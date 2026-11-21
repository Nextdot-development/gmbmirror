import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "./env";
import { supabaseServer } from "./session";
import type { Business, GoogleConnection, GrowthState, GuideProgress, PostDraft, ReplyDraft, VisibilityCheck, PlacesHistory } from "./types";

/**
 * One tiny key value layer per user. Demo mode writes a JSON file under .data.
 * Supabase mode writes rows to public.user_data with row level security (see supabase/schema.sql).
 */
const FILE = path.join(process.cwd(), ".data", "user_data.json");

async function demoRead(): Promise<Record<string, Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (e) {
    // Only "the file does not exist yet" means "no data". Anything else must not look like an empty account.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Could not read stored data.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Stored data is damaged and could not be read.");
  }
}

/**
 * Writes the whole demo file atomically: a temporary file, then a rename. A request reading at the same moment sees
 * the old file or the new one, never half of one (which used to read as "damaged"). Same file, same format.
 */
async function writeAll(all: Record<string, Record<string, unknown>>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2));
  await fs.rename(tmp, FILE);
}

async function getKey<T>(userId: string, key: string, fallback: T): Promise<T> {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    const { data, error } = await sb.from("user_data").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
    // A failed read is not the same as "no row". Treating it as empty sent people back to onboarding,
    // where saving would overwrite what they already had.
    if (error) throw new Error(`Could not load ${key}: ${error.message}`);
    return (data?.value as T) ?? fallback;
  }
  const all = await demoRead();
  return (all[userId]?.[key] as T) ?? fallback;
}

async function setKey(userId: string, key: string, value: unknown): Promise<void> {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    const { error } = await sb
      .from("user_data")
      .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
    if (error) throw new Error(`Could not save ${key}: ${error.message}`);
    return;
  }
  await serial(async () => {
    const all = await demoRead();
    all[userId] = { ...(all[userId] ?? {}), [key]: value };
    await writeAll(all);
  });
}

/**
 * Demo mode keeps every user in one file, so each change is read, modified and written whole. Changes in this
 * process run one at a time, so two at once (a page and a background job) cannot drop each other's update.
 */
// Next.js bundles route handlers and pages separately, so this module can be loaded more than once in one process.
// The queue lives on globalThis so every copy shares it.
const shared = globalThis as unknown as { __gmbStoreQueue?: Promise<unknown> };
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = (shared.__gmbStoreQueue ?? Promise.resolve()).then(fn, fn);
  shared.__gmbStoreQueue = run.catch(() => undefined);
  return run;
}

/**
 * Read, change and write one value as a single step. In demo mode it runs inside the write queue, so no other change
 * in this process can land between the read and the write. `fn` returns undefined to leave the value as it is.
 */
async function updateKey<T>(userId: string, key: string, fallback: T, fn: (cur: T) => T | undefined): Promise<T> {
  if (env.mode() === "supabase") {
    // Supabase: no transaction here; a conditional update in SQL would be needed for the same guarantee.
    const cur = await getKey<T>(userId, key, fallback);
    const next = fn(cur);
    if (next !== undefined) await setKey(userId, key, next);
    return next ?? cur;
  }
  return serial(async () => {
    const all = await demoRead();
    const cur = (all[userId]?.[key] as T) ?? fallback;
    const next = fn(cur);
    if (next === undefined) return cur;
    all[userId] = { ...(all[userId] ?? {}), [key]: next };
    await writeAll(all);
    return next;
  });
}

async function delKey(userId: string, key: string) {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    const { error } = await sb.from("user_data").delete().eq("user_id", userId).eq("key", key);
    if (error) throw new Error(`Could not delete ${key}: ${error.message}`);
    return;
  }
  await serial(async () => {
    const all = await demoRead();
    if (all[userId]) delete all[userId][key];
    await writeAll(all);
  });
}

/**
 * Data belongs to one business location of one user. The first location ("main") uses the original key names, so
 * data saved before locations existed is read in place, never moved. Other locations use "loc:<id>:<key>".
 */
