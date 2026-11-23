/**
 * Test server for the browser tests. Playwright starts it (see playwright.config.ts); do not run it against real data.
 *
 * 1. Copies the app (src, public, config) into a temporary folder outside the project. The copy has no .env file,
 *    and the app keeps demo data in `<cwd>/.data`, so the real `.env` and `.data` are never read or written.
 * 2. Deletes the copy's `.data`, so every run starts with no accounts.
 * 3. Builds the copy with `next build` (the build cache in the temp folder is kept between runs to save time).
 * 4. Starts a mock Anthropic API, and two `next start` servers with throwaway secrets:
 *      - main:    Claude only (the mock).
 *      - partial: Claude (the mock) plus ChatGPT with a deliberately invalid key, so OpenAI really answers 401.
 *                 No Google sign-in keys, for the Google page's "not set up" state.
 *      - direct:  like main, but set up as if browsers reach it with no proxy in front (TRUSTED_PROXY_HOPS=0).
 *      - noplaces: like main, but with no Google Places key.
 *      - gbp:     like main, plus live Google Business Profile (GBP_API_APPROVED=true) against a local stand-in for
 *                 Google's OAuth, Account Management, Business Information, v4 reviews/posts and Performance APIs
 *                 (GOOGLE_API_BASE_URL, honoured by the app only for loopback addresses). Nothing reaches Google.
 *    main and direct use a local Google Places stand-in (GOOGLE_PLACES_BASE_URL) with fixed test businesses.
 *    main and partial use TRUSTED_PROXY_HOPS=1: the tests play the trusted proxy by sending x-forwarded-for.
 * 5. Answers 200 on http://127.0.0.1:<mock port>/ready once both app servers respond.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const DIR = process.env.E2E_DIR;
const PORT = Number(process.env.E2E_PORT);
const PARTIAL_PORT = Number(process.env.E2E_PARTIAL_PORT);
const DIRECT_PORT = Number(process.env.E2E_DIRECT_PORT);
const NOPLACES_PORT = Number(process.env.E2E_NOPLACES_PORT);
const GBP_PORT = Number(process.env.E2E_GBP_PORT);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT);

// Refuse anything that could touch the project's own files.
const tmp = fs.realpathSync(os.tmpdir());
if (!DIR || !path.isAbsolute(DIR)) throw new Error("E2E_DIR must be an absolute path.");
fs.mkdirSync(DIR, { recursive: true });
const real = fs.realpathSync(DIR);
if (!real.startsWith(tmp + path.sep) || real.startsWith(fs.realpathSync(ROOT))) throw new Error(`E2E_DIR must be inside ${tmp} and outside the project.`);

/* ---------- copy the app ---------- */
for (const item of ["src", "public"]) {
  fs.rmSync(path.join(DIR, item), { recursive: true, force: true });
  if (fs.existsSync(path.join(ROOT, item))) fs.cpSync(path.join(ROOT, item), path.join(DIR, item), { recursive: true });
}
for (const f of ["package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "next-env.d.ts"]) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIR, f));
}
for (const f of fs.readdirSync(DIR)) if (f.startsWith(".env")) fs.rmSync(path.join(DIR, f), { force: true });
fs.rmSync(path.join(DIR, ".data"), { recursive: true, force: true });
// Turbopack will not follow a node_modules symlink that points outside the copy, so the copy gets its own.
// COPYFILE_FICLONE makes cheap copy-on-write clones where the file system supports them (APFS, Btrfs).
// It is copied again only when package-lock.json changes.
const lock = fs.existsSync(path.join(ROOT, "package-lock.json")) ? crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "package-lock.json"))).digest("hex") : "none";
const marker = path.join(DIR, ".e2e-modules");
const nm = path.join(DIR, "node_modules");
if (fs.lstatSync(nm, { throwIfNoEntry: false })?.isSymbolicLink() || !fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== lock) {
  console.log("[e2e] copying node_modules into the test folder");
  fs.rmSync(nm, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "node_modules"), nm, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  fs.writeFileSync(marker, lock);
}

