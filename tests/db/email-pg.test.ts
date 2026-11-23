import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authUser, startPostgres, useSupabaseMode, type TestDb } from "./harness";

// Email notifications in Supabase mode: the migration 20261122000000_email_notifications.sql (applied by the harness
// after the core schema), per-user preferences and log, the owner's address from Supabase Auth, and RLS.

let t: TestDb;
before(async () => {
  t = await startPostgres();
  useSupabaseMode(t.url);
});
after(async () => {
  await (await import("@/lib/db-pg")).closePool();
  await t.stop();
});

const MIGRATION = path.join(import.meta.dirname, "../../supabase/migrations/20261122000000_email_notifications.sql");

test("the migration is safe to run again, reports itself applied, and still refuses unknown record kinds", async () => {
  const sql = readFileSync(MIGRATION, "utf8");
  await t.admin.query(sql);
  await t.admin.query(sql);
  const check = sql.match(/^-- check: (.+)$/m)![1];
  assert.equal(Object.values((await t.admin.query(check)).rows[0])[0], true);
  const u = await authUser(t.admin, "k@example.test");
  await t.admin.query("insert into public.accounts (user_id) values ($1)", [u]);
  await assert.rejects(t.admin.query("insert into public.user_records (user_id, key, value) values ($1, 'something_else', '{}')", [u]), /user_records_key_check/);
});

test("preferences and the email log are per user; the owner's address comes from Supabase Auth; deleting the account removes them", async () => {
  const { db } = await import("@/lib/store");
  const { getPrefs, savePrefs } = await import("@/lib/notify");
  const { emailOf } = await import("@/lib/session");
  const a = await authUser(t.admin, "owner-a@example.test"), b = await authUser(t.admin, "owner-b@example.test");
  await savePrefs(a, { reportEmails: false, jobAlerts: true, postPublished: true });
  await db.updateUserKey(a, "email_log", [], (log: unknown[]) => [{ at: "x", kind: "security", subject: "s", status: "accepted" }, ...log]);
  assert.deepEqual(await getPrefs(a), { reportEmails: false, jobAlerts: true, postPublished: true });
  assert.deepEqual(await getPrefs(b), { reportEmails: true, jobAlerts: true, postPublished: false }, "another user keeps the defaults");
  assert.equal((await db.getUserKey<unknown[]>(b, "email_log", [])).length, 0);
  assert.equal(await emailOf(a), "owner-a@example.test");
  assert.equal(await emailOf("00000000-0000-4000-8000-000000000000"), undefined);
  // Browsers (RLS): the owner may read their own records; another signed-in user sees nothing.
  const seen = async (as: string) => {
    const c = await t.admin.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: as, role: "authenticated" }), as]);
      return (await c.query("select key from public.user_records where user_id = $1 order by key", [a])).rows.map((r) => r.key);
    } finally {
      await c.query("rollback");
      c.release();
    }
  };
  assert.deepEqual(await seen(a), ["email_log", "notifications"]);
  assert.deepEqual(await seen(b), []);
  await db.deleteAccountData(a);
  assert.equal(Number((await t.admin.query("select count(*) from public.user_records where user_id = $1", [a])).rows[0].count), 0);
});
