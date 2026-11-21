import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { authUser, inNewProcess, startPostgres, useSupabaseMode, type TestDb } from "./harness";

// The background job queue and the shared rate limits in Supabase mode, against a real local PostgreSQL.

let t: TestDb;
type Jobs = typeof import("@/lib/jobs");
let jobs: Jobs;

before(async () => {
  t = await startPostgres();
  useSupabaseMode(t.url);
  process.env.DATABASE_POOL_MAX = "10";
  jobs = await import("@/lib/jobs");
});
after(async () => {
  await (await import("@/lib/db-pg")).closePool();
  await t.stop();
});

const ok = { status: "succeeded" as const, message: "done" };
const at = new Date("2026-12-01T10:00:00Z");

test("duplicate protection is enforced by the database: twenty simultaneous enqueues of one key make one job", async () => {
  const u = await authUser(t.admin, "dup@example.test");
  const made = await Promise.all(Array.from({ length: 20 }, () => jobs.enqueue(u, { kind: "monthly_report", loc: "main", key: "monthly_report:main:2026-11", runAt: at, payload: { month: "2026-11" } })));
  assert.equal(new Set(made.map((j) => j.id)).size, 1);
  assert.equal((await jobs.listJobs(u)).length, 1);
  // A succeeded key is done: it is not queued again.
  await t.admin.query("update public.jobs set status = 'succeeded' where user_id = $1", [u]);
  const again = await jobs.enqueue(u, { kind: "monthly_report", loc: "main", key: "monthly_report:main:2026-11", runAt: at });
  assert.equal(again.id, made[0].id);
});

test("several runners at once (overlapping scheduler calls): every due job runs exactly once", async () => {
  const users = await Promise.all(["r1", "r2", "r3"].map((n) => authUser(t.admin, `${n}@example.test`)));
  for (const u of users) for (let i = 0; i < 8; i++) await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: `publish_post:main:p${i}:t`, runAt: at });
  const runs = new Map<string, number>();
  const handler = { publish_post: async (j: { id: string }) => {
    runs.set(j.id, (runs.get(j.id) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, 5));
    return ok;
  } };
  const results = await Promise.all(Array.from({ length: 4 }, () => jobs.runDueJobs(handler, { at })));
  assert.equal(results.reduce((n, r) => n + r.ran, 0), 24);
  assert.equal(runs.size, 24);
  assert.ok([...runs.values()].every((n) => n === 1), "no job ran twice");
  for (const u of users) assert.ok((await jobs.listJobs(u)).every((j) => j.status === "succeeded"));
});

test("runners in two separate processes (two server instances) never take the same job", async () => {
  const u = await authUser(t.admin, "proc@example.test");
  for (let i = 0; i < 12; i++) await jobs.enqueue(u, { kind: "refresh_profile", loc: "main", key: `refresh_profile:main:d${i}`, runAt: at });
  const code = `const { runDueJobs } = await import("@/lib/jobs");
    const r = await runDueJobs({ refresh_profile: async (j) => { await new Promise((s) => setTimeout(s, 10)); return { status: "succeeded", message: process.pid + "" }; } }, { at: new Date(${JSON.stringify(at.toISOString())}) });
    await (await import("@/lib/db-pg")).closePool();
    console.log(JSON.stringify(r.results.map((x) => x.id)));`;
  const env = { DATABASE_URL: t.url, APP_MODE: "supabase" };
  const [a, b] = await Promise.all([inNewProcess(code, env), inNewProcess(code, env)]);
  const ids = [...JSON.parse(a), ...JSON.parse(b)];
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12, "each job was run by exactly one instance");
});

test("a runner that loses its lease cannot overwrite the result of the runner that took the job over", async () => {
  const u = await authUser(t.admin, "lease@example.test");
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:slow:t", runAt: at });
  const { pgClaimNext, pgFinish } = await import("@/lib/jobs-pg");
  const first = (await pgClaimNext(at, 300))!;
  // The first runner stalls past its lease (5 minutes); a second one claims the job.
  const later = new Date(at.getTime() + 6 * 60_000);
  const second = (await pgClaimNext(later, 300))!;
  assert.equal(second.job.id, first.job.id);
  assert.equal(second.job.attempts, 2);
  assert.notEqual(second.token, first.token);
  assert.equal(await pgFinish(second, jobs.applyOutcome(second.job, ok, later)), true);
  assert.equal(await pgFinish(first, jobs.applyOutcome(first.job, { status: "failed", message: "stale" }, later)), false, "the stale runner's result is refused");
  const j = (await jobs.listJobs(u))[0];
  assert.equal(j.status, "succeeded");
  assert.ok(j.log.some((l) => l.message === "Attempt 2 started."));
});