/* ---------- environment: an explicit list, nothing inherited from the shell or a .env file ---------- */
const keep = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "SYSTEMROOT", "USERPROFILE"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const secret = () => crypto.randomBytes(32).toString("hex");
const base = {
  ...keep,
  NEXT_TELEMETRY_DISABLED: "1",
  APP_MODE: "demo",
  ALLOW_DEMO_IN_PRODUCTION: "true",
  SESSION_SECRET: secret(),
  TOKEN_ENCRYPTION_KEY: secret(),
  NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
  ANTHROPIC_API_KEY: "e2e-test-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  GOOGLE_CLIENT_ID: "e2e-fake-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-fake-client-secret",
  TRUSTED_PROXY_HOPS: "1",
  // Background jobs run only when a test calls POST /api/jobs/run (with the secret), optionally "as of" a later time.
  JOBS_RUNNER: "off",
  CRON_SECRET: "e2e-cron-secret-0123456789",
  JOBS_TEST_CLOCK: "on",
  AI_RETRY_DELAY_MS: "50",
  // One test server serves hundreds of test accounts against a stand-in without quota.
  GBP_QPM_GUARD: "100000",
  GBP_EDITS_PER_MIN: "100000",
  // Google Places stand-in, served by the mock below. Fake key; nothing reaches Google.
  GOOGLE_PLACES_API_KEY: "e2e-places-key",
  GOOGLE_PLACES_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
};
// The Business Profile server also has email switched on, against a Resend stand-in (the main server keeps the
// "email not set up" state). Nothing reaches Resend.
const gbpEnv = {
  ...base, NEXT_PUBLIC_APP_URL: `http://localhost:${GBP_PORT}`, GBP_API_APPROVED: "true", GOOGLE_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/gapi`,
  RESEND_API_KEY: "re_e2e_fake_key_0123456789", EMAIL_FROM: "GMBmirror <notifications@e2e.example.test>", RESEND_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/resend`,
};
const directEnv = { ...base, NEXT_PUBLIC_APP_URL: `http://localhost:${DIRECT_PORT}`, TRUSTED_PROXY_HOPS: "0" };
const { GOOGLE_PLACES_API_KEY: _pk, GOOGLE_PLACES_BASE_URL: _pb, ...noPlacesEnv } = base;
const noplacesEnv = { ...noPlacesEnv, NEXT_PUBLIC_APP_URL: `http://localhost:${NOPLACES_PORT}` };
// partial also has no Google sign-in set up, for the "not configured" state of the Google page.
const { GOOGLE_CLIENT_ID: _id, GOOGLE_CLIENT_SECRET: _secret, ...noGoogle } = base;
// It also has a deliberately invalid Places key, so Google really answers "invalid key" (needs internet).
const partialEnv = {
  ...noGoogle,
  GOOGLE_PLACES_BASE_URL: "",
  NEXT_PUBLIC_APP_URL: `http://localhost:${PARTIAL_PORT}`,
  AI_EXTRA_PROVIDERS: "true",
  OPENAI_API_KEY: "sk-e2e-deliberately-invalid-key",
  OPENAI_MODEL: "gpt-4o-mini",
  GOOGLE_PLACES_API_KEY: "AIzaE2E-deliberately-invalid-places-key-0",
};

/* ---------- build ---------- */
// The copy's own Next.js: running the project's copy would load a second React and break the build.
const next = path.join(DIR, "node_modules", "next", "dist", "bin", "next");
console.log(`[e2e] building a copy of the app in ${DIR}`);
const build = spawnSync(process.execPath, [next, "build"], { cwd: DIR, env: base, stdio: ["ignore", "inherit", "inherit"] });
if (build.status !== 0) {
  console.error("[e2e] next build failed");
  process.exit(1);
}

