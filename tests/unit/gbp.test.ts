import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  classify, createPost, fetchInsights, GbpError, getProfile, googleBase, listAccounts, listLocations, listReviews, postBody,
  REPLY_MAX_BYTES, updatePost, updateReply,
} from "@/lib/gbp-api";
import { accessToken, authUrl, exchangeCode, MANAGE_SCOPE, pkcePair } from "@/lib/google";
import { autoLocation, gbpStatus, live } from "@/lib/gbp-state";
import { decrypt, encrypt } from "@/lib/crypto";
import type { GoogleConnection, PostDraft } from "@/lib/types";

// Google Business Profile client, OAuth and connection rules. fetch is replaced in each test; nothing reaches Google.

type Sent = { url: URL; method: string; body?: string; auth?: string | null };
const realFetch = globalThis.fetch;
let sent: Sent[] = [];
/** Answers each request with the next response from the list (the last one repeats). */
function answer(...responses: (Response | (() => Response) | Record<string, unknown>)[]) {
  sent = [];
  let i = 0;
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    sent.push({ url: new URL(String(u)), method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined, auth: new Headers(init?.headers).get("authorization") });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (typeof r === "function") return r();
    return r instanceof Response ? r.clone() : new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
}
const err = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
  process.env.GOOGLE_CLIENT_ID = "unit-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "unit-client-secret";
  process.env.GBP_API_APPROVED = "true";
  delete process.env.GOOGLE_API_BASE_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("base URLs: Google by default; the test override only for a loopback address", () => {
  assert.equal(googleBase("v4"), "https://mybusiness.googleapis.com");
  assert.equal(googleBase("perf"), "https://businessprofileperformance.googleapis.com");
  process.env.GOOGLE_API_BASE_URL = "http://127.0.0.1:4999/gapi/";
  assert.equal(googleBase("info"), "http://127.0.0.1:4999/gapi/info");
  for (const bad of ["https://evil.example/gapi", "http://10.0.0.5/gapi", "not a url", "http://127.0.0.1.evil.example/x"]) {
    process.env.GOOGLE_API_BASE_URL = bad;
    assert.equal(googleBase("oauth"), "https://oauth2.googleapis.com", bad);
  }
});

