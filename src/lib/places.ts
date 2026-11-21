import "server-only";
import { categoryInfo, typeMatchesCategory } from "./business";
import type { Business, GoogleVerdict } from "./types";
import { analyseCompetitors, type Comparable } from "./competition";
import { gridLeaders, gridOffsets, type GridSize } from "./grid";
import type { GridLeader } from "./types";

/**
 * Google Places API (New), called only from the server with GOOGLE_PLACES_API_KEY, with the older Places API as a
 * fallback when Google refuses the new one (see "Older Places API" below).
 * Every new-API request sends a minimal X-Goog-FieldMask so only the fields we show are billed; older-API requests
 * name the fields where that API allows it (Details, Find Place; its Text Search returns fixed fields).
 * Terms: only place IDs, our own scores, ranks and timestamps may be stored. Everything else is fetched fresh.
 */
const BASE = "https://places.googleapis.com/v1";
/** GOOGLE_PLACES_BASE_URL exists only so the browser tests can point at a local stand-in; leave it unset otherwise. */
const base = () => process.env.GOOGLE_PLACES_BASE_URL || BASE;
const TIMEOUT_MS = 20_000;

export const placesConfigured = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

type GoogleError = { status?: string; message?: string; details?: { reason?: string }[] };

/** What to change for each reason Google gives. Reasons come from google.rpc.ErrorInfo. */
const REASON_HELP: Record<string, string> = {
  ACCESS_DENIED:
    "Google denied Places API (New) for this key. In Google Cloud, open the key's project and enable \"Places API (New)\" (it is separate from the older \"Places API\"). If the key has API restrictions, add Places API (New) to its allowed APIs.",
  SERVICE_DISABLED: "Places API (New) is not enabled in the key's Google Cloud project. Enable \"Places API (New)\" in APIs & Services, then wait a few minutes.",
  API_KEY_SERVICE_BLOCKED: "This key is restricted to other APIs. In Google Cloud > Credentials, edit the key and add \"Places API (New)\" to its API restrictions.",
  API_KEY_HTTP_REFERRER_BLOCKED: "This key only works from certain websites, but the app calls Google from its server. Change the key's application restriction to None or to the server's IP address.",
  API_KEY_IP_ADDRESS_BLOCKED: "This key only works from certain IP addresses, and this server's address is not one of them. Add the server's IP address to the key.",
  API_KEY_ANDROID_APP_BLOCKED: "This key is restricted to an Android app. Use a key with no application restriction or an IP restriction.",
  API_KEY_IOS_APP_BLOCKED: "This key is restricted to an iOS app. Use a key with no application restriction or an IP restriction.",
  API_KEY_INVALID: "Google says GOOGLE_PLACES_API_KEY is not a valid key. Copy it again from Google Cloud > Credentials.",
  BILLING_DISABLED: "Billing is not enabled on the key's Google Cloud project. Link a billing account, then try again.",
};

/** A Places failure with Google's own status, reason and message, never the key. */
export class PlacesError extends Error {
  readonly httpStatus: number;
  readonly google: GoogleError;
  constructor(httpStatus: number, google: GoogleError, key = "") {
    const reason = google.details?.find((d) => d.reason)?.reason ?? "";
    const status = google.status ?? "";
    const said = (google.message ?? "").split(key || "\u0000").join("[key]").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]").slice(0, 200);
    const code = [httpStatus, status, reason].filter(Boolean).join(" ");
    let help = REASON_HELP[reason];
    if (!help) {
      if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") help = "Google Places quota or rate limit reached. Try again later, or raise the quota in Google Cloud.";
      else if (httpStatus === 404 || status === "NOT_FOUND") help = "Google could not find this place. Search for your business again in Settings.";
      else if (httpStatus === 400) help = "Google Places could not use this request. Check the Place ID or the search words.";
      else if (httpStatus === 401 || httpStatus === 403) help = "Google Places refused the request.";
      else help = "Google Places is having problems. Try again in a few minutes.";
    }
    super(`${help} (Google: ${code}${said ? `, "${said}"` : ""})`);
    this.name = "PlacesError";
    this.httpStatus = httpStatus;
    this.google = google;
  }
  /** True when the key or project is not allowed to use Places API (New). */
  get denied() {
    const reason = this.google.details?.find((d) => d.reason)?.reason ?? "";
    return this.httpStatus === 403 && ["ACCESS_DENIED", "SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED"].includes(reason);
  }
}

