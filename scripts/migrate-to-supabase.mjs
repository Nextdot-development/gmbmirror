#!/usr/bin/env node
/**
 * GMBmirror: copy stored data into the Supabase (PostgreSQL) tables of supabase/migrations/*_gmbmirror_core.sql.
 *
 * Non-destructive by design:
 *  - The source is only read: the demo JSON files (.data/users.json, .data/user_data.json) are opened read-only, and
 *    the old Supabase table public.user_data is only selected from. Nothing is ever deleted from a source.
 *  - Dry run by default. Nothing is written without --apply.
 *  - A user who already has an account row in the database is skipped entirely (never merged, never overwritten),
 *    so running it again creates no duplicates.
 *  - Each user is copied in one transaction and checked by counting rows before it is committed.
 *  - Every copied account is tagged with the batch id; --rollback <batch> removes exactly that batch (its accounts and,
 *    through foreign keys, their locations, records, connections and jobs) and nothing else.
 *
 * Accounts: demo accounts are matched to Supabase Auth users by email (demo password hashes cannot be moved to
 * Supabase Auth). Create or invite each person in Supabase Auth first (same email); unmatched users are reported and
 * skipped, and can be copied by running the script again later.
 *
 * Usage (DATABASE_URL: a direct or session connection string with rights on auth.users and public.*):
 *   node scripts/migrate-to-supabase.mjs --json .data                 # dry run from the demo JSON files
 *   node scripts/migrate-to-supabase.mjs --json .data --apply         # copy
 *   node scripts/migrate-to-supabase.mjs --user-data-table --apply    # copy from the old public.user_data table
 *   node scripts/migrate-to-supabase.mjs --rollback <batch>           # remove one copied batch
 * Optional: DATABASE_CA_CERT (PEM) to verify the server certificate.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";

const LOCATION_KEYS = ["business", "checks", "replies", "posts", "guide", "places", "growth", "automation_log", "reports", "share_events", "review_stats", "insights_notes", "gbp_scores"];
const JOB_KINDS = ["publish_post", "review_sweep", "refresh_profile", "monthly_report"];
const JOB_STATUS = ["queued", "running", "waiting", "succeeded", "failed", "cancelled"];
const LOC_ID = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** j***@example.com: reports never print full email addresses. */
export const mask = (email) => (email ? email.replace(/^(.)[^@]*/, "$1***") : "(no email)");

/**
 * Turns one user's stored values (the store's key names) into table rows. Pure: no database access.
 * Returns the rows and what was left out, with reasons.
 */
export function planUser(values) {
  const skipped = [];
  const raw = values.locations;
  const listed = Array.isArray(raw?.ids) ? raw.ids.filter((x) => typeof x === "string" && LOC_ID.test(x)) : [];
  const others = listed.filter((x) => x !== "main");
  // Same rule as the app: "main" is listed unless it was removed and another location remains.
  const ids = raw?.mainRemoved && others.length ? others : ["main", ...others];
  const active = raw && ids.includes(raw.active) ? raw.active : ids[0];
  const records = [], google = [], userRecords = [], jobs = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === "locations") continue;
    if (key === "ai_usage") { userRecords.push({ key, value }); continue; }
    if (key === "jobs") {
      for (const j of Array.isArray(value) ? value : []) {
        if (!j || !UUID.test(j.id ?? "") || !JOB_KINDS.includes(j.kind) || !JOB_STATUS.includes(j.status) || typeof j.key !== "string") { skipped.push({ key: `jobs/${j?.id ?? "?"}`, reason: "not a valid job" }); continue; }
        jobs.push(j);
      }
      continue;
    }
    const m = key.match(/^loc:([A-Za-z0-9_-]{1,40}):(.+)$/);
    const loc = m ? m[1] : "main", k = m ? m[2] : key;
    if (!ids.includes(loc)) { skipped.push({ key, reason: "belongs to a location that is not in the location list (left over from a removed location)" }); continue; }
    if (value === null || value === undefined) { skipped.push({ key, reason: "empty value" }); continue; }
    if (k === "google") google.push({ loc, value });
    else if (LOCATION_KEYS.includes(k)) records.push({ loc, key: k, value });
    else skipped.push({ key, reason: "unknown key" });
  }
  return { index: { active, ids, mainRemoved: !ids.includes("main") }, records, google, userRecords, jobs, skipped };
}

async function readJsonSource(dir) {
  const read = async (f) => {
    const h = await fs.open(path.join(dir, f), "r"); // read-only
    try { return JSON.parse(await h.readFile("utf8")); } finally { await h.close(); }
  };
  const users = await read("users.json").catch((e) => (e.code === "ENOENT" ? {} : Promise.reject(e)));
  const data = await read("user_data.json").catch((e) => (e.code === "ENOENT" ? {} : Promise.reject(e)));
  const emailById = new Map(Object.values(users).map((u) => [u.id, String(u.email).toLowerCase()]));
  return Object.entries(data).map(([id, values]) => ({ sourceId: id, email: emailById.get(id), values }));
}

async function readTableSource(db) {
  const rows = (await db.query("select user_id, key, value from public.user_data order by user_id, key")).rows;
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.user_id)) by.set(r.user_id, {});
    by.get(r.user_id)[r.key] = r.value;
  }
  return [...by].map(([id, values]) => ({ sourceId: id, values, sameId: true }));
}