test("errors: sign-in, scope, permission, API off, quota, not found, invalid and outage are told apart", () => {
  const e = (status: number, error: object) => classify(status, { error } as never).kind;
  assert.equal(e(401, { status: "UNAUTHENTICATED" }), "reconnect");
  assert.equal(e(403, { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] }), "scope");
  assert.equal(e(403, { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." }), "scope");
  assert.equal(e(403, { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] }), "not_enabled");
  assert.equal(e(403, { status: "PERMISSION_DENIED", message: "The caller does not have permission" }), "permission");
  assert.equal(e(429, { status: "RESOURCE_EXHAUSTED" }), "quota");
  assert.equal(e(403, { status: "PERMISSION_DENIED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] }), "quota");
  assert.equal(e(404, { status: "NOT_FOUND" }), "not_found");
  assert.equal(e(503, { status: "UNAVAILABLE" }), "unavailable");
  const invalid = classify(400, { error: { status: "INVALID_ARGUMENT", message: "Summary is too long." } });
  assert.equal(invalid.kind, "invalid");
  assert.match(invalid.message, /Google said: Summary is too long\./);
  // Customer messages never mention server settings.
  for (const k of ["reconnect", "scope", "permission", "not_enabled", "quota", "not_found", "unavailable", "network"] as const) {
    assert.doesNotMatch(new GbpError(k).message, /\.env|GOOGLE_|client id|secret|console/i);
  }
});

test("account discovery: all pages, 20 at a time, with the access token", async () => {
  answer({ accounts: [{ name: "accounts/1", accountName: "Group", type: "LOCATION_GROUP" }], nextPageToken: "p2" }, { accounts: [{ name: "accounts/2", accountName: "Me", type: "PERSONAL" }] });
  const a = await listAccounts("tok-1");
  assert.deepEqual(a.map((x) => [x.name, x.accountName, x.type]), [["accounts/1", "Group", "LOCATION_GROUP"], ["accounts/2", "Me", "PERSONAL"]]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url.origin + sent[0].url.pathname, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
  assert.equal(sent[0].url.searchParams.get("pageSize"), "20");
  assert.equal(sent[1].url.searchParams.get("pageToken"), "p2");
  assert.equal(sent[0].auth, "Bearer tok-1");
});

test("location discovery: read mask, 100 per page, every page, several accounts, shared locations listed once", async () => {
  answer(
    { locations: [{ name: "locations/1", title: "Clinic A", storefrontAddress: { addressLines: ["12 MG Road"], locality: "Pune", postalCode: "411001" }, metadata: { placeId: "ChIJa" } }], nextPageToken: "n" },
    { locations: [{ name: "locations/2", title: "Clinic B" }] },
    { locations: [{ name: "locations/1", title: "Clinic A" }, { name: "locations/3", title: "Salon" }] },
  );
  const { locations, truncated } = await listLocations("t", [{ name: "accounts/1", accountName: "Group" }, { name: "accounts/2", accountName: "Me" }]);
  assert.equal(truncated, false);
  assert.deepEqual(locations.map((l) => [l.account, l.location, l.title]), [["accounts/1", "locations/1", "Clinic A"], ["accounts/1", "locations/2", "Clinic B"], ["accounts/2", "locations/3", "Salon"]]);
  assert.equal(locations[0].address, "12 MG Road, Pune, 411001");
  assert.equal(locations[0].placeId, "ChIJa");
  assert.equal(sent[0].url.pathname, "/v1/accounts/1/locations");
  assert.equal(sent[0].url.searchParams.get("readMask"), "name,title,storefrontAddress,metadata");
  assert.equal(sent[0].url.searchParams.get("pageSize"), "100");
  assert.equal(sent[1].url.searchParams.get("pageToken"), "n");
  assert.equal(sent[2].url.pathname, "/v1/accounts/2/locations");
});

test("location discovery stops at the page limit and says so", async () => {
  answer({ locations: [{ name: "locations/x" }], nextPageToken: "more" });
  const r = await listLocations("t", [{ name: "accounts/1", accountName: "A" }], 2);
  assert.equal(r.truncated, true);
  assert.equal(sent.length, 2);
});

test("profile: one location read with a read mask; missing fields stay missing", async () => {
  answer({ name: "locations/1", title: "Clinic A", phoneNumbers: { primaryPhone: "020 1234" }, categories: { primaryCategory: { displayName: "Dermatologist" } },
    regularHours: { periods: [{}] }, openInfo: { status: "OPEN" }, metadata: { placeId: "ChIJa", hasVoiceOfMerchant: true, mapsUri: "https://maps.google.com/?cid=1" } });
  const p = await getProfile("t", "locations/1");
  assert.equal(sent[0].url.pathname, "/v1/locations/1");
  assert.match(sent[0].url.searchParams.get("readMask")!, /^name,title,storefrontAddress,phoneNumbers,categories,websiteUri,regularHours,profile,openInfo,metadata$/);
  assert.deepEqual([p.title, p.phone, p.category, p.hasHours, p.openStatus, p.verified, p.website, p.description], ["Clinic A", "020 1234", "Dermatologist", true, "OPEN", true, undefined, undefined]);
});

test("reviews: 50 a page, newest first, next page token, stars, replies and Google's totals", async () => {
  answer({
    reviews: [
      { name: "accounts/1/locations/1/reviews/a", reviewer: { displayName: "Asha" }, starRating: "FOUR", comment: "Good", createTime: "2026-11-01T00:00:00Z" },
      { name: "accounts/1/locations/1/reviews/b", reviewer: { isAnonymous: true }, starRating: "STAR_RATING_UNSPECIFIED", createTime: "2026-10-01T00:00:00Z",
        reviewReply: { comment: "Thanks", updateTime: "2026-10-02T00:00:00Z", reviewReplyState: "PENDING" } },
    ],
    averageRating: 4.3, totalReviewCount: 61, nextPageToken: "next-1",
  });
  const page = await listReviews("t", "accounts/1", "locations/1", "tok-9");
  assert.equal(sent[0].url.pathname, "/v4/accounts/1/locations/1/reviews");
  assert.deepEqual(Object.fromEntries(sent[0].url.searchParams), { pageSize: "50", orderBy: "updateTime desc", pageToken: "tok-9" });
  assert.deepEqual([page.averageRating, page.totalReviewCount, page.nextPageToken], [4.3, 61, "next-1"]);
  assert.deepEqual(page.reviews.map((r) => [r.stars, r.replied, r.reviewer]), [[4, false, "Asha"], [0, true, "A Google user"]]);
  assert.deepEqual(page.reviews[1].reply, { text: "Thanks", updatedAt: "2026-10-02T00:00:00Z", state: "PENDING" });
});

test("reply: PUT to the review's reply; over 4096 bytes is refused before calling Google", async () => {
  answer({ comment: "Thank you", reviewReplyState: "APPROVED", updateTime: "2026-11-02T00:00:00Z" });
  const r = await updateReply("t", "accounts/1/locations/1/reviews/a", "Thank you");
  assert.deepEqual([sent[0].method, sent[0].url.pathname, sent[0].body], ["PUT", "/v4/accounts/1/locations/1/reviews/a/reply", '{"comment":"Thank you"}']);
  assert.equal(r.state, "APPROVED");
  sent = [];
  const hindi = "धन्यवाद ".repeat(200); // 3 bytes per letter: under 4096 characters, over 4096 bytes
  assert.ok(hindi.length < REPLY_MAX_BYTES && Buffer.byteLength(hindi) > REPLY_MAX_BYTES);
  await assert.rejects(updateReply("t", "accounts/1/locations/1/reviews/a", hindi), (e: GbpError) => e.kind === "invalid");
  assert.equal(sent.length, 0);
});

const draft = (o: Partial<PostDraft>): PostDraft => ({ id: "p", text: "Monsoon skin care camp this Saturday.", kind: "STANDARD", status: "approved", warnings: [], createdAt: "", ...o });

test("posts: update, event and offer bodies; editing sends an update mask of the changed fields", async () => {
  assert.deepEqual(postBody(draft({})), { languageCode: "en", summary: "Monsoon skin care camp this Saturday.", topicType: "STANDARD" });
  const ev = postBody(draft({ kind: "EVENT", event: { title: "Skin camp", start: "2026-12-05T10:00", end: "2026-12-05T13:30" } }), "hi");
  assert.deepEqual(ev.event, { title: "Skin camp", schedule: {
    startDate: { year: 2026, month: 12, day: 5 }, startTime: { hours: 10, minutes: 0, seconds: 0, nanos: 0 },
    endDate: { year: 2026, month: 12, day: 5 }, endTime: { hours: 13, minutes: 30, seconds: 0, nanos: 0 } } });
  assert.equal(ev.languageCode, "hi");
  const offer = postBody(draft({ kind: "OFFER", event: { title: "20% off", start: "2026-12-01T09:00", end: "2026-12-10T18:00" }, offer: { couponCode: "GLOW20", termsConditions: "" } }));
  assert.deepEqual(offer.offer, { couponCode: "GLOW20" });

  answer({ name: "accounts/1/locations/1/localPosts/9", state: "LIVE", searchUrl: "https://local.google.com/p/9" });
  const created = await createPost("t", "accounts/1", "locations/1", draft({}));
  assert.deepEqual([sent[0].method, sent[0].url.pathname], ["POST", "/v4/accounts/1/locations/1/localPosts"]);
  assert.deepEqual([created.name, created.state, created.searchUrl], ["accounts/1/locations/1/localPosts/9", "LIVE", "https://local.google.com/p/9"]);

  answer({ name: "accounts/1/locations/1/localPosts/9", state: "PROCESSING" });
  await updatePost("t", "accounts/1/locations/1/localPosts/9", draft({ text: "Edited text for the camp." }));
  assert.deepEqual([sent[0].method, sent[0].url.pathname, sent[0].url.searchParams.get("updateMask")], ["PATCH", "/v4/accounts/1/locations/1/localPosts/9", "summary"]);
  await updatePost("t", "accounts/1/locations/1/localPosts/9", draft({ kind: "EVENT", event: { title: "Camp", start: "2026-12-05T10:00", end: "2026-12-05T12:00" } }));
  assert.equal(sent.at(-1)!.url.searchParams.get("updateMask"), "summary,event");
});

test("insights: supported metrics, two 28-day periods in one request, missing values count as 0", async () => {
  const now = new Date("2026-11-19T08:00:00Z");
  // Every day in range: 3 search views; calls only on 2026-11-10 (Google omits zero values).
  const days: string[] = [];
  for (let t = Date.UTC(2026, 8, 25); t <= Date.UTC(2026, 10, 18); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const dv = (v: (d: string) => string | undefined) => days.map((d) => {
    const [year, month, day] = d.split("-").map(Number);
    const value = v(d);
    return value === undefined ? { date: { year, month, day } } : { date: { year, month, day }, value };
  });
  answer({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: dv((d) => (d >= "2026-10-22" ? "4" : "2")) } },
    { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", timeSeries: { datedValues: dv(() => "1") } },
    { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: dv((d) => (d === "2026-11-10" ? "5" : undefined)) } },
  ] }] });
  const ins = await fetchInsights("t", "locations/1", 28, now);
  const q = sent[0].url.searchParams;
  assert.equal(sent[0].url.origin + sent[0].url.pathname, "https://businessprofileperformance.googleapis.com/v1/locations/1:fetchMultiDailyMetricsTimeSeries");
  assert.ok(q.getAll("dailyMetrics").includes("CALL_CLICKS"));
  assert.ok(!q.getAll("dailyMetrics").includes("BUSINESS_CONVERSATIONS") && !q.getAll("dailyMetrics").includes("BUSINESS_FOOD_ORDERS"), "no deprecated metrics");
  assert.deepEqual([q.get("dailyRange.start_date.year"), q.get("dailyRange.start_date.month"), q.get("dailyRange.start_date.day")], ["2026", "9", "24"]);
  assert.deepEqual([q.get("dailyRange.end_date.year"), q.get("dailyRange.end_date.month"), q.get("dailyRange.end_date.day")], ["2026", "11", "18"]);
  assert.deepEqual([ins.current.start, ins.current.end, ins.previous.start, ins.previous.end], ["2026-10-22", "2026-11-18", "2026-09-24", "2026-10-21"]);
  assert.equal(ins.current.totals.searchViews, 4 * 28);
  assert.equal(ins.previous.totals.searchViews, 2 * 27); // the stand-in data starts a day after the previous period
  assert.equal(ins.current.totals.mapsViews, 28);
  assert.equal(ins.current.totals.calls, 5);
  assert.equal(ins.previous.totals.calls, 0);
  assert.equal(ins.dailyViews.length, 28);
  assert.equal(ins.dailyViews[0].value, 5);
});

test("reads are retried once on a Google outage; writes are never retried", async () => {
  answer(err(503, { error: { status: "UNAVAILABLE" } }), { accounts: [] });
  assert.deepEqual(await listAccounts("t"), []);
  assert.equal(sent.length, 2);
  answer(err(503, { error: { status: "UNAVAILABLE" } }));
  await assert.rejects(createPost("t", "accounts/1", "locations/1", draft({})), (e: GbpError) => e.kind === "unavailable");
  assert.equal(sent.length, 1);
  answer(err(403, { error: { status: "PERMISSION_DENIED" } }));
  await assert.rejects(listReviews("t", "accounts/1", "locations/1"), (e: GbpError) => e.kind === "permission");
  assert.equal(sent.length, 1, "a permission error is not retried");
});

test("OAuth: PKCE S256 challenge in the sign-in URL, with offline access and the Business Profile scope", () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  const u = new URL(authUrl("st", challenge));
  assert.deepEqual([u.searchParams.get("code_challenge"), u.searchParams.get("code_challenge_method"), u.searchParams.get("access_type"), u.searchParams.get("state")], [challenge, "S256", "offline", "st"]);
  assert.ok(u.searchParams.get("scope")!.split(" ").includes(MANAGE_SCOPE));
  assert.equal(u.searchParams.get("client_id"), "unit-client-id");
});