/** Place IDs are opaque tokens; reject anything that could change the URL path. */
export const validPlaceId = (id: string) => /^[A-Za-z0-9_-]{10,300}$/.test(id);

async function places<T>(path: string, mask: string, body?: unknown): Promise<T> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("Google Places is not set up. Add GOOGLE_PLACES_API_KEY to the server settings.");
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new Error("Google Places did not answer in time. Try again.");
    throw new Error("Could not reach Google Places. Check the connection and try again.");
  }
  if (!res.ok) {
    let err: GoogleError = {};
    try {
      err = ((await res.json()) as { error?: GoogleError }).error ?? {};
    } catch {
      /* no JSON body */
    }
    throw new PlacesError(res.status, err, key);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("Google Places sent a response that could not be read. Try again.");
  }
}

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  photos?: unknown[];
  /** True when the source returns at most one photo per place (older API search results), so the count is unknown. */
  photosLimited?: boolean;
  regularOpeningHours?: unknown;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
};

/** `photos` is undefined when the source can't tell how many photos a place has. */
/** `photos`, `website`, `phone` and `hours` are undefined when the source does not say. */
export type PlaceSummary = {
  id: string; name: string; address?: string; rating?: number; reviews: number; photos?: number; type?: string;
  website?: boolean; phone?: boolean; hours?: boolean;
};

const summary = (p: RawPlace): PlaceSummary => ({
  id: p.id,
  name: p.displayName?.text ?? "Unnamed place",
  address: p.formattedAddress,
  rating: p.rating,
  reviews: p.userRatingCount ?? 0,
  photos: p.photosLimited ? undefined : (p.photos?.length ?? 0),
  type: p.primaryTypeDisplayName?.text ?? p.primaryType,
  // The older API's search results leave these out, so there they are unknown rather than missing.
  website: p.photosLimited ? undefined : Boolean(p.websiteUri),
  phone: p.photosLimited ? undefined : Boolean(p.nationalPhoneNumber),
  hours: p.photosLimited && !p.regularOpeningHours ? undefined : Boolean(p.regularOpeningHours),
});

/** The comparable fields of a place, with undefined wherever Google did not say. */
const comparable = (p: RawPlace): Comparable => ({
  id: p.id,
  rating: p.rating,
  reviews: p.userRatingCount,
  photos: p.photosLimited ? undefined : p.photos ? p.photos.length : undefined,
  website: p.photosLimited ? undefined : Boolean(p.websiteUri),
  phone: p.photosLimited ? undefined : Boolean(p.nationalPhoneNumber),
  hours: p.photosLimited && !p.regularOpeningHours ? undefined : Boolean(p.regularOpeningHours),
});

async function textSearch(textQuery: string, mask: string, extra: Record<string, unknown> = {}): Promise<RawPlace[]> {
  const j = await places<{ places?: RawPlace[] }>("/places:searchText", mask, { textQuery, ...extra });
  return j.places ?? [];
}

/* ---------------- Older Places API (fallback) ---------------- */

/*
 * Every feature uses Places API (New) first. When Google refuses it for this key (403 ACCESS_DENIED,
 * SERVICE_DISABLED or API_KEY_SERVICE_BLOCKED), the same request goes to the older Places API, which uses the
 * same Place IDs. After a refusal the app skips the new API for 10 minutes, then tries it again, so it switches
 * back by itself once Google allows it. The older API needs the key in the URL, so its URLs are never logged or shown.
 */
const LEGACY = "https://maps.googleapis.com/maps/api/place";
const NEW_API_RETRY_MS = 10 * 60_000;
let newApiDeniedUntil = 0;

type LegacyResult = {
  place_id: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  photos?: unknown[];
  opening_hours?: unknown;
  website?: string;
  formatted_phone_number?: string;
  business_status?: string;
  types?: string[];
  geometry?: { location?: { lat: number; lng: number } };
};