/* ---------- mock Anthropic API ---------- */
// Tests set what it answers with GET /mode?m=<mode>&a=<answer text>, and read the prompts it received with GET /calls.
/* ---------- Google Places (New) stand-in ---------- */
// Three businesses the tests own, plus generated competitors. Tests change the data with GET /places-mode.
const HOSPITAL = "ChIJe2eHospital00001", SALON = "ChIJe2eSalon0000001", SPARSE = "ChIJe2eSparse000001";
const GLOW_BRANCH = "ChIJe2eSalon0000002", GLOW_SPA = "ChIJe2eGlowSpa00001", MISSING = "ChIJe2eMissing00001";
const HOME = { latitude: 18.52, longitude: 73.85 };
// shift: moves which neighbouring businesses lead the grid results (to test competitor movement).
let placesMode = { improved: false, grid: [2, 2, 2, 2, 1, 2, 2, 2, 2], shift: 0 };
/** Text searches the business finder made, for tests to read with GET /places-finds. */
let finds = [];
const photos = (n) => Array.from({ length: n }, (_, i) => ({ name: `photo-${i}` }));
function fixture(id) {
  if (id === HOSPITAL)
    return { id, displayName: { text: "Sunrise Multi-speciality Hospital" }, formattedAddress: "MG Road, Pune", rating: 4.6, userRatingCount: 820, photos: photos(10),
      regularOpeningHours: { weekdayDescriptions: ["Monday: Open 24 hours"] }, websiteUri: "https://sunrise-hospital.example", nationalPhoneNumber: "098765 43210",
      primaryType: "general_hospital", primaryTypeDisplayName: { text: "General Hospital" }, businessStatus: "OPERATIONAL", location: HOME };
  if (id === SALON)
    return placesMode.improved
      ? { id, displayName: { text: "Glow Salon" }, formattedAddress: "FC Road, Pune", rating: 4.1, userRatingCount: 60, photos: photos(10), regularOpeningHours: { weekdayDescriptions: [] },
          websiteUri: "https://glow.example", nationalPhoneNumber: "091234 56789", primaryType: "beauty_salon", primaryTypeDisplayName: { text: "Beauty Salon" }, businessStatus: "OPERATIONAL", location: HOME }
      : { id, displayName: { text: "Glow Salon" }, formattedAddress: "FC Road, Pune", rating: 3.8, userRatingCount: 12, photos: photos(3),
          primaryType: "beauty_salon", primaryTypeDisplayName: { text: "Beauty Salon" }, businessStatus: "OPERATIONAL", location: HOME };
  if (id === SPARSE) return { id, displayName: { text: "New Corner Clinic" }, location: HOME };
  if (id === GLOW_BRANCH) return { id, displayName: { text: "Glow Salon" }, formattedAddress: "Kothrud, Pune, Maharashtra", primaryType: "beauty_salon", primaryTypeDisplayName: { text: "Beauty Salon" }, location: HOME };
  if (id === GLOW_SPA) return { id, displayName: { text: "Glow Salon & Spa" }, formattedAddress: "Baner, Pune, Maharashtra", primaryType: "spa", primaryTypeDisplayName: { text: "Spa" }, location: HOME };
  if (id === MISSING) return null;
  // Any other test Place ID (for example ChIJtestPlace123) is a plain listing, so tests can paste IDs.
  const filler = id.match(/^ChIJe2eFiller(\d{5})$/);
  if (filler) return { id, displayName: { text: `Nearby business ${Number(filler[1]) + 1}` }, location: HOME };
  if (/^ChIJ[A-Za-z0-9_-]{6,}$/.test(id)) return { id, displayName: { text: "Test listing" }, formattedAddress: "Test address, Pune", location: HOME };
  return null;
}
// Business finder scenarios, chosen by the words searched.
function findResults(query) {
  const q = query.toLowerCase();
  if (q.includes("quota")) return { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded.", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } } };
  if (q.includes("outage")) return { status: 503, body: { error: { code: 503, status: "UNAVAILABLE", message: "The service is unavailable." } } };
  if (q.includes("nothing")) return { status: 200, body: {} };
  if (q.includes("zzq")) return { status: 200, body: { places: [{ id: "ChIJe2eOther000001", displayName: { text: "Wellness Clinic" }, formattedAddress: "Swargate, Pune" }, { id: "ChIJe2eOther000002", displayName: { text: "Vishwanand Wellness" }, formattedAddress: "Kothrud, Pune" }] } };
  if (q.includes("glow")) return { status: 200, body: { places: [fixture(GLOW_SPA), fixture(SALON), fixture(GLOW_BRANCH)].map((p) => ({ ...p, formattedAddress: p.formattedAddress ?? "FC Road, Pune, Maharashtra" })) } };
  if (q.includes("sunrise")) return { status: 200, body: { places: [fixture(HOSPITAL)] } };
  const all = [HOSPITAL, SALON, SPARSE].map(fixture);
  const words = q.split(/\s+/);
  return { status: 200, body: { places: all.filter((p) => words.some((w) => w.length > 3 && p.displayName.text.toLowerCase().includes(w))) } };
}
function competitorsFor(query) {
  const make = (i, kind, extra = {}) => ({ id: `ChIJe2eComp${kind}${String(i).padStart(4, "0")}`, displayName: { text: `${kind} competitor ${i}` }, ...extra });
  if (/hospital/i.test(query)) {
    const list = Array.from({ length: 9 }, (_, i) => make(i + 1, "Hosp", { rating: 4.2 + (i % 5) * 0.1, userRatingCount: 300 + i * 150, photos: photos(10),
      regularOpeningHours: {}, websiteUri: i < 8 ? "https://x.example" : undefined, nationalPhoneNumber: "01", primaryType: "hospital", primaryTypeDisplayName: { text: "Hospital" } }));
    list.splice(2, 0, fixture(HOSPITAL));
    return list;
  }
  if (/salon/i.test(query))
    return Array.from({ length: 10 }, (_, i) => make(i + 1, "Salon", { rating: 4.3 + (i % 6) * 0.1, userRatingCount: 40 + i * 25, photos: photos(6 + (i % 5)),
      regularOpeningHours: {}, websiteUri: i < 7 ? "https://s.example" : undefined, nationalPhoneNumber: i < 9 ? "02" : undefined, primaryType: "beauty_salon", primaryTypeDisplayName: { text: "Beauty Salon" } }));
  // Anything else: competitors with most fields missing, to test "not compared".
  return Array.from({ length: 10 }, (_, i) => make(i + 1, "Clinic", { primaryType: "doctor", primaryTypeDisplayName: { text: "Doctor" } }));
}
/**
 * The grid point a search comes from, as an index into placesMode.grid (3x3 = 9 values, 5x5 = 25 values), from its
 * distance to the business in grid steps (the search radius is the grid spacing). A 3x3 setting used for a 5x5 scan
 * gives every outer point the value of the nearest 3x3 point.
 */
function gridCell(center, radiusM) {
  const size = placesMode.grid.length === 25 ? 5 : 3, h = (size - 1) / 2;
  const km = radiusM / 1000, dLat = km / 111.32, dLng = km / (111.32 * Math.cos((HOME.latitude * Math.PI) / 180));
  const clamp = (v) => Math.max(-h, Math.min(h, v));
  const up = clamp(Math.round((center.latitude - HOME.latitude) / dLat)), right = clamp(Math.round((center.longitude - HOME.longitude) / dLng));
  return (h - up) * size + (right + h);
}
/** Neighbouring businesses in the grid results. placesMode.leaders lets a test change who leads. */
const neighbour = (i) => ({ id: `ChIJe2eFiller${String(i).padStart(5, "0")}` });
function placesApi(req, res, u, body) {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.headers["x-goog-api-key"] !== "e2e-places-key") return send(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "bad key", details: [{ reason: "API_KEY_INVALID" }] } });
  if (u.pathname === "/v1/places:searchText") {
    const j = JSON.parse(body || "{}");
    const circle = j.locationBias?.circle;
    if (circle) {
      // Rank grid: our three businesses sit at the position set for this grid point (null = not listed).
      const rank = placesMode.grid[gridCell(circle.center, circle.radius)];
      const filler = Array.from({ length: 20 }, (_, i) => neighbour((i + placesMode.shift) % 20));
      if (rank) filler.splice(rank - 1, 3, { id: HOSPITAL }, { id: SALON }, { id: SPARSE });
      return send(200, { places: filler.slice(0, 20) });
    }
    if ((j.pageSize ?? 20) <= 5) {
      finds.push(String(j.textQuery));
      const r = findResults(String(j.textQuery));
      return send(r.status, r.body);
    }
    return send(200, { places: competitorsFor(String(j.textQuery)).slice(0, j.pageSize ?? 10) });
  }
  const m = u.pathname.match(/^\/v1\/places\/(.+)$/);
  if (m) {
    const f = fixture(decodeURIComponent(m[1]));
    return f ? send(200, f) : send(404, { error: { code: 404, status: "NOT_FOUND", message: "Not found" } });
  }
  return send(404, { error: { code: 404, status: "NOT_FOUND" } });
}