export type Scope = { userId: string; loc: string };
export const MAIN_LOCATION = "main";
const keyFor = (s: Scope, key: string) => (s.loc === MAIN_LOCATION ? key : `loc:${s.loc}:${key}`);
const LOCATION_KEYS = ["business", "checks", "google", "replies", "posts", "guide", "places", "growth", "automation_log", "reports", "share_events", "review_stats", "insights_notes", "gbp_scores"];

/**
 * The user's locations; `active` is the one the app shows. "main" (the first location, stored under the original key
 * names) is listed unless it was removed (`mainRemoved`). There is always at least one location.
 */
export type LocationIndex = { active: string; ids: string[]; mainRemoved?: boolean };

function normaliseIndex(idx: LocationIndex | null): LocationIndex {
  const others = (idx?.ids ?? []).filter((x) => x !== MAIN_LOCATION);
  // "main" is listed unless it was removed; with nothing else left it comes back (empty), so the app always has one.
  const ids = idx?.mainRemoved && others.length ? others : [MAIN_LOCATION, ...others];
  const active = idx && ids.includes(idx.active) ? idx.active : ids[0];
  return ids.includes(MAIN_LOCATION) ? { active, ids } : { active, ids, mainRemoved: true };
}

const get = <T>(s: Scope, key: string, fallback: T) => getKey<T>(s.userId, keyFor(s, key), fallback);
const set = (s: Scope, key: string, value: unknown) => setKey(s.userId, keyFor(s, key), value);