// Broad groups the older API lists alongside (often before) the specific type, for example ["health", "hospital"].
const GENERIC_TYPES = new Set(["point_of_interest", "establishment", "health", "food", "store", "finance", "place_of_worship", "geocode", "political"]);

/** Maps an older-API place onto the Places API (New) shape the features use. */
export function fromLegacy(r: LegacyResult, photosLimited = false): RawPlace {
  const type = r.types?.find((t) => !GENERIC_TYPES.has(t)) ?? r.types?.find((t) => t !== "point_of_interest" && t !== "establishment");
  const label = type ? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ") : undefined;
  const loc = r.geometry?.location;
  return {
    id: r.place_id,
    displayName: r.name ? { text: r.name } : undefined,
    formattedAddress: r.formatted_address,
    rating: r.rating,
    userRatingCount: r.user_ratings_total,
    photos: r.photos,
    photosLimited,
    regularOpeningHours: r.opening_hours,
    websiteUri: r.website,
    nationalPhoneNumber: r.formatted_phone_number,
    primaryType: type,
    primaryTypeDisplayName: label ? { text: label } : undefined,
    businessStatus: r.business_status,
    location: loc ? { latitude: loc.lat, longitude: loc.lng } : undefined,
  };
}

const LEGACY_HELP: Record<string, string> = {
  OVER_QUERY_LIMIT: "Google Places quota or rate limit reached. Try again later, or raise the quota in Google Cloud.",
  NOT_FOUND: "Google could not find this place. Search for your business again in Settings.",
  INVALID_REQUEST: "Google Places could not use this request. Check the Place ID or the search words.",
  REQUEST_DENIED: "Google refused the older Places API for this key too.",
  UNKNOWN_ERROR: "Google Places is having problems. Try again in a few minutes.",
};

/** An older-API failure, with Google's status and message, never the key. */
export class LegacyPlacesError extends Error {
  readonly status: string;
  constructor(status: string, message = "", key = "") {
    const said = message.split(key || "\u0000").join("[key]").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]").slice(0, 200);
    super(`${LEGACY_HELP[status] ?? "Google Places could not answer. Try again."} (Google, older Places API: ${status}${said ? `, "${said}"` : ""})`);
    this.name = "LegacyPlacesError";
    this.status = status;
  }
  get denied() {
    return this.status === "REQUEST_DENIED";
  }
}

async function legacy<T extends { status?: string; error_message?: string }>(endpoint: string, params: Record<string, string>): Promise<T> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("Google Places is not set up. Add GOOGLE_PLACES_API_KEY to the server settings.");
  const url = new URL(`${LEGACY}/${endpoint}/json`);
  url.search = new URLSearchParams({ ...params, key }).toString();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new Error("Google Places did not answer in time. Try again.");
    throw new Error("Could not reach Google Places. Check the connection and try again.");
  }
  let j: T;
  try {
    j = (await res.json()) as T;
  } catch {
    throw new Error("Google Places sent a response that could not be read. Try again.");
  }
  if (j.status === "OK" || j.status === "ZERO_RESULTS") return j;
  throw new LegacyPlacesError(j.status ?? `HTTP ${res.status}`, j.error_message, key);
}

async function legacyDetails(placeId: string, fields: string): Promise<RawPlace> {
  const j = await legacy<{ status?: string; result?: LegacyResult }>("details", { place_id: placeId, fields });
  if (!j.result) throw new LegacyPlacesError("NOT_FOUND");
  return fromLegacy(j.result);
}

/** Older Text Search: up to 20 results. Its results carry at most one photo each, so photo counts are unknown. */
async function legacyTextSearch(query: string, bias?: { latitude: number; longitude: number; radiusM: number }): Promise<RawPlace[]> {
  const params: Record<string, string> = { query };
  if (bias) Object.assign(params, { location: `${bias.latitude},${bias.longitude}`, radius: String(Math.round(bias.radiusM)) });
  const j = await legacy<{ status?: string; results?: LegacyResult[] }>("textsearch", params);
  return (j.results ?? []).map((r) => fromLegacy(r, true));
}