/* ---------- Google Business Profile stand-in (OAuth + Business Profile APIs) ---------- */
// Tests change it with GET /gbp-mode and read the requests it received with GET /gbp-calls.
const LOCS = {
  "locations/1001": { name: "locations/1001", title: "Zentrix Skin Clinic, Saheed Nagar", storefrontAddress: { addressLines: ["Plot 12, Saheed Nagar"], locality: "Bhubaneswar", postalCode: "751007" },
    phoneNumbers: { primaryPhone: "0674 123 4567" }, websiteUri: "https://zentrix.example", categories: { primaryCategory: { displayName: "Dermatologist" } },
    regularHours: { periods: [{ openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 18 } }] }, profile: { description: "Skin and hair clinic." }, openInfo: { status: "OPEN" },
    metadata: { placeId: "ChIJtestPlace123", mapsUri: "https://maps.google.com/?cid=1001", newReviewUri: "https://g.page/r/1001/review", hasVoiceOfMerchant: true } },
  "locations/1002": { name: "locations/1002", title: "Zentrix Skin Clinic, Patia", storefrontAddress: { addressLines: ["KIIT Road"], locality: "Patia", postalCode: "751024" },
    categories: { primaryCategory: { displayName: "Skin care clinic" } }, openInfo: { status: "OPEN" }, metadata: { placeId: "ChIJe2eZentrixPatia1", hasVoiceOfMerchant: false } },
  "locations/1003": { name: "locations/1003", title: "Zentrix Hair Studio", metadata: {} },
  "locations/2001": { name: "locations/2001", title: "Glow Salon", storefrontAddress: { addressLines: ["FC Road"], locality: "Pune" }, metadata: { placeId: "ChIJe2eSalon0000001" } },
};
// loseAnswer: the next new post is kept but its answer is lost (503), as when a request times out after Google acted.
const freshGbp = () => ({ fail: "", failPath: "", failMethod: "", loseAnswer: "", expiresIn: 3600, refresh: "ok", replyState: "APPROVED", tokens: new Map(), issued: 0, refreshes: 0, revoked: 0, replies: {}, posts: [], seq: 0, calls: [] });
let gbp = freshGbp();
const REVIEWERS = ["Asha Patel", "Rohit Nayak", "Sunita Das", "Imran Sheikh", "Pooja Mishra"];
function reviewsFor(parent) {
  return Array.from({ length: 60 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const name = `${parent}/reviews/r${n}`;
    const stored = gbp.replies[name];
    const reply = stored ?? (i % 3 === 2 ? { comment: `Thank you, ${REVIEWERS[i % 5].split(" ")[0]}.`, updateTime: "2026-10-01T10:00:00Z", reviewReplyState: "APPROVED" } : undefined);
    return { name, reviewId: `r${n}`, reviewer: { displayName: `${REVIEWERS[i % 5]} ${n}` }, starRating: ["FIVE", "FOUR", "TWO", "FIVE", "THREE"][i % 5],
      comment: i % 5 === 4 ? undefined : `Review number ${n}: ${["great care", "short wait", "parking was hard", "friendly staff", "ok"][i % 5]}.`,
      createTime: new Date(Date.UTC(2026, 10, 15) - i * 86_400_000).toISOString(), updateTime: new Date(Date.UTC(2026, 10, 15) - i * 86_400_000).toISOString(), ...(reply ? { reviewReply: reply } : {}) };
  });
}
function perfSeries(q) {
  const metrics = q.getAll("dailyMetrics");
  const start = Date.UTC(Number(q.get("dailyRange.start_date.year")), Number(q.get("dailyRange.start_date.month")) - 1, Number(q.get("dailyRange.start_date.day")));
  const end = Date.UTC(Number(q.get("dailyRange.end_date.year")), Number(q.get("dailyRange.end_date.month")) - 1, Number(q.get("dailyRange.end_date.day")));
  const days = [];
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t));
  // Earlier half v, later half 2v. Calls only in the later half; messages and bookings never (Google omits zeros).
  const base = { BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 1, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 2, BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 1, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 1, WEBSITE_CLICKS: 1, BUSINESS_DIRECTION_REQUESTS: 1 };
  // Bookings are left out entirely, as Google does for profiles without bookings: the app must show "not reported".
  return { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: metrics.filter((m) => m !== "BUSINESS_BOOKINGS").map((m) => ({ dailyMetric: m, timeSeries: { datedValues: days.map((d, i) => {
    const later = i >= days.length / 2;
    const v = m === "CALL_CLICKS" ? (later ? 1 : 0) : (base[m] ?? 0) * (later ? 2 : 1);
    const date = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    return v ? { date, value: String(v) } : { date };
  }) } })) }] };
}
function gbpApi(req, res, u, body) {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const path = u.pathname.slice("/gapi".length);
  gbp.calls.push({ method: req.method, path, query: u.search, body });
  // OAuth
  if (path === "/oauth/token") {
    const f = new URLSearchParams(body);
    if (f.get("client_id") !== "e2e-fake-client-id" || f.get("client_secret") !== "e2e-fake-client-secret") return send(401, { error: "invalid_client" });
    const issue = (expiresIn, extra = {}) => {
      const t = `at-${++gbp.issued}`;
      gbp.tokens.set(t, Date.now() + expiresIn * 1000);
      return { access_token: t, expires_in: expiresIn, token_type: "Bearer", ...extra };
    };
    if (f.get("grant_type") === "authorization_code") {
      if (!f.get("code_verifier")) return send(400, { error: "invalid_request", error_description: "Missing code verifier." });
      const code = f.get("code");
      const email = code === "e2e-good-other" ? "other-owner@example.test" : "owner@example.test";
      const idToken = `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
      if (code === "e2e-good" || code === "e2e-good-other") return send(200, issue(gbp.expiresIn, { refresh_token: "rt-e2e", scope: "https://www.googleapis.com/auth/business.manage openid https://www.googleapis.com/auth/userinfo.email", id_token: idToken }));
      if (code === "e2e-noscope") return send(200, issue(3600, { refresh_token: "rt-e2e", scope: "openid https://www.googleapis.com/auth/userinfo.email", id_token: idToken }));
      return send(400, { error: "invalid_grant", error_description: "Bad Request" });
    }
    if (f.get("grant_type") === "refresh_token") {
      if (gbp.refresh === "invalid_grant" || f.get("refresh_token") !== "rt-e2e") return send(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      gbp.refreshes++;
      return send(200, issue(3600));
    }
    return send(400, { error: "unsupported_grant_type" });
  }
  if (path === "/oauth/revoke") {
    gbp.revoked++;
    return send(200, {});
  }
  // Every API call needs a live access token from this stand-in.
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const exp = gbp.tokens.get(token);
  if (!exp || exp <= Date.now()) return send(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } });
  if (gbp.fail && path.includes(gbp.failPath) && (!gbp.failMethod || gbp.failMethod === req.method)) {
    const F = {
      permission: [403, { status: "PERMISSION_DENIED", message: "The caller does not have permission" }],
      scope: [403, { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes.", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] }],
      quota: [429, { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." }],
      unavailable: [503, { status: "UNAVAILABLE", message: "The service is currently unavailable." }],
      disabled: [403, { status: "PERMISSION_DENIED", message: "API has not been used in project 1 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] }],
    }[gbp.fail];
    return send(F[0], { error: { code: F[0], ...F[1] } });
  }
  let m;
  if (path === "/accounts/v1/accounts") {
    if (u.searchParams.get("pageSize") !== "20") return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "pageSize" } });
    return u.searchParams.get("pageToken") === "acc-p2"
      ? send(200, { accounts: [{ name: "accounts/200", accountName: "Owner (personal)", type: "PERSONAL", role: "PRIMARY_OWNER" }] })
      : send(200, { accounts: [{ name: "accounts/100", accountName: "Zentrix Group", type: "LOCATION_GROUP", role: "OWNER" }], nextPageToken: "acc-p2" });
  }
  if ((m = path.match(/^\/info\/v1\/(accounts\/\d+)\/locations$/))) {
    if (!u.searchParams.get("readMask")) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "readMask is required" } });
    const pick = (...ids) => ids.map((id) => ({ name: LOCS[id].name, title: LOCS[id].title, storefrontAddress: LOCS[id].storefrontAddress, metadata: LOCS[id].metadata }));
    if (m[1] === "accounts/100") return u.searchParams.get("pageToken") === "loc-p2" ? send(200, { locations: pick("locations/1003") }) : send(200, { locations: pick("locations/1001", "locations/1002"), nextPageToken: "loc-p2" });
    if (m[1] === "accounts/200") return send(200, { locations: pick("locations/1001", "locations/2001") });
    return send(404, { error: { code: 404, status: "NOT_FOUND" } });
  }
  if ((m = path.match(/^\/info\/v1\/(locations\/\d+)$/))) return LOCS[m[1]] ? send(200, LOCS[m[1]]) : send(404, { error: { code: 404, status: "NOT_FOUND" } });
  if ((m = path.match(/^\/v4\/v4\/(accounts\/\d+\/locations\/\d+)\/reviews$/))) {
    const all = reviewsFor(m[1]);
    const second = u.searchParams.get("pageToken") === "rev-p2";
    return send(200, { reviews: second ? all.slice(50) : all.slice(0, 50), averageRating: 4.2, totalReviewCount: all.length, ...(second ? {} : { nextPageToken: "rev-p2" }) });
  }
  if ((m = path.match(/^\/v4\/v4\/(accounts\/\d+\/locations\/\d+)\/reviews\/(r\d+)$/))) {
    const r = reviewsFor(m[1]).find((x) => x.reviewId === m[2]);
    return r ? send(200, r) : send(404, { error: { code: 404, status: "NOT_FOUND" } });
  }
  if ((m = path.match(/^\/v4\/v4\/(accounts\/\d+\/locations\/\d+\/reviews\/r\d+)\/reply$/)) && req.method === "PUT") {
    const j = JSON.parse(body || "{}");
    if (!j.comment) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "comment is required" } });
    gbp.replies[m[1]] = { comment: j.comment, updateTime: new Date().toISOString(), reviewReplyState: gbp.replyState };
    return send(200, gbp.replies[m[1]]);
  }
  if ((m = path.match(/^\/v4\/v4\/(accounts\/\d+\/locations\/\d+)\/localPosts$/))) {
    if (req.method === "GET") return send(200, { localPosts: gbp.posts.filter((p) => p.name.startsWith(m[1] + "/")) });
    const j = JSON.parse(body || "{}");
    if (!j.summary || !["STANDARD", "EVENT", "OFFER"].includes(j.topicType)) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "summary and topicType are required" } });
    if (j.topicType !== "STANDARD" && !j.event?.schedule?.startDate) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "event is required" } });
    const n = ++gbp.seq;
    const post = { ...j, name: `${m[1]}/localPosts/${n}`, state: "LIVE", searchUrl: `https://local.google.com/place?lpsid=${n}`, createTime: new Date().toISOString() };
    gbp.posts.push(post);
    if (gbp.loseAnswer === "1") {
      gbp.loseAnswer = "";
      return send(503, { error: { code: 503, status: "UNAVAILABLE", message: "The service is unavailable." } });
    }
    return send(200, post);
  }
  if ((m = path.match(/^\/v4\/v4\/(accounts\/\d+\/locations\/\d+\/localPosts\/\d+)$/)) && req.method === "PATCH") {
    const post = gbp.posts.find((p) => p.name === m[1]);
    if (!post) return send(404, { error: { code: 404, status: "NOT_FOUND" } });
    const mask = (u.searchParams.get("updateMask") ?? "").split(",").filter(Boolean);
    if (!mask.length) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "updateMask is required" } });
    const j = JSON.parse(body || "{}");
    for (const f of mask) post[f] = j[f];
    post.state = "PROCESSING";
    post.updateTime = new Date().toISOString();
    return send(200, post);
  }
  if ((m = path.match(/^\/perf\/v1\/(locations\/\d+):fetchMultiDailyMetricsTimeSeries$/))) return send(200, perfSeries(u.searchParams));
  return send(404, { error: { code: 404, status: "NOT_FOUND", message: `stand-in has no ${req.method} ${path}` } });
}

