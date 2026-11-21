import "server-only";
import { LIMITS, takeShared } from "./ratelimit";
import type { GbpInsights, GbpMetricGroup, PostDraft, Review } from "./types";

/**
 * Google Business Profile API client. Only endpoints and fields from Google's reference docs are used
 * (checked November 2026, links in docs/MASTER_PROJECT_STATUS.md):
 *  - Account Management v1   accounts.list                         pageSize max 20
 *  - Business Information v1 accounts.locations.list, locations.get readMask required, pageSize max 100
 *  - My Business v4          reviews list/get/updateReply           pageSize max 50; reply max 4096 bytes
 *  - My Business v4          localPosts list/create/patch           list pageSize max 100; patch needs updateMask
 *  - Performance v1          locations.fetchMultiDailyMetricsTimeSeries
 * Every call needs an OAuth access token with the business.manage scope. Nothing here stores anything.
 */

const HOSTS = {
  oauth: "https://oauth2.googleapis.com",
  accounts: "https://mybusinessaccountmanagement.googleapis.com",
  info: "https://mybusinessbusinessinformation.googleapis.com",
  v4: "https://mybusiness.googleapis.com",
  perf: "https://businessprofileperformance.googleapis.com",
} as const;
export type GoogleHost = keyof typeof HOSTS;

/**
 * Where a Google API lives. GOOGLE_API_BASE_URL exists only for the isolated test servers, which point it at a local
 * stand-in. It is honoured only for a loopback address, so a wrong setting can never send tokens to another host.
 */
export function googleBase(host: GoogleHost): string {
  const o = process.env.GOOGLE_API_BASE_URL?.trim();
  if (o) {
    try {
      const u = new URL(o);
      if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return `${o.replace(/\/+$/, "")}/${host}`;
    } catch {
      /* ignored: falls back to Google */
    }
  }
  return HOSTS[host];
}

/* ---------------- errors ---------------- */

export type GbpErrorKind = "reconnect" | "scope" | "permission" | "not_enabled" | "quota" | "not_found" | "invalid" | "unavailable" | "network";

/** Plain-language messages for business owners. Server setup details are logged, never shown. */
const MESSAGES: Record<GbpErrorKind, string> = {
  reconnect: "Your Google sign-in has expired or was removed. Reconnect Google to continue.",
  scope: "Google did not give this app permission to manage your Business Profile. Reconnect Google and allow access when Google asks.",
  permission: "Your Google account does not have permission for this business location. Sign in with an account that owns or manages it.",
  not_enabled: "This Google feature is not available right now. Please try again later.",
  quota: "Google is limiting requests right now. Try again in a minute.",
  not_found: "Google could not find this item. It may have been removed. Reload the page.",
  invalid: "Google did not accept this request.",
  unavailable: "Google is not responding right now. Try again in a few minutes.",
  network: "Could not reach Google. Try again in a moment.",
};

export class GbpError extends Error {
  kind: GbpErrorKind;
  status: number;
  reason: string;
  constructor(kind: GbpErrorKind, status = 0, reason = "", detail = "") {
    super(kind === "invalid" && detail ? `${MESSAGES.invalid} Google said: ${detail}` : MESSAGES[kind]);
    this.name = "GbpError";
    this.kind = kind;
    this.status = status;
    this.reason = reason;
  }
}

type GoogleErrorBody = { error?: { code?: number; status?: string; message?: string; details?: { reason?: string }[] } | string; error_description?: string };

