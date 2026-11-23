import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// Email (Resend) and notifications, against a local stand-in for Resend's API and a demo store in a temporary folder.
// No real email is sent and the project's .data is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), "gmb-email-"));
// The report PDF reads its fonts from the working folder (the project root on a server): link them in.
mkdirSync(path.join(dir, "src"));
symlinkSync(path.resolve("src/assets"), path.join(dir, "src", "assets"));
symlinkSync(path.resolve("node_modules"), path.join(dir, "node_modules"));
process.chdir(dir);
process.env.APP_MODE = "demo";
process.env.SESSION_SECRET = "s".repeat(40);
process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
delete process.env.TRUSTED_PROXY_HOPS;
delete process.env.EMAIL_REPLY_TO;

const OWNER = "owner-1";
mkdirSync(path.join(dir, ".data"));
writeFileSync(path.join(dir, ".data", "users.json"), JSON.stringify({ "owner@example.test": { id: OWNER, email: "owner@example.test", hash: "x" } }));

type Req = { headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
let seen: Req[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { id: "em_1" } };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
    res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
  });
});

type Email = typeof import("@/lib/email");
type Notify = typeof import("@/lib/notify");
type Store = typeof import("@/lib/store");
let email: Email, notify: Notify, store: Store;
const configure = () => {
  process.env.RESEND_API_KEY = "re_test_key_123456";
  process.env.EMAIL_FROM = "GMBmirror <notifications@mail.example.test>";
  process.env.RESEND_API_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const unconfigure = () => { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; };

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  email = await import("@/lib/email");
  notify = await import("@/lib/notify");
  store = await import("@/lib/store");
});
after(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { seen = []; reply = { status: 200, body: { id: "em_1" } }; });

const msg = (over: Partial<Parameters<Email["sendEmail"]>[0]> = {}) =>
  ({ to: "owner@example.test", subject: "Hello", text: "Hi", html: "<p>Hi</p>", kind: "security" as const, userId: OWNER, ...over });

test("not configured: nothing is sent, the outcome says so, and the log records it (never 'delivered')", async () => {
  unconfigure();
  const out = await email.sendEmail(msg());
  assert.deepEqual(out, { status: "not_configured" });
  assert.equal(seen.length, 0);
  const log = await store.db.getUserKey<{ status: string }[]>(OWNER, "email_log", []);
  assert.equal(log[0].status, "not_configured");
});

test("configured: one request to Resend with the key, sender, reply-to, idempotency key and a base64 PDF attachment", async () => {
  configure();
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const out = await email.sendEmail(msg({ idempotencyKey: "k-1", attachments: [{ filename: "report.pdf", content: pdf }] }));
  assert.deepEqual(out, { status: "accepted", id: "em_1" });
  assert.equal(seen.length, 1);
  const r = seen[0];
  assert.equal(r.headers.authorization, "Bearer re_test_key_123456");
  assert.equal(r.headers["idempotency-key"], "k-1");
  assert.equal(r.body.from, "GMBmirror <notifications@mail.example.test>");
  assert.deepEqual(r.body.to, ["owner@example.test"]);
  assert.equal(r.body.reply_to, "gmbmirror@gmail.com", "replies go to the public support address by default");
  const att = (r.body.attachments as { filename: string; content: string }[])[0];
  assert.equal(att.filename, "report.pdf");
  assert.deepEqual([...Buffer.from(att.content, "base64")], [...pdf]);
});

test("a rejected message is 'failed' with Resend's reason, and the key never appears in it", async () => {
  configure();
  reply = { status: 403, body: { name: "validation_error", message: "The mail.example.test domain is not verified." } };
  const out = await email.sendEmail(msg());
  assert.equal(out.status, "failed");
  assert.match((out as { error: string }).error, /not verified/);
  assert.ok(!JSON.stringify(out).includes("re_test_key"));
  const log = await store.db.getUserKey<{ status: string; detail?: string }[]>(OWNER, "email_log", []);
  assert.equal(log[0].status, "failed");
});

test("Resend unreachable: 'failed', no exception", async () => {
  configure();
  process.env.RESEND_API_BASE_URL = "http://127.0.0.1:9"; // nothing listens on the discard port
  const out = await email.sendEmail(msg());
  assert.deepEqual(out, { status: "failed", error: "Resend could not be reached." });
});

test("an invalid recipient is skipped without a request; HTML is escaped in the layout", async () => {
  configure();
  assert.equal((await email.sendEmail(msg({ to: "not-an-address" }))).status, "skipped");
  assert.equal(seen.length, 0);
  const { html, text } = email.layout({ title: "<b>x</b>", paragraphs: ["a & b <script>"] });
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;") && html.includes("a &amp; b &lt;script&gt;") && !html.includes("<script>"));
  assert.ok(text.includes("a & b <script>"), "the text part is plain");
});

