import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./store";
import { env } from "./env";
import { pgCancel, pgClaimNext, pgEnqueue, pgFinish, pgListJobs } from "./jobs-pg";
import { runAsAiUser } from "./ai-usage";
import type { Job, JobKind, JobStatus } from "./types";

/**
 * Background job queue. Jobs live with the user's data (per-user key "jobs"); each names its location. A runner
 * (in-process timer, or the /api/jobs/run endpoint called by a scheduler) takes due jobs, runs them, and records the
 * result. Guarantees, within one server process:
 *  - one live job per key (duplicate protection),
 *  - a running job holds a lease, so it is not taken twice; a crashed run is retried after the lease expires,
 *  - failures are retried with back-off, then marked failed with the reason,
 *  - every step is logged on the job.
 * Demo mode (JSON store): claims are atomic within one server process, which is all the JSON store supports.
 * Supabase mode: the queue lives in PostgreSQL (jobs-pg.ts) and is safe across instances; see runDueJobsPg.
 */

const MAX_JOBS = 400;
const LEASE_MS = 5 * 60_000;
/** Waits before attempts 2, 3 and 4. */
export const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const LIVE: JobStatus[] = ["queued", "running", "waiting"];

const now = () => new Date();
const iso = (d: Date) => d.toISOString();

export async function listJobs(userId: string, loc?: string): Promise<Job[]> {
  if (env.mode() === "supabase") return pgListJobs(userId, loc);
  const all = await db.getUserKey<Job[]>(userId, "jobs", []);
  return loc ? all.filter((j) => j.loc === loc) : all;
}

/**
 * Applies a change to the stored job list as one atomic step (the store's read-change-write, see updateKey): no other
 * change in this process can land between reading the list and writing it. That is what makes claiming a job safe:
 * two runners (the timer and the scheduler endpoint) can never both see a job as due and both take it.
 */
async function update(userId: string, fn: (jobs: Job[]) => Job[]): Promise<Job[]> {
  return db.updateUserKey<Job[]>(userId, "jobs", [], (before) => {
    const next = fn(before);
    // Nothing changed (for example a duplicate key): nothing to write.
    if (next === before || (next.length === before.length && next.every((j, i) => j === before[i]))) return undefined;
    // Finished jobs older than 60 days are dropped first when the list is full.
    const cutoff = Date.now() - 60 * 86_400_000;
    return next.length > MAX_JOBS ? next.filter((j) => LIVE.includes(j.status) || Date.parse(j.updatedAt) > cutoff).slice(0, MAX_JOBS) : next;
  });
}

export type NewJob = { kind: JobKind; loc: string; key: string; runAt: Date; payload?: Record<string, string>; maxAttempts?: number };

/**
 * Queues a job unless one with the same key is already queued, running or waiting (that one is returned), or has
 * already succeeded (also returned: a key is done once).
 */
export async function enqueue(userId: string, j: NewJob): Promise<Job> {
  if (env.mode() === "supabase") return pgEnqueue(userId, j);
  let result!: Job;
  await update(userId, (jobs) => {
    const existing = jobs.find((x) => x.key === j.key && (LIVE.includes(x.status) || x.status === "succeeded"));
    if (existing) {
      result = existing;
      return jobs;
    }
    const t = iso(now());
    result = { id: randomUUID(), kind: j.kind, loc: j.loc, key: j.key, runAt: iso(j.runAt), status: "queued", attempts: 0, maxAttempts: j.maxAttempts ?? 4,
      createdAt: t, updatedAt: t, payload: j.payload ?? {}, log: [{ at: t, status: "queued", message: `Scheduled for ${iso(j.runAt)}.` }] };
    return [result, ...jobs];
  });
  return result;
}

/** Cancels the live jobs with this key (for example when a scheduled post is edited or deleted). */
export async function cancelJobs(userId: string, key: string, reason: string): Promise<number> {
  if (env.mode() === "supabase") return pgCancel(userId, { key }, reason);
  let n = 0;
  await update(userId, (jobs) => jobs.map((x) => {
    if (x.key !== key || !LIVE.includes(x.status)) return x;
    n++;
    const t = iso(now());
    return { ...x, status: "cancelled", leaseUntil: undefined, updatedAt: t, log: [{ at: t, status: "cancelled" as const, message: reason }, ...x.log].slice(0, 30) };
  }));
  return n;
}

