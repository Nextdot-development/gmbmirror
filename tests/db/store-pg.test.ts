import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { authUser, inNewProcess, startPostgres, useSupabaseMode, type TestDb } from "./harness";

// The store in Supabase mode, against a real (local, throwaway) PostgreSQL with the production schema.

let t: TestDb;
type Store = typeof import("@/lib/store");
let store: Store;
const biz = (name: string) => ({ name, website: "", location: "Pune", category: "Salon", type: "general" as const, audit: {}, createdAt: "" });

before(async () => {
  t = await startPostgres();
  useSupabaseMode(t.url);
  process.env.DATABASE_POOL_MAX = "8";
  store = await import("@/lib/store");
});
after(async () => {
  await (await import("@/lib/db-pg")).closePool();
  await t.stop();
});

test("each user sees only their own data, and each location only its own", async () => {
  const { db } = store;
  const a = await authUser(t.admin, "a@example.test"), b = await authUser(t.admin, "b@example.test");
  await db.saveBusiness({ userId: a, loc: "main" }, biz("A main"));
  await db.updateLocations(a, (idx) => ({ active: "b2", ids: [...idx.ids, "b2"] }));
  await db.saveBusiness({ userId: a, loc: "b2" }, biz("A branch"));
  await db.savePosts({ userId: a, loc: "b2" }, [{ id: "p", text: "branch post", kind: "STANDARD", status: "draft", warnings: [], createdAt: "" }]);
  await db.saveBusiness({ userId: b, loc: "main" }, biz("B main"));
  assert.equal((await db.getBusiness({ userId: a, loc: "main" }))!.name, "A main");
  assert.equal((await db.getBusiness({ userId: a, loc: "b2" }))!.name, "A branch");
  assert.equal((await db.getBusiness({ userId: b, loc: "main" }))!.name, "B main");
  assert.equal((await db.getPosts({ userId: a, loc: "main" })).length, 0, "posts stay with their location");
  assert.equal(await db.getBusiness({ userId: b, loc: "b2" }), null, "another user's location id finds nothing");
  assert.deepEqual(await db.getLocations(a), { active: "b2", ids: ["main", "b2"] });
  assert.deepEqual(await db.getLocations(b), { active: "main", ids: ["main"] });
  // Per-user records (Claude usage).
  await db.saveUserKey(a, "ai_usage", { "2026-11": { reply: 2 } });
  assert.deepEqual(await db.getUserKey(a, "ai_usage", {}), { "2026-11": { reply: 2 } });
  assert.deepEqual(await db.getUserKey(b, "ai_usage", {}), {});
  // Rows carry the user and the location.
  const rows = (await t.admin.query("select user_id, location_id, key from public.location_records order by 1, 2, 3")).rows;
  assert.ok(rows.every((r) => [a, b].includes(r.user_id)));
  assert.ok(rows.some((r) => r.user_id === a && r.location_id === "b2" && r.key === "posts"));
});

test("read-change-write from many connections at once loses nothing (atomic across connections)", async () => {
  const { db } = store;
  const u = await authUser(t.admin, "c@example.test");
  const scope = { userId: u, loc: "main" };
  await db.saveBusiness(scope, biz("C"));
  await Promise.all(Array.from({ length: 40 }, () => db.updateLocal<{ n: number }>(scope, "share_events", { n: 0 }, (cur) => ({ n: cur.n + 1 }))));
  assert.deepEqual(await db.getLocal(scope, "share_events", {}), { n: 40 });
});

test("two server instances changing the same record at once: every change is kept", async () => {
  const { db } = store;
  const u = await authUser(t.admin, "d@example.test");
  const scope = { userId: u, loc: "main" };
  await db.saveBusiness(scope, biz("D"));
  const other = inNewProcess(
    `const { db } = await import("@/lib/store");
     const s = { userId: ${JSON.stringify(u)}, loc: "main" };
     await Promise.all(Array.from({ length: 25 }, () => db.updateLocal(s, "share_events", { n: 0 }, (c) => ({ n: c.n + 1 }))));
     await (await import("@/lib/db-pg")).closePool();
     console.log("done");`,
    { DATABASE_URL: t.url, APP_MODE: "supabase", DATABASE_POOL_MAX: "5" },
  );
  await Promise.all(Array.from({ length: 25 }, () => db.updateLocal<{ n: number }>(scope, "share_events", { n: 0 }, (cur) => ({ n: cur.n + 1 }))));
  assert.equal(await other, "done");
  assert.deepEqual(await db.getLocal(scope, "share_events", {}), { n: 50 });
});

test("Google connection: a slow request from an older sign-in cannot overwrite a newer one", async () => {
  const { db } = store;
  const u = await authUser(t.admin, "e@example.test");
  const scope = { userId: u, loc: "main" };
  const conn = (at: string, email: string) => ({ email, tokens: "enc.tok.en", scopes: [], connectedAt: at }) as unknown as import("@/lib/types").GoogleConnection;
  await db.saveGoogle(scope, conn("2026-11-21T10:00:00Z", "old@example.test"));
  await db.saveGoogle(scope, conn("2026-11-21T11:00:00Z", "new@example.test"));
  await db.updateGoogle(scope, "2026-11-21T10:00:00Z", (c) => ({ ...c, email: "stale write" }));
  assert.equal((await db.getGoogle(scope))!.email, "new@example.test");
  await db.updateGoogle(scope, "2026-11-21T11:00:00Z", (c) => ({ ...c, locationName: "locations/1" }));
  assert.equal((await db.getGoogle(scope))!.locationName, "locations/1");
  // Tokens are stored as the app encrypted them, in their own table.
  const row = (await t.admin.query("select connection->>'tokens' as tokens, connected_at from public.google_connections where user_id = $1", [u])).rows[0];
  assert.equal(row.tokens, "enc.tok.en");
  assert.equal(row.connected_at, "2026-11-21T11:00:00Z");
});