/* ---------- Claude stand-in for growth recommendations and action content ---------- */
function growthAnswer(user) {
  let ids = [];
  try { ids = JSON.parse(user).candidates.map((c) => c.id); } catch {}
  return JSON.stringify({
    recommendations: ids.slice(0, 3).map((id, i) => ({
      id, title: `Claude plan ${i + 1} for ${id}`, why: `Mock Claude reason for ${id}, based on the facts given.`,
      steps: [`First step for ${id}.`, `Second step for ${id}.`], benefit: mode === "growth-promise" && i === 0 ? "We guarantee you will rank first." : `A clearer profile for ${id}.`,
      difficulty: "Easy", priority: i === 0 ? "Critical" : "High",
    })),
  });
}

let mode = "named";
let answer = "";
let calls = [];
let ready = false;
/** Emails the app sent to the Resend stand-in (attachments: name and first bytes only). */
let emails = [];
let stopping = false;
const servers = [];

http
  .createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/ready") {
      res.writeHead(ready ? 200 : 503);
      return res.end(ready ? "ready" : "starting");
    }
    if (u.pathname === "/mode") {
      mode = u.searchParams.get("m") ?? "named";
      answer = u.searchParams.get("a") ?? "";
      calls = [];
      return res.end("ok");
    }
    if (u.pathname === "/calls") return res.end(JSON.stringify(calls));
    if (u.pathname === "/emails") return res.end(JSON.stringify(emails));
    if (u.pathname === "/places-finds") return res.end(JSON.stringify(finds));
    if (u.pathname === "/gbp-calls") return res.end(JSON.stringify({ calls: gbp.calls, refreshes: gbp.refreshes, revoked: gbp.revoked, posts: gbp.posts, replies: gbp.replies }));
    if (u.pathname === "/gbp-mode") {
      if (u.searchParams.has("reset")) gbp = freshGbp();
      for (const k of ["fail", "failPath", "failMethod", "refresh", "replyState", "loseAnswer"]) if (u.searchParams.has(k)) gbp[k] = u.searchParams.get(k);
      if (u.searchParams.has("expiresIn")) gbp.expiresIn = Number(u.searchParams.get("expiresIn"));
      return res.end("ok");
    }
    if (u.pathname === "/places-mode") {
      if (u.searchParams.has("improved")) placesMode.improved = u.searchParams.get("improved") === "1";
      if (u.searchParams.has("shift")) placesMode.shift = Number(u.searchParams.get("shift"));
      if (u.searchParams.has("grid")) placesMode.grid = u.searchParams.get("grid").split(",").map((x) => (x === "null" ? null : Number(x)));
      if (u.searchParams.has("reset")) {
        placesMode = { improved: false, grid: [2, 2, 2, 2, 1, 2, 2, 2, 2], shift: 0 };
        finds = [];
      }
      return res.end("ok");
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (u.pathname.startsWith("/v1/places")) return placesApi(req, res, u, body);
      if (u.pathname.startsWith("/gapi/")) return gbpApi(req, res, u, body);
      if (u.pathname === "/resend/emails") {
        const j = JSON.parse(body || "{}");
        emails.push({ ...j, attachments: (j.attachments ?? []).map((x) => ({ filename: x.filename, head: Buffer.from(x.content, "base64").subarray(0, 5).toString("latin1") })), auth: req.headers.authorization, key: req.headers["idempotency-key"] });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: `em_${emails.length}` }));
      }
      const j = JSON.parse(body || "{}");
      const system = typeof j.system === "string" ? j.system : "";
      calls.push({ system, user: j.messages?.[0]?.content, model: j.model });
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const text = (t) => send(200, { content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 40 } });
      // Failure modes, for every kind of request.
      if (mode === "500") return send(500, { error: { type: "api_error" } });
      if (mode === "429") return send(429, { error: { type: "rate_limit_error" } });
      if (mode === "refusal") return send(200, { content: [], stop_reason: "refusal" });
      if (mode === "max_tokens") return send(200, { content: [{ type: "text", text: "Thank you for" }], stop_reason: "max_tokens" });
      if (mode === "html") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<html>gateway error</html>");
      }
      if (system.startsWith("You prioritise growth")) return text(mode === "growth-bad" ? "Here are my thoughts, not JSON." : growthAnswer(calls.at(-1).user));
      if (system.includes("Return only a JSON array of three strings")) return text(JSON.stringify([
        "Version one from mock Claude: monsoon skin care basics for families in Bhubaneswar, with simple daily steps.",
        "Version two from mock Claude: what to expect at a skin check, how long it takes and what to bring along.",
        "Version three from mock Claude: an invitation to ask questions about seasonal skin care at the front desk.",
      ]));
      if (system.startsWith("You draft content")) return text("Draft from mock Claude: Sunrise Multi-speciality Hospital in Pune offers [services]. Open [hours].");
      if (system.startsWith("You advise"))
        return text(mode === "nofix" ? "no list" : '["Add every service to your Google profile.", "Promise guaranteed results to new patients.", "Make your phone number match on your website.", "Add 10 recent photos of the clinic."]');
      if (system.startsWith("Extract")) return text('["Alpha Clinic","Beta Dental"]');
      if (system.startsWith("Answer like")) return text(answer);
      return text("Thank you for the feedback, Rohit. We are glad the visit went smoothly.");
    });
  })
  .listen(MOCK_PORT, "127.0.0.1");

/* ---------- app servers ---------- */
for (const [port, env] of [[PORT, base], [PARTIAL_PORT, partialEnv], [DIRECT_PORT, directEnv], [NOPLACES_PORT, noplacesEnv], [GBP_PORT, gbpEnv]]) {
  const child = spawn(process.execPath, [next, "start", "-p", String(port)], { cwd: DIR, env, stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[e2e] app server on port ${port} stopped (${code})`);
      process.exit(1);
    }
  });
  servers.push(child);
}

const up = async (port) => {
  try {
    return (await fetch(`http://localhost:${port}/login`)).ok;
  } catch {
    return false;
  }
};
for (let i = 0; i < 120 && !ready; i++) {
  ready = (await up(PORT)) && (await up(PARTIAL_PORT)) && (await up(DIRECT_PORT)) && (await up(NOPLACES_PORT)) && (await up(GBP_PORT));
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
console.log(ready ? "[e2e] servers ready" : "[e2e] servers did not start");

const stop = () => {
  stopping = true;
  for (const s of servers) s.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