/** Turns a Google error response into one of the kinds above. */
export function classify(status: number, body: GoogleErrorBody | null): GbpError {
  const e = typeof body?.error === "object" ? body.error : undefined;
  const reasons = (e?.details ?? []).map((d) => d.reason ?? "").filter(Boolean);
  const reason = reasons[0] ?? e?.status ?? (typeof body?.error === "string" ? body.error : "");
  const msg = (e?.message ?? "").slice(0, 200);
  const has = (r: string) => reasons.includes(r) || e?.status === r;
  if (status === 401) return new GbpError("reconnect", status, reason);
  if (status === 429 || has("RATE_LIMIT_EXCEEDED") || has("RESOURCE_EXHAUSTED")) return new GbpError("quota", status, reason);
  if (status === 403) {
    if (has("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient authentication scopes/i.test(msg)) return new GbpError("scope", status, reason);
    if (has("SERVICE_DISABLED") || has("API_DISABLED") || /has not been used|is disabled/i.test(msg)) return new GbpError("not_enabled", status, reason);
    return new GbpError("permission", status, reason);
  }
  if (status === 404) return new GbpError("not_found", status, reason);
  if (status >= 500) return new GbpError("unavailable", status, reason);
  return new GbpError("invalid", status, reason, msg);
}

/* ---------------- request helper ---------------- */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Google API request. Reads are retried once after a short wait on 429 and 5xx; writes are never retried,
 * so a reply or post cannot be sent twice. All calls share a guard under the project's 300 requests a minute.
 */
async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    if (!(await takeShared("gbp:project", LIMITS.gbpProject)).ok) {
      console.error("[gbp] request held back: this server's own limit of Google requests per minute was reached");
      throw new GbpError("quota", 429, "LOCAL_GUARD");
    }
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      if (method === "GET" && attempt === 0) {
        await wait(500);
        continue;
      }
      throw new GbpError("network");
    }
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    if (method === "GET" && attempt === 0 && RETRYABLE.has(res.status)) {
      const after = Number(res.headers.get("retry-after"));
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 2) * 1000 : 800);
      continue;
    }
    const body = (await res.json().catch(() => null)) as GoogleErrorBody | null;
    const err = classify(res.status, body);
    // Server log for whoever runs the app: no token, no URL query.
    console.error(`[gbp] ${method} ${new URL(url).pathname} -> ${res.status} ${err.kind}${err.reason ? ` (${err.reason})` : ""}`);
    throw err;
  }
}

/* ---------------- accounts and locations ---------------- */

export type GbpAccount = { name: string; accountName: string; type?: string; role?: string; verificationState?: string };

/** Every account the signed-in Google user can use (Google pages these 20 at a time). */
export async function listAccounts(token: string, maxPages = 10): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken = "";
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ pageSize: "20" });
    if (pageToken) q.set("pageToken", pageToken);
    const j = await call<{ accounts?: GbpAccount[]; nextPageToken?: string }>(token, `${googleBase("accounts")}/v1/accounts?${q}`);
    for (const a of j.accounts ?? []) out.push({ name: a.name, accountName: a.accountName || a.name, type: a.type, role: a.role, verificationState: a.verificationState });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

type RawAddress = { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string };
type RawTime = { hours?: number; minutes?: number };
type RawPeriod = { openDay?: string; openTime?: RawTime; closeDay?: string; closeTime?: RawTime };
const DAY_NAME: Record<string, string> = { MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday" };
// Google omits zero values in JSON, so a missing hour or minute is 0 (midnight).
const hhmm = (t?: RawTime) => `${String(t?.hours ?? 0).padStart(2, "0")}:${String(t?.minutes ?? 0).padStart(2, "0")}`;

/** Google's opening periods as readable lines, in Google's order. A period ending on another day names that day. */
export function formatHours(periods: RawPeriod[] = []): string[] {
  return periods.filter((p) => p.openDay && DAY_NAME[p.openDay]).map((p) => {
    const open = DAY_NAME[p.openDay!];
    const close = p.closeDay && p.closeDay !== p.openDay && DAY_NAME[p.closeDay] ? `${DAY_NAME[p.closeDay]} ` : "";
    return `${open} ${hhmm(p.openTime)}–${close}${hhmm(p.closeTime)}`;
  });
}

type RawLocation = {
  name: string;
  title?: string;
  storefrontAddress?: RawAddress;
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { displayName?: string } };
  regularHours?: { periods?: RawPeriod[] };
  profile?: { description?: string };
  openInfo?: { status?: string };
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string; hasVoiceOfMerchant?: boolean };
};

export const formatAddress = (a?: RawAddress) =>
  a ? [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", ") : "";

export type GbpLocation = {
  /** "accounts/{id}": the account the location was listed under (the v4 reviews and posts URLs need it). */
  account: string;
  /** "locations/{id}" */
  location: string;
  title: string;
  address: string;
  placeId?: string;
  accountName?: string;
  /** The town or city from the address, when Google gives one. */
  city?: string;
};

const LOCATION_LIST_MASK = "name,title,storefrontAddress,metadata";

/**
 * Every location under the given accounts (Google pages these up to 100 at a time). A location shared through
 * more than one account is listed once. `truncated` is true when the page limit stopped the listing early.
 */
