import "server-only";
import { db, type Scope } from "./store";
import { env } from "./env";
import { accessToken, sampleReviews } from "./google";
import {
  fetchInsights, fetchMonthly, GbpError, getProfile, getReview, listAccounts, listLocations, listPosts, listReviews,
  type GbpLocation, type GbpPost, type ReviewPage,
} from "./gbp-api";
import type { GbpArea, GoogleConnection, Review, SourcedField } from "./types";
import { applyGoogleProfile, snapshotFrom } from "./business-sync";
import { profileScore } from "./profile-score";
import { tagHistory } from "./listing-history";
import { live, type LiveConnection } from "./gbp-state";

export { autoLocation, gbpStatus, live, locationFields, type GbpStatus, type LiveConnection } from "./gbp-state";

/**
 * The Business Profile integration as the app uses it: connection state, token refresh, and each feature,
 * recording the last successful sync and the last error per area. Live calls happen only when OAuth is set up,
 * GBP_API_APPROVED=true, the owner connected Google, and a location is chosen. Otherwise nothing calls Google.
 */

/**
 * Saves only the fields given, on top of what is stored now, and only if it is still the same sign-in
 * (`connectedAt`). A slow request that started before a disconnect or a new sign-in must not write the old
 * connection back over the new one.
 */
async function patchConnection(scope: Scope, connectedAt: string, patch: Partial<GoogleConnection> | ((cur: GoogleConnection) => Partial<GoogleConnection>)) {
  await db.updateGoogle(scope, connectedAt, (cur) => ({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) }));
}

/**
 * Runs one Google feature with a fresh access token. Saves a refreshed token, marks the connection for
 * reconnecting when Google refuses the sign-in, and records the last success or failure for the area.
 */
