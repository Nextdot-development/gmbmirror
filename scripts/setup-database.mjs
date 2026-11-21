#!/usr/bin/env node
// GMBmirror: connect this app to its Supabase database in one step.
//
//   npm run db:setup            asks once for the connection string (hidden), tests it, creates the tables if they
//                               are missing (after asking), checks security, and saves it to .env.local.
//   npm run db:setup -- --check only tests and checks; writes nothing.
//
// It never drops anything, never imports old data, never touches .env or .data, and never prints the password.
// TLS: Supabase's certificate authority is built in (src/lib/db-ssl.ts) and certificates are always verified.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import nextEnv from "@next/env";
import pg from "pg";
import { connectionString, customCa, sslFor } from "../src/lib/db-ssl.ts";
import { configProblems } from "../src/lib/env.ts";

const root = path.resolve(import.meta.dirname, "..");
const MIGRATION = path.join(root, "supabase/migrations/20261121000000_gmbmirror_core.sql");
const VERIFY = path.join(root, "supabase/verify/verify_schema.sql");
const ENV_LOCAL = path.join(root, ".env.local");
const TABLES = ["accounts", "locations", "location_records", "google_connections", "user_records", "jobs", "rate_limits", "migration_runs"];
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const yes = args.has("--yes");

const ok = (m) => console.log(`  \u2713 ${m}`);
const info = (m) => console.log(`    ${m}`);
let problemCount = 0;
const bad = (m) => { problemCount++; console.log(`  \u2717 ${m}`); };
/** Stops with a message. Thrown (not process.exit) so the database connection is closed on the way out. */
class Stop extends Error {}
const fail = (m) => { throw new Stop(m); };

/** Reads a line without showing what is typed (for anything containing the password). */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.startsWith(question)) rl.output.write(question); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); });
  });
}


