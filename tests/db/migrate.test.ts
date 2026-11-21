import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { authUser, startPostgres, useSupabaseMode, type TestDb } from "./harness";
// @ts-expect-error: a plain JavaScript script, run by operators with node
import { mask, migrate, planUser, sourceFingerprint } from "../../scripts/migrate-to-supabase.mjs";

// The JSON-to-Supabase migration script, on temporary copies shaped like .data, against a local PostgreSQL.

let t: TestDb;
let dir: string;
type Store = typeof import("@/lib/store");
let store: Store;
const quiet = () => undefined;
const ids = { u1: "11111111-1111-4111-8111-111111111111", u2: "22222222-2222-4222-8222-222222222222", u3: "33333333-3333-4333-8333-333333333333", u4: "44444444-4444-4444-8444-444444444444" };
const job = { id: "55555555-5555-4555-8555-555555555555", kind: "publish_post", loc: "b2", key: "publish_post:b2:p1:2026-12-01T10:00:00.000Z", runAt: "2026-12-01T10:00:00.000Z", status: "queued",
  attempts: 0, maxAttempts: 4, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-20T10:00:00.000Z", payload: { postId: "p1" }, log: [{ at: "2026-11-20T10:00:00.000Z", status: "queued", message: "Scheduled" }] };

before(async () => {
  t = await startPostgres();
  useSupabaseMode(t.url);
  store = await import("@/lib/store");
  dir = mkdtempSync(path.join(os.tmpdir(), "gmb-migrate-"));
  writeFileSync(path.join(dir, "users.json"), JSON.stringify({
    "one@example.test": { id: ids.u1, email: "one@example.test", hash: "x" },
    "two@example.test": { id: ids.u2, email: "Two@Example.test", hash: "x" },
    "three@example.test": { id: ids.u3, email: "three@example.test", hash: "x" },
  }));
  writeFileSync(path.join(dir, "user_data.json"), JSON.stringify({
    [ids.u1]: {
      locations: { active: "b2", ids: ["main", "b2"] },
      business: { name: "One Clinic", website: "", location: "Pune", category: "Dentist", type: "healthcare", audit: {}, createdAt: "2026-11-01" },
      replies: { "accounts/1/locations/1/reviews/r1": { text: "Thank you", status: "posted", updatedAt: "2026-11-02" } },
      google: { email: "g@example.test", tokens: "iv.tag.encrypted", scopes: ["business.manage"], connectedAt: "2026-11-03T00:00:00Z", locationName: "locations/1" },
      "loc:b2:business": { name: "One Clinic Branch", website: "", location: "Pune", category: "Dentist", type: "healthcare", audit: {}, createdAt: "2026-11-04" },
      "loc:b2:posts": [{ id: "p1", text: "Open Sunday", kind: "STANDARD", status: "approved", scheduledAt: "2026-12-01T10:00:00.000Z", warnings: [], createdAt: "2026-11-05" }],
      "loc:b2:google": { email: "g@example.test", tokens: "iv.tag.encrypted2", scopes: [], connectedAt: "2026-11-06T00:00:00Z" },
      "loc:gone:business": { name: "Removed long ago" },
      weird: { x: 1 },
      ai_usage: { "2026-11": { calls: 3 } },
      jobs: [job, { id: "not-a-uuid", kind: "publish_post" }],
    },
    [ids.u2]: { business: { name: "Two Salon", website: "", location: "Delhi", category: "Salon", type: "general", audit: {}, createdAt: "2026-11-01" } },
    [ids.u3]: { business: { name: "Three (no Supabase account)" } },
    [ids.u4]: { business: { name: "Four (no email in users.json)" } },
  }));
});
after(async () => {
  await (await import("@/lib/db-pg")).closePool();
  await t.stop();
  rmSync(dir, { recursive: true, force: true });
});

const accounts = async () => Number((await t.admin.query("select count(*) from public.accounts")).rows[0].count);

test("plan: locations, records, tokens, jobs and Claude usage are mapped; leftovers and unknown keys are reported, not copied", () => {
  const data = JSON.parse(readFileSync(path.join(dir, "user_data.json"), "utf8"));
  const p = planUser(data[ids.u1]);
  assert.deepEqual(p.index, { active: "b2", ids: ["main", "b2"], mainRemoved: false });
  assert.deepEqual(p.records.map((r: { loc: string; key: string }) => `${r.loc}/${r.key}`).sort(), ["b2/business", "b2/posts", "main/business", "main/replies"]);
  assert.deepEqual(p.google.map((g: { loc: string }) => g.loc).sort(), ["b2", "main"]);
  assert.equal(p.jobs.length, 1);
  assert.deepEqual(p.skipped.map((s: { key: string }) => s.key).sort(), ["jobs/not-a-uuid", "loc:gone:business", "weird"]);
  assert.equal(mask("someone@example.test"), "s***@example.test");
});

test("dry run writes nothing; apply copies matched users exactly; a second apply creates no duplicates; the source files are untouched", async () => {
  const fp = await sourceFingerprint(dir);
  const a1 = await authUser(t.admin, "one@example.test"), a2 = await authUser(t.admin, "two@example.test");
  // Someone already using the database before the migration must not be affected by it or by its rollback.
  const existing = await authUser(t.admin, "existing@example.test");
  await store.db.saveBusiness({ userId: existing, loc: "main" }, { name: "Existing", website: "", location: "Pune", category: "Salon", type: "general", audit: {}, createdAt: "" });

  const dry = await migrate({ databaseUrl: t.url, json: dir, apply: false, log: quiet });
  assert.equal(await accounts(), 1, "a dry run writes nothing");
  assert.deepEqual(dry.users.map((u: { result: string }) => u.result).sort(), ["skipped: no Supabase Auth user with this email (create or invite them, then run again)", "skipped: no Supabase Auth user with this email (create or invite them, then run again)", "would copy", "would copy"]);
  assert.ok(!JSON.stringify(dry).includes("one@example.test"), "reports mask email addresses");

  const run = await migrate({ databaseUrl: t.url, json: dir, apply: true, log: quiet });
  assert.deepEqual(run.summary, { users: 4, copied: 2, skipped: 2 });
  const { db } = store;
  // User one: the app reads everything back through the normal store, under the Supabase account id.
  assert.deepEqual(await db.getLocations(a1), { active: "b2", ids: ["main", "b2"] });
  assert.equal((await db.getBusiness({ userId: a1, loc: "main" }))!.name, "One Clinic");
  assert.equal((await db.getBusiness({ userId: a1, loc: "b2" }))!.name, "One Clinic Branch");
  assert.equal((await db.getPosts({ userId: a1, loc: "b2" }))[0].text, "Open Sunday");
  assert.equal((await db.getReplies({ userId: a1, loc: "main" }))["accounts/1/locations/1/reviews/r1"].status, "posted");
  assert.equal((await db.getGoogle({ userId: a1, loc: "main" }))!.tokens, "iv.tag.encrypted", "tokens are copied as encrypted, unchanged");
  assert.equal((await db.getGoogle({ userId: a1, loc: "b2" }))!.tokens, "iv.tag.encrypted2");
  assert.deepEqual(await db.getUserKey(a1, "ai_usage", {}), { "2026-11": { calls: 3 } });
  const { listJobs } = await import("@/lib/jobs");
  const js = await listJobs(a1);
  assert.equal(js.length, 1);
  assert.equal(js[0].key, job.key);
  assert.equal(js[0].loc, "b2");
  // User two: matched by email in any letter case. Isolation between the two.
  assert.equal((await db.getBusiness({ userId: a2, loc: "main" }))!.name, "Two Salon");
  assert.equal(await db.getBusiness({ userId: a2, loc: "b2" }), null);
  assert.equal((await db.getPosts({ userId: a2, loc: "main" })).length, 0);
  // Leftovers were not copied.
  assert.equal(Number((await t.admin.query("select count(*) from public.locations where id = 'gone'")).rows[0].count), 0);

  const counts = async () => (await t.admin.query("select (select count(*) from public.location_records) r, (select count(*) from public.jobs) j, (select count(*) from public.google_connections) g")).rows[0];
  const before2 = await counts();
  const again = await migrate({ databaseUrl: t.url, json: dir, apply: true, log: quiet });
  assert.equal(again.summary.copied, 0);
  assert.ok(again.users.filter((u: { result: string }) => u.result.startsWith("skipped: already")).length === 2);
  assert.deepEqual(await counts(), before2, "running it again adds nothing");
  assert.equal(await sourceFingerprint(dir), fp, "the JSON source files were not changed");

  // Rollback removes exactly the copied batch.
  await migrate({ databaseUrl: t.url, rollback: run.batch, log: quiet });
  assert.equal(await db.getBusiness({ userId: a1, loc: "main" }), null);
  assert.equal(await db.getBusiness({ userId: a2, loc: "main" }), null);
  assert.equal((await listJobs(a1)).length, 0);
  assert.equal((await db.getBusiness({ userId: existing, loc: "main" }))!.name, "Existing", "data that was not migrated is untouched");
  assert.ok((await t.admin.query("select summary from public.migration_runs where batch = $1", [run.batch])).rows[0].summary.rolledBackAt);
  // It can be copied again after a rollback.
  assert.equal((await migrate({ databaseUrl: t.url, json: dir, apply: true, log: quiet })).summary.copied, 2);
});

test("the old Supabase table public.user_data can be the source (same user ids)", async () => {
  await t.admin.query(readFileSync(path.join(import.meta.dirname, "../../supabase/schema.sql"), "utf8"));
  const u = await authUser(t.admin, "legacy@example.test");
  await t.admin.query("insert into public.user_data (user_id, key, value) values ($1, 'business', $2::jsonb), ($1, 'checks', '[]'::jsonb)", [u, JSON.stringify({ name: "Legacy Clinic" })]);
  const r = await migrate({ databaseUrl: t.url, userDataTable: true, apply: true, log: quiet });
  assert.ok(r.users.some((x: { result: string }) => x.result === "copied"));
  assert.equal((await store.db.getBusiness({ userId: u, loc: "main" }))!.name, "Legacy Clinic");
  assert.equal(Number((await t.admin.query("select count(*) from public.user_data where user_id = $1", [u])).rows[0].count), 2, "the old table is not changed");
});