/** Runs the Places API (New) version, or the older API when Google refuses the new one for this key. */
async function newOrLegacy<T>(modern: () => Promise<T>, older: () => Promise<T>): Promise<T> {
  let refused: PlacesError | undefined;
  if (Date.now() >= newApiDeniedUntil) {
    try {
      const out = await modern();
      newApiDeniedUntil = 0;
      return out;
    } catch (e) {
      if (!(e instanceof PlacesError) || !e.denied) throw e;
      refused = e;
      newApiDeniedUntil = Date.now() + NEW_API_RETRY_MS;
    }
  }
  try {
    return await older();
  } catch (e) {
    if (!(e instanceof LegacyPlacesError) || !e.denied) throw e;
    // Both refused. Report the Places API (New) problem, which is the one to fix.
    if (refused) throw refused;
    newApiDeniedUntil = 0;
    return modern();
  }
}

/** For tests: forget that the new API was refused. */
export function resetPlacesFallback() {
  newApiDeniedUntil = 0;
}

/* ---------------- Business discovery (Place ID finder) ---------------- */

const FIND_MASK = "places.id,places.displayName,places.formattedAddress,places.primaryType,places.primaryTypeDisplayName";

/**
 * Up to 5 Google listings for a business name and city (and state, if given), with name, address and category.
 * The older API's Find Place, used only if Google refuses the new one, usually returns 1.
 */
export async function findPlaces(name: string, city: string, state = ""): Promise<PlaceSummary[]> {
  const query = [name, city, state].map((x) => x.trim()).filter(Boolean).join(" ");
  return newOrLegacy(
    async () => (await textSearch(query, FIND_MASK, { pageSize: 5 })).map(summary),
    async () => {
      const j = await legacy<{ status?: string; candidates?: LegacyResult[] }>("findplacefromtext", {
        input: query,
        inputtype: "textquery",
        fields: "place_id,name,formatted_address,types",
      });
      return (j.candidates ?? []).slice(0, 5).map((c) => summary(fromLegacy(c)));
    },
  );
}

/** Name, address and category of one listing, fetched fresh (Google content is not stored). */
export async function placeSummary(placeId: string): Promise<PlaceSummary> {
  return summary(
    await newOrLegacy(
      () => places<RawPlace>(`/places/${encodeURIComponent(placeId)}`, "id,displayName,formattedAddress,primaryType,primaryTypeDisplayName"),
      () => legacyDetails(placeId, "place_id,name,formatted_address,types"),
    ),
  );
}

/** True when Google says the place does not exist (as opposed to a key, quota or network problem). */
export const isNotFound = (e: unknown) =>
  (e instanceof PlacesError && (e.httpStatus === 404 || e.google.status === "NOT_FOUND" || (e.httpStatus === 400 && e.google.status === "INVALID_ARGUMENT" && !e.google.details?.some((d) => d.reason)))) ||
  (e instanceof LegacyPlacesError && (e.status === "NOT_FOUND" || e.status === "INVALID_REQUEST"));

/* ---------------- Profile audit ---------------- */

export type AuditItem = { key: string; label: string; value: string; points: number; max: number; fix?: string };

export type AuditResult = { name: string; score: number; items: AuditItem[]; checklist: Record<string, GoogleVerdict> };

const digits = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);

/** This app's verdicts on the checklist items Google can answer. Owner-only items are left out. */
export function auditVerdicts(p: RawPlace, b: Business): Record<string, GoogleVerdict> {
  const out: Record<string, GoogleVerdict> = {
    hours: p.regularOpeningHours ? "yes" : "no",
    photos: (p.photos?.length ?? 0) >= 10 ? "yes" : "no",
    website: p.websiteUri ? "yes" : "no",
  };
  if (!p.nationalPhoneNumber) out.phone = "no";
  else if (digits(b.phone).length === 10) out.phone = digits(b.phone) === digits(p.nationalPhoneNumber) ? "yes" : "attention";
  else out.phone = "partial";
  if (!p.primaryType) out.primary_category = "no";
  else {
    const fits = typeMatchesCategory(p.primaryType, b.category);
    out.primary_category = fits === undefined ? "partial" : fits ? "yes" : "attention";
  }
  return out;
}

