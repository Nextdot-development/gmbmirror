import "server-only";
import { query, tx } from "./db-pg";
import type { Job, JobKind, JobStatus } from "./types";

/**
 * The job queue in PostgreSQL (APP_MODE=supabase). Shared by every server instance and every scheduler call:
 *  - duplicate protection is a unique index (one live or succeeded job per user and key);
 *  - a runner claims one job at a time with `claim_next_job` (FOR UPDATE SKIP LOCKED, a lease and a fresh lease
 *    token), so two runners never take the same job;
 *  - a result is saved only while the runner still holds the lease token, so a runner whose lease expired cannot
 *    overwrite the work of the runner that took the job over.
 * Nothing depends on memory in the server process.
 */

type Row = {
  id: string; user_id: string; location_id: string; kind: JobKind; key: string; status: JobStatus; run_at: Date; lease_until: Date | null;
  lease_token: string | null; attempts: number; max_attempts: number; payload: Record<string, string>; last_error: string | null;
  log: Job["log"]; created_at: Date; updated_at: Date;
};

const LIVE: JobStatus[] = ["queued", "running", "waiting"];

export function toJob(r: Row): Job {
  return {
    id: r.id, kind: r.kind, loc: r.location_id, key: r.key, runAt: r.run_at.toISOString(), status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts,
    ...(r.lease_until ? { leaseUntil: r.lease_until.toISOString() } : {}), ...(r.last_error ? { lastError: r.last_error } : {}),
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), payload: r.payload ?? {}, log: r.log ?? [],
  };
}

export async function pgListJobs(userId: string, loc?: string): Promise<Job[]> {
  const rows = await query<Row>(
    `select * from public.jobs where user_id = $1 ${loc ? "and location_id = $2" : ""} order by created_at desc limit 400`,
    loc ? [userId, loc] : [userId],
  );
  return rows.map(toJob);
}

export type NewJobRow = { kind: JobKind; loc: string; key: string; runAt: Date; payload?: Record<string, string>; maxAttempts?: number };

/** Queues a job unless one with the key is live or has succeeded (that one is returned). Atomic. */
export async function pgEnqueue(userId: string, j: NewJobRow): Promise<Job> {
  await query("insert into public.accounts (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
  const t = new Date().toISOString();
  const made = await query<Row>(
    `insert into public.jobs (user_id, location_id, kind, key, status, run_at, max_attempts, payload, log)
     values ($1, $2, $3, $4, 'queued', $5, $6, $7::jsonb, $8::jsonb)
     on conflict (user_id, key) where status in ('queued', 'running', 'waiting', 'succeeded') do nothing
     returning *`,
    [userId, j.loc, j.kind, j.key, j.runAt, j.maxAttempts ?? 4, JSON.stringify(j.payload ?? {}), JSON.stringify([{ at: t, status: "queued", message: `Scheduled for ${j.runAt.toISOString()}.` }])],
  );
  if (made[0]) return toJob(made[0]);
  const existing = await query<Row>(
    "select * from public.jobs where user_id = $1 and key = $2 and status in ('queued', 'running', 'waiting', 'succeeded') limit 1",
    [userId, j.key],
  );
  return toJob(existing[0]);
}

/** Cancels the user's live jobs that match (one key, a key prefix, or a location). Returns how many. */
export async function pgCancel(userId: string, match: { key?: string; prefix?: string; loc?: string }, reason: string): Promise<number> {
  const cond = match.key !== undefined ? "key = $2" : match.prefix !== undefined ? "starts_with(key, $2)" : "location_id = $2";
  const arg = match.key ?? match.prefix ?? match.loc!;
  const entry = JSON.stringify([{ at: new Date().toISOString(), status: "cancelled", message: reason }]);
  const rows = await query(
    `update public.jobs set status = 'cancelled', lease_until = null, lease_token = null, updated_at = now(),
            log = (select coalesce(jsonb_agg(t.e order by t.n), '[]'::jsonb) from jsonb_array_elements($3::jsonb || log) with ordinality as t (e, n) where t.n <= 30)
      where user_id = $1 and ${cond} and status = any($4::text[]) returning id`,
    [userId, arg, entry, LIVE],
  );
  return rows.length;
}

export type Claimed = { job: Job; userId: string; token: string };

/** Claims the next due job of any user, or null when nothing is due. */
export async function pgClaimNext(at: Date, leaseSeconds: number): Promise<Claimed | null> {
  const rows = await query<Row>("select * from public.claim_next_job($1, $2)", [at, leaseSeconds]);
  const r = rows[0];
  return r ? { job: toJob(r), userId: r.user_id, token: r.lease_token! } : null;
}

/**
 * Saves a job's result, only if this runner still holds the job (same lease token, still running).
 * Returns false when the lease was lost: another runner has taken the job and its result counts instead.
 */
export async function pgFinish(c: Claimed, next: Job): Promise<boolean> {
  return tx(async (cl) => {
    const res = await cl.query(
      `update public.jobs set status = $3, run_at = $4, attempts = $5, lease_until = null, lease_token = null, last_error = $6, log = $7::jsonb, updated_at = now()
        where id = $1 and lease_token = $2 and status = 'running'`,
      [c.job.id, c.token, next.status, next.runAt, next.attempts, next.lastError ?? null, JSON.stringify(next.log.slice(0, 30))],
    );
    return res.rowCount === 1;
  });
}
