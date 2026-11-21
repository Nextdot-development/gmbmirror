import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The job queue and per-location storage, against a demo store in a temporary folder: the project's .data is never
// touched (the store resolves its file from the working directory when it is first loaded).
const dir = mkdtempSync(path.join(os.tmpdir(), "gmb-unit-"));
process.chdir(dir);
process.env.APP_MODE = "demo";
process.env.SESSION_SECRET = "s".repeat(40);
delete process.env.TRUSTED_PROXY_HOPS;

type Jobs = typeof import("@/lib/jobs");
type Store = typeof import("@/lib/store");
let jobs: Jobs, store: Store;
before(async () => {
  store = await import("@/lib/store");
  jobs = await import("@/lib/jobs");
});

test("the store works in the temporary folder, not the project", () => {
  assert.equal(realpathSync(process.cwd()), realpathSync(dir));
});

test("locations: main uses the original keys, others are separate; deleting the account removes every location", async () => {
  const { db } = store;
  const u = "user-a";
  await db.saveBusiness({ userId: u, loc: "main" }, { name: "Main", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });
  await db.saveBusiness({ userId: u, loc: "b2" }, { name: "Branch", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });
  await db.savePosts({ userId: u, loc: "b2" }, [{ id: "p", text: "t", kind: "STANDARD", status: "draft", warnings: [], createdAt: "" }]);
  assert.equal((await db.getBusiness({ userId: u, loc: "main" }))!.name, "Main");
  assert.equal((await db.getBusiness({ userId: u, loc: "b2" }))!.name, "Branch");
  assert.equal((await db.getPosts({ userId: u, loc: "main" })).length, 0, "posts never leak between locations");
  assert.equal((await db.getBusiness({ userId: "user-b", loc: "b2" })), null, "or between users");
  // Unknown or missing index: only main, active main.
  assert.deepEqual(await db.getLocations(u), { active: "main", ids: ["main"] });
  await db.saveLocations(u, { active: "b2", ids: ["main", "b2"] });
  assert.deepEqual(await db.getLocations(u), { active: "b2", ids: ["main", "b2"] });
  await db.saveLocations(u, { active: "gone", ids: ["main", "b2"] });
  assert.equal((await db.getLocations(u)).active, "main", "an unknown active location falls back to main");
  await db.saveLocations(u, { active: "b2", ids: ["main", "b2"] });
  await db.deleteAccountData(u);
  assert.equal(await db.getBusiness({ userId: u, loc: "main" }), null);
  assert.equal(await db.getBusiness({ userId: u, loc: "b2" }), null);
  assert.equal((await db.getPosts({ userId: u, loc: "b2" })).length, 0);
});

test("concurrent writes in one process are not lost", async () => {
  const { db } = store;
  await Promise.all(Array.from({ length: 20 }, (_, i) => db.saveLocal({ userId: "user-c", loc: "main" }, `k${i}`, i)));
  for (let i = 0; i < 20; i++) assert.equal(await db.getLocal({ userId: "user-c", loc: "main" }, `k${i}`, -1), i);
});

test("queue: one live job per key, cancel by key prefix", async () => {
  const u = "user-q";
  const a = await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:p1:t1", runAt: new Date() });
  const b = await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:p1:t1", runAt: new Date() });
  assert.equal(a.id, b.id, "a duplicate key returns the existing job");
  assert.equal((await jobs.listJobs(u)).length, 1);
  assert.equal(await jobs.cancelMatching(u, "publish_post:main:p1:", "edited"), 1);
  assert.equal((await jobs.listJobs(u))[0].status, "cancelled");
  // A cancelled key can be queued again (for example a post scheduled again for the same time).
  const c = await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:p1:t1", runAt: new Date() });
  assert.notEqual(c.id, a.id);
});