export async function profileAudit(placeId: string, b: Business): Promise<AuditResult> {
  const p = await newOrLegacy(
    () =>
      places<RawPlace>(
        `/places/${encodeURIComponent(placeId)}`,
        "id,displayName,rating,userRatingCount,photos,regularOpeningHours,websiteUri,nationalPhoneNumber,primaryType,primaryTypeDisplayName,businessStatus",
      ),
    () => legacyDetails(placeId, "place_id,name,rating,user_ratings_total,photos,opening_hours,website,formatted_phone_number,business_status,types"),
  );
  const who = b.type === "healthcare" ? "patient" : "customer";
  const reviews = p.userRatingCount ?? 0;
  const photos = p.photos?.length ?? 0;
  const tier = (v: number, steps: [number, number][]) => steps.find(([min]) => v >= min)?.[1] ?? 0;
  const verdicts = auditVerdicts(p, b);
  const items: AuditItem[] = [
    { key: "status", label: "Business status", value: p.businessStatus === "OPERATIONAL" ? "Open" : p.businessStatus ? p.businessStatus.replace(/_/g, " ").toLowerCase() : "unknown", max: 10,
      points: p.businessStatus === "OPERATIONAL" ? 10 : 0, fix: "Make sure Google shows the business as open. Correct it in your Business Profile." },
    { key: "rating", label: "Rating", value: p.rating ? `${p.rating.toFixed(1)} of 5` : "no rating yet", max: 15, points: p.rating ? tier(p.rating, [[4.5, 15], [4.0, 10], [3.5, 5]]) : 0,
      fix: "Reply to every review, fix the issues people mention, and ask every " + who + " for honest feedback." },
    { key: "reviews", label: "Number of reviews", value: String(reviews), max: 20, points: tier(reviews, [[100, 20], [50, 15], [20, 10], [5, 5]]),
      fix: `Share your review link or QR code with every ${who} after a visit. Do not filter by rating.` },
    { key: "photos", label: "Photos", value: photos >= 10 ? "10 or more" : String(photos), max: 15, points: tier(photos, [[10, 15], [5, 10], [1, 5]]),
      fix: "Add recent photos of the entrance, inside, team and services." },
    { key: "hours", label: "Opening hours", value: p.regularOpeningHours ? "listed" : "missing", max: 15, points: p.regularOpeningHours ? 15 : 0, fix: "Add your regular opening hours and keep holiday hours up to date." },
    { key: "website", label: "Website", value: p.websiteUri ? "listed" : "missing", max: 10, points: p.websiteUri ? 10 : 0, fix: "Add your website to the profile." },
    { key: "phone", label: "Phone", value: p.nationalPhoneNumber ? (verdicts.phone === "attention" ? "listed, different from your Settings" : "listed") : "missing", max: 10, points: p.nationalPhoneNumber ? 10 : 0,
      fix: verdicts.phone === "attention" ? "Make the phone number on Google and in your Settings the same." : "Add a phone number that someone answers." },
    { key: "category", label: "Primary category", value: (p.primaryTypeDisplayName?.text ?? p.primaryType ?? "missing") + (verdicts.primary_category === "attention" ? " (does not fit the category you chose)" : ""), max: 5, points: p.primaryType ? 5 : 0,
      fix: verdicts.primary_category === "attention" ? "Check that Google's primary category names your main service, or change the category in Settings." : "Choose the primary category that names your main service." },
  ];
  for (const i of items) if (i.points === i.max && !(i.key === "phone" && verdicts.phone === "attention") && !(i.key === "category" && verdicts.primary_category === "attention")) delete i.fix;
  return { name: p.displayName?.text ?? "Your business", score: items.reduce((s, i) => s + i.points, 0), items, checklist: verdicts };
}

/* ---------------- Competitors ---------------- */

// Website, phone and hours are in the same Text Search price tier as rating and review count, so they add no cost.
const COMPETITOR_MASK =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.photos,places.primaryType,places.primaryTypeDisplayName,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours";

export function categoryQuery(b: Business): string {
  const c = categoryInfo(b.category, b.type);
  return `${c.many} in ${b.location}`;
}

