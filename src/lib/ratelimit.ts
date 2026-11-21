import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * Fixed-window rate limiter held in this server process's memory.
 * It needs no extra service, but the counts are per process: with several instances or serverless
 * functions each one keeps its own count, and a restart clears them. Use a shared store for that setup.
 */
type Bucket = { count: number; resetAt: number };
// One map per process, even when Next.js loads this module once per bundle (route handlers and pages).
const g = globalThis as unknown as { __gmbRateBuckets?: Map<string, Bucket> };
const buckets = (g.__gmbRateBuckets ??= new Map<string, Bucket>());
const MAX_BUCKETS = 10_000;

export type Limit = { limit: number; windowMs: number };

export const LIMITS = {
  /** Every login attempt from one client address, whatever the account. */
  loginPerIp: { limit: 20, windowMs: 15 * 60_000 },
  /**
   * Failed logins for one account from one client: an address, or a browser that has logged in to the account
   * before. Blocks guessing from one place without letting it lock the owner out elsewhere. Cleared by a success.
   */
  loginFailPerClient: { limit: 5, windowMs: 15 * 60_000 },
  /** Failed logins for one account from anywhere. Catches guessing spread over many addresses; recognised browsers are exempt. */
  loginFailPerAccount: { limit: 20, windowMs: 60 * 60_000 },
  signupPerIp: { limit: 5, windowMs: 60 * 60_000 },
  /** Password reset emails: per client address, and per email address. */
  resetPerIp: { limit: 5, windowMs: 60 * 60_000 },
  resetPerEmail: { limit: 3, windowMs: 60 * 60_000 },
  /** Each visibility check makes several paid model calls. */
  visibilityPerUser: { limit: 6, windowMs: 60 * 60_000 },
  /** Reply and post drafts, one model call each. */
  draftPerUser: { limit: 30, windowMs: 60 * 60_000 },
  /** Claude-written dashboard recommendations, per user. Only made when the underlying data changed. */
  growthPerUser: { limit: 12, windowMs: 60 * 60_000 },
  /** Every Google Places request, per user. A grid scan uses 10. */
  placesPerUser: { limit: 60, windowMs: 60 * 60_000 },
  /**
   * Every Business Profile API request from this process. Google's approved project quota is 300 a minute; the guard
   * stays below it. GBP_QPM_GUARD overrides it (the test servers raise it: their Google stand-in has no quota).
   */
  gbpProject: { limit: Number(process.env.GBP_QPM_GUARD) > 0 ? Number(process.env.GBP_QPM_GUARD) : 250, windowMs: 60_000 },
  /** Replies and posts sent to one location. Google allows 10 profile edits a minute per profile. */
  // GBP_EDITS_PER_MIN exists for the test servers, where every test account shares one stand-in location.
  gbpEditsPerLocation: { limit: Number(process.env.GBP_EDITS_PER_MIN) > 0 ? Number(process.env.GBP_EDITS_PER_MIN) : 10, windowMs: 60_000 },
  /** Manual "update insights" and "check Google again" requests, per user. */
  gbpRefreshPerUser: { limit: 20, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;

function prune(now: number) {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  // Still full of live buckets: drop the oldest so memory stays bounded.
  for (const k of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(k);
  }
}

/** Counts one attempt. Returns ok=false once the limit for the window is used up. */
export function take(key: string, { limit, windowMs }: Limit, cost = 1): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) prune(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (cost > limit) return { ok: false, retryAfterSec: Math.ceil(windowMs / 1000) };
    buckets.set(key, { count: cost, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (b.count + cost > limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  b.count += cost;
  return { ok: true, retryAfterSec: 0 };
}

/** Whether a limit is already used up, without counting an attempt. */
export function peek(key: string, { limit }: Limit, cost = 1): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now || b.count + cost <= limit) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

/** Gives back one attempt, for example when the action failed for reasons outside the user's control. */
export function refund(key: string) {
  const b = buckets.get(key);
  if (b && b.count > 0) b.count -= 1;
}

export function clear(key: string) {
  buckets.delete(key);
}

/** Bucket shared by every request whose address cannot be trusted. Forging a header can never earn more attempts. */
export const UNTRUSTED_CLIENT = "untrusted";

/**
 * TRUSTED_PROXY_HOPS: how many reverse proxies we control sit in front of the app (Vercel, nginx, Caddy, a load
 * balancer: 1 each; Cloudflare in front of nginx: 2). Each one appends, or overwrites with, the address it saw.
 * Returns undefined when unset or invalid; the startup check (env.ts) reports both in production.
 */
export function trustedProxyHops(value = process.env.TRUSTED_PROXY_HOPS): number | undefined {
  return value !== undefined && /^(10|[0-9])$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

/**
 * The rate-limit key for a client, from the X-Forwarded-For header and the number of trusted proxies.
 *
 * Only the entry written by our own outermost proxy, `hops` places from the right, is trusted. Everything to its
 * left was sent by the client and is ignored. With no trusted proxy (hops = 0) nothing in the header can be
 * trusted: Next.js copies the socket address into it only when the client sent none, so a forged value and a
 * real one look the same. Every such request then shares one bucket.
 * IPv6 addresses are grouped by /64, the block one subscriber usually gets, so one user cannot rotate addresses.
 */
export function clientKeyFrom(forwardedFor: string | null | undefined, hops: number): string {
  if (!(hops > 0)) return UNTRUSTED_CLIENT;
  const entries = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Fewer entries than proxies: the request did not come through all of them.
  const entry = entries.length >= hops ? entries[entries.length - hops] : undefined;
  return (entry && normaliseIp(entry)) || UNTRUSTED_CLIENT;
}

function normaliseIp(raw: string): string | undefined {
  let s = raw;
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) s = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":")); // IPv4 with a port
  s = s.replace(/%.*$/, ""); // IPv6 zone id
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) s = mapped[1];
  const version = isIP(s);
  if (version === 4) return s;
  if (version === 6) return `${ipv6Prefix64(s)}::/64`;
  return undefined;
}