test("removing a location deletes only its rows; a late write to it is refused; deleting the account removes everything", async () => {
  const { db } = store;
  const u = await authUser(t.admin, "f@example.test"), other = await authUser(t.admin, "g@example.test");
  for (const loc of ["main", "b2", "b3"]) {
    if (loc !== "main") await db.updateLocations(u, (idx) => ({ active: idx.active, ids: [...idx.ids, loc] }));
    await db.saveBusiness({ userId: u, loc }, biz(loc));
    await db.saveGoogle({ userId: u, loc }, { email: "x", tokens: "t", scopes: [], connectedAt: loc } as unknown as import("@/lib/types").GoogleConnection);
  }
  await db.saveBusiness({ userId: other, loc: "main" }, biz("other"));
  assert.equal((await db.removeLocation(u, "b2")).ok, true);
  assert.equal(await db.getBusiness({ userId: u, loc: "b2" }), null);
  assert.equal(await db.getGoogle({ userId: u, loc: "b2" }), null);
  assert.equal(Number((await t.admin.query("select count(*) from public.location_records where user_id = $1 and location_id = 'b2'", [u])).rows[0].count), 0);
  await assert.rejects(db.saveBusiness({ userId: u, loc: "b2" }, biz("late")), /no longer exists/, "a removed location cannot be brought back by a late write");
  assert.equal((await db.getBusiness({ userId: u, loc: "b3" }))!.name, "b3");
  // The first location can be removed too, and stays removed.
  assert.equal((await db.removeLocation(u, "main")).ok, true);
  assert.deepEqual(await db.getLocations(u), { active: "b3", ids: ["b3"], mainRemoved: true });
  await assert.rejects(db.saveBusiness({ userId: u, loc: "main" }, biz("late")), /no longer exists/);
  assert.equal((await db.removeLocation(u, "b3")).ok, false, "the last location cannot be removed");
  // Delete my data: everything of this user, nothing of the other.
  await db.deleteAccountData(u);
  for (const tbl of ["accounts", "locations", "location_records", "google_connections", "user_records", "jobs"]) {
    assert.equal(Number((await t.admin.query(`select count(*) from public.${tbl} where user_id = $1`, [u])).rows[0].count), 0, tbl);
  }
  assert.equal((await db.getBusiness({ userId: other, loc: "main" }))!.name, "other");
});

test("data survives a restart: written by one server process, read by a new one", async () => {
  const u = await authUser(t.admin, "h@example.test");
  await inNewProcess(
    `const { db } = await import("@/lib/store");
     await db.saveBusiness({ userId: ${JSON.stringify(u)}, loc: "main" }, { name: "Persisted", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });
     await (await import("@/lib/db-pg")).closePool();`,
    { DATABASE_URL: t.url, APP_MODE: "supabase" },
  );
  const out = await inNewProcess(
    `const { db } = await import("@/lib/store");
     console.log((await db.getBusiness({ userId: ${JSON.stringify(u)}, loc: "main" })).name);
     await (await import("@/lib/db-pg")).closePool();`,
    { DATABASE_URL: t.url, APP_MODE: "supabase" },
  );
  assert.equal(out, "Persisted");
});

test("Row Level Security: the public key reads only its own non-sensitive rows, never tokens, jobs or limits, and cannot write", async () => {
  const { db } = store;
  const a = await authUser(t.admin, "rls-a@example.test"), b = await authUser(t.admin, "rls-b@example.test");
  await db.saveBusiness({ userId: a, loc: "main" }, biz("A"));
  await db.saveBusiness({ userId: b, loc: "main" }, biz("B"));
  await db.saveGoogle({ userId: a, loc: "main" }, { email: "x", tokens: "secret", scopes: [], connectedAt: "1" } as unknown as import("@/lib/types").GoogleConnection);
  const asRole = async (role: "authenticated" | "anon", sub: string | null, sql: string) => {
    const c = await t.admin.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
      const r = await c.query(sql);
      await c.query("rollback");
      return r.rows;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  };
  const mine = await asRole("authenticated", a, "select user_id, value->>'name' as name from public.location_records");
  assert.deepEqual(mine.map((r) => r.name), ["A"], "only the signed-in user's rows");
  assert.equal((await asRole("authenticated", a, "select * from public.google_connections")).length, 0, "tokens are not readable");
  assert.equal((await asRole("authenticated", a, "select * from public.jobs")).length, 0);
  assert.equal((await asRole("authenticated", a, "select * from public.rate_limits")).length, 0);
  assert.equal((await asRole("anon", null, "select * from public.location_records")).length, 0, "signed out: nothing");
  await assert.rejects(asRole("authenticated", a, `insert into public.accounts (user_id) values ('${a}')`), /row-level security|permission denied/);
  await assert.rejects(asRole("authenticated", a, "update public.location_records set value = '{}'::jsonb returning 1").then((r) => { if (r.length === 0) throw new Error("row-level security: no rows updated"); }), /row-level security/);
  await assert.rejects(asRole("authenticated", a, "select * from public.claim_next_job(now(), 60)"), /permission denied/, "the job function is not callable with the public key");
});
