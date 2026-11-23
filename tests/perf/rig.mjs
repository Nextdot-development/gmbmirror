// Performance rig: measures signed-in page times under production-like distances, without touching real services.
//
//   node --import ./tests/setup/register.mjs tests/perf/rig.mjs [--rtt 200] [--runs 5] [--label before]
//
// - A throwaway PostgreSQL with the real schema (tests/db stub + supabase/migrations), reached through a TCP proxy
//   that adds half the round-trip time in each direction (default 200 ms: Vercel iad1 to Supabase Sydney).
// - A stand-in for Supabase Auth with the same delay: /auth/v1/user and /auth/v1/.well-known/jwks.json, with an
//   ES256-signed session exactly like the real project's.
// - A production build of a clean copy of the app (no .env files are copied), served with `next start`.
// - Seeded data for one user: 3 locations, business details, 40 posts, 60 replies, 12 reports, logs.
// Prints, per page: median and slowest time, Supabase Auth calls and database round trips per request.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const RTT = Number(arg("rtt", 200)), RUNS = Number(arg("runs", 5)), LABEL = arg("label", "run");
const HALF = RTT / 2;
const free = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bin = (n) => spawnSync("which", [n], { encoding: "utf8" }).stdout.trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), "gmb-perf-"));
const cleanups = [];
const done = async (code = 0) => { for (const c of cleanups.reverse()) await Promise.resolve(c()).catch(() => {}); fs.rmSync(work, { recursive: true, force: true }); process.exit(code); };
process.on("SIGINT", () => done(1));

/* ---------- PostgreSQL ---------- */
const pgPort = await free();
const data = path.join(work, "pg");
execFileSync(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
execFileSync(bin("pg_ctl"), ["-D", data, "-o", `-p ${pgPort} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c max_connections=80`, "-l", path.join(work, "pglog"), "-w", "start"], { stdio: "ignore" });
cleanups.push(() => spawnSync(bin("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" }));
{
  const c = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${pgPort}/postgres` });
  await c.connect(); await c.query("create database gmb"); await c.end();
}
const DIRECT = `postgresql://postgres@127.0.0.1:${pgPort}/gmb`;
const admin = new pg.Pool({ connectionString: DIRECT, max: 4 });
cleanups.push(() => admin.end());
await admin.query(fs.readFileSync(path.join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
for (const f of fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) await admin.query(fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));

/* ---------- delay proxy in front of PostgreSQL: counts round trips (client write bursts) ---------- */
let dbTrips = 0;
const proxyPort = await free();
const proxy = net.createServer((client) => {
  const upstream = net.connect(pgPort, "127.0.0.1");
  let last = 0;
  client.on("data", (b) => { const now = Date.now(); if (now - last > 3) dbTrips++; last = now; setTimeout(() => upstream.write(b), HALF); });
  upstream.on("data", (b) => setTimeout(() => client.write(b), HALF));
  const end = () => { client.destroy(); upstream.destroy(); };
  client.on("error", end); upstream.on("error", end); client.on("close", end); upstream.on("close", end);
}).listen(proxyPort, "127.0.0.1");
cleanups.push(() => proxy.close());

/* ---------- Supabase Auth stand-in (ES256, like the real project) ---------- */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "perf-key", alg: "ES256", use: "sig" };
const b64u = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
const USER = { id: randomUUID(), email: "perf-owner@example.test" };
const now = Math.floor(Date.now() / 1000);
const claims = { sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 6 * 3600, session_id: randomUUID(), aal: "aal1" };
const head = { alg: "ES256", typ: "JWT", kid: "perf-key" };
const signing = `${b64u(head)}.${b64u(claims)}`;
const sig = createSign("SHA256").update(signing).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
const ACCESS = `${signing}.${sig.toString("base64url")}`;
const authCalls = {};
const authPort = await free();
const userJson = { id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
const auth = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  authCalls[p] = (authCalls[p] ?? 0) + 1;
  setTimeout(() => {
    res.setHeader("content-type", "application/json");
    if (p === "/auth/v1/user") return res.end(JSON.stringify(userJson));
    if (p === "/auth/v1/.well-known/jwks.json") return res.end(JSON.stringify({ keys: [jwk] }));
    res.statusCode = 404; res.end("{}");
  }, RTT);
}).listen(authPort, "127.0.0.1");
cleanups.push(() => auth.close());
const AUTH_URL = `http://localhost:${authPort}`;

/* ---------- seed one realistic account ---------- */
await admin.query("insert into auth.users (id, email) values ($1, $2)", [USER.id, USER.email]);
process.env.APP_MODE = "supabase"; process.env.DATABASE_URL = DIRECT; process.env.SESSION_SECRET = "s".repeat(40);
process.env.NEXT_PUBLIC_SUPABASE_URL = AUTH_URL; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "perf-key";
const { db } = await import("@/lib/store");
const iso = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const biz = (name) => ({ name, website: "example.test", location: "Pune", category: "Doctor / Clinic", type: "healthcare", audit: {}, createdAt: iso(90), language: "en", services: ["Skin care", "Allergy tests"], keywords: ["skin clinic pune"] });
await db.saveBusiness({ userId: USER.id, loc: "main" }, biz("Zentrix Skin Clinic"));
await db.updateLocations(USER.id, (idx) => ({ active: "main", ids: [...idx.ids, "b2", "b3"] }));
for (const [loc, name] of [["b2", "Zentrix Baner"], ["b3", "Zentrix Wakad"]]) await db.saveBusiness({ userId: USER.id, loc }, biz(name));
for (const loc of ["main", "b2", "b3"]) {
  const scope = { userId: USER.id, loc };
  await db.savePosts(scope, Array.from({ length: 40 }, (_, i) => ({ id: randomUUID(), text: `Post ${i}: monsoon skin care tips for families, with simple steps to follow every day at home.`, kind: "STANDARD", status: i % 3 ? "draft" : "approved", warnings: [], createdAt: iso(i) })));
  const replies = {};
  for (let i = 0; i < 60; i++) replies[`accounts/1/locations/1/reviews/r${i}`] = { text: `Thank you for visiting us, reply ${i}.`, status: i % 2 ? "posted" : "draft", updatedAt: iso(i), history: Array.from({ length: 5 }, (_, j) => ({ at: iso(i + j), action: "edited", by: "owner", text: "Earlier wording of the reply." })) };
  await db.saveReplies(scope, replies);
  await db.updateLocal(scope, "automation_log", [], () => Array.from({ length: 200 }, (_, i) => ({ at: iso(i / 4), action: "Reply drafted", result: "done", detail: "Draft ready for approval." })));
  await db.updateLocal(scope, "reports", [], () => Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), month: `2026-${String(12 - i).padStart(2, "0")}`, generatedAt: iso(30 * i), trigger: "schedule", partial: false, business: "Zentrix", location: "Pune", summary: "A steady month with more reviews and replies.", sections: Array.from({ length: 9 }, (_, s) => ({ title: `Section ${s}`, available: true, lines: ["Line one of the section.", "Line two of the section.", "Line three."] })) })));
  await db.updateLocal(scope, "review_stats", [], () => Array.from({ length: 90 }, (_, i) => ({ at: iso(i), rating: 4.6, count: 120 - i })));
}