test("runner: due jobs run once; retries back off; attempts run out; waiting does not use attempts; crashed runs resume", async () => {
  const u = "user-r";
  const t0 = new Date("2026-12-01T10:00:00Z");
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "ok", runAt: t0 });
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "flaky", runAt: t0, maxAttempts: 2 });
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "wait", runAt: t0 });
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "later", runAt: new Date("2026-12-02T00:00:00Z") });
  const calls: string[] = [];
  const handlers = { publish_post: async (j: { key: string }) => {
    calls.push(j.key);
    if (j.key === "flaky") return { status: "retry" as const, message: "Google busy" };
    if (j.key === "wait") return { status: "waiting" as const, message: "Google not connected", until: new Date(t0.getTime() + 3600_000), giveUpAt: new Date(t0.getTime() + 30 * 86_400_000) };
    return { status: "succeeded" as const, message: "done" };
  } };
  const r1 = await jobs.runDueJobs(handlers, { userIds: [u], at: t0 });
  assert.deepEqual(calls.sort(), ["flaky", "ok", "wait"]);
  const by = async (k: string) => (await jobs.listJobs(u)).find((j) => j.key === k)!;
  assert.equal((await by("ok")).status, "succeeded");
  assert.equal((await by("flaky")).status, "queued");
  assert.equal((await by("flaky")).runAt, new Date(t0.getTime() + jobs.BACKOFF_MS[0]).toISOString(), "first retry after 5 minutes");
  assert.equal((await by("wait")).status, "waiting");
  assert.equal((await by("wait")).attempts, 0, "waiting does not use up attempts");
  assert.equal(r1.ran, 3);

  // Nothing is due again at the same time: no double execution.
  calls.length = 0;
  await jobs.runDueJobs(handlers, { userIds: [u], at: t0 });
  assert.equal(calls.length, 0);

  // Second attempt of the flaky job: attempts run out, failed with the reason; the succeeded job is not rerun.
  await jobs.runDueJobs(handlers, { userIds: [u], at: new Date(t0.getTime() + jobs.BACKOFF_MS[0] + 1000) });
  assert.equal((await by("flaky")).status, "failed");
  assert.equal((await by("flaky")).lastError, "Google busy");
  assert.ok((await by("flaky")).log.some((l) => l.message.includes("No attempts left")));
  assert.ok(!calls.includes("ok"));

  // A job left "running" by a crash is taken again only after its lease has expired.
  const list = await store.db.getUserKey<import("@/lib/types").Job[]>(u, "jobs", []);
  const crashed = { ...list.find((j) => j.key === "later")!, status: "running" as const, leaseUntil: "2026-12-02T00:05:00Z", runAt: "2026-12-02T00:00:00Z" };
  await store.db.saveUserKey(u, "jobs", list.map((j) => (j.key === "later" ? crashed : j)));
  calls.length = 0;
  await jobs.runDueJobs(handlers, { userIds: [u], at: new Date("2026-12-02T00:01:00Z") });
  assert.ok(!calls.includes("later"), "lease still held");
  await jobs.runDueJobs(handlers, { userIds: [u], at: new Date("2026-12-02T00:06:00Z") });
  assert.ok(calls.includes("later"), "taken again after the lease expired");

  // Waiting jobs give up after their limit.
  const w = await by("wait");
  const gaveUp = jobs.applyOutcome({ ...w, attempts: 1 }, { status: "waiting", message: "Google not connected", until: new Date("2026-12-20T00:00:00Z"), giveUpAt: new Date("2026-12-05T00:00:00Z") }, new Date("2026-12-06T00:00:00Z"));
  assert.equal(gaveUp.status, "failed");
  // A handler that throws is a retry, with the error as the reason.
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "throws", runAt: t0 });
  await jobs.runDueJobs({ publish_post: async () => { throw new Error("boom"); } }, { userIds: [u], at: new Date("2026-12-03T00:00:00Z") });
  assert.equal((await by("throws")).lastError, "boom");
  assert.equal((await by("throws")).status, "queued");
});

test("queue: ten simultaneous enqueues of one key make one job", async () => {
  const u = "user-dup";
  const made = await Promise.all(Array.from({ length: 10 }, () => jobs.enqueue(u, { kind: "monthly_report", loc: "main", key: "monthly_report:main:2026-11", runAt: new Date() })));
  assert.equal(new Set(made.map((j) => j.id)).size, 1);
  assert.equal((await jobs.listJobs(u)).length, 1);
});

test("runner: a second runner started during a run does not take the job the first one holds", async () => {
  const u = "user-twice";
  const at = new Date("2026-12-10T10:00:00Z");
  await jobs.enqueue(u, { kind: "publish_post", loc: "main", key: "publish_post:main:p9:t", runAt: at });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let runs = 0;
  const slow = { publish_post: async () => { runs++; await gate; return { status: "succeeded" as const, message: "done" }; } };
  const first = jobs.runDueJobs(slow, { userIds: [u], at });
  // Let the first runner claim the job, then start another runner as a separate process would (no shared busy flag).
  while (!(await jobs.listJobs(u)).some((j) => j.status === "running")) await new Promise((r) => setTimeout(r, 5));
  (globalThis as unknown as { __gmbJobsBusy?: boolean }).__gmbJobsBusy = false;
  const second = await jobs.runDueJobs(slow, { userIds: [u], at });
  assert.equal(second.ran, 0, "the running job holds a lease");
  release();
  await first;
  assert.equal(runs, 1);
  assert.equal((await jobs.listJobs(u))[0].status, "succeeded");
});

