import "server-only";
import { Pool, type PoolClient } from "pg";
import { connectionString, sslFor } from "./db-ssl";

/**
 * PostgreSQL (Supabase) storage for APP_MODE=supabase. Server only: it connects with DATABASE_URL, a privileged
 * connection that bypasses Row Level Security, so every query here names the user it acts for.
 *
 * The rest of the app keeps using the store's key names. This module maps them onto tables (see
 * supabase/migrations/*_gmbmirror_core.sql):
 *   "locations"                         -> accounts + locations
 *   "ai_usage"                          -> user_records
 *   "google" / "loc:<id>:google"        -> google_connections
 *   "<key>" / "loc:<id>:<key>"          -> location_records ("main" location for the key without a prefix)
 * Jobs and rate limits have their own tables and functions (jobs-pg.ts, ratelimit-pg.ts).
 */

const g = globalThis as unknown as { __gmbPgPool?: Pool };

/** One small pool per server instance. On Vercel each function instance keeps a few connections to the pooler. */
export function pool(): Pool {
  if (g.__gmbPgPool) return g.__gmbPgPool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set (APP_MODE=supabase stores data in PostgreSQL).");
  // TLS comes from sslFor, not from the URL, so certificates are always verified (Supabase's CA is built in).
  const { url, host } = connectionString(raw);
  g.__gmbPgPool = new Pool({
    connectionString: url,
    ssl: sslFor(host),
    max: Math.max(1, Number(process.env.DATABASE_POOL_MAX) || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return g.__gmbPgPool;
}

/** Closes the pool (tests and scripts; a restart starts a new one). */
export async function closePool() {
  const p = g.__gmbPgPool;
  g.__gmbPgPool = undefined;
  if (p) await p.end();
}

/** Queries slower than this are logged (statement start only, never the values). DB_SLOW_MS overrides. */
const SLOW_MS = Number(process.env.DB_SLOW_MS) > 0 ? Number(process.env.DB_SLOW_MS) : 250;
const slowLog = (sql: string, ms: number) => {
  if (ms >= SLOW_MS) console.warn(`[db] slow ${Math.round(ms)}ms: ${sql.replace(/\s+/g, " ").trim().slice(0, 90)}`);
};

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const t0 = performance.now();
  try {
    return (await pool().query(sql, params)).rows as T[];
  } finally {
    slowLog(sql, performance.now() - t0);
  }
}

/** Runs `fn` in one transaction (committed, or rolled back on any error). Slow transactions are logged. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const c = await pool().connect();
  const waited = performance.now() - t0;
  if (waited >= SLOW_MS) console.warn(`[db] waited ${Math.round(waited)}ms for a connection (pool size ${process.env.DATABASE_POOL_MAX || 3})`);
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    slowLog("transaction", performance.now() - t0);
  }
}

/** Serialises read-change-write steps on one record across every server instance, until the transaction ends. */
const lock = (c: PoolClient, userId: string, what: string) => c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${userId}/${what}`]);

/** Per-user records shared by every location (supabase/migrations: user_records). */
export const USER_KEYS = ["ai_usage", "notifications", "email_log"];

export const PG_LOCATION_KEYS = ["business", "checks", "replies", "posts", "guide", "places", "growth", "automation_log", "reports", "share_events", "review_stats", "insights_notes", "gbp_scores"];

type Route = { t: "index" } | { t: "user"; key: string } | { t: "google"; loc: string } | { t: "loc"; loc: string; key: string };

export function route(key: string): Route {
  if (key === "locations") return { t: "index" };
  if (USER_KEYS.includes(key)) return { t: "user", key };
  const m = key.match(/^loc:([A-Za-z0-9_-]{1,40}):(.+)$/);
  const loc = m ? m[1] : "main", k = m ? m[2] : key;
  if (k === "google") return { t: "google", loc };
  if (PG_LOCATION_KEYS.includes(k)) return { t: "loc", loc, key: k };
  throw new Error(`Unknown storage key "${key}".`);
}

type Index = { active: string; ids: string[]; mainRemoved?: boolean };

async function readIndex(c: PoolClient | Pool, userId: string): Promise<Index | null> {
  // One round trip: the account row and its locations in order.
  const acc = (await c.query(
    `select a.active_location, a.main_removed,
            coalesce((select array_agg(l.id order by l.position, l.created_at) from public.locations l where l.user_id = a.user_id), '{}') as ids
       from public.accounts a where a.user_id = $1`,
    [userId],
  )).rows[0];
  if (!acc) return null;
  return { active: acc.active_location, ids: acc.ids as string[], ...(acc.main_removed ? { mainRemoved: true } : {}) };
}

/** Saves the location list: ids no longer listed are deleted with everything they hold (removing a location). */
async function writeIndex(c: PoolClient, userId: string, idx: Index) {
  await c.query(
    `insert into public.accounts (user_id, active_location, main_removed) values ($1, $2, $3)
     on conflict (user_id) do update set active_location = excluded.active_location, main_removed = excluded.main_removed, updated_at = now()`,
    [userId, idx.active, Boolean(idx.mainRemoved)],
  );
  for (const [i, id] of idx.ids.entries()) {
    await c.query("insert into public.locations (user_id, id, position) values ($1, $2, $3) on conflict (user_id, id) do update set position = excluded.position", [userId, id, i]);
  }
  await c.query("delete from public.locations where user_id = $1 and not (id = any($2::text[]))", [userId, idx.ids]);
}

/**
 * A location must exist before data is written to it. "main" is created on first use unless it was removed; any
 * other location exists only after it was added to the list, so a late write can never bring back a removed one.
 */
async function ensureLocation(c: PoolClient, userId: string, loc: string) {
  const has = await c.query("select 1 from public.locations where user_id = $1 and id = $2", [userId, loc]);
  if (has.rowCount) return;
  if (loc !== "main") throw new Error("This location no longer exists.");
  const acc = (await c.query("select main_removed from public.accounts where user_id = $1", [userId])).rows[0];
  if (acc?.main_removed) throw new Error("This location no longer exists.");
  await c.query("insert into public.accounts (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
  await c.query("insert into public.locations (user_id, id, position) values ($1, 'main', 0) on conflict do nothing", [userId]);
}

async function readValue(c: PoolClient | Pool, userId: string, r: Exclude<Route, { t: "index" }>, forUpdate = false): Promise<unknown> {
  const fu = forUpdate ? " for update" : "";
  if (r.t === "user") return (await c.query(`select value from public.user_records where user_id = $1 and key = $2${fu}`, [userId, r.key])).rows[0]?.value;
  if (r.t === "google") return (await c.query(`select connection as value from public.google_connections where user_id = $1 and location_id = $2${fu}`, [userId, r.loc])).rows[0]?.value;
  return (await c.query(`select value from public.location_records where user_id = $1 and location_id = $2 and key = $3${fu}`, [userId, r.loc, r.key])).rows[0]?.value;
}

async function writeValue(c: PoolClient, userId: string, r: Exclude<Route, { t: "index" }>, value: unknown) {
  const v = JSON.stringify(value);
  if (r.t === "user") {
    await c.query("insert into public.accounts (user_id) values ($1) on conflict (user_id) do nothing", [userId]);
    await c.query(
      `insert into public.user_records (user_id, key, value) values ($1, $2, $3::jsonb)
       on conflict (user_id, key) do update set value = excluded.value, version = public.user_records.version + 1, updated_at = now()`,
      [userId, r.key, v],
    );
    return;
  }
  await ensureLocation(c, userId, r.loc);
  if (r.t === "google") {
    await c.query(
      `insert into public.google_connections (user_id, location_id, connection) values ($1, $2, $3::jsonb)
       on conflict (user_id, location_id) do update set connection = excluded.connection, version = public.google_connections.version + 1, updated_at = now()`,
      [userId, r.loc, v],
    );
    return;
  }
  await c.query(
    `insert into public.location_records (user_id, location_id, key, value) values ($1, $2, $3, $4::jsonb)
     on conflict (user_id, location_id, key) do update set value = excluded.value, version = public.location_records.version + 1, updated_at = now()`,
    [userId, r.loc, r.key, v],
  );
}

export async function pgGet<T>(userId: string, key: string, fallback: T): Promise<T> {
  const r = route(key);
  if (r.t === "index") return ((await readIndex(pool(), userId)) as T) ?? fallback;
  const v = await readValue(pool(), userId, r);
  return v === undefined || v === null ? fallback : (v as T);
}

/**
 * Several stored values of one user in one round trip (location records of any locations, and Google connections).
 * Returns the stored value for each key found; keys not found are absent. The location index is not included.
 */
export async function pgGetMany(userId: string, keys: string[]): Promise<Record<string, unknown>> {
  const locs: string[] = [], locKeys: string[] = [], googleLocs: string[] = [], userKeys: string[] = [];
  const back = new Map<string, string>();
  for (const key of keys) {
    const r = route(key);
    if (r.t === "loc") { locs.push(r.loc); locKeys.push(r.key); back.set(`L|${r.loc}|${r.key}`, key); }
    else if (r.t === "google") { googleLocs.push(r.loc); back.set(`G|${r.loc}`, key); }
    else if (r.t === "user") { userKeys.push(r.key); back.set(`U|${r.key}`, key); }
  }
  const rows = await query<{ t: string; loc: string; key: string; value: unknown }>(
    `select 'L' as t, location_id as loc, key, value from public.location_records
       where user_id = $1 and (location_id, key) in (select * from unnest($2::text[], $3::text[]))
     union all
     select 'G', location_id, 'google', connection from public.google_connections where user_id = $1 and location_id = any($4::text[])
     union all
     select 'U', '', key, value from public.user_records where user_id = $1 and key = any($5::text[])`,
    [userId, locs, locKeys, googleLocs, userKeys],
  );
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = back.get(r.t === "L" ? `L|${r.loc}|${r.key}` : r.t === "G" ? `G|${r.loc}` : `U|${r.key}`);
    if (k) out[k] = r.value;
  }
  return out;
}

export async function pgSet(userId: string, key: string, value: unknown): Promise<void> {
  const r = route(key);
  await tx(async (c) => {
    await lock(c, userId, key);
    if (r.t === "index") await writeIndex(c, userId, value as Index);
    else await writeValue(c, userId, r, value);
  });
}

/** Read, change and write as one step, safe across server instances (an advisory lock per user and key). */
export async function pgUpdate<T>(userId: string, key: string, fallback: T, fn: (cur: T) => T | undefined): Promise<T> {
  const r = route(key);
  return tx(async (c) => {
    await lock(c, userId, key);
    if (r.t === "index") {
      const cur = ((await readIndex(c, userId)) as T) ?? fallback;
      const next = fn(cur);
      if (next === undefined) return cur;
      await writeIndex(c, userId, next as Index);
      return next;
    }
    const raw = await readValue(c, userId, r, true);
    const cur = raw === undefined || raw === null ? fallback : (raw as T);
    const next = fn(cur);
    if (next === undefined) return cur;
    await writeValue(c, userId, r, next);
    return next;
  });
}

export async function pgDelete(userId: string, key: string): Promise<void> {
  const r = route(key);
  if (r.t === "index") {
    await query("delete from public.accounts where user_id = $1", [userId]);
    return;
  }
  if (r.t === "user") await query("delete from public.user_records where user_id = $1 and key = $2", [userId, r.key]);
  else if (r.t === "google") await query("delete from public.google_connections where user_id = $1 and location_id = $2", [userId, r.loc]);
  else await query("delete from public.location_records where user_id = $1 and location_id = $2 and key = $3", [userId, r.loc, r.key]);
}

/** Everything the user has: the account row and, through foreign keys, every location, record, connection and job. */
export async function pgDeleteAccount(userId: string): Promise<void> {
  await query("delete from public.accounts where user_id = $1", [userId]);
}

/** Every location's business name for one user, in one query (the app's location menu). */
export async function pgBusinessNames(userId: string): Promise<Record<string, string | undefined>> {
  const rows = await query<{ location_id: string; name: string | null }>(
    "select location_id, value->>'name' as name from public.location_records where user_id = $1 and key = 'business'", [userId]);
  return Object.fromEntries(rows.map((r) => [r.location_id, r.name ?? undefined]));
}

export async function pgListUserIds(): Promise<string[]> {
  return (await query<{ user_id: string }>("select user_id from public.accounts order by created_at")).map((r) => r.user_id);
}