/* ---------- production build of a clean copy ---------- */
const appDir = path.join(work, "app");
fs.mkdirSync(appDir);
for (const f of ["src", "public", "package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "next-env.d.ts", "vercel.json"]) {
  if (fs.existsSync(path.join(ROOT, f))) fs.cpSync(path.join(ROOT, f), path.join(appDir, f), { recursive: true });
}
fs.cpSync(path.join(ROOT, "node_modules"), path.join(appDir, "node_modules"), { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
const appPort = await free();
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NEXT_TELEMETRY_DISABLED: "1",
  APP_MODE: "supabase", DATABASE_URL: `postgresql://postgres@127.0.0.1:${proxyPort}/gmb`, DATABASE_POOL_MAX: "3",
  NEXT_PUBLIC_SUPABASE_URL: AUTH_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "perf-key", NEXT_PUBLIC_APP_URL: `http://localhost:${appPort}`,
  SESSION_SECRET: "s".repeat(40), TOKEN_ENCRYPTION_KEY: "a".repeat(64), TRUSTED_PROXY_HOPS: "0", JOBS_RUNNER: "off",
};
const next = path.join(appDir, "node_modules/next/dist/bin/next");
const build = spawnSync(process.execPath, [next, "build"], { cwd: appDir, env, encoding: "utf8" });
if (build.status !== 0) { console.error(build.stdout.slice(-3000), build.stderr.slice(-3000)); await done(1); }
const server = spawn(process.execPath, [next, "start", "-p", String(appPort)], { cwd: appDir, env, stdio: "ignore" });
cleanups.push(() => server.kill("SIGTERM"));
for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${appPort}/login`)).ok) break; } catch {} await sleep(500); }

/* ---------- measure ---------- */
const session = { access_token: ACCESS, token_type: "bearer", expires_in: 21600, expires_at: claims.exp, refresh_token: "perf-refresh", user: userJson };
const cookie = `sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const PAGES = ["/app", "/app/reviews", "/app/posts", "/app/reports", "/app/locations", "/app/settings", "/app/google-profile", "/app/ai-visibility"];
const rows = [];
for (const p of PAGES) {
  const one = async () => {
    const a0 = Object.values(authCalls).reduce((s, n) => s + n, 0), d0 = dbTrips, t0 = performance.now();
    const res = await fetch(`http://localhost:${appPort}${p}`, { headers: { cookie }, redirect: "manual" });
    const body = await res.text();
    return { ms: performance.now() - t0, status: res.status, bytes: body.length, auth: Object.values(authCalls).reduce((s, n) => s + n, 0) - a0, db: dbTrips - d0 };
  };
  await one(); // warm-up (first render compiles nothing in production, but fills caches like a real second visit)
  const r = []; for (let i = 0; i < RUNS; i++) r.push(await one());
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  rows.push({ page: p, status: r[0].status, median_ms: Math.round(ms[Math.floor(ms.length / 2)]), max_ms: Math.round(ms.at(-1)), auth_calls: r[0].auth, db_round_trips: r[0].db, html_kb: Math.round(r[0].bytes / 1024) });
}
console.log(`\n[${LABEL}] RTT ${RTT} ms to the database and to Supabase Auth, ${RUNS} runs per page after one warm-up`);
console.table(rows);
fs.writeFileSync(path.join(ROOT, `tests/perf/result-${LABEL}.json`), JSON.stringify({ rtt: RTT, runs: RUNS, at: new Date().toISOString(), rows }, null, 2));
await done(0);