export async function listLocations(token: string, accounts: GbpAccount[], maxPages = 10): Promise<{ locations: GbpLocation[]; truncated: boolean }> {
  const seen = new Map<string, GbpLocation>();
  let truncated = false;
  for (const a of accounts) {
    let pageToken = "";
    for (let i = 0; ; i++) {
      if (i === maxPages) {
        truncated = true;
        break;
      }
      const q = new URLSearchParams({ readMask: LOCATION_LIST_MASK, pageSize: "100" });
      if (pageToken) q.set("pageToken", pageToken);
      const j = await call<{ locations?: RawLocation[]; nextPageToken?: string }>(token, `${googleBase("info")}/v1/${a.name}/locations?${q}`);
      for (const l of j.locations ?? []) {
        if (seen.has(l.name)) continue;
        seen.set(l.name, { account: a.name, accountName: a.accountName, location: l.name, title: l.title || l.name, address: formatAddress(l.storefrontAddress), placeId: l.metadata?.placeId, city: l.storefrontAddress?.locality });
      }
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
  }
  return { locations: [...seen.values()], truncated };
}

export type GbpProfile = {
  title: string;
  address: string;
  phone?: string;
  website?: string;
  category?: string;
  description?: string;
  hasHours: boolean;
  /** Opening hours, one line per period. */
  hours: string[];
  /** OPEN, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY, or undefined when Google does not say. */
  openStatus?: string;
  placeId?: string;
  mapsUri?: string;
  newReviewUri?: string;
  /** Google's hasVoiceOfMerchant: the profile is verified and in good standing. */
  verified?: boolean;
};

const PROFILE_MASK = "name,title,storefrontAddress,phoneNumbers,categories,websiteUri,regularHours,profile,openInfo,metadata";

/** The selected location's profile, as Google has it now. */
export async function getProfile(token: string, location: string): Promise<GbpProfile> {
  const l = await call<RawLocation>(token, `${googleBase("info")}/v1/${location}?${new URLSearchParams({ readMask: PROFILE_MASK })}`);
  return {
    title: l.title ?? "",
    address: formatAddress(l.storefrontAddress),
    phone: l.phoneNumbers?.primaryPhone,
    website: l.websiteUri,
    category: l.categories?.primaryCategory?.displayName,
    description: l.profile?.description,
    hasHours: Boolean(l.regularHours?.periods?.length),
    hours: formatHours(l.regularHours?.periods),
    openStatus: l.openInfo?.status && l.openInfo.status !== "OPEN_FOR_BUSINESS_UNSPECIFIED" ? l.openInfo.status : undefined,
    placeId: l.metadata?.placeId,
    mapsUri: l.metadata?.mapsUri,
    newReviewUri: l.metadata?.newReviewUri,
    verified: l.metadata?.hasVoiceOfMerchant,
  };
}

/* ---------------- reviews ---------------- */

const STAR: Record<string, 1 | 2 | 3 | 4 | 5> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

type RawReview = {
  name: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string; reviewReplyState?: string };
};

export function toReview(r: RawReview): Review {
  return {
    id: r.name,
    reviewer: r.reviewer?.displayName || "A Google user",
    // Google sends STAR_RATING_UNSPECIFIED for some old reviews; 0 is shown as "no star rating".
    stars: STAR[r.starRating ?? ""] ?? 0,
    comment: r.comment ?? "",
    createdAt: r.createTime,
    updatedAt: r.updateTime,
    replied: Boolean(r.reviewReply),
    reply: r.reviewReply ? { text: r.reviewReply.comment ?? "", updatedAt: r.reviewReply.updateTime, state: r.reviewReply.reviewReplyState } : undefined,
    source: "google_api",
  };
}