/** Asks for the database password (hidden) and puts it into the URL, encoded so $ # @ / ? and quotes are safe. */
export async function withPassword(u, ask, { keepAllowed }) {
  const pw = await ask(keepAllowed ? "  Database password (hidden; press Enter to keep the one in the string): " : "  Database password (hidden): ", { hidden: true });
  if (pw) u.password = encodeURIComponent(pw).replace(/'/g, "%27");
  else if (!keepAllowed) fail("No password entered. Nothing was changed.");
  return u;
}

/**
 * Checks the string is Supabase's transaction pooler for this project, then always asks for the password (hidden):
 * required when the string has none or shows [YOUR-PASSWORD], optional (Enter keeps it) when it already has one.
 */
export async function normalise(raw, ref, ask) {
  let s = raw.trim().replace(/^DATABASE_URL=/, "").replace(/^["']|["']$/g, "");
  if (!/^postgres(ql)?:\/\//.test(s)) fail("That is not a connection string. Copy it from Supabase: Connect > Connection string > Transaction pooler.");
  s = s.replace(/:\[YOUR-PASSWORD\]@/i, ":@");
  let u;
  try { u = new URL(s); } catch { fail("That connection string could not be read. Copy it again from Supabase: Connect > Transaction pooler."); }
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(u.hostname)) {
    fail("This is the direct connection (db.<project>.supabase.co). It does not work from Vercel (IPv6 only) and does not suit serverless. Use Connect > Transaction pooler (port 6543).");
  }
  if (!/\.pooler\.supabase\.com$/i.test(u.hostname)) info(`Note: ${u.hostname} is not a Supabase pooler host. Continuing, with the operating system's certificates.`);
  if (/\.pooler\.supabase\.com$/i.test(u.hostname) && u.port !== "6543") {
    info(`Port ${u.port || 5432} is the session pooler; switching to 6543 (transaction pooler), which suits serverless.`);
    u.port = "6543";
  }
  const user = decodeURIComponent(u.username);
  if (ref && /\.pooler\.supabase\.com$/i.test(u.hostname) && user !== `postgres.${ref}`) {
    fail(`This connection string belongs to a different Supabase project than NEXT_PUBLIC_SUPABASE_URL (user ${user.replace(/\..*/, ".<other project>")}).`);
  }
  // Re-encode a password already in the string, so special characters survive the URL and the .env.local file.
  if (u.password) u.password = encodeURIComponent(decodeURIComponent(u.password)).replace(/'/g, "%27");
  await withPassword(u, ask, { keepAllowed: Boolean(u.password) });
  return u.toString();
}

/** Which local env files hold a non-empty DATABASE_URL (names only; values are never read out or printed). */
function savedIn() {
  return [".env.local", ".env"].filter((f) => {
    try { return /^\s*DATABASE_URL\s*=\s*\S+/m.test(readFileSync(path.join(root, f), "utf8")); } catch { return false; }
  });
}

/** Saves APP_MODE and DATABASE_URL to .env.local (private file, ignored by git). Other lines are kept. */
export function envLocalContent(before, url) {
  // Keep everything except earlier APP_MODE / DATABASE_URL / DATABASE_CA_CERT lines and the old inactive template.
  const ours = /^# (GMBmirror: this machine uses|Private: never commit|Supabase transaction pooler \(port 6543\))/;
  const kept = before.split("\n").filter((l) => !/^\s*#?\s*(APP_MODE|DATABASE_URL|DATABASE_CA_CERT)\s*=/.test(l) && !ours.test(l)).join("\n");
  const template = kept.includes("INACTIVE until you fill in");
  const header = "# GMBmirror: this machine uses the real Supabase project. Written by npm run db:setup.\n# Private: never commit or share this file (.gitignore excludes it). Delete it to go back to demo mode.\n";
  const body = `APP_MODE=supabase\n# Supabase transaction pooler (port 6543). Contains the database password.\nDATABASE_URL="${url}"\n`;
  return header + body + (template || !kept.trim() ? "" : `\n${kept.trim()}\n`);
}

function saveEnvLocal(url) {
  writeFileSync(ENV_LOCAL, envLocalContent(existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "", url), { mode: 0o600 });
  chmodSync(ENV_LOCAL, 0o600);
}

async function main() {
  console.log("GMBmirror database setup\n");
  nextEnv.loadEnvConfig(root, true, { info: () => {}, error: console.error });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (!ref) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env (https://<project>.supabase.co).");
  ok("Supabase project found in .env");
  if (process.env.DATABASE_CA_CERT?.trim() && !customCa()) {
    info("DATABASE_CA_CERT is set but is not a certificate, so it is ignored. It is not needed: remove it from .env when convenient.");
  } else if (customCa()) info("DATABASE_CA_CERT is set and will be used instead of the built-in Supabase CA. It is not needed for Supabase.");

  // 1. The connection string. Setup always asks for a fresh one (an older DATABASE_URL in .env or .env.local is
  //    ignored, never printed, and never changed). --check uses the saved one (.env.local wins over .env).
  let url;
  let entered = false;
  const existing = savedIn();
  if (checkOnly) {
    url = process.env.DATABASE_URL;
    if (!url) fail("DATABASE_URL is not set. Run npm run db:setup (without --check) to enter it.");
    ok(`Using the saved DATABASE_URL (from ${existing[0] ?? "the environment"})`);
  } else {
    if (existing.length) info(`An existing DATABASE_URL in ${existing.join(" and ")} is ignored here. A working one is saved to .env.local, which takes priority over .env.`);
    console.log("\n  In Supabase, open your project > Connect (top bar) > Connection string > Transaction pooler,");
    console.log("  and copy the string. Nothing you paste or type is shown.\n");
    url = await normalise(await ask("  Transaction pooler connection string (hidden): ", { hidden: true }), ref, ask);
    entered = true;
  }

  // 2. Connect, with verified TLS. If Supabase refuses the password, ask again (up to 3 tries in all).
  const { host } = connectionString(url);
  let db;
  for (let attempt = 1; ; attempt++) {
    db = new pg.Client({ connectionString: connectionString(url).url, ssl: sslFor(host), connectionTimeoutMillis: 15000 });
    try {
      await db.connect();
      break;
    } catch (e) {
      await db.end().catch(() => {});
      const m = String(e.message);
      const wrongPassword = /password authentication failed|SASL|authentication failed/i.test(m);
      if (wrongPassword && entered && attempt < 3) {
        bad("Supabase refused that password. Try again (or reset it in Supabase: Database > Settings > Reset database password).");
        problemCount--;
        url = (await withPassword(new URL(url), ask, { keepAllowed: false })).toString();
        continue;
      }
      if (wrongPassword) fail(entered ? "Supabase refused the password 3 times. Reset it in Supabase (Database > Settings > Reset database password), then run npm run db:setup again. Nothing was saved." : "Supabase refused the saved password. Run npm run db:setup (without --check) to enter a fresh one.");
      if (/tenant\/user .* not found/i.test(m)) fail("The pooler does not know this project/user. Copy the string again from Connect > Transaction pooler. Nothing was saved.");
      fail(`Could not connect (${e.code ?? "error"}). Nothing was saved.`);
    }
  }
  const v = (await db.query("select current_setting('server_version') v, current_user u")).rows[0];
  ok(`Connected to ${host}${sslFor(host) ? " over TLS with a verified certificate" : " (local, no TLS)"} (PostgreSQL ${v.v})`);

  try {
    // 3. Inspect before changing anything.
    const have = (await db.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)", [TABLES])).rows.map((r) => r.relname);
    const legacy = (await db.query("select to_regclass('public.user_data') is not null t")).rows[0].t;
    const missing = TABLES.filter((t) => !have.includes(t));
    if (!missing.length) ok("All 8 GMBmirror tables exist");
    else info(`Tables present: ${have.length}/8${have.length ? ` (${have.join(", ")})` : ""}. Missing: ${missing.join(", ")}`);
    if (legacy) info("An old table public.user_data exists. It is not used and is left untouched.");

    // 4. Create what is missing (the migration only adds; it never drops).
    if (missing.length) {
      if (checkOnly) {
        bad("Schema not applied yet (run npm run db:setup without --check)");
      } else {
        const go = yes || /^y(es)?$/i.test(await ask(`\n  Create the missing tables, functions and security policies now? It never drops anything. [y/N] `));
        if (!go) fail("Stopped. Nothing was changed.");
        await db.query("begin");
        try {
          await db.query(readFileSync(MIGRATION, "utf8"));
          await db.query("commit");
        } catch (e) {
          await db.query("rollback").catch(() => {});
          fail(`The schema could not be applied, and nothing was changed: ${e.message}`);
        }
        ok("Schema applied (supabase/migrations/20261121000000_gmbmirror_core.sql)");
      }
    }

    // 5. Security and structure checks (supabase/verify/verify_schema.sql, all inside a rolled-back transaction).
    if (!(checkOnly && missing.length)) {
      const sql = readFileSync(VERIFY, "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");
      let results;
      try {
        results = [].concat(await db.query(sql));
      } catch (e) {
        await db.query("rollback").catch(() => {});
        fail(`A security check could not run (nothing was changed): ${e.message}`);
      }
      const rows = results.flatMap((r) => r.rows ?? []);
      const checks = rows.filter((r) => "ok" in r);
      const failed = checks.filter((r) => r.ok !== true);
      const rls = rows.filter((r) => "rls_on" in r);
      const policies = rows.filter((r) => "policyname" in r).length;
      const counts = rows.filter((r) => "count" in r && "table_name" in r);
      const leftovers = rows.find((r) => "leftover_verify_users" in r);
      rls.every((r) => r.exists && r.rls_on) ? ok("8 tables, Row Level Security on for each") : bad(`Tables or RLS missing: ${rls.filter((r) => !r.exists || !r.rls_on).map((r) => r.table_name).join(", ")}`);
      info(`${rows.filter((r) => "conname" in r).length} foreign keys, ${rows.filter((r) => "indexname" in r).length} indexes, ${policies} read-only policies`);
      failed.length ? failed.forEach((r) => bad(`Check failed: ${r.check_name ?? r.table_without_policies ?? `${r.proname} / ${r.rolname}`}`)) : ok(`${checks.length} security checks passed (own rows only, no token access, no writes from the browser, functions blocked)`);
      Number(leftovers?.leftover_verify_users) === 0 ? ok("Test users rolled back (none left behind)") : bad("Temporary check users were left behind");
      const total = counts.reduce((n, r) => n + Number(r.count), 0);
      info(total === 0 ? "Database is empty: no accounts or records yet (fresh start)." : `Records so far: ${counts.filter((r) => Number(r.count)).map((r) => `${r.table_name} ${r.count}`).join(", ")}`);
      if (failed.length || !rls.every((r) => r.exists && r.rls_on)) fail("Security checks failed. The connection was not saved.");
    }
  } finally {
    await db.end();
  }

  // 6. Save the connection string in one place: .env.local (never .env).
  if (entered) {
    const go = yes || /^y(es)?$/i.test(await ask(`\n  Save APP_MODE=supabase and the tested connection to .env.local (not shown here)? [y/N] `));
    if (!go) fail("Not saved. Nothing was written.");
    saveEnvLocal(url);
    ok(".env.local saved (readable only by you; ignored by git). .env was not changed.");
  }

  // 7. What the app still needs to start in Supabase mode.
  const problems = configProblems({ ...process.env, APP_MODE: "supabase", DATABASE_URL: url });
  problems.length ? problems.forEach((p) => bad(p)) : ok("App settings complete for APP_MODE=supabase");

  // 8. Supabase Auth, read with the public key.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const s = await (await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: key } })).json();
    s.disable_signup ? bad("Supabase Auth: sign-ups are turned off") : ok("Supabase Auth: email sign-up on");
    s.mailer_autoconfirm ? info("Supabase Auth: email confirmation is OFF (new accounts are not verified)") : ok("Supabase Auth: email confirmation on");
  } catch { info("Could not read Supabase Auth settings."); }

  console.log("\nStill to do in the Supabase dashboard (Authentication > URL Configuration and > Emails): see docs/DEPLOYMENT.md, section 10.");
  if (entered) console.log("Restart the dev server (npm run dev) so it switches to Supabase mode.");
  if (problemCount) { console.log(`\n${problemCount} problem(s) above.`); process.exitCode = 1; }
}

if (import.meta.main) {
  main().catch((e) => {
    console.log(`\n\u2717 ${e instanceof Stop ? e.message : `Unexpected error: ${e.message}`}`);
    process.exitCode = 1;
  });
}