export const db = {
  getBusiness: (s: Scope) => get<Business | null>(s, "business", null),
  saveBusiness: (s: Scope, b: Business) => set(s, "business", b),

  getChecks: (s: Scope) => get<VisibilityCheck[]>(s, "checks", []),
  addCheck: async (s: Scope, c: VisibilityCheck) => {
    const list = await get<VisibilityCheck[]>(s, "checks", []);
    await set(s, "checks", [c, ...list].slice(0, 30));
  },

  getGoogle: (s: Scope) => get<GoogleConnection | null>(s, "google", null),
  saveGoogle: (s: Scope, g: GoogleConnection) => set(s, "google", g),
  /**
   * Changes the stored connection only if it is still the sign-in `connectedAt` (atomically): a slow request that
   * started before a disconnect or a new sign-in can never write the old connection back.
   */
  updateGoogle: (s: Scope, connectedAt: string, fn: (cur: GoogleConnection) => GoogleConnection) =>
    updateKey<GoogleConnection | null>(s.userId, keyFor(s, "google"), null, (cur) => (cur && cur.connectedAt === connectedAt ? fn(cur) : undefined)),
  deleteGoogle: (s: Scope) => delKey(s.userId, keyFor(s, "google")),

  getReplies: (s: Scope) => get<Record<string, ReplyDraft>>(s, "replies", {}),
  saveReplies: (s: Scope, r: Record<string, ReplyDraft>) => set(s, "replies", r),

  getPosts: (s: Scope) => get<PostDraft[]>(s, "posts", []),
  savePosts: (s: Scope, p: PostDraft[]) => set(s, "posts", p),

  getProgress: (s: Scope) => get<GuideProgress>(s, "guide", { done: {}, notes: "", insights: [] }),
  saveProgress: (s: Scope, g: GuideProgress) => set(s, "guide", g),

  getPlaces: (s: Scope) => get<PlacesHistory>(s, "places", { profileScores: [], scans: [] }),
  savePlaces: (s: Scope, p: PlacesHistory) => set(s, "places", p),
  /** Read, change and write the listing history as one step (a slow scan cannot overwrite an audit saved meanwhile). */
  updatePlaces: (s: Scope, fn: (cur: PlacesHistory) => PlacesHistory) => updateKey<PlacesHistory>(s.userId, keyFor(s, "places"), { profileScores: [], scans: [] }, fn),
  getGrowth: (s: Scope) => get<GrowthState>(s, "growth", { completed: [], drafts: {} }),
  saveGrowth: (s: Scope, g: GrowthState) => set(s, "growth", g),

  /** Any other per-location record (automation log, reports, share counts, AI cache). */
  getLocal: <T>(s: Scope, key: string, fallback: T) => get<T>(s, key, fallback),
  saveLocal: (s: Scope, key: string, value: unknown) => set(s, key, value),
  /** Read, change and write one per-location record as a single step (see updateKey). */
  updateLocal: <T>(s: Scope, key: string, fallback: T, fn: (cur: T) => T | undefined) => updateKey<T>(s.userId, keyFor(s, key), fallback, fn),

  /** Per-user records, shared by all locations (location index, jobs, AI usage). */
  getUserKey: <T>(userId: string, key: string, fallback: T) => getKey<T>(userId, key, fallback),
  saveUserKey: (userId: string, key: string, value: unknown) => setKey(userId, key, value),
  /** Read, change and write one per-user record as a single step (the job queue uses it to claim jobs). */
  updateUserKey: <T>(userId: string, key: string, fallback: T, fn: (cur: T) => T | undefined) => updateKey<T>(userId, key, fallback, fn),

  getLocations: async (userId: string): Promise<LocationIndex> => normaliseIndex(await getKey<LocationIndex | null>(userId, "locations", null)),
  /** Saves the location list. "main" counts as removed exactly when `ids` leaves it out. */
  saveLocations: (userId: string, idx: LocationIndex) => setKey(userId, "locations", { active: idx.active, ids: idx.ids, mainRemoved: !idx.ids.includes(MAIN_LOCATION) }),

  /** Changes the location list as one atomic step. `fn` returns undefined to leave it unchanged. */
  updateLocations: async (userId: string, fn: (idx: LocationIndex) => LocationIndex | undefined): Promise<LocationIndex> =>
    normaliseIndex(await updateKey<LocationIndex | null>(userId, "locations", null, (raw) => {
      const next = fn(normaliseIndex(raw));
      return next && { active: next.active, ids: next.ids, mainRemoved: !next.ids.includes(MAIN_LOCATION) };
    })),
  /** Removes one location's data: only its own keys (see LOCATION_KEYS); other locations and per-user data stay. */
  deleteLocation: async (s: Scope) => {
    for (const k of LOCATION_KEYS) await delKey(s.userId, keyFor(s, k));
  },
  /**
   * Takes one location out of the list (one atomic step) and then deletes its data. Refuses to remove the last
   * location or one that is not in the list. If it was the location being shown, another one is shown instead.
   */
  removeLocation: async (userId: string, loc: string): Promise<{ ok: boolean; active?: string }> => {
    let ok = false;
    const after = await updateKey<LocationIndex | null>(userId, "locations", null, (raw) => {
      const idx = normaliseIndex(raw);
      if (!idx.ids.includes(loc) || idx.ids.length < 2) return undefined;
      ok = true;
      const ids = idx.ids.filter((x) => x !== loc);
      return { active: idx.active === loc ? ids[0] : idx.active, ids, mainRemoved: !ids.includes(MAIN_LOCATION) };
    });
    if (!ok) return { ok: false };
    await db.deleteLocation({ userId, loc });
    return { ok: true, active: normaliseIndex(after).active };
  },
  /** Removes everything the user has, in every location ("Delete my data"). */
  deleteAccountData: async (userId: string) => {
    const { ids } = await db.getLocations(userId);
    for (const loc of new Set([MAIN_LOCATION, ...ids])) await db.deleteLocation({ userId, loc });
    for (const k of ["locations", "jobs", "ai_usage"]) await delKey(userId, k);
  },

  /** Every user id with stored data (demo mode only; used by the background job runner). */
  listUserIds: async (): Promise<string[]> => {
    if (env.mode() === "supabase") throw new Error("Listing users needs a server-side Supabase client (see docs: background jobs).");
    return Object.keys(await demoRead());
  },
};