test("welcome email: sent once per account (a second confirmation sends nothing)", async () => {
  configure();
  const user = { id: "welcome-user", email: "new@example.test" };
  assert.equal((await notify.notifyWelcome(user))?.status, "accepted");
  assert.equal(await notify.notifyWelcome(user), undefined);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers["idempotency-key"], "welcome:welcome-user");
  assert.match(String(seen[0].body.text), /https:\/\/app\.example\.test\/app\/onboarding/);
});

test("job failure alert: respects the owner's choice; a final failure from the runner is reported exactly once", async () => {
  configure();
  const jobs = await import("@/lib/jobs");
  const scope = { userId: OWNER, loc: "main" };
  await store.db.saveBusiness(scope, { name: "Zentrix Clinic", website: "", location: "Pune", category: "Dentist", type: "healthcare", audit: {}, createdAt: "" });
  const at = new Date("2026-12-01T10:00:00Z");
  await jobs.enqueue(OWNER, { kind: "refresh_profile", loc: "main", key: "refresh:test", runAt: at, maxAttempts: 1 });
  const handlers = { refresh_profile: async () => ({ status: "failed" as const, message: "Google said no." }) };
  const r1 = await jobs.runDueJobs(handlers, { userIds: [OWNER], at, onFailed: notify.notifyJobFailed });
  assert.equal(r1.results[0].status, "failed");
  assert.equal(seen.length, 1);
  assert.match(String(seen[0].body.subject), /daily Google profile refresh failed/);
  assert.match(String(seen[0].body.text), /Zentrix Clinic[\s\S]*Reason: Google said no\./);
  await jobs.runDueJobs(handlers, { userIds: [OWNER], at, onFailed: notify.notifyJobFailed });
  assert.equal(seen.length, 1, "a failed job is not run or reported again");
  // Turned off: no email.
  await notify.savePrefs(OWNER, { jobAlerts: false });
  await jobs.enqueue(OWNER, { kind: "refresh_profile", loc: "main", key: "refresh:test2", runAt: at, maxAttempts: 1 });
  await jobs.runDueJobs(handlers, { userIds: [OWNER], at, onFailed: notify.notifyJobFailed });
  assert.equal(seen.length, 1);
  await notify.savePrefs(OWNER, { jobAlerts: true });
});

test("monthly report email: attaches the PDF; scheduled ones respect the choice, requested ones are always sent", async () => {
  configure();
  const scope = { userId: OWNER, loc: "main" };
  const r = { id: "r1", month: "2026-11", generatedAt: "2026-12-01T00:00:00Z", trigger: "schedule" as const, partial: false, business: "Zentrix Clinic", location: "Pune",
    sections: [{ title: "Reviews", available: true, lines: ["12 new reviews, average 4.6 ★"] }], summary: "मासिक सारांश: अच्छा महीना।" };
  assert.equal((await notify.notifyReport(scope, r)).status, "accepted");
  const att = (seen[0].body.attachments as { filename: string; content: string }[])[0];
  assert.equal(att.filename, "report-2026-11.pdf");
  assert.ok(Buffer.from(att.content, "base64").toString("latin1").startsWith("%PDF-"));
  await notify.savePrefs(OWNER, { reportEmails: false });
  assert.equal((await notify.notifyReport(scope, r)).status, "skipped");
  assert.equal((await notify.notifyReport(scope, r, true)).status, "accepted", "the owner asked for it");
  assert.equal(seen.length, 2);
  await notify.savePrefs(OWNER, { reportEmails: true });
});

test("per-user hourly limit: the 21st email in an hour is not sent", async () => {
  configure();
  const u = "busy-user";
  const outs = [];
  for (let i = 0; i < 21; i++) outs.push((await email.sendEmail(msg({ userId: u }))).status);
  assert.equal(outs.filter((s) => s === "accepted").length, 20);
  assert.equal(outs[20], "skipped");
});

test("startup checks: both email settings or neither, a real sender, never a free-mail domain", async () => {
  const { configProblems } = await import("@/lib/env");
  const base = { APP_MODE: "demo", SESSION_SECRET: "s".repeat(40) } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(configProblems({ ...base }), []);
  assert.deepEqual(configProblems({ ...base, RESEND_API_KEY: "re_x", EMAIL_FROM: "GMBmirror <hello@gmbmirror.com>" }), []);
  assert.ok(configProblems({ ...base, RESEND_API_KEY: "re_x" }).some((p) => p.startsWith("EMAIL_FROM is required")));
  assert.ok(configProblems({ ...base, EMAIL_FROM: "a@b.com" }).some((p) => p.startsWith("RESEND_API_KEY is required")));
  assert.ok(configProblems({ ...base, RESEND_API_KEY: "re_x", EMAIL_FROM: "gmbmirror@gmail.com" }).some((p) => p.includes("cannot use gmail.com")));
  assert.ok(configProblems({ ...base, RESEND_API_KEY: "sk_x", EMAIL_FROM: "a@b.com" }).some((p) => p.includes("start with re_")));
});