/** Cancels every live job of one location (for example when the location is removed). */
export async function cancelLocationJobs(userId: string, loc: string, reason: string): Promise<number> {
  if (env.mode() === "supabase") return pgCancel(userId, { loc }, reason);
  let n = 0;
  await update(userId, (jobs) => jobs.map((x) => {
    if (x.loc !== loc || !LIVE.includes(x.status)) return x;
    n++;
    const t = iso(now());
    return { ...x, status: "cancelled", leaseUntil: undefined, updatedAt: t, log: [{ at: t, status: "cancelled" as const, message: reason }, ...x.log].slice(0, 30) };
  }));
  return n;
}

/** Cancels every live job whose key starts with `prefix` (for example all scheduled runs of one post). */
export async function cancelMatching(userId: string, prefix: string, reason: string): Promise<number> {
  if (env.mode() === "supabase") return pgCancel(userId, { prefix }, reason);
  let n = 0;
  await update(userId, (jobs) => jobs.map((x) => {
    if (!x.key.startsWith(prefix) || !LIVE.includes(x.status)) return x;
    n++;
    const t = iso(now());
    return { ...x, status: "cancelled", leaseUntil: undefined, updatedAt: t, log: [{ at: t, status: "cancelled" as const, message: reason }, ...x.log].slice(0, 30) };
  }));
  return n;
}

export type JobOutcome =
  | { status: "succeeded"; message: string }
  /** Try again later (a temporary failure): counts as an attempt. */
  | { status: "retry"; message: string }
  /** Cannot run yet for a known reason; checked again at `until`. Does not use up attempts, but expires at `giveUpAt`. */
  | { status: "waiting"; message: string; until: Date; giveUpAt?: Date }
  | { status: "failed"; message: string }
  | { status: "cancelled"; message: string };

export type Handler = (job: Job, userId: string) => Promise<JobOutcome>;

/** Is the job due now: queued or waiting with its time reached, or running with an expired lease (a crashed run). */
export function isDue(j: Job, at = now()): boolean {
  if ((j.status === "queued" || j.status === "waiting") && Date.parse(j.runAt) <= at.getTime()) return true;
  return j.status === "running" && Boolean(j.leaseUntil) && Date.parse(j.leaseUntil!) <= at.getTime();
}

/** The job after an outcome: retries back off, attempts run out into "failed", waiting jobs expire. */
export function applyOutcome(j: Job, o: JobOutcome, at = now()): Job {
  const t = iso(at);
  let next: Job = { ...j, leaseUntil: undefined, updatedAt: t };
  if (o.status === "retry") {
    if (j.attempts >= j.maxAttempts) next = { ...next, status: "failed", lastError: o.message };
    else next = { ...next, status: "queued", lastError: o.message, runAt: iso(new Date(at.getTime() + BACKOFF_MS[Math.min(j.attempts - 1, BACKOFF_MS.length - 1)])) };
  } else if (o.status === "waiting") {
    const giveUp = o.giveUpAt ?? new Date(Date.parse(j.createdAt) + 7 * 86_400_000);
    next = at >= giveUp
      ? { ...next, status: "failed", lastError: `${o.message} Gave up after waiting.` }
      // Waiting does not use up an attempt.
      : { ...next, status: "waiting", attempts: Math.max(0, j.attempts - 1), lastError: o.message, runAt: iso(o.until) };
  } else {
    next = { ...next, status: o.status, lastError: o.status === "failed" ? o.message : undefined };
  }
  const message = next.status === "failed" && o.status === "retry" ? `${o.message} No attempts left.` : o.message;
  return { ...next, log: [{ at: t, status: next.status, message }, ...j.log].slice(0, 30) };
}

// Shared by every copy of this module in the process (Next.js may load it once per bundle).
const runner = globalThis as unknown as { __gmbJobsBusy?: boolean };

/** Time-sensitive work first: scheduled posts, then review automation, then refreshes and reports. */
const PRIORITY: Record<JobKind, number> = { publish_post: 0, review_sweep: 1, refresh_profile: 2, monthly_report: 3 };
/** Jobs started per pass, across all users; the rest run on the next pass. */
const PER_PASS = 60;

/**
 * Runs due jobs for the given users (default: every user with data). Due jobs of all users are collected first and
 * run by priority, so one busy account cannot delay another's scheduled post. One pass at a time per process.
 */
export type RunOpts = { userIds?: string[]; at?: Date; budgetMs?: number; onFailed?: (userId: string, job: Job) => Promise<unknown> };

/** Tells the owner about a job that failed for good. Never stops the run. */
async function failedHook(opts: RunOpts, userId: string, job: Job | undefined) {
  if (job?.status === "failed" && opts.onFailed) await opts.onFailed(userId, job).catch((e) => console.error("[jobs] failure notice not sent:", e instanceof Error ? e.message : e));
}