export type ReviewPage = { reviews: Review[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string };

/** One page (up to 50) of a location's reviews, newest first. */
export async function listReviews(token: string, account: string, location: string, pageToken?: string, pageSize = 50): Promise<ReviewPage> {
  const q = new URLSearchParams({ pageSize: String(pageSize), orderBy: "updateTime desc" });
  if (pageToken) q.set("pageToken", pageToken);
  const j = await call<{ reviews?: RawReview[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string }>(
    token,
    `${googleBase("v4")}/v4/${account}/${location}/reviews?${q}`,
  );
  return { reviews: (j.reviews ?? []).map(toReview), averageRating: j.averageRating, totalReviewCount: j.totalReviewCount, nextPageToken: j.nextPageToken || undefined };
}

/** One review by its full name (accounts/…/locations/…/reviews/…). */
export async function getReview(token: string, name: string): Promise<Review> {
  return toReview(await call<RawReview>(token, `${googleBase("v4")}/v4/${name}`));
}

/** Google's documented limit for a reply. */
export const REPLY_MAX_BYTES = 4096;

/** Creates the reply, or replaces the existing one. Returns Google's moderation state when it sends one. */
export async function updateReply(token: string, reviewName: string, comment: string): Promise<{ state?: string; updatedAt?: string }> {
  if (Buffer.byteLength(comment, "utf8") > REPLY_MAX_BYTES) throw new GbpError("invalid", 400, "TOO_LONG", `the reply is longer than ${REPLY_MAX_BYTES} bytes.`);
  const r = await call<{ reviewReplyState?: string; updateTime?: string }>(token, `${googleBase("v4")}/v4/${reviewName}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment }),
  });
  return { state: r.reviewReplyState, updatedAt: r.updateTime };
}

/* ---------------- posts ---------------- */

/** "YYYY-MM-DDTHH:mm" (the location's local time) to Google's Date and TimeOfDay objects. */
function googleDateTime(local: string) {
  const [y, mo, d, h, mi] = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)!.slice(1).map(Number);
  return { date: { year: y, month: mo, day: d }, time: { hours: h, minutes: mi, seconds: 0, nanos: 0 } };
}

/** The LocalPost body for a draft. EVENT and OFFER posts need event details (title and schedule). */
export function postBody(post: PostDraft, languageCode = "en"): Record<string, unknown> {
  const body: Record<string, unknown> = { languageCode, summary: post.text, topicType: post.kind };
  if (post.callToAction) body.callToAction = post.callToAction.url ? { actionType: post.callToAction.actionType, url: post.callToAction.url } : { actionType: post.callToAction.actionType };
  if (post.kind !== "STANDARD" && post.event) {
    const s = googleDateTime(post.event.start), e = googleDateTime(post.event.end);
    body.event = { title: post.event.title, schedule: { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time } };
  }
  if (post.kind === "OFFER" && post.offer) {
    const o = Object.fromEntries(Object.entries(post.offer).filter(([, v]) => v));
    if (Object.keys(o).length) body.offer = o;
  }
  return body;
}

export type GbpPost = { name: string; state?: string; searchUrl?: string; summary?: string; topicType?: string; createTime?: string; updateTime?: string };

export async function createPost(token: string, account: string, location: string, post: PostDraft, languageCode?: string): Promise<GbpPost> {
  return call<GbpPost>(token, `${googleBase("v4")}/v4/${account}/${location}/localPosts`, { method: "POST", body: JSON.stringify(postBody(post, languageCode)) });
}

/** Updates a published post. Only the fields named in the update mask change (Google requires the mask). */
export async function updatePost(token: string, name: string, post: PostDraft, languageCode?: string): Promise<GbpPost> {
  const body = postBody(post, languageCode);
  const mask = ["summary", ...(body.event ? ["event"] : []), ...(body.offer ? ["offer"] : []), ...(body.callToAction ? ["callToAction"] : [])].join(",");
  return call<GbpPost>(token, `${googleBase("v4")}/v4/${name}?${new URLSearchParams({ updateMask: mask })}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** The location's posts on Google (first 100), to show each published post's current state. */
export async function listPosts(token: string, account: string, location: string): Promise<GbpPost[]> {
  const j = await call<{ localPosts?: GbpPost[] }>(token, `${googleBase("v4")}/v4/${account}/${location}/localPosts?pageSize=100`);
  return j.localPosts ?? [];
}

/* ---------------- performance ---------------- */

/** Supported DailyMetric values used here (BUSINESS_CONVERSATIONS and BUSINESS_FOOD_ORDERS are deprecated). */
export const METRIC_GROUPS = {
  searchViews: ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"],
  mapsViews: ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"],
  calls: ["CALL_CLICKS"],
  website: ["WEBSITE_CLICKS"],
  directions: ["BUSINESS_DIRECTION_REQUESTS"],
  messages: ["MESSAGING_CLICKS"],
  bookings: ["BUSINESS_BOOKINGS"],
} as const;
export type MetricGroup = GbpMetricGroup;
const ALL_METRICS = Object.values(METRIC_GROUPS).flat();

/** date -> metric -> value. `metrics` lists every metric Google returned a series for. */
export type DailyTotals = Map<string, Record<string, number>> & { metrics?: Set<string> };

const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const key = (d: { year: number; month: number; day?: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`;

/**
 * Daily values per metric for an inclusive date range. Google leaves a value out when it is zero,
 * so a missing value counts as 0. Returns date ("YYYY-MM-DD") -> metric -> value.
 */
export async function fetchDailyMetrics(token: string, location: string, start: Date, end: Date): Promise<DailyTotals> {
  const q = new URLSearchParams();
  for (const m of ALL_METRICS) q.append("dailyMetrics", m);
  const s = ymd(start), e = ymd(end);
  q.set("dailyRange.start_date.year", String(s.year));
  q.set("dailyRange.start_date.month", String(s.month));
  q.set("dailyRange.start_date.day", String(s.day));
  q.set("dailyRange.end_date.year", String(e.year));
  q.set("dailyRange.end_date.month", String(e.month));
  q.set("dailyRange.end_date.day", String(e.day));
  type Series = { dailyMetric?: string; timeSeries?: { datedValues?: { date?: { year: number; month: number; day?: number }; value?: string }[] } };
  const j = await call<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: Series[] }[] }>(
    token,
    `${googleBase("perf")}/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q}`,
  );
  const out: DailyTotals = new Map();
  out.metrics = new Set();
  for (const group of j.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      if (!series.dailyMetric) continue;
      out.metrics.add(series.dailyMetric);
      for (const dv of series.timeSeries?.datedValues ?? []) {
        if (!dv.date) continue;
        const k = key(dv.date);
        const row = out.get(k) ?? {};
        const n = Number(dv.value ?? 0);
        row[series.dailyMetric] = (row[series.dailyMetric] ?? 0) + (Number.isFinite(n) ? n : 0);
        out.set(k, row);
      }
    }
  }
  return out;
}

export type Insights = GbpInsights;

const DAY = 86_400_000;

/**
 * The last `days` days up to yesterday, and the same number of days before that, for comparison.
 * One Performance API request covers both periods.
 */
export async function fetchInsights(token: string, location: string, days = 28, now = new Date()): Promise<Insights> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY);
  const curStart = new Date(end.getTime() - (days - 1) * DAY);
  const prevEnd = new Date(curStart.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY);
  const daily = await fetchDailyMetrics(token, location, prevStart, end);
  return summarise(daily, { prevStart, prevEnd, curStart, end }, now);
}

export function summarise(daily: DailyTotals, r: { prevStart: Date; prevEnd: Date; curStart: Date; end: Date }, now = new Date()): Insights {
  const iso = (d: Date) => key(ymd(d));
  const empty = () => Object.fromEntries(Object.keys(METRIC_GROUPS).map((g) => [g, 0])) as Record<MetricGroup, number>;
  const current = empty(), previous = empty();
  const dailyViews: { date: string; value: number }[] = [];
  for (let t = r.curStart.getTime(); t <= r.end.getTime(); t += DAY) {
    const row = daily.get(iso(new Date(t))) ?? {};
    dailyViews.push({ date: iso(new Date(t)), value: [...METRIC_GROUPS.searchViews, ...METRIC_GROUPS.mapsViews].reduce((n, m) => n + (row[m] ?? 0), 0) });
  }
  const curFrom = iso(r.curStart), curTo = iso(r.end), prevFrom = iso(r.prevStart), prevTo = iso(r.prevEnd);
  for (const [date, row] of daily) {
    const bucket = date >= curFrom && date <= curTo ? current : date >= prevFrom && date <= prevTo ? previous : null;
    if (!bucket) continue;
    for (const [g, metrics] of Object.entries(METRIC_GROUPS) as [MetricGroup, readonly string[]][]) for (const m of metrics) bucket[g] += row[m] ?? 0;
  }
  const reported = daily.metrics ? (Object.keys(METRIC_GROUPS) as MetricGroup[]).filter((g) => METRIC_GROUPS[g].some((m) => daily.metrics!.has(m))) : undefined;
  return { at: now.toISOString(), current: { start: curFrom, end: curTo, totals: current }, previous: { start: prevFrom, end: prevTo, totals: previous }, dailyViews, ...(reported ? { reported } : {}) };
}

/** Totals per calendar month for the last `months` full months (one request). */
export async function fetchMonthly(token: string, location: string, months = 6, now = new Date()): Promise<{ month: string; totals: Record<MetricGroup, number> }[]> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - DAY);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const daily = await fetchDailyMetrics(token, location, start, end);
  const out = new Map<string, Record<MetricGroup, number>>();
  for (let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1); t <= end.getTime(); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) {
    out.set(new Date(t).toISOString().slice(0, 7), Object.fromEntries(Object.keys(METRIC_GROUPS).map((g) => [g, 0])) as Record<MetricGroup, number>);
  }
  for (const [date, row] of daily) {
    const totals = out.get(date.slice(0, 7));
    if (!totals) continue;
    for (const [g, metrics] of Object.entries(METRIC_GROUPS) as [MetricGroup, readonly string[]][]) for (const m of metrics) totals[g] += row[m] ?? 0;
  }
  return [...out].map(([month, totals]) => ({ month, totals }));
}