test("OAuth: exactly three scopes (Business Profile, sign-in identity, email) and the configured callback address", () => {
  const before = process.env.GOOGLE_REDIRECT_URI;
  try {
    const scopes = (u: URL) => u.searchParams.get("scope")!.split(" ").sort();
    process.env.GOOGLE_REDIRECT_URI = "https://gmbmirror.com/api/google/callback";
    const prod = new URL(authUrl("st", "ch"));
    assert.deepEqual(scopes(prod), ["email", "https://www.googleapis.com/auth/business.manage", "openid"]);
    assert.equal(prod.searchParams.get("redirect_uri"), "https://gmbmirror.com/api/google/callback");
    // Unset (local development): the app's own address plus /api/google/callback.
    delete process.env.GOOGLE_REDIRECT_URI;
    assert.match(new URL(authUrl("st", "ch")).searchParams.get("redirect_uri")!, /^http:\/\/localhost:\d+\/api\/google\/callback$/);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_REDIRECT_URI;
    else process.env.GOOGLE_REDIRECT_URI = before;
  }
});

const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

test("OAuth: code exchange sends the PKCE verifier, encrypts the tokens, and refuses a grant without the scope", async () => {
  answer({ access_token: "acc", refresh_token: "ref", expires_in: 3600, scope: `${MANAGE_SCOPE} openid email`, id_token: idToken("owner@example.test") });
  const { conn } = await exchangeCode("code-1", "verifier-1");
  const body = new URLSearchParams(sent[0].body);
  assert.deepEqual([sent[0].url.href, body.get("code"), body.get("code_verifier"), body.get("grant_type")], ["https://oauth2.googleapis.com/token", "code-1", "verifier-1", "authorization_code"]);
  assert.equal(conn.email, "owner@example.test");
  assert.ok(!conn.tokens.includes("acc") && !conn.tokens.includes("ref"), "tokens are stored encrypted");
  assert.equal(JSON.parse(decrypt(conn.tokens)).refresh_token, "ref");

  answer({ access_token: "acc", refresh_token: "ref", expires_in: 3600, scope: "openid email" }, {});
  await assert.rejects(exchangeCode("code-2", "v"), (e: GbpError) => e.kind === "scope");
  assert.equal(sent[1].url.href, "https://oauth2.googleapis.com/revoke", "the partial grant is revoked");

  answer(err(400, { error: "invalid_grant" }));
  await assert.rejects(exchangeCode("used-code", "v"), (e: GbpError) => e.kind === "reconnect");
});

