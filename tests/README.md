# Tests

| Command | Runs |
|---|---|
| `npm test` or `npm run test:unit` | Unit tests (`tests/unit/`), Node's built-in test runner. A few seconds. |
| `npm run test:e2e` | Browser tests (`tests/e2e/`), Playwright with your installed Google Chrome. About 1 to 2 minutes, plus the build. |
| `npm run test:all` | Unit tests, then browser tests. |
| `npm run test:e2e:report` | Opens the HTML report of the last browser run. |

Run one browser file or one viewport: `npx playwright test posts`, `npx playwright test --project=mobile`.

## Unit tests

- `tests/setup/` lets the tests import the app's TypeScript files directly (`@/lib/...`).
- They need Node 22.18 or newer, which strips TypeScript types natively.
- No extra dependencies.

| File | Covers |
|---|---|
| `unit/medical.test.ts` | Healthcare wording rules: 100% claims, "offer" as a promotion vs a verb, Hindi and Hinglish phrases, no false alarms |
| `unit/visibility-matching.test.ts` | Business name, alias and possible-match detection; natural and custom visibility questions |
| `unit/score-and-limits.test.ts` | Visibility score and trend; rate limiter cost and refund |
| `unit/places-errors.test.ts` | Google Places error messages name the right Cloud setting and never contain the API key |
| `unit/places-fallback.test.ts` | Places API (New) first, older Places API when Google refuses it; switching back |
| `unit/account-security.test.ts` | Supabase cookie options, signup error messages, failure-only login limits, Google token revocation |
| `unit/discovery.test.ts` | Business finder: name matching, result order and branch flags, search request shape, "not found" vs other errors |
| `unit/listing-history.test.ts` | History stays with the Google listing it was measured for when the listing changes |
| `unit/growth-intelligence.test.ts` | Categories (and old names), checklist verdicts, competitor gap analysis, health score, recommendations, Claude-answer validation, no Google content sent to Claude |
| `unit/gbp.test.ts` | Google Business Profile client: base-URL guard, error kinds, account/location/review paging, reply byte limit, post bodies and update masks, insights periods, retries, PKCE, code exchange and scope refusal, token refresh and `invalid_grant`, connection statuses, automatic location choice |
| `unit/review-safety.test.ts` | Review classification (negative, rating-only, health and complaint terms in English, Hindi, Hinglish), contact data removed before Claude, reply checks, automatic-publishing rules |
| `unit/profile-score-pdf.test.ts` | Business Profile score (points, unknown items left out, fix steps) and the built-in PDF writer |
| `unit/jobs-locations.test.ts` | Job queue (duplicate keys, cancel, priority run, back-off, attempts, waiting, crashed-run lease) and location isolation, against a temporary store |
| `unit/client-address.test.ts` | Client address for rate limits: trusted-proxy hops, forged entries ignored, IPv6 /64 grouping, `TRUSTED_PROXY_HOPS` startup check |

## Browser tests

### Setup (once)

1. Install Google Chrome. The tests use it (`channel: "chrome"`); Playwright downloads no browser.
2. Run `npm install`. If Playwright ever tries to download browsers, use `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`.
3. Make sure ports 3111–3115 and 4999 are free. To use other ports, set `E2E_PORT`, `E2E_PARTIAL_PORT`, `E2E_DIRECT_PORT`, `E2E_NOPLACES_PORT`, `E2E_GBP_PORT` and `E2E_MOCK_PORT`.

Internet access is needed for two things:
- the build downloads its fonts;
- the partial-results test sends a deliberately invalid key to OpenAI and expects its real 401 reply;
- one Google test sends a made-up sign-in code to Google's token endpoint and expects it to be refused.

### How it keeps your data safe

`tests/e2e/support/server.mjs` (started by Playwright, never by hand) does this:

- Copies `src/`, `public/` and the config files into a temporary folder outside the project: `$TMPDIR/gmb-growth-engine-e2e`, or `E2E_DIR` if set. It refuses any folder inside the project.
- Gives the copy its own `node_modules`, cloned from the project's. It is copied again only when `package-lock.json` changes.
- Deletes the copy's `.data` at the start of every run, so each run begins with no accounts.
- Uses no `.env`. The servers get an explicit list of throwaway settings: demo mode, random secrets, a fake Claude key pointed at the local mock, and fake Google keys.
- Builds the copy and starts:
  - a mock Claude API on 4999, which records prompts and lets tests choose its answers;
  - the app on 3111 (Claude only, Google sign-in with fake keys, `TRUSTED_PROXY_HOPS=1`);
  - the app on 3112 (Claude plus an invalid OpenAI key, no Google sign-in keys, `TRUSTED_PROXY_HOPS=1`);
  - the app on 3113 (like 3111, but `TRUSTED_PROXY_HOPS=0`: reached directly, for the spoofing tests);
  - the app on 3114 (like 3111, but with no Google Places key);
  - the app on 3115 (like 3111, plus `GBP_API_APPROVED=true` and `GOOGLE_API_BASE_URL` pointing at the Google Business Profile stand-in).

All test servers run background jobs only when a test calls `POST /api/jobs/run` (helper `runJobs(page, at?)`), with `JOBS_RUNNER=off`, a test `CRON_SECRET`, and `JOBS_TEST_CLOCK=on` so a test can run jobs "as of" a later time. These settings exist for tests only. Their Google request guards are raised (`GBP_QPM_GUARD`, `GBP_EDITS_PER_MIN`) because every test account shares one stand-in location.