/** Copies one user in one transaction. Returns counts, or why the user was skipped. */
async function copyUser(db, targetId, plan, batch) {
  const c = await db.connect();
  try {
    await c.query("begin");
    const exists = await c.query("select 1 from public.accounts where user_id = $1", [targetId]);
    if (exists.rowCount) { await c.query("rollback"); return { skipped: "already in the database (left unchanged)" }; }
    await c.query("insert into public.accounts (user_id, active_location, main_removed, migration_batch) values ($1, $2, $3, $4)", [targetId, plan.index.active, plan.index.mainRemoved, batch]);
    for (const [i, id] of plan.index.ids.entries()) await c.query("insert into public.locations (user_id, id, position) values ($1, $2, $3)", [targetId, id, i]);
    for (const r of plan.records) await c.query("insert into public.location_records (user_id, location_id, key, value) values ($1, $2, $3, $4::jsonb)", [targetId, r.loc, r.key, JSON.stringify(r.value)]);
    for (const g of plan.google) await c.query("insert into public.google_connections (user_id, location_id, connection) values ($1, $2, $3::jsonb)", [targetId, g.loc, JSON.stringify(g.value)]);
    for (const u of plan.userRecords) await c.query("insert into public.user_records (user_id, key, value) values ($1, $2, $3::jsonb)", [targetId, u.key, JSON.stringify(u.value)]);
    let jobs = 0;
    for (const j of plan.jobs) {
      const r = await c.query(
        `insert into public.jobs (id, user_id, location_id, kind, key, status, run_at, lease_until, attempts, max_attempts, payload, last_error, log, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15) on conflict do nothing`,
        [j.id, targetId, j.loc ?? "main", j.kind, j.key, j.status, j.runAt, j.leaseUntil ?? null, j.attempts ?? 0, j.maxAttempts ?? 4, JSON.stringify(j.payload ?? {}), j.lastError ?? null,
          JSON.stringify((j.log ?? []).slice(0, 30)), j.createdAt ?? new Date().toISOString(), j.updatedAt ?? new Date().toISOString()],
      );
      jobs += r.rowCount;
    }
    // Check before committing: everything planned is there.
    const count = async (t) => Number((await c.query(`select count(*) from public.${t} where user_id = $1`, [targetId])).rows[0].count);
    const got = { locations: await count("locations"), records: await count("location_records"), google: await count("google_connections"), userRecords: await count("user_records") };
    const want = { locations: plan.index.ids.length, records: plan.records.length, google: plan.google.length, userRecords: plan.userRecords.length };
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`Count check failed: expected ${JSON.stringify(want)}, found ${JSON.stringify(got)}.`);
    await c.query("commit");
    return { copied: { ...got, jobs, jobsSkipped: plan.jobs.length - jobs } };
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function migrate({ databaseUrl, json, userDataTable, apply, rollback, log = console.log }) {
  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const db = new pg.Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: 2 });
  try {
    if (rollback) {
      const r = await db.query("delete from public.accounts where migration_batch = $1 returning user_id", [rollback]);
      await db.query("update public.migration_runs set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('rolledBackAt', now()::text, 'rolledBackUsers', $2::int) where batch = $1", [rollback, r.rowCount]);
      log(`Rolled back batch ${rollback}: removed ${r.rowCount} account(s) and their data. Nothing else was changed.`);
      return { rolledBack: r.rowCount };
    }
    const source = json ? await readJsonSource(json) : userDataTable ? await readTableSource(db) : null;
    if (!source) throw new Error("Choose a source: --json <dir> or --user-data-table.");
    const batch = `m-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`;
    const report = { batch, mode: apply ? "apply" : "dry-run", source: json ? `json:${json}` : "public.user_data", users: [] };
    if (apply) await db.query("insert into public.migration_runs (batch, source) values ($1, $2)", [batch, report.source]);
    for (const u of source) {
      const plan = planUser(u.values);
      const entry = { source: u.sameId ? u.sourceId : mask(u.email), locations: plan.index.ids.length, records: plan.records.length, google: plan.google.length, jobs: plan.jobs.length, skippedKeys: plan.skipped };
      let target;
      if (u.sameId) target = (await db.query("select id from auth.users where id = $1", [u.sourceId])).rows[0]?.id;
      else if (u.email) target = (await db.query("select id from auth.users where lower(email) = $1", [u.email])).rows[0]?.id;
      if (!target) { report.users.push({ ...entry, result: "skipped: no Supabase Auth user with this email (create or invite them, then run again)" }); continue; }
      if (!apply) {
        const exists = (await db.query("select 1 from public.accounts where user_id = $1", [target])).rowCount;
        report.users.push({ ...entry, result: exists ? "would skip: already in the database" : "would copy" });
        continue;
      }
      const r = await copyUser(db, target, plan, batch);
      report.users.push({ ...entry, result: r.skipped ? `skipped: ${r.skipped}` : "copied", ...(r.copied ? { copied: r.copied } : {}) });
    }
    const summary = { users: report.users.length, copied: report.users.filter((x) => x.result === "copied").length, skipped: report.users.filter((x) => x.result.startsWith("skipped")).length };
    report.summary = summary;
    if (apply) await db.query("update public.migration_runs set finished_at = now(), summary = $2::jsonb where batch = $1", [batch, JSON.stringify(summary)]);
    log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    await db.end();
  }
}

/** Fingerprint of the source files, so an operator (and the tests) can confirm they were not changed. */
export async function sourceFingerprint(dir) {
  const h = createHash("sha256");
  for (const f of ["users.json", "user_data.json", "sessions.json"]) h.update(await fs.readFile(path.join(dir, f)).catch(() => Buffer.from("")));
  return h.digest("hex");
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate-to-supabase.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error("Set DATABASE_URL to the Supabase database connection string."); process.exit(2); }
  migrate({ databaseUrl, json: opt("--json"), userDataTable: args.includes("--user-data-table"), apply: args.includes("--apply"), rollback: opt("--rollback") })
    .catch((e) => { console.error(`Migration stopped: ${e.message}`); process.exit(1); });
}