test("retries back off and are kept in the database; waiting does not use attempts; cancellation by prefix and by location", async () => {
  const u = await authUser(t.admin, "retry@example.test");
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:flaky:t", runAt: at, maxAttempts: 2 });
  await jobs.enqueue(u, { kind: "review_sweep", loc: "main", key: "review_sweep:main:x", runAt: at });
  const handlers = {
    publish_post: async () => ({ status: "retry" as const, message: "Google busy" }),
    review_sweep: async () => ({ status: "waiting" as const, message: "Not connected", until: new Date(at.getTime() + 3600_000), giveUpAt: new Date(at.getTime() + 30 * 86_400_000) }),
  };
  await jobs.runDueJobs(handlers, { at });
  const by = async (k: string) => (await jobs.listJobs(u)).find((j) => j.key === k)!;
  assert.equal((await by("publish_post:main:flaky:t")).status, "queued");
  assert.equal((await by("publish_post:main:flaky:t")).runAt, new Date(at.getTime() + jobs.BACKOFF_MS[0]).toISOString());
  assert.equal((await by("review_sweep:main:x")).status, "waiting");
  assert.equal((await by("review_sweep:main:x")).attempts, 0);
  // Nothing due at the same moment: nothing runs twice.
  assert.equal((await jobs.runDueJobs(handlers, { at })).ran, 0);
  await jobs.runDueJobs(handlers, { at: new Date(at.getTime() + jobs.BACKOFF_MS[0] + 1000) });
  const failed = await by("publish_post:main:flaky:t");
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "Google busy");
  // Cancellation.
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:p7:a", runAt: at });
  await jobs.enqueue(u, { kind: "publish_post", loc: "b2", key: "publish_post:b2:p8:a", runAt: at });
  assert.equal(await jobs.cancelMatching(u, "publish_post:main:p7:", "edited"), 1);
  assert.equal(await jobs.cancelLocationJobs(u, "b2", "removed"), 1);
  assert.equal((await by("publish_post:main:p7:a")).status, "cancelled");
  assert.equal((await by("publish_post:b2:p8:a")).log[0].message, "removed");
});

test("jobs survive a restart: queued by one process, run by a new one", async () => {
  const u = await authUser(t.admin, "restart@example.test");
  await jobs.enqueue(u, { kind: "monthly_report", loc: "main", key: "monthly_report:main:2026-10", runAt: at });
  const out = await inNewProcess(
    `const { runDueJobs, listJobs } = await import("@/lib/jobs");
     await runDueJobs({ monthly_report: async () => ({ status: "succeeded", message: "made" }) }, { at: new Date(${JSON.stringify(at.toISOString())}) });
     console.log((await listJobs(${JSON.stringify(u)}))[0].status);
     await (await import("@/lib/db-pg")).closePool();`,
    { DATABASE_URL: t.url, APP_MODE: "supabase" },
  );
  assert.equal(out, "succeeded");
});

test("shared rate limits: 50 simultaneous attempts against a limit of 10 let exactly 10 through", async () => {
  const { takeShared, peekShared, refundShared, clearShared } = await import("@/lib/ratelimit");
  const l = { limit: 10, windowMs: 60_000 };
  const r = await Promise.all(Array.from({ length: 50 }, () => takeShared("login:fail:test", l)));
  assert.equal(r.filter((x) => x.ok).length, 10);
  assert.ok(r.find((x) => !x.ok)!.retryAfterSec > 0);
  assert.equal((await peekShared("login:fail:test", l)).ok, false);
  await refundShared("login:fail:test");
  assert.equal((await takeShared("login:fail:test", l)).ok, true);
  await clearShared("login:fail:test");
  assert.equal((await peekShared("login:fail:test", l)).ok, true);
  assert.equal((await takeShared("cost", { limit: 60, windowMs: 60_000 }, 26)).ok, true);
  assert.equal((await takeShared("cost", { limit: 60, windowMs: 60_000 }, 26)).ok, true);
  assert.equal((await takeShared("cost", { limit: 60, windowMs: 60_000 }, 26)).ok, false, "a cost above what is left is refused and not counted");
  assert.equal((await takeShared("cost", { limit: 60, windowMs: 60_000 }, 8)).ok, true);
});