export async function competitors(placeId: string, b: Business) {
  const query = categoryQuery(b);
  const raw = await newOrLegacy(
    () => textSearch(query, COMPETITOR_MASK, { pageSize: 10 }),
    async () => (await legacyTextSearch(query)).slice(0, 10),
  );
  const index = raw.findIndex((p) => p.id === placeId);
  const youRaw =
    index >= 0
      ? raw[index]
      : await newOrLegacy(
          () =>
            places<RawPlace>(
              `/places/${encodeURIComponent(placeId)}`,
              "id,displayName,rating,userRatingCount,photos,primaryType,primaryTypeDisplayName,websiteUri,nationalPhoneNumber,regularOpeningHours",
            ),
          () => legacyDetails(placeId, "place_id,name,rating,user_ratings_total,photos,types,website,formatted_phone_number,opening_hours"),
        );
  const analysis = analyseCompetitors(comparable(youRaw), raw.map(comparable));
  const position = index >= 0 ? index + 1 : null;
  const gaps = [...(position === null ? [`You are not in the top ${raw.length} Google results for "${query}".`] : []), ...analysis.gaps];
  // The most common primary category among the results, to show what Google groups you with.
  const types = raw.filter((p) => p.id !== placeId).map((p) => p.primaryTypeDisplayName?.text ?? p.primaryType).filter((t): t is string => Boolean(t));
  const counts = types.reduce<Record<string, number>>((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
  const commonType = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
  return {
    query,
    list: raw.map(summary),
    position,
    you: summary(youRaw),
    gaps,
    analysis,
    commonType: commonType ? { label: commonType[0], count: commonType[1], of: types.length } : undefined,
  };
}

/* ---------------- Rank grid ---------------- */

/**
 * Ranks (1-20, or null for "20+") for a keyword at a 3x3 or 5x5 grid around the business, row by row from the
 * north-west, plus the businesses most often in the top 3 (place IDs from the same results, so no extra requests).
 * Requests: one for the business's map location, then one IDs-only Text Search per point (see scanRequests).
 */
export async function rankGrid(placeId: string, keyword: string, radiusKm: number, size: GridSize = 3): Promise<{ ranks: (number | null)[]; leaders: GridLeader[] }> {
  const p = await newOrLegacy(
    () => places<RawPlace>(`/places/${encodeURIComponent(placeId)}`, "id,location"),
    () => legacyDetails(placeId, "place_id,geometry/location"),
  );
  if (!p.location) throw new Error("Google has no map location for this place, so the grid cannot be drawn.");
  const { latitude: lat, longitude: lng } = p.location;
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const cells = gridOffsets(size).map(({ row, col }) => ({ latitude: lat + row * dLat, longitude: lng + col * dLng }));
  // Five points at a time, so a 25-point scan does not send 25 requests to Google at once.
  const lists: string[][] = [];
  for (let i = 0; i < cells.length; i += 5) {
    lists.push(...(await Promise.all(cells.slice(i, i + 5).map(async (center) => {
      // IDs only: the cheapest Text Search field mask. The older API returns up to 20 results too.
      const found = await newOrLegacy(
        () => textSearch(keyword, "places.id", { pageSize: 20, locationBias: { circle: { center, radius: radiusKm * 1000 } } }),
        () => legacyTextSearch(keyword, { ...center, radiusM: radiusKm * 1000 }),
      );
      return found.map((x) => x.id);
    }))));
  }
  return {
    ranks: lists.map((ids) => {
      const i = ids.indexOf(placeId);
      return i >= 0 && i < 20 ? i + 1 : null;
    }),
    leaders: gridLeaders(lists, placeId),
  };
}

/** Names of up to 5 businesses, read fresh from Google each time (names are not stored). One request each. */
export async function placeNames(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(ids.slice(0, 5).map(async (id) => {
    const p = await newOrLegacy(
      () => places<RawPlace>(`/places/${encodeURIComponent(id)}`, "id,displayName"),
      () => legacyDetails(id, "place_id,name"),
    );
    if (p.displayName?.text) out[id] = p.displayName.text;
  }));
  return out;
}