export async function runDueJobs(handlers: Partial<Record<JobKind, Handler>>, opts: RunOpts = {}): Promise<{ ran: number; results: { id: string; kind: JobKind; status: JobStatus }[]; skipped?: string }> {
  if (env.mode() === "supabase") return runDueJobsPg(handlers, opts);
  if (runner.__gmbJobsBusy) return { ran: 0, results: [], skipped: "A run is already in progress." };
  runner.__gmbJobsBusy = true;
  const results: { id: string; kind: JobKind; status: JobStatus }[] = [];
  try {
    const users = opts.userIds ?? (await db.listUserIds());
    const at = opts.at ?? now();
    const due: { userId: string; job: Job }[] = [];
    for (const userId of users) for (const job of (await listJobs(userId)).filter((j) => isDue(j, at))) due.push({ userId, job });
    due.sort((a, b) => PRIORITY[a.job.kind] - PRIORITY[b.job.kind] || a.job.runAt.localeCompare(b.job.runAt));
    for (const { userId, job } of due.slice(0, PER_PASS)) {
      // Claim it: running, with a lease, one more attempt.
      let claimed: Job | undefined;
      await update(userId, (jobs) => jobs.map((x) => {
        if (x.id !== job.id || !isDue(x, at)) return x;
        const t = iso(now());
        claimed = { ...x, status: "running", attempts: x.attempts + 1, leaseUntil: iso(new Date(at.getTime() + LEASE_MS)), updatedAt: t,
          log: [{ at: t, status: "running" as const, message: `Attempt ${x.attempts + 1} started.` }, ...x.log].slice(0, 30) };
        return claimed;
      }));
      if (!claimed) continue;
      const handler = handlers[claimed.kind];
      let outcome: JobOutcome;
      try {
        // Claude calls made by the job count against the job owner's allowance.
        outcome = handler ? await runAsAiUser(userId, () => handler(claimed!, userId)) : { status: "failed", message: `No handler for ${claimed.kind}.` };
      } catch (e) {
        outcome = { status: "retry", message: e instanceof Error ? e.message : "The job failed." };
      }
      let final!: Job;
      // Retry and waiting times count from the run's time (the test clock, or now).
      const runAt = opts.at ? at : now();
      await update(userId, (jobs) => jobs.map((x) => (x.id === claimed!.id ? (final = applyOutcome(x, outcome, runAt)) : x)));
      results.push({ id: claimed.id, kind: claimed.kind, status: final?.status ?? "failed" });
      await failedHook(opts, userId, final);
    }
  } finally {
    runner.__gmbJobsBusy = false;
  }
  return { ran: results.length, results };
}

/**
 * Supabase mode: claims due jobs one at a time from the database (any user, time-sensitive kinds first) until none
 * is due, PER_PASS jobs have run, or the time budget is spent. Each claim holds a lease, so several runners (two
 * overlapping scheduler calls, several instances) can run at once without taking the same job. A runner stopped
 * mid-job (function timeout, crash) leaves the lease to expire; the job is then taken again and retried.
 * `budgetMs`: stop starting new jobs after this long (keep it well under the function's time limit).
 */
async function runDueJobsPg(handlers: Partial<Record<JobKind, Handler>>, opts: RunOpts) {
  const results: { id: string; kind: JobKind; status: JobStatus }[] = [];
  const started = Date.now();
  const budget = opts.budgetMs ?? 240_000;
  for (let i = 0; i < PER_PASS && Date.now() - started < budget; i++) {
    const at = opts.at ?? now();
    const claimed = await pgClaimNext(at, LEASE_MS / 1000);
    if (!claimed) break;
    const handler = handlers[claimed.job.kind];
    let outcome: JobOutcome;
    try {
      outcome = handler ? await runAsAiUser(claimed.userId, () => handler(claimed.job, claimed.userId)) : { status: "failed", message: `No handler for ${claimed.job.kind}.` };
    } catch (e) {
      outcome = { status: "retry", message: e instanceof Error ? e.message : "The job failed." };
    }
    const next = applyOutcome(claimed.job, outcome, opts.at ? at : now());
    const saved = await pgFinish(claimed, next);
    results.push({ id: claimed.job.id, kind: claimed.job.kind, status: saved ? next.status : "running" });
    // Only the runner that saved the final state tells the owner, so a failure is reported once.
    if (saved) await failedHook(opts, claimed.userId, next);
  }
  return { ran: results.length, results };
}
