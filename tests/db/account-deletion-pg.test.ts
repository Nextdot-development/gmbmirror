import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { authUser, startPostgres, useSupabaseMode, type TestDb } from "./harness";

// Account deletion and limit-record pruning in Supabase mode, against a throwaway PostgreSQL with the real schema.

let t: TestDb;
before(async () => {
  t = await startPostgres();
  useSupabaseMode(t.url);
});
after(async () => {
  await (await import("@/lib/db-pg")).closePool();
  await t.stop();
});

const count = async (sql: string, args: unknown[]) => Number((await t.admin.query(sql, args)).rows[0].count);

test("deleting an account removes the login and every row of that user; another user is untouched", async () => {
  const { db } = await import("@/lib/store");
  const { deleteLogin } = await import("@/lib/session");
  const { enqueue } = await import("@/lib/jobs");
  const { savePrefs } = await import("@/lib/notify");
  const a = await authUser(t.admin, "leaving@example.test"), b = await authUser(t.admin, "staying@example.test");
  for (const u of [a, b]) {
    await db.saveBusiness({ userId: u, loc: "main" }, { name: u === a ? "A" : "B", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });
    await db.saveGoogle({ userId: u, loc: "main" }, { email: "g@example.test", tokens: "iv.tag.enc", connectedAt: "2026-11-21T00:00:00Z" });
    await enqueue(u, { kind: "monthly_report", loc: "main", key: `monthly_report:main:2026-11:${u}`, runAt: new Date("2026-12-01T03:00:00Z") });
    await savePrefs(u, { reportEmails: false });
  }
  await db.deleteAccountData(a);
  assert.equal(await deleteLogin(a), true);
  for (const table of ["accounts", "locations", "location_records", "google_connections", "user_records", "jobs"]) {
    assert.equal(await count(`select count(*) from public.${table} where user_id = $1`, [a]), 0, `${table} of the deleted user`);
    assert.ok(await count(`select count(*) from public.${table} where user_id = $1`, [b]) > 0, `${table} of the other user`);
  }
  assert.equal(await count("select count(*) from auth.users where id = $1", [a]), 0, "the login is gone");
  assert.equal(await count("select count(*) from auth.users where id = $1", [b]), 1);
  assert.equal(await deleteLogin(a), false, "deleting again reports that nothing was deleted");
});

test("the login can be deleted first too: the account's data goes with it (foreign keys)", async () => {
  const { db } = await import("@/lib/store");
  const { deleteLogin } = await import("@/lib/session");
  const c = await authUser(t.admin, "direct@example.test");
  await db.saveBusiness({ userId: c, loc: "main" }, { name: "C", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });
  assert.equal(await deleteLogin(c), true);
  assert.equal(await count("select count(*) from public.location_records where user_id = $1", [c]), 0);
});

test("expired limit records (which may hold an email or IP) are pruned after a day; current ones stay", async () => {
  const { pruneLimits, takeShared } = await import("@/lib/ratelimit");
  await takeShared("reset:email:current@example.test", { limit: 3, windowMs: 3_600_000 });
  await t.admin.query("insert into public.rate_limits (key, count, reset_at) values ('reset:email:old@example.test', 1, now() - interval '2 days'), ('login:ip:203.0.113.9', 4, now() - interval '25 hours'), ('recent-expired', 1, now() - interval '1 hour')");
  assert.equal(await pruneLimits(), 2);
  const keys = (await t.admin.query("select key from public.rate_limits order by key")).rows.map((r) => r.key);
  assert.deepEqual(keys, ["recent-expired", "reset:email:current@example.test"]);
});