export async function withGoogle<T>(scope: Scope, conn: GoogleConnection, area: GbpArea, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    const { token, updated } = await accessToken(conn);
    if (updated) {
      conn.tokens = updated;
      await patchConnection(scope, conn.connectedAt, { tokens: updated });
    }
    const out = await fn(token);
    // The sync time is saved at most once a minute per area (and always when it clears an error), to keep writes low.
    const last = conn.lastSync?.[area];
    const clearsError = conn.lastError?.area === area;
    if (clearsError || !last || Date.now() - Date.parse(last) > 60_000) {
      await patchConnection(scope, conn.connectedAt, (cur) => ({ lastSync: { ...(cur.lastSync ?? {}), [area]: new Date().toISOString() }, ...(clearsError ? { lastError: undefined } : {}) }));
    }
    return out;
  } catch (e) {
    const err = e instanceof GbpError ? e : new GbpError("network");
    if (!(e instanceof GbpError)) console.error("[gbp] unexpected error", e instanceof Error ? e.message : e);
    await patchConnection(scope, conn.connectedAt, {
      lastError: { area, at: new Date().toISOString(), message: err.message },
      ...(err.kind === "reconnect" || err.kind === "scope" ? { needsReconnect: true } : {}),
    });
    throw err;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Google could not be reached.");

/* ---------------- locations ---------------- */

export async function discoverLocations(token: string): Promise<{ locations: GbpLocation[]; truncated: boolean }> {
  return listLocations(token, await listAccounts(token));
}

/** Every Business Profile location the connected Google account can manage. */
export async function fetchLocations(scope: Scope): Promise<{ locations: GbpLocation[]; truncated?: boolean; error?: string }> {
  const conn = await db.getGoogle(scope);
  if (!conn || !env.googleConfigured() || !env.gbpApproved() || conn.needsReconnect) return { locations: [] };
  try {
    return await withGoogle(scope, conn, "locations", discoverLocations);
  } catch (e) {
    return { locations: [], error: message(e) };
  }
}

/* ---------------- profile ---------------- */

/** A stored profile older than this is read from Google again when a page needs it. */
export const PROFILE_MAX_AGE_MS = 6 * 60 * 60_000;

export type SyncResult = { changed: SourcedField[]; placeIdChanged?: boolean; error?: string };

/**
 * Reads the selected location's profile (and Google's rating and review count) and stores it on the connection,
 * replacing any earlier snapshot. Then fills the business details under the rules in business-sync.ts: the owner's
 * own values are never overwritten. If the location's Place ID differs from the business's, the location wins (it is
 * the listing the owner manages) and earlier audits and scans stay labelled with the old listing.
 */
export async function syncBusinessFromGoogle(scope: Scope): Promise<SyncResult> {
  const conn = await db.getGoogle(scope);
  if (!live(conn)) return { changed: [] };
  const location = conn.locationName;
  let snap;
  try {
    snap = await withGoogle(scope, conn, "profile", async (t) => {
      const profile = await getProfile(t, location);
      // The rating and review count are a nice-to-have: the profile is still saved if the reviews call fails.
      const page = await listReviews(t, conn.accountName, location, undefined, 1).catch(() => undefined);
      return snapshotFrom(profile, location, { rating: page?.averageRating, count: page?.totalReviewCount });
    });
  } catch (e) {
    return { changed: [], error: message(e) };
  }
  // Saved only for the same sign-in and the same location (the owner may have switched while Google answered).
  let saved = false;
  await db.updateGoogle(scope, conn.connectedAt, (cur) => {
    if (cur.locationName !== location) return cur;
    saved = true;
    return { ...cur, profile: snap };
  });
  if (!saved) return { changed: [] };
  // Business Profile score history: one entry a day per Google location, so locations never mix.
  const score = profileScore(snap).score;
  const scores = await db.getLocal<{ at: string; score: number; location: string }[]>(scope, "gbp_scores", []);
  await db.saveLocal(scope, "gbp_scores", [{ at: snap.fetchedAt, score, location: snap.location },
    ...scores.filter((x) => !(x.location === snap.location && x.at.slice(0, 10) === snap.fetchedAt.slice(0, 10)))].slice(0, 400));
  // Rating and review count history (one entry a day), for review growth in reports.
  if (snap.reviewCount !== undefined || snap.rating !== undefined) {
    const stats = await db.getLocal<{ at: string; rating?: number; count?: number }[]>(scope, "review_stats", []);
    const day = snap.fetchedAt.slice(0, 10);
    await db.saveLocal(scope, "review_stats", [{ at: snap.fetchedAt, rating: snap.rating, count: snap.reviewCount }, ...stats.filter((x) => x.at.slice(0, 10) !== day)].slice(0, 400));
  }
  const b = await db.getBusiness(scope);
  if (!b) return { changed: [] };
  const { business, changed, placeId } = applyGoogleProfile(b, snap);
  if (placeId) {
    if (b.placeId) await db.savePlaces(scope, tagHistory(await db.getPlaces(scope), b.placeId));
    business.placeId = placeId;
  }
  if (changed.length || placeId || JSON.stringify(business.sources) !== JSON.stringify(b.sources)) await db.saveBusiness(scope, business);
  return { changed, placeIdChanged: Boolean(placeId) };
}

/** The stored snapshot for the selected location, read again from Google when missing or old. */
export async function currentProfile(scope: Scope): Promise<{ conn: GoogleConnection | null; error?: string }> {
  let conn = await db.getGoogle(scope);
  if (!live(conn)) return { conn };
  const snap = conn.profile;
  const stale = !snap || snap.location !== conn.locationName || Date.now() - Date.parse(snap.fetchedAt) > PROFILE_MAX_AGE_MS;
  // After a recent failure, wait 10 minutes before asking Google again on page views.
  const recentFailure = conn.lastError?.area === "profile" && Date.now() - Date.parse(conn.lastError.at) < 10 * 60_000;
  if (!stale || (recentFailure && snap?.location === conn.locationName)) return { conn };
  const r = await syncBusinessFromGoogle(scope);
  conn = await db.getGoogle(scope);
  return { conn, error: r.error };
}

/* ---------------- reviews ---------------- */

export type ReviewsResult = { reviews: Review[]; source: "google_api" | "sample"; error?: string } & Partial<Omit<ReviewPage, "reviews">>;

/** One page of reviews from Google, or the labelled samples when live access is not on. */
export async function loadReviews(scope: Scope, pageToken?: string): Promise<ReviewsResult> {
  const conn = await db.getGoogle(scope);
  if (!live(conn)) return { reviews: sampleReviews(), source: "sample" };
  try {
    const page = await withGoogle(scope, conn, "reviews", (t) => listReviews(t, conn.accountName, conn.locationName, pageToken));
    return { ...page, source: "google_api" };
  } catch (e) {
    return { reviews: [], source: "google_api", error: message(e) };
  }
}

/**
 * The review a reply is for. For a live location it is read from Google by name, and must belong to the selected
 * location: the submitted id is never trusted on its own. Otherwise it must be one of the samples.
 */
export async function findReview(scope: Scope, id: string): Promise<{ review?: Review; conn?: LiveConnection; error?: string }> {
  const conn = await db.getGoogle(scope);
  if (!live(conn)) {
    const review = sampleReviews().find((r) => r.id === id);
    return review ? { review } : { error: "That review could not be found. Reload the page and try again." };
  }
  if (!id.startsWith(`${conn.accountName}/${conn.locationName}/reviews/`) || !/^[\w/-]+$/.test(id)) {
    return { error: "That review does not belong to your selected location." };
  }
  try {
    return { review: await withGoogle(scope, conn, "reviews", (t) => getReview(t, id)), conn };
  } catch (e) {
    return { error: message(e) };
  }
}

/* ---------------- posts ---------------- */

/** The selected location's posts on Google, to show each published post's current state. */
export async function loadGooglePosts(scope: Scope): Promise<{ posts?: GbpPost[]; error?: string }> {
  const conn = await db.getGoogle(scope);
  if (!live(conn)) return {};
  try {
    return { posts: await withGoogle(scope, conn, "posts", (t) => listPosts(t, conn.accountName, conn.locationName)) };
  } catch (e) {
    return { error: message(e) };
  }
}

/* ---------------- insights ---------------- */

/** Insights older than this are fetched again when the Google page opens. */
export const INSIGHTS_MAX_AGE_MS = 12 * 60 * 60_000;

/** Fetches the last 28 days of performance (and the 28 before) and keeps them on the connection. */
export async function refreshInsights(scope: Scope): Promise<{ error?: string }> {
  const conn = await db.getGoogle(scope);
  if (!live(conn)) return { error: "Connect Google and choose a location first." };
  const location = conn.locationName;
  try {
    const insights = await withGoogle(scope, conn, "insights", async (t) => {
      const i = await fetchInsights(t, location);
      // The monthly trend is extra: the 28-day figures are still saved if it fails.
      const monthly = await fetchMonthly(t, location).catch(() => undefined);
      return monthly ? { ...i, monthly } : i;
    });
    // Saved only if it is the same sign-in and the owner did not switch location while Google was answering.
    await db.updateGoogle(scope, conn.connectedAt, (cur) => (cur.locationName === location ? { ...cur, insights } : cur));
    return {};
  } catch (e) {
    return { error: message(e) };
  }
}