const conn = (t: object): GoogleConnection => ({ email: "o@example.test", connectedAt: "", tokens: encrypt(JSON.stringify(t)) });

test("tokens: a valid token is used as is; an expiring one is refreshed; a refused refresh means reconnect", async () => {
  answer({});
  assert.deepEqual(await accessToken(conn({ access_token: "a1", refresh_token: "r1", expires_at: Date.now() + 3_600_000 })), { token: "a1" });
  assert.equal(sent.length, 0);

  answer({ access_token: "a2", expires_in: 3600 });
  const r = await accessToken(conn({ access_token: "a1", refresh_token: "r1", expires_at: Date.now() + 30_000 }));
  assert.equal(r.token, "a2");
  assert.deepEqual([new URLSearchParams(sent[0].body).get("grant_type"), new URLSearchParams(sent[0].body).get("refresh_token")], ["refresh_token", "r1"]);
  assert.equal(JSON.parse(decrypt(r.updated!)).refresh_token, "r1", "the refresh token is kept when Google sends no new one");

  answer(err(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
  await assert.rejects(accessToken(conn({ access_token: "a1", refresh_token: "r1", expires_at: 0 })), (e: GbpError) => e.kind === "reconnect");
  await assert.rejects(accessToken(conn({ access_token: "a1", expires_at: 0 })), (e: GbpError) => e.kind === "reconnect");
  await assert.rejects(accessToken({ ...conn({}), tokens: "damaged" }), (e: GbpError) => e.kind === "reconnect");
  answer(err(500, { error: "internal_failure" }));
  await assert.rejects(accessToken(conn({ access_token: "a1", refresh_token: "r1", expires_at: 0 })), (e: GbpError) => e.kind === "unavailable");
});

test("connection status: not set up, not connected, reconnect, switched off, choose a location, connected", () => {
  const c = (o: Partial<GoogleConnection> = {}): GoogleConnection => ({ email: "", tokens: "", connectedAt: "", ...o });
  const full = c({ accountName: "accounts/1", locationName: "locations/1" });
  assert.equal(gbpStatus(null), "not_connected");
  assert.equal(gbpStatus(c()), "choose_location");
  assert.equal(gbpStatus(full), "connected");
  assert.equal(live(full), true);
  assert.equal(gbpStatus({ ...full, needsReconnect: true }), "reconnect");
  assert.equal(live({ ...full, needsReconnect: true }), false);
  process.env.GBP_API_APPROVED = "false";
  assert.equal(gbpStatus(full), "not_enabled");
  assert.equal(live(full), false);
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(gbpStatus(null), "not_configured");
  assert.equal(live(full), false);
});

test("automatic location choice: the only location, or the only one with the Settings listing's Place ID", () => {
  const l = (location: string, placeId?: string) => ({ account: "accounts/1", location, title: location, address: "", placeId });
  assert.equal(autoLocation([l("locations/1")])?.location, "locations/1");
  assert.equal(autoLocation([l("locations/1", "A"), l("locations/2", "B")], "B")?.location, "locations/2");
  assert.equal(autoLocation([l("locations/1", "A"), l("locations/2", "B")], "C"), undefined);
  assert.equal(autoLocation([l("locations/1", "A"), l("locations/2", "A")], "A"), undefined, "two matches: the owner chooses");
  assert.equal(autoLocation([l("locations/1"), l("locations/2")]), undefined);
  assert.equal(autoLocation([]), undefined);
});

test("posts: a photo is sent as the post's media (Google downloads it); editing includes it in the update mask", async () => {
  const body = postBody(draft({ imageUrl: "https://example.test/camp.jpg" }));
  assert.deepEqual(body.media, [{ mediaFormat: "PHOTO", sourceUrl: "https://example.test/camp.jpg" }]);
  assert.equal(postBody(draft({})).media, undefined);
  answer({ name: "accounts/1/locations/1/localPosts/9", state: "LIVE" });
  await updatePost("t", "accounts/1/locations/1/localPosts/9", draft({ imageUrl: "https://example.test/camp.jpg" }));
  assert.equal(sent.at(-1)!.url.searchParams.get("updateMask"), "summary,media");
});