test("locations: removing one deletes only its data; the last one cannot be removed; removing the first one works", async () => {
  const { db } = store;
  const u = "user-rm", other = "user-rm-other";
  const biz = (name: string) => ({ name, website: "", location: "Pune", category: "Salon", type: "general" as const, audit: {}, createdAt: "" });
  for (const loc of ["main", "b2", "b3"]) {
    await db.saveBusiness({ userId: u, loc }, biz(loc));
    await db.savePosts({ userId: u, loc }, [{ id: `p-${loc}`, text: "t", kind: "STANDARD", status: "draft", warnings: [], createdAt: "" }]);
    await db.saveLocal({ userId: u, loc }, "reports", [{ id: loc }]);
  }
  await db.saveBusiness({ userId: other, loc: "b2" }, biz("someone else"));
  await db.saveLocations(u, { active: "b2", ids: ["main", "b2", "b3"] });
  await jobs.enqueue(u, { kind: "publish_post", loc: "b2", key: "publish_post:b2:p:t", runAt: new Date() });
  await jobs.enqueue(u, { kind: "publish_post", loc: "b3", key: "publish_post:b3:p:t", runAt: new Date() });

  assert.equal(await jobs.cancelLocationJobs(u, "b2", "removed"), 1);
  const left = await jobs.listJobs(u);
  assert.equal(left.find((j) => j.loc === "b2")!.status, "cancelled");
  assert.equal(left.find((j) => j.loc === "b3")!.status, "queued", "other locations' jobs are untouched");

  const r = await db.removeLocation(u, "b2");
  assert.equal(r.ok, true);
  assert.equal(r.active, "main", "the removed location was shown; another one is shown now");
  assert.deepEqual((await db.getLocations(u)).ids, ["main", "b3"]);
  assert.equal(await db.getBusiness({ userId: u, loc: "b2" }), null);
  assert.equal((await db.getPosts({ userId: u, loc: "b2" })).length, 0);
  assert.deepEqual(await db.getLocal({ userId: u, loc: "b2" }, "reports", []), []);
  for (const loc of ["main", "b3"]) {
    assert.equal((await db.getBusiness({ userId: u, loc }))!.name, loc, "other locations keep their data");
    assert.equal((await db.getPosts({ userId: u, loc })).length, 1);
  }
  assert.equal((await db.getBusiness({ userId: other, loc: "b2" }))!.name, "someone else", "another user's location with the same id is untouched");
  assert.equal((await db.removeLocation(u, "nope")).ok, false, "an unknown location is refused");

  // The first location ("main", stored under the original key names) can be removed too.
  assert.equal((await db.removeLocation(u, "main")).ok, true);
  assert.deepEqual(await db.getLocations(u), { active: "b3", ids: ["b3"], mainRemoved: true });
  assert.equal(await db.getBusiness({ userId: u, loc: "main" }), null);
  assert.equal((await db.getBusiness({ userId: u, loc: "b3" }))!.name, "b3");
  // Adding a location later keeps main removed.
  await db.updateLocations(u, (idx) => ({ active: "b4", ids: [...idx.ids, "b4"] }));
  assert.deepEqual((await db.getLocations(u)).ids, ["b3", "b4"]);
  await db.updateLocations(u, (idx) => ({ ...idx, ids: ["b3"], active: "b3" }));
  // The last location cannot be removed.
  assert.equal((await db.removeLocation(u, "b3")).ok, false);
  assert.equal((await db.getBusiness({ userId: u, loc: "b3" }))!.name, "b3");
});

test("jobs: a job whose location was removed is cancelled without running", async () => {
  const { HANDLERS } = await import("@/lib/job-handlers");
  const u = "user-gone";
  await store.db.saveLocations(u, { active: "main", ids: ["main"] });
  const job = await jobs.enqueue(u, { kind: "publish_post", loc: "removed1", key: "publish_post:removed1:p:t", runAt: new Date(), payload: { postId: "p" } });
  const out = await HANDLERS.publish_post(job, u);
  assert.equal(out.status, "cancelled");
  assert.match(out.message, /location was removed/);
});