The mock on 4999 also serves a **Google Business Profile stand-in** under `/gapi`: the OAuth token and revoke endpoints (codes `e2e-good`, `e2e-good-other`, `e2e-noscope`; PKCE verifier required), Account Management (2 accounts over 2 pages), Business Information (4 locations, one shared by both accounts, over 2 pages; `locations.get`), v4 reviews (60 over 2 pages, get, reply) and posts (create, list, patch with update mask), and the Performance API. Tests choose failures with `gbpMode()` (permission, scope, quota, unavailable, API disabled; token lifetime; refused refresh) and read what it received with `gbpCalls()`. The app honours `GOOGLE_API_BASE_URL` only for a loopback `http://` address. `gbp.spec.ts` runs against 3115.

The mock on 4999 also serves a **Google Places (New) stand-in**. The app on 3111 and 3113 talks to it through `GOOGLE_PLACES_BASE_URL`, a setting that exists for tests only and must stay unset in real use. It knows three businesses, plus business-finder scenarios (two "Glow Salon" branches, "Glow Salon & Spa", searches containing "nothing", "zzq", "quota" or "outage", and the unknown ID `ChIJe2eMissing00001`):
- a strong hospital (`ChIJe2eHospital00001`);
- a weak salon (`ChIJe2eSalon0000001`);
- a place with almost no data (`ChIJe2eSparse000001`).

It returns competitor lists per category. Tests change its data with `placesMode()` (improved salon data, or the rank at each grid point). The partial-results server (3112) has a deliberately invalid real Places key.

The project's real `.env` and `.data` are never read or written. Test accounts are `e2e-<viewport>-<time>-<random>@example.test`.

Tests run one at a time (`workers: 1`), because the mock AI holds one answer at a time and the demo store is a set of JSON files. Every test signs up its own account. On 3111 and 3112 the tests play the one trusted proxy: the `x-forwarded-for` they send is the client address the app sees, and each test uses its own, so the signup limit doesn't block the suite. A browser console error fails a test.

### What is covered

| File | Features | Viewports |
|---|---|---|
| `posts.spec.ts` | Post editing; Draft / Approved / Posted labels; reply labels | desktop, mobile |
| `insights.spec.ts` | ChatGPT guide insights: add, invalid edit, edit, delete, edit after another tab deleted it; unique field ids | desktop |
| `layout.spec.ts` | Mobile navigation hint; no sideways scroll and no duplicate ids on 7 app pages | desktop, tablet, mobile |
| `review-share.spec.ts` | WhatsApp link and phone numbers; QR PNG download | desktop, tablet, mobile |
| `language.spec.ts` | English, Hindi, Hinglish: saved, sent to reply and post prompts, WhatsApp message | desktop |
| `visibility.spec.ts` | Aliases, custom questions, score and trend, possible match, AI fix list, quota refund | desktop |
| `discovery.spec.ts` | Business finder: exact, branches, similar names, no results, quota, outage, selection and saving, Settings change with confirmation, unknown Place ID, server-side replace protection, phone | desktop, mobile |
| `long-email-layout.spec.ts` | A long email never makes the page wider than a phone screen or a 390 px desktop window | desktop (opens its own phone and narrow browsers) |
| `growth.spec.ts` | Categories, checklist from Google, competitor gaps, rank history, dashboard health, Claude recommendations (cached; no Google content sent), action plans and drafts, Claude failure, unusable answers, missing data, old category names, phone layout | desktop |
| `branding.spec.ts` | GMBmirror name in titles, metadata, logo, manifest and share image; gmbmirror@gmail.com as mailto links (footer, legal pages, 404, login, Settings) and in the report PDF; no old name on any page | desktop, mobile |
| `completion.spec.ts` | 5x5 rank grid (25 points, exact request count, competitor movement, names on request, daily points across locations); removing one location (typed name, only its data deleted, last one kept); Hindi report PDF (embedded fonts, no missing glyphs); a scheduled post whose answer from Google was lost is found on Google, not posted twice | desktop, mobile |
| `places-errors.spec.ts` | Google's own error reason shown without the key; the rank grid keeps its inputs after a failed scan | desktop |
| `partial-results.spec.ts` | One provider fails; every provider fails; partial checks count toward the limit | desktop |
| `rate-limit-spoofing.spec.ts` | Forged `x-forwarded-for` cannot escape the signup or login limits, behind a proxy or with none | desktop |
| `auth.spec.ts` | Signup and login validation, email case, duplicate accounts, per-account lockout, session cookie flags, tampered cookie, logout revocation | desktop, mobile |
| `onboarding.spec.ts` | Onboarding redirect, required fields, website normalisation, business type, Place ID paste, trim, empty and invalid | desktop, mobile |
| `reviews-errors.spec.ts` | Claude failures (500, 429, refusal, cut off, unreadable), empty and over-long replies, healthcare warnings, forged review id, 30-draft limit | desktop |
| `google-connection.spec.ts` | Not connected, OAuth redirect and state cookie, callback errors (cancelled, forged state, rejected code), connected state, disconnect, not set up | desktop |

Not covered automatically: anything needing real Google, Supabase or AI keys. The real Places and Claude paths are checked by hand (see `docs/MASTER_PROJECT_STATUS.md`, 0E) (live OAuth, locations, reviews, posting, "Find on Google" search results, real AI text).

### When a test fails

- Run `npm run test:e2e:report`.
- Each failure has a screenshot and a trace in `test-results/`. Open a trace with `npx playwright show-trace <file>`.
- The test server's output is printed with a `[WebServer]` prefix.