/** The first four groups of an IPv6 address, written without leading zeros. */
function ipv6Prefix64(s: string): string {
  const [head, tail] = s.toLowerCase().split("::");
  const count = (part?: string) => (part ? part.split(":").reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0) : 0);
  const groups = [...(head ? head.split(":") : []), ...(tail === undefined ? [] : Array(8 - count(head) - count(tail)).fill("0"))];
  return groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":");
}

/** The rate-limit key for the client making the current request. See clientKeyFrom. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return clientKeyFrom(h.get("x-forwarded-for"), trustedProxyHops() ?? 0);
}

export function waitMessage(what: string, retryAfterSec: number): string {
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Too many ${what}. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
}

/* ---------------- Shared limits (what the app uses) ---------------- */

/**
 * The same limits, shared by every server instance in Supabase mode (a PostgreSQL table and function), and held in
 * this process's memory in demo mode. On Vercel each function instance has its own memory, so without the shared
 * store a login lockout or a Google budget could be passed by spreading requests over instances.
 */
const shared = () => process.env.APP_MODE === "supabase";
const pg = () => import("./db-pg");

export async function takeShared(key: string, l: Limit, cost = 1): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!shared()) return take(key, l, cost);
  if (cost > l.limit) return { ok: false, retryAfterSec: Math.ceil(l.windowMs / 1000) };
  const r = (await (await pg()).query<{ ok: boolean; retry_after_sec: number }>("select * from public.take_rate_limit($1, $2, $3, $4)", [key, l.limit, l.windowMs, cost]))[0];
  return { ok: r.ok, retryAfterSec: r.retry_after_sec };
}

export async function peekShared(key: string, l: Limit, cost = 1): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!shared()) return peek(key, l, cost);
  const r = (await (await pg()).query<{ count: number; reset_at: Date }>("select count, reset_at from public.rate_limits where key = $1", [key]))[0];
  if (!r || r.reset_at.getTime() <= Date.now() || r.count + cost <= l.limit) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.ceil((r.reset_at.getTime() - Date.now()) / 1000) };
}

export async function refundShared(key: string): Promise<void> {
  if (!shared()) return refund(key);
  await (await pg()).query("update public.rate_limits set count = greatest(count - 1, 0) where key = $1", [key]);
}

export async function clearShared(key: string): Promise<void> {
  if (!shared()) return clear(key);
  await (await pg()).query("delete from public.rate_limits where key = $1", [key]);
}
