// Database tests: a throwaway PostgreSQL cluster per test file, in a temporary folder, on a free local port.
// It gets the test-only Supabase stub (auth.users, auth.uid(), anon and authenticated roles) and then the real
// schema from supabase/migrations. Nothing here touches the project's .env, .data or any remote database.
// Needs the PostgreSQL server programs (initdb, pg_ctl), version 15 or later. They are not optional: if they are
// missing the tests fail and say so, instead of being skipped.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");

function bin(name: string): string {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  const p = r.stdout.trim();
  if (!p) throw new Error(`The database tests need PostgreSQL's "${name}" (PostgreSQL 15 or later). Install PostgreSQL (for example: brew install postgresql@17) and run npm run test:db again.`);
  return p;
}

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const port = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(port));
  });
});

export type TestDb = { url: string; admin: pg.Pool; stop: () => Promise<void> };

export async function startPostgres(): Promise<TestDb> {
  const initdb = bin("initdb"), pgctl = bin("pg_ctl");
  const dir = mkdtempSync(path.join(os.tmpdir(), "gmb-db-"));
  const data = path.join(dir, "data");
  const port = await freePort();
  execFileSync(initdb, ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
  execFileSync(pgctl, ["-D", data, "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c max_connections=60`, "-l", path.join(dir, "log"), "-w", "start"], { stdio: "ignore" });
  const boot = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres` });
  await boot.connect();
  await boot.query("create database gmb");
  await boot.end();
  const url = `postgresql://postgres@127.0.0.1:${port}/gmb`;
  const admin = new pg.Pool({ connectionString: url, max: 4 });
  await admin.query(readFileSync(path.join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
  for (const f of readdirSync(path.join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
  }
  return {
    url,
    admin,
    stop: async () => {
      await admin.end().catch(() => undefined);
      spawnSync(pgctl, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The settings the app needs to run in Supabase mode against the test database (no real Supabase is contacted). */
export function useSupabaseMode(url: string) {
  process.env.APP_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-publishable-key";
  process.env.SESSION_SECRET = "s".repeat(40);
  process.env.DATABASE_URL = url;
  delete process.env.TRUSTED_PROXY_HOPS;
}

/** A Supabase Auth user in the test database (the app's accounts reference auth.users). */
export async function authUser(admin: pg.Pool, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await admin.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

/**
 * Runs a snippet in a separate Node process (a fresh server instance: new memory, new connection pool) with the
 * app's modules available as "@/...". Returns what the snippet prints.
 */
export function inNewProcess(code: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", path.join(ROOT, "tests/setup/register.mjs"), "--input-type=module", "-e", code], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`Child process failed (${code}): ${err}`))));
  });
}
