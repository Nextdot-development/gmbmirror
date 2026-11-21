# GMBmirror (formerly GMB Growth Engine): Master Project Status

Updated: 21 November 2026, after the Supabase and Vercel preparation (section 0N, with docs/DEPLOYMENT.md). The rename to GMBmirror is 0M. The final pre-OAuth completion is 0L. The intelligence and automation upgrade is 0K. The onboarding redesign is 0J; the stabilization pass is 0I. The Google Business Profile integration is 0H. The pre-OAuth verification is 0G. The business finder is 0F; the growth engine is 0E. The full current-state audit is `docs/COMPLETE_PROJECT_AUDIT.md`.

This file replaces the two working notes "Current Features" and "Pending Features". Every status below was checked against the code in `src/` and against the tests actually run. Nothing was implemented while writing it.

`docs/product-audit/` (the morning audit) is left unchanged. It describes the app **before** today's feature work, so read this file for the current state. See "Documentation" at the end for which parts of the audit are now out of date.

---

## How to read the statuses

| Status | Meaning |
|---|---|
| **Tested, real service** | Run against the real external service (only the Claude API so far) |
| **Tested, browser** | Clicked through in a real browser on a scratch copy of the app, with the AI provider mocked |
| **Built, compile-checked only** | Code exists, and the TypeScript check and production build pass. **Not yet clicked through in a browser.** |
| **Demo / mock only** | Works with sample data or the local file store |
| **Built, waiting on a service** | Code exists but needs an approval, a key or a service setup before it can be tested |
| **Not built** | Absent from the code |

**Automated tests in the repository** (20 November, after 0K: all passed):
- `npm run test:unit` runs **100** unit tests.
- `npm run test:e2e` runs **212** Playwright browser tests: desktop 122, mobile 86, tablet 4, none skipped.

Rows marked "Playwright" or "Tested, browser (Phase 1)" are protected by those tests. Other "Tested, browser" rows were clicked through on the date shown.
---

## 0N. Supabase storage and Vercel preparation (21 November 2026)

Full details: `docs/DEPLOYMENT.md`. **Not deployed; not production ready** until it runs on a real Supabase project and Vercel.

- **Supabase mode now stores all app data in PostgreSQL from the server** (`src/lib/db-pg.ts`, `DATABASE_URL`), replacing the earlier single `user_data` table read with the user's Supabase session. Schema: `supabase/migrations/20261121000000_gmbmirror_core.sql` (accounts, locations, location records, Google connections, user records, jobs, rate limits, migration runs; RLS on every table, no browser access to tokens, jobs or limits).
- **Jobs on Vercel:** database queue (`src/lib/jobs-pg.ts`) with `claim_next_job` (SKIP LOCKED, leases, lease tokens); `/api/jobs/run` accepts GET (Vercel Cron) and POST, `maxDuration = 300`, 240-second budget. No in-memory state.
- **Shared rate limits** in Supabase mode (`takeShared`, `peekShared`, `refundShared`, `clearShared`); demo mode keeps memory.
- **Report PDF fonts** added to the route's file trace for serverless deployment.
- **Startup check:** `DATABASE_URL` is required in Supabase mode. `SUPABASE_SERVICE_ROLE_KEY` is not used.
- **Migration script:** `scripts/migrate-to-supabase.mjs` (dry run by default, read-only source, no duplicates, per-user checked transactions, batch rollback; JSON files or the old `user_data` table).
- **"Add a Google location"** now adds the location to the list before saving its data (needed by the database's foreign keys; harmless in demo mode).
- **Tests:** `npm run test:db` (17 tests against a throwaway local PostgreSQL). Demo mode unchanged: unit and browser suites still pass.

---

## 0M. Rename to GMBmirror (21 November 2026)

The product is now **GMBmirror**; the public contact address is **gmbmirror@gmail.com**.

- **One source:** `src/lib/brand.ts` holds the name, the tagline ("AI-Powered Google Business Profile Growth Platform") and the email. Pages, titles, metadata, the share image, the manifest, legal pages and report PDFs read it.
- **Titles and metadata:** default title "GMBmirror — AI-Powered Google Business Profile Growth Platform"; every page "<page> | GMBmirror"; `application-name`, Open Graph and Twitter titles and site name; share image text; new web app manifest (`/manifest.webmanifest`, name and short name, the existing SVG icon).
- **Logo:** text wordmark "GMB" (ink) + "mirror" (brand blue) in the display face, beside the existing blue pin tile. Favicon unchanged (it has no text).
- **Contact email, always a mailto link:** footer, privacy policy and terms (new Contact sections), 404 page, login and signup pages, Settings > Account, and the last line of every report PDF. `NEXT_PUBLIC_CONTACT_EMAIL` is no longer read (it was not set anywhere). Users' own email addresses are unchanged.
- **Kept on purpose (internal, not visible to customers):** package name `gmb-growth-engine`, the project folder, the test server folder `gmb-growth-engine-e2e`, in-memory keys `__gmb*`, storage keys, cookie names, routes, environment variable names, OAuth settings and URLs. Historical documents in `docs/product-audit/` keep the old name.
- **Not available:** this app sends no email (no SMTP or email provider). Nothing claims an email was sent. PNG app icons (192 and 512 px) for full home-screen install support are not in the project; the manifest uses the SVG icon.
- **Tests:** new `branding.spec.ts` (desktop and mobile): titles and metadata, logo name, every contact link, manifest, share image, PDF footer, and no "Growth Engine" in any page's HTML.

---

## 0L. Final pre-OAuth completion (20 November 2026)

Finishes the work left open in 0K.4 and reviews the background and storage architecture before Google OAuth. The blue-and-white redesign (requested again in this milestone, section C) was completed earlier the same day; the new screens below use the same design tokens. **Not production ready:** real Google OAuth and every live Business Profile data flow are still unverified (0L.6).

### 0L.1 Features

| Feature | Status | Notes |
|---|---|---|
| 5x5 rank grid | Done | 3x3 (9 points) or 5x5 (25 points). Points run row by row from the north-west; the business is the centre. Searches run 5 at a time. Old scans read as 3x3. |
| Grid cost controls | Done | Exact cost shown before scanning: 1 + points Google Places requests (10 or 26). Daily allowance of grid points per user, **all locations together**, counted from saved scans (survives restarts): `GRID_POINTS_PER_DAY`, default 75. The hourly Places budget (60 requests a user) is charged the exact request count before the scan starts. A scan that does not fit is refused before any request. |
| Grid scan history | Done | Up to 30 scans per listing. Only scans with the same phrase, spacing **and grid size** are compared (grid, dashboard, recommendations, monthly report). |
| Competitor movement | Done | The businesses most often in the top 3 across the grid, from the same search results (no extra requests). Stored: place IDs and counts only (Google's terms). Names are read from Google only when the owner presses "Show names" (one request each, never stored). Movement against the previous scan of the same series: gained, lost, new, dropped out. |
| Remove one location | Done | Locations page, closed by default; the owner types the location name. Cancels the location's live jobs, revokes its Google access unless another location shares the same sign-in, removes it from the list (atomic) and deletes only its keys. The last location cannot be removed (use Delete my data). The first location (original key names) can be removed too (`mainRemoved` in the location list). Nothing changes on Google. |
| Hindi PDF | Done | `reportPdf()`: English-only reports keep the plain Helvetica PDF. Any other text embeds Noto Sans and Noto Sans Devanagari (SIL Open Font License, `src/assets/fonts`, licences included) and is shaped by HarfBuzz (`harfbuzzjs` 1.6.4, MIT, no dependencies). Only the glyphs used are embedded (HarfBuzz subsetter): a Hindi report is about 20 KB, not 1.7 MB. Checked by rendering: conjuncts, vowel signs before the consonant, nukta, anusvara, mixed Hindi and English lines. |
| Hindi PDF text copy | Partly | Each glyph maps to its character (ToUnicode), and every multi-glyph syllable carries its real text (ActualText) for readers that support it (Acrobat). Apple Preview ignores ActualText, so copied Hindi there shows vowel signs in drawn order (for example "िरपोटर्"), as with most Hindi PDFs. The printed text is correct everywhere. |
| Scheduled post recovery | Done | From the second attempt, before creating a post the job lists the location's posts on Google; a post with exactly this text created since the job was scheduled is recorded instead of posting again. Tested with a stand-in that keeps the post and loses the answer; without this fix the same test makes two Google posts. |
| Monthly report gaps | Done | New "Review requests" section (share actions in the app, never claimed reviews); rankings one line per series with the grid size; competitor movement line. Report list saved atomically (a scheduled and an on-request report for the same month cannot both be kept). |

### 0L.2 Background jobs: verified

- **Twice is prevented:** every change to a user's job list is now one atomic read-change-write inside the store's queue (before this pass, `update()` read and wrote separately). Claiming a job therefore cannot happen twice in one process; a running job holds a 5-minute lease; one live job per key. Tested: 10 simultaneous enqueues make 1 job; a second runner started during a run does not take the held job.
- **Retries and recovery:** back-off 5 min, 30 min, 2 h; waiting does not use attempts and gives up after 7 days; a crashed run is taken again after its lease. Scheduled publishing checks Google before reposting (0L.1).
- **Other users' data:** a job lives in its owner's job list, and handlers build their scope from that owner's id and the job's location. A job whose location is not in the owner's list (removed) is cancelled without running (tested). Location IDs are random and never reused.
- **Writes by jobs are atomic:** reply drafts from the review sweep, a scheduled post's result, the automation log and report list use atomic updates, so the owner's own change at the same moment is kept.

### 0L.3 Scheduler and environment configuration

| Deployment | Configure |
|---|---|
| One long-running server (`npm start`, a VM) | `JOBS_RUNNER=inprocess` (or empty in demo mode with `npm start`), `JOBS_INTERVAL_SECONDS=60`. Nothing else. |
| Serverless or several instances | `JOBS_RUNNER=off`, `CRON_SECRET` (16+ characters, `openssl rand -hex 24`), and a scheduler calling `POST https://<domain>/api/jobs/run` with `Authorization: Bearer <CRON_SECRET>` every minute (cron, Vercel Cron, Cloud Scheduler). **Needs Supabase mode first (0L.5):** the JSON store supports one process only. |
| Never | `JOBS_TEST_CLOCK=on` (test servers only). |

Other settings added in this pass: `GRID_POINTS_PER_DAY` (default 75). Unchanged: `AI_MONTHLY_CALL_LIMIT`, `AI_EXTRA_PROVIDERS=false`, `GBP_QPM_GUARD`.

### 0L.4 JSON storage: remaining risks before Supabase

1. **One process only.** The write queue, rate limits and job busy flag live in one Node process. Two processes on the same `.data` folder can overwrite each other's writes and both run a job. Run demo mode as a single instance.
2. **Owner actions still read then write.** 33 save calls in request handlers (business details, replies, posts, checklist, growth) read the value and save it later. Two simultaneous edits to the same record by the same owner (two tabs) can lose one. Every background-job write is atomic.
3. **Whole-file rewrites.** Every change rewrites `user_data.json` (atomically, via a temporary file and a rename). Time grows with the number of users; fine for a demo, not for many customers.
4. **Sessions and accounts** (`users.json`, `sessions.json`, `src/lib/session.ts`) still write directly without the temporary-file step (0I.2).
5. **Rate limits are in memory**: they reset on restart and are per process.
6. **`listUserIds` reads every user** on each job run; it throws in Supabase mode.

### 0L.5 Supabase migration requirements

1. Schema: `public.user_data (user_id, key, value jsonb, updated_at)` with row level security (`supabase/schema.sql`), plus a **jobs table** (one row per job with `status`, `run_at`, `lease_until`, `attempts`, `key` unique for live jobs) instead of the per-user `jobs` value.
2. **Atomic claims:** `update jobs set status='running', lease_until=now()+interval '5 min', attempts=attempts+1 where id=$1 and (status in ('queued','waiting') and run_at<=now() or status='running' and lease_until<=now()) returning *` (or `for update skip locked`). This replaces the in-process queue and busy flag.
3. **Conditional updates** for `updateKey`, `updateGoogle`, `updateLocal`, `updateLocations` (compare `updated_at`, or a SQL function per change).
4. **A server-side service client** for the job runner to list due jobs across users (`listUserIds` today), never exposed to browsers.
5. **Shared rate limits** (database table or Redis) for the Places, Business Profile and Claude budgets.
6. Session and account storage moved off the JSON files (Supabase Auth).
7. Migrate existing demo data per user and location (`main` keys and `loc:<id>:<key>` keys map directly), then run the full test suite in Supabase mode.

### 0L.6 Exact Google OAuth setup (unchanged requirements, still open)

1. Google Cloud project `the-doc-mirror-gmb-engine`: OAuth consent screen with scopes `business.manage`, `openid`, `email`; add test users while in Testing.
2. Web OAuth client with redirect URI exactly `GOOGLE_REDIRECT_URI` (today `http://localhost:3000/api/google/callback`; production `https://<domain>/api/google/callback`).
3. Enable: My Business Account Management API, My Business Business Information API, Google My Business API (v4, after access approval), Business Profile Performance API.
4. `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, then `GBP_API_APPROVED=true`.
5. Run the live checklist in 0H.3 (connect, locations, reviews, one reply, one post and edit, insights, disconnect), then a scheduled post and one approval-mode review sweep on the owner's own profile.
6. Publishing to customers needs Google's OAuth verification of the sensitive scope (final branding, privacy and terms pages).

### 0L.7 Tests (20 November)

- **Unit: 114 / 114** (14 new). New: grid points and cost, series matching, competitor leaders and movement (`grid.test.ts`); 5x5 grid makes exactly 25 searches; Hindi and mixed PDFs (embedded subset fonts, shaping order, no missing glyphs, page wrapping); ten simultaneous enqueues make one job; a second runner does not take a held job; removing a location (only its keys, first location, last one refused, other users untouched); a job for a removed location is cancelled.
- **Browser: 222 / 222**, none skipped (desktop 127, mobile 91, tablet 4). New `completion.spec.ts` (desktop and mobile): 5x5 grid with cost text, 25 cells, competitors, names on request, movement, hourly budget refusal; daily points across locations; removing a location; Hindi report PDF; scheduled post recovery after a lost answer (fails without the fix: two Google posts).
- **TypeScript** passes. **Production build** passes with no warnings.
- Changed expectations in existing tests, and why: `places-fallback.test.ts` reads `rankGrid(...).ranks` (the function now also returns competitors; the test also checks them). No assertion was removed or loosened.
- `.env` (19 Nov 13:22) and `.data` (19 Nov 15:16) unchanged.

### 0L.8 Real API versus local stand-in

| Area | Verified against |
|---|---|
| Claude | Real API in 0K (5 calls); no new Claude features in this pass |
| Google Business Profile (OAuth, reviews, replies, posts, insights) | Local stand-in only |
| Google Places (grid, names, audit, competitors) | Local stand-in in tests; the Places key itself was verified live earlier (0G). 5x5 scans have not been run against the live Places API. |
| PDF rendering | Real: rendered with macOS Quick Look and text extracted with PDFKit |

---

## 0K. Intelligence and automation upgrade (20 November 2026)

The "GBP Tool: Top 10 Features" document was not available in this conversation or the project; sections 3 to 12 of the request were used as the 10 features. `.env` and `.data` were not modified (checked after every run).

### 0K.1 Feature status

| # | Feature | Status | What exists now |
|---|---|---|---|
| 1 | Profile audit and score | **Done, tested** (Business Profile data needs live verification) | **Business Profile score:** 0–100 from the owner's own profile data (verification, status, category, hours, phone, website, description, review count, rating). Each item shows its points, why points were lost, and fix steps. Items Google does not report are left out of the total, not counted as 0. Recalculated at every profile sync; history per Google location (`gbp_scores`). The existing public-listing audit remains. |
| 2 | AI post writer and scheduler | **Done, tested** (live publishing needs OAuth) | Claude writes 3 variations (validated JSON array; single-draft fallback) using services, the call-to-action button and the last 5 posts, with the city mentioned once. Buttons: Book, Call, Learn more, Order, Buy (not for healthcare), Sign up; sent as Google's `callToAction`. Scheduling stores the moment in UTC (from the browser's time zone). Approving queues a `publish_post` job with retry, back-off, a waiting state while Google is not connected (up to 7 days past the time), duplicate protection and a log per post. Editing or deleting cancels it; a passed time is never published silently. Content calendar by month. Never marked published without Google's answer. |
| 3 | AI review replies | **Done, tested** (live publishing needs OAuth) | Generate; rewrite shorter, more detailed, more professional, more friendly, or again. Style examples from the owner's published replies. Rating-only and negative tones; Hindi and Hinglish. Contact details removed before Claude. Safety checks: risky medical wording, "already fixed" claims, repeated health details, contact data. Negative and sensitive reviews need a confirmation tick. Reply history per review. **Automation per location:** manual / approval / automatic. Automatic needs a live connection and an explicit opt-in, publishes only 5-star (or 4+) positive, non-sensitive replies with no warnings; everything else is held with reasons. One-click pause; every action logged. |
| 4 | Rank tracking and geo-grid | **Improved, tested** | Saved search phrases (Settings), per-phrase movement table (points found, average position, change since the previous scan), explicit "estimate, not Business Profile data" label. **Not done:** 5×5 or larger grids (25+ Places calls per scan) and competitor movement. |
| 5 | Multi-location | **Done, tested** | Location scopes in the store. The first location keeps the original keys (existing data read in place); others use `loc:<id>:<key>`. Switcher in the sidebar; account overview `/app/locations` (per-location health, audit, rating, scheduled posts). Add a location by hand or from the connected Google account. Every record (posts, replies, jobs, reports, logs, history, settings) belongs to one location; tested for isolation. A Google sign-in shared by locations is revoked only when the last one disconnects. Delete my data removes every location. **Not done:** removing a single location. |
| 6 | Competitors and category finder | **Improved, tested** | Existing gap analysis and "most common Google category" finder, plus a Claude explanation ("why they may be more visible", two first steps) from comparison counts only (no competitor names or Google content), saved with the comparison. Comparisons for another category or city are never shown as current. |
| 7 | Performance insights | **Done with stand-in** (live data needs OAuth) | 28 days against the previous 28; daily views; a monthly table (6 months, one extra request); a metric Google does not return is shown as "Not reported by Google", not 0. Freshness shown. Claude explanation on request (numbers only, "may" for causes). Location comparison on the overview page via each location's own data. |
| 8 | Review QR and WhatsApp | **Done, tested** | Custom message with `{name}` and `{link}` (must include the link), language default otherwise; copy link and copy message; QR download. Counted only: WhatsApp shares started, QR downloads, copies (per location and month), with a note that reviews written are not known. |
| 9 | Monthly reports | **Done, tested** | Built from stored data only. Sections: profile score, reviews and replies (review growth from daily counts), posts, rankings (estimate), competitors, Google performance, AI visibility (estimate), improvements, next month's plan, automation. Missing data is marked "Not available: reason". Claude executive summary from the facts only. History of 24 months per location; "All locations" view; built-in PDF download (Latin text; other scripts shown as "?" in the PDF only). Scheduled job on the 1st of each month; "Create this month's report now". No email is sent (not configured). |
| 10 | AI visibility and fix list | **Improved, tested** | Claude only (OpenAI and Gemini only with `AI_EXTRA_PROVIDERS=true`). A service question when services are listed. Answers labelled as estimates. Existing alias matching, custom questions, competitor mentions, excerpts, score history and fix list. |

### 0K.2 Shared infrastructure

**Claude engine (`src/lib/ai.ts`):**
- One retry for 429, 5xx, timeouts and network errors.
- Per-user monthly usage per feature: calls and tokens, in `ai_usage`, attributed to the request's user or the job's owner.
- Monthly limit: `AI_MONTHLY_CALL_LIMIT`, default 600.
- A one-hour per-user cache for repeatable texts (summaries, explanations).
- Structured output validated where it matters (post variations, growth recommendations).

**Jobs (`src/lib/jobs.ts`, `src/lib/job-handlers.ts`):**
- Each job has a persistent status, log, attempts, lease, back-off (5 min, 30 min, 2 h), a waiting state, a duplicate key, and the user and location it belongs to.
- Each pass collects due jobs from all users and runs scheduled posts first, then review sweeps, refreshes and reports, up to 60 a pass.
- Recurring work is planned on every pass:
  - the monthly report;
  - a daily Google refresh, staggered over the day;
  - review sweeps every 30 minutes while automation is on.
- **Runners:**
  - `POST /api/jobs/run` with `CRON_SECRET`;
  - an in-process timer (on by default only for `npm start` in demo mode, or with `JOBS_RUNNER=inprocess`).
- **Production:** with several instances or serverless hosting, set `JOBS_RUNNER=off` and call the endpoint every minute from a scheduler (cron, Vercel Cron or a cloud scheduler). The lease prevents double runs within one process; several processes sharing the store need a shared lock or a database row lock (Supabase).

**Store robustness:**
- Demo writes are serialised in-process, through a queue shared across Next.js bundles.
- Connection updates are atomic and tied to the sign-in they started from.
- The rate-limit counters are shared across bundles.

**Bugs found by the new tests and fixed:**
- **Lost updates:** route handlers and pages had separate copies of the store lock and rate limits, so a page render could undo a new Google sign-in.
- **Claude usage not counted** for requests.
- **Report retries** timed from the wall clock instead of the run time.
- **Post button lost after a failed save:** the form reset it while the screen still showed it.
- **Prompt wording** ("a a doctor's clinic").
- **Shared Claude cache** across users; it is now per user.

### 0K.3 Tests (20 November)

- **Unit:** 100/100. New:
  - `review-safety.test.ts` (4);
  - `profile-score-pdf.test.ts` (2);
  - `jobs-locations.test.ts` (5, against a temporary store, never the project's `.data`).
- **Browser:** 212/212, 0 skipped (desktop 122, mobile 86, tablet 4). New specs:
  - `automation.spec.ts`: scheduled publishing, review automation, the monthly report and PDF, insights, the profile score;
  - `locations.spec.ts`;
  - `intelligence.spec.ts`.
- **Updated tests:**
  - a 2-star review now needs the confirmation tick;
  - insights refresh makes 2 requests;
  - the reply prompt wording changed;
  - the ChatGPT guide test now waits for each entry (a race in the test).
- **Test servers** run jobs only through the endpoint (`JOBS_RUNNER=off`, test clock `JOBS_TEST_CLOCK=on`). Their quota guards are raised (`GBP_QPM_GUARD`, `GBP_EDITS_PER_MIN`) because hundreds of test accounts share one stand-in location.
- **Real Claude API (5 calls):**
  - a 5-star reply that did not repeat the health details;
  - a "shorter" rewrite;
  - a Hindi reply to a negative review (the phone number was removed before Claude saw it);
  - 3 post variations, parsed correctly;
  - a report summary that mentioned the missing data.
- `tsc` and `next build` pass.

### 0K.4 Still open

**OAuth-dependent (not verified live):**
- the real Business Profile reads;
- publishing replies and posts;
- automatic replies;
- scheduled publishing;
- insights and the monthly trend;
- the profile score from real data.

**Supabase-dependent:**
- the job runner's user listing (`db.listUserIds` refuses in Supabase mode);
- atomic connection updates (need a conditional SQL update);
- a cross-instance job lock;
- `users.json` / `sessions.json` atomic writes (demo).

**Not built (as of 0K):**
- 5×5 grids and competitor movement in rank tracking: **done in 0L**;
- removing a single location: **done in 0L**;
- email delivery of reports: still not built;
- Devanagari text in the PDF: **done in 0L**.

---

## 0J. Simpler onboarding, Google-first connection, and Settings that save everywhere (20 November 2026)

### 0J.1 Onboarding

- **Step 1** (`/app/onboarding`) asks only for: business type, name, city or area, and an optional website.
- **Removed from onboarding:** category, phone, other names, own visibility questions, reply language, and the Place ID / public listing finder. Category starts as the general one for the type ("Other healthcare" / "Other local business") until Google or the owner sets it.
- **Step 2** (`/app/onboarding/connect`, new) shows Google Business Profile connection, using the existing OAuth routes (`/api/google/start?from=onboarding`; the callback returns there). Depending on the connection state:
  - **Not set up on the server:** "Google connection needs setting up", no connect button, then Continue.
  - **Not connected:** "Connect Google Business Profile", or "Skip for now".
  - **Expired sign-in:** Reconnect.
  - **Live calls switched off:** says the account is connected but locations come later.
  - **Choosing a location:** cards with addresses; "Use this location and continue" saves it, reads the profile and opens the dashboard. With no locations: a clear message, "Use a different Google account" (the sign-in now shows Google's account chooser), or skip.
  - **Fallback:** "Can't connect now? Find your public Google listing instead". This is the Places finder, labelled as reading public data only, never as a connection.

### 0J.2 Details brought in from Google

On choosing a location (in onboarding, Settings, the Google page, or automatically after sign-in), the app reads the Business Information profile plus Google's rating and review count. It stores a snapshot on the Google connection (`GoogleConnection.profile`): name, address, phone, website, primary category, description, opening hours (formatted from `regularHours.periods`), open status, verification, Place ID, Maps link, rating and review count. The snapshot is refreshed when older than 6 hours, or with "Refresh from Google".

Rules (`src/lib/business-sync.ts`, unit-tested):
- An empty website or phone is filled from Google and marked as Google's.
- Google's primary category is mapped to the app's category for the type, unless the owner chose one.
- The location's Place ID becomes the business's listing; old history is labelled with the old listing.
- A value the owner typed is never replaced. Settings offers "Use Google's name / website / phone" when they differ.
- Values that came from Google follow Google.
- Switching to another location first removes values that came from the old location.
- Nothing Google did not return is invented. Missing phone, website, hours, verification or open status appear as "worth improving" notes.

### 0J.3 Settings (`/app/settings`)

1. **Business information:**
   - Editable: type, name, category, city, phone and website, each labelled "Added by you" or "From your Google Business Profile".
   - Read-only "From your Google Business Profile": address, hours, status, verification, rating, Google's own name, phone, website and category, plus "Refresh from Google".
2. **Google connection:** the shared panel (same as the Google page). Status, account, location, Connect or Reconnect (returns to Settings), Change location (redirects with "Location saved. Your details were updated from Google."), and Disconnect (returns to Settings).
3. **Public Google listing:** the finder. When a Business Profile location with a Place ID is chosen, it shows "Linked to your Business Profile location" instead, and the server refuses a different Place ID.
4. **AI preferences:** reply and post language, other names, own visibility questions, with their own form and action.
5. **Account:** signed-in email and Delete my data. The setup status list now appears only under `next dev`.

### 0J.4 Saving and consistency

- Server actions validate and save to the existing JSON store (atomic writes). No browser storage is used, and nothing changed in Supabase.
- `saveBusinessAction` changes only the fields its form sent. `saveAiPreferencesAction` changes only language, aliases and questions. The business form can no longer change the Place ID (tested with a hand-made request).
- Every save revalidates the whole `/app` layout.
- **Where changes show:**
  - The **name** appears on the dashboard, Google page (review message), AI visibility page and in Claude prompts.
  - The **city and category** feed the visibility questions, the competitor search and the dashboard.
  - The **language** is used by new drafts and the WhatsApp message.
  - **Aliases** are used in visibility matching.
- Competitor comparisons are shown only for the current category and city search (`historyFor(…, categoryQuery(b))`). Older ones stay in history.
- Changing location drops the old insights and profile snapshot, and switches reviews, posts and the listing.
- Disconnecting deletes the connection record (tokens, location, snapshot, insights). The status changes everywhere, the dashboard shows "Connect Google", and Reviews returns to labelled samples.
- The dashboard shows a "Connect Google" prompt only when connecting is possible.

### 0J.5 Tests (20 November)

- **Unit: 89 passed.** New: `business-sync.test.ts` (category mapping, fill rules, owner's values kept, Google-sourced values follow Google, switching location, gaps, hours formatting).
- **Browser: 177 passed, 0 failed, 0 skipped, first full run** (desktop 102, mobile 71, tablet 4), followed by 26/26 for the Settings and onboarding specs after a final style change.
- New specs:
  - `settings.spec.ts`: sections, name and city everywhere, separate saves, validation, category and type changes without stale comparisons, server-side category check, phone layout.
  - `gbp-onboarding.spec.ts`: new-owner journey with Google, owner's values kept, location switch without stale data, disconnect and reconnect from Settings, no-locations fallback, phone layout.
- Updated specs: `onboarding.spec.ts` (rewritten for the 2-step flow); `discovery.spec.ts` (finder now on step 2 and in Settings, saves directly); `gbp.spec.ts` (the listing follows the chosen location; "API off" checked through Refresh from Google, because the profile is cached; a different account rediscovers locations); `language` and `visibility` (the AI preferences form).
- The test fixture sets the category to "Doctor / Clinic" in its own data after onboarding, because the older specs were written for a clinic.
- `tsc` and `next build` pass. `.env` and `.data` are unchanged.

### 0J.6 Needs real Google to confirm

- Real field coverage: opening-hours formats (split days, 24 hours, special hours are not read), how Google spells primary categories (the mapping to app categories is by keywords), and rating and review count from `reviews.list` with `pageSize=1`.
- The account chooser (`prompt=select_account consent`) with several Google accounts.

---

## 0I. Stabilization pass before G1–G5 (20 November 2026)

Nothing was implemented in this pass; only this document changed. `.env` and `.data` were read for setting names and set/empty status only, and not modified.

### 0I.1 Test results

| Check | Result |
|---|---|
| Full Playwright suite, idle machine (load about 2) | **145 passed, 0 failed, 0 skipped, first run, 3.6 minutes** (desktop 86, mobile 55, tablet 4). No rerun was needed. The 13 failures of 19 November were load-related timeouts plus the two robustness bugs fixed then. |
| Server log of that run | No crashes, no "damaged data" errors, no tokens or client secrets. The only Google error lines are the ones the tests cause on purpose (permission, scope, quota, API off, outage, refused refresh, invalid client). |
| Unit tests | **82 passed**, 0 failed |
| TypeScript (`tsc --noEmit`) | Pass |
| Production build (`next build`) | Pass |

### 0I.2 The remaining half-written-file risk (`src/lib/session.ts`)

`user_data.json` is now written atomically (`src/lib/store.ts`). `src/lib/session.ts` still writes **`users.json`** (signup) and **`sessions.json`** (every login and logout) in place with `fs.writeFile`, and reads `sessions.json` on **every** signed-in request (`getUser`).

- **Risk 1, half-read file:** a request that reads while a login or logout is writing can see half a file. `readJson` then throws "Stored accounts are damaged", so that one request fails with an error page. Nothing is lost: the code deliberately refuses to treat a damaged file as empty.
- **Risk 2, lost update:** two logins or signups at the same moment both read, change and write the whole file, so one of them can be lost (a session that silently ends, or a signup that must be repeated). Atomic writes do not fix this one.
- **Scope:** demo mode only. Supabase mode does not use these files.

**Verdict:** yes, it needs a separate, small fix. Use the same temporary-file-plus-rename write in `writeJson`, which removes risk 1. Risk 2 needs a per-file write queue, or simply accepting it as a demo-mode limitation. It does not block the first real OAuth connection; it matters only if several people use a demo-mode server at once. Not changed in this pass, as instructed.

### 0I.3 Environment variables: code and `.env` compared

| Variable | Used by | `.env.example` | Real `.env` (20 Nov) |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | `env.googleConfigured()`, `authUrl`, token requests | yes | **empty**: needed |
| `GOOGLE_CLIENT_SECRET` | `env.googleConfigured()`, token requests | yes | **empty**: needed |
| `GOOGLE_REDIRECT_URI` | `redirectUri()` in `src/lib/google.ts` (sign-in URL and code exchange). If empty, `NEXT_PUBLIC_APP_URL` + `/api/google/callback`. | yes | `http://localhost:3000/api/google/callback` |
| `NEXT_PUBLIC_APP_URL` | redirects after sign-in, the callback fallback, cookie `secure` flag. Fixed at **build time** by Next.js. | yes | `http://localhost:3000` |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM token encryption; startup check needs 64 hex characters once Google keys are set | yes | valid (64 hex) |
| `SESSION_SECRET` | signs the session and the PKCE sign-in cookie | yes | set (64 characters) |
| `GBP_API_APPROVED` | `env.gbpApproved()`: live Business Profile calls on or off | yes | `false` |
| `GOOGLE_API_BASE_URL` | test servers only; ignored unless a loopback `http://` address | comment only (never set) | not present: correct |

All names match exactly between the code, `.env.example` and the real `.env`; there are no duplicate lines. One unrelated gap: `NEXT_PUBLIC_CONTACT_EMAIL` is read by the code but is not in `.env.example`. The startup check also requires `TRUSTED_PROXY_HOPS` for production builds; it is not needed for `npm run dev`.

### 0I.4 Callback URL and Google APIs, from the code

- **Callback route:** `src/app/api/google/callback/route.ts` → path **`/api/google/callback`**. The URL sent to Google is exactly `GOOGLE_REDIRECT_URI`, which today is **`http://localhost:3000/api/google/callback`**. It must be registered character for character (scheme, host, port, no trailing slash).
- Open the app at **`http://localhost:3000`**, not `127.0.0.1:3000`. The state, PKCE and session cookies belong to the host that started the sign-in, and the callback redirects to `NEXT_PUBLIC_APP_URL`.
- **Start route:** `/api/google/start`. It needs a logged-in user, otherwise it goes to `/login`.
- **Scopes requested:** `https://www.googleapis.com/auth/business.manage`, `openid`, `email`, with `access_type=offline`, `prompt=consent` and PKCE S256.
- **Google endpoints the code calls:**

| Host | Use | Enable in Cloud Console |
|---|---|---|
| `accounts.google.com`, `oauth2.googleapis.com` | sign-in, tokens, revoke | nothing to enable |
| `mybusinessaccountmanagement.googleapis.com` | accounts | **My Business Account Management API** |
| `mybusinessbusinessinformation.googleapis.com` | locations and profile | **My Business Business Information API** |
| `mybusiness.googleapis.com` (v4) | reviews, replies, posts | **Google My Business API** (shown only after access approval) |
| `businessprofileperformance.googleapis.com` | insights | **Business Profile Performance API** |
| `places.googleapis.com`, `maps.googleapis.com` | business finder, audit, competitors, rank grid (API key, not OAuth) | Places API (New), already working |

Google's basic-setup page lists seven Business Profile APIs, including Lodging, Place Actions, Notifications and Verifications. This app does not call those four, so enabling them is optional. The Performance API is not on that list but is called by the insights feature. If it is not enabled, only the insights card shows "This Google feature is not available right now" (tested).

---

## 0H. Google Business Profile integration (19 November 2026)

Google approved the Business Profile API project (`the-doc-mirror-gmb-engine`, project number 991258388802, 300 QPM). The final Web OAuth client is not created yet (logo and branding pending). The whole integration is built so that **only configuration and a live check remain**. Nothing in this section has run against real Google yet: every Business Profile call was tested against a local stand-in.

### 0H.1 What exists now

| Capability | How it works | Files |
|---|---|---|
| OAuth start and callback | State cookie plus **PKCE (S256)**; the verifier cookie is signed and names the user who started the sign-in. `access_type=offline`, `prompt=consent`. A grant without `business.manage` is refused and revoked. Signing in again with the same Google account keeps the chosen location; a different account starts fresh. | `src/app/api/google/start/route.ts`, `src/app/api/google/callback/route.ts`, `src/lib/google.ts` |
| Token storage and refresh | AES-256-GCM, as before. Refreshed a minute before expiry; a new refresh token from Google replaces the old one. `invalid_grant`, an unreadable token or a missing refresh token marks the connection **Reconnect needed** (no repeated failing calls). | `src/lib/google.ts`, `src/lib/gbp.ts` |
| Account discovery | Account Management v1 `accounts.list`, 20 per page, every page. | `src/lib/gbp-api.ts` |
| Location discovery, multiple locations | Business Information v1 `accounts.locations.list`, `readMask=name,title,storefrontAddress,metadata`, 100 per page, every page, every account; a location shared by two accounts appears once. | `src/lib/gbp-api.ts` |
| Location selection | Chosen automatically when there is one location, or exactly one with the Place ID chosen in Settings (G1). Otherwise the owner picks from cards with addresses ("Same listing as in Settings" badge). The server accepts only a location Google lists for the account. A mismatch with the Settings listing is pointed out. | `src/lib/gbp-state.ts`, `src/app/actions.ts`, `src/components/forms.tsx` |
| Business profile | Business Information v1 `locations.get` (title, address, phone, website, category, hours, description, open status, verification via `metadata.hasVoiceOfMerchant`, Maps link). Gaps shown in plain words. Read live, not stored. | `src/components/BusinessProfile.tsx` |
| Reviews with pagination | v4 `reviews.list`, 50 per page, newest first, Google's average rating and total. Waiting for reply / Replied / All filters; "Older reviews" and "Back to newest". Existing replies shown with Google's moderation state (Pending, Rejected). | `src/app/app/reviews/page.tsx` |
| Reply workflow | Draft with Claude (existing integration, unchanged) → Save → **Approve this exact text** → **Publish reply to Google** (v4 `PUT …/reply`). Editing after approval removes the Publish button until approved again; the server also refuses text that differs from the approved text. Existing replies can be edited and republished. 4096-byte limit checked before calling Google. Review ids are read from Google and must belong to the selected location. | `src/app/actions.ts`, `src/components/forms.tsx`, `src/lib/gbp.ts` |
| Posts: Update, Event, Offer | v4 `localPosts.create` with Event schedule and Offer details (Offer hidden for healthcare, as before). After publishing: Google's resource name, state (Live, Processing, Rejected) and "View on Google" link. **Published posts can be edited**: the change needs approval, then "Publish changes to Google" sends `localPosts.patch` with `updateMask` (summary, plus event/offer when present). A post published to another location is not updated. | `src/app/actions.ts`, `src/app/app/posts/page.tsx` |
| Performance insights | Performance API v1 `fetchMultiDailyMetricsTimeSeries`: search views, maps views, calls, website clicks, direction requests, message clicks, bookings (deprecated metrics not used). Last 28 days up to yesterday against the 28 before, one request; missing values count as 0 (Google omits zeros). Kept on the connection, refreshed at most every 12 hours on page view, or by "Update from Google". | `src/lib/gbp-api.ts`, `src/components/BusinessProfile.tsx` |
| Last successful sync, errors | Per area (locations, profile, reviews, replies, posts, insights) the last success time and the last problem are stored and shown. | `src/lib/gbp.ts`, `src/app/app/google/page.tsx` |
| Quota and error handling | All calls share a guard of 250 a minute (project quota 300). Replies and posts: 10 a minute per location (Google's edit limit). Reads retried once after a short wait on 429/5xx; writes never retried, so nothing is sent twice. Google errors classified as reconnect, scope, permission, not enabled, quota, not found, invalid, unavailable, network, each with a plain message. Setup details are logged on the server (no tokens), never shown to owners. | `src/lib/gbp-api.ts`, `src/lib/ratelimit.ts` |
| Disconnect | Revokes at Google, deletes the tokens and cached insights (unchanged behaviour, now tested against the stand-in). | `src/app/actions.ts` |
| Statuses for owners | Coming soon (no OAuth client), Not connected, Reconnect needed, Connected but not switched on (`GBP_API_APPROVED` not true), Choose a location, Connected. No server configuration is shown to customers; a developer note appears only under `next dev`. Dashboard badge follows the same status. Demo mode and labelled sample reviews are unchanged when not live. | `src/lib/gbp-state.ts`, pages |

Two robustness fixes found by the browser tests on a heavily loaded machine:
- **Demo store writes are now atomic** (temporary file, then rename; `src/lib/store.ts`). Before, a request reading while another wrote could see half a file and fail with "Stored data is damaged". Same file, same format. `users.json` (`src/lib/session.ts`) is still written in place: same risk, not changed here.
- **No lost updates to the Google connection.** Background saves (refreshed token, sync time, last error, insights, automatic location) apply only if the stored connection is still the same sign-in (`connectedAt`). Before, a slow page render could write the previous Google account's connection back over a new sign-in. The demo store has no transactions, so a very small read-then-write window remains; Supabase mode would need the same guard as a conditional update.

Storage: still the same JSON `user_data` keys. Only optional fields were added (`GoogleConnection`: location address and Place ID, scopes, `needsReconnect`, `lastSync`, `lastError`, `insights`; `PostDraft`: Google name, state, link, published time and location; `Review`/`ReplyDraft`: reply text, moderation state, posted time). Older data reads unchanged. No Supabase change. Google Places and Claude code unchanged.

Endpoints and fields were checked against Google's reference pages on 19 November 2026 (accounts.list, accounts.locations.list, Location, reviews.list/updateReply/deleteReply, localPosts create/list/patch/delete, fetchMultiDailyMetricsTimeSeries, DailyMetric, TimeSeries, limits, basic setup). Not stated by Google and therefore **unverified**: which LocalPost fields `patch` accepts after publishing, whether replies and posts count against the 10-edits-a-minute limit, and whether the Performance API must be enabled separately.

### 0H.2 Tests

- Unit `tests/unit/gbp.test.ts` (16): base-URL guard, error classification, account and location paging and de-duplication, profile read mask, review paging and mapping, reply byte limit, post bodies and update masks, insights periods and zero handling, read retry vs no write retry, PKCE, code exchange and scope refusal, token refresh and `invalid_grant`, connection statuses, automatic location choice.
- Browser `tests/e2e/gbp.spec.ts` (15, desktop and phone): discovery across accounts and pages; choosing a location; automatic choice and mismatch; reviews totals, filters and paging; reply workflow (approve, re-approve after edit, exact text published); editing an existing reply (Pending state); forged review id refused; posts (publish, Google state, edit published post with PATCH and mask, event schedule); insights; token expiry and refresh; refresh refused → reconnect → restored; permission, quota, API off, outage and scope errors; missing scope; PKCE cookie required; different Google account; disconnect; no sideways scroll.
- `google-connection.spec.ts` updated for the new wording, plus PKCE parameters and the "Coming soon" state with no server settings shown.
- **Results (19 November):** unit 82/82; `tsc` and `next build` pass. Browser: the full run (145 tests) took 1.5 hours instead of minutes because macOS indexing kept the machine at load 11 to 19; 132 passed and 13 timed out or failed. Of the 13, one was a real change (reply limit now 4096 bytes; test updated) and two runs exposed the two robustness bugs above (fixed). After the fixes, all 13 passed on rerun, and the final run of the Google-related specs (`gbp`, `google-connection`, `reviews-errors`, `posts`, desktop and phone, 43 tests) passed 43/43. A single clean full run after the last fix was not completed; run `npm run test:e2e` on an idle machine to confirm.
- The stand-in runs on a fifth test server (port 3115, `GBP_API_APPROVED=true`), reached through `GOOGLE_API_BASE_URL`, which the app honours **only for a loopback http address**. It is never set in real use.

### 0H.3 Final status, separated

**Implemented and tested locally (stand-in, not Google):** everything in 0H.1.

**Ready for OAuth credentials:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are the only missing values (checked 20 November, see 0I.3). `GOOGLE_REDIRECT_URI` is already set to `http://localhost:3000/api/google/callback`, and `TOKEN_ENCRYPTION_KEY` and `SESSION_SECRET` are valid. Nothing is hard-coded.

**Requires real Google account authorization:** connecting with the owner's Google account on the consent screen; a refresh token being issued; the account's real accounts and locations.

**Requires live API verification (G6 checklist):**
1. Connect; check the finder's listing is pre-selected.
2. Locations, profile fields and verification flag look right.
3. Reviews load, page 2 loads, rating and total match Google.
4. Publish one reply to your own review, check it on Google, then edit it.
5. Publish one Update post; check its state and link; edit it and confirm the PATCH is accepted (field list is not documented).
6. One Event post.
7. Insights: compare with the Performance tab in Business Profile; note how many days of delay Google has.
8. Disconnect; confirm the app is gone at myaccount.google.com/permissions.

**Requires Google configuration or approval:**
- Create the Web OAuth client after the logo is final; redirect URI must equal `GOOGLE_REDIRECT_URI` (production: `https://<domain>/api/google/callback`).
- OAuth consent screen with the `business.manage` scope; while in Testing, add test users (refresh tokens then expire after about 7 days → owners see "Reconnect needed"). Publishing the app for customers needs Google's OAuth verification (sensitive scope), which needs the final branding, privacy and terms pages.
- Enable in Cloud Console the four APIs the code calls (0I.4): My Business Account Management, My Business Business Information, Google My Business API (v4), and Business Profile Performance API.
- Set `GBP_API_APPROVED=true` in the real `.env` (not changed by this work). Until then connected owners see "Connected, not switched on yet".
- Quota is per process in memory; with several server instances, share the limiter (see ratelimit.ts note).

---

## 0G. Pre-OAuth verification, and Google Business Profile readiness (19 November 2026)

### 0G.1 Verification results

| Check | Result | Evidence |
|---|---|---|
| Onboarding, from signup to dashboard | Works | Signup, then the onboarding form (type, name, website, city, the business finder, category, language and more), then the dashboard. Covered by `auth`, `onboarding`, `discovery` and `growth` specs. |
| The listing stays linked after refresh, logout and login, editing details, and reopening Settings | **Yes** | New browser test: the Place ID and the Settings card are unchanged after each step; editing the city and category keeps the listing; the review link uses it. |
| Changing the listing keeps old history **without** attributing it to the new listing | **Was not true; fixed** | Before: audit, rank-grid and competitor history had no link to a listing, so after a change the old listing's audits appeared as the new one's trend, and "score rose from X to Y" compared two businesses. Now each entry records its Place ID; when the listing changes, older untagged entries are labelled with the old listing; every view (Google page, dashboard, recommendations, "vs previous audit") uses only the current listing's history; the Google page says how much earlier history is kept. Switching back shows that listing's history again. The daily scan limit still counts all scans (cost). Files: `src/lib/listing-history.ts` (new), `src/app/actions.ts`, `src/lib/growth-server.ts`, `src/app/app/google/page.tsx`, `src/lib/types.ts`. Unit test `listing-history.test.ts` (3) and a browser test (hospital audit and scan, then salon: empty history plus a "kept" note; salon audit not compared with the hospital's 100; back to the hospital: only its own audit and scan). |
| The about 20 px horizontal overflow at about 390 px | **Reproduced; the cause was not what was reported; fixed** | The phone-layout "Log out (email)" button did not wrap, so long emails pushed the page wider. It affected **real phones too** (150 px past a 390 px screen with a long email). The test helper had hidden it, because Chrome widens a phone's layout to fit content (the page zooms out). Fix: the button keeps to the screen width and shortens the email with "…" (`src/app/app/layout.tsx`). The `sideways()` test helper now compares with the screen width, and a new test (`long-email-layout.spec.ts`) checks a long email on a phone and in a 390 px desktop window. The rest of the phone layout is unchanged. |
| Business finder for healthcare and ordinary local businesses | Works | Browser tests: hospital (exact match) and salon (Local business, Salon category). **Live with real Google:** "Lakme Salon", Pune, Maharashtra (5 branches with full addresses, Beauty Salon; one chosen, saved, shown in Settings), in addition to Apollo (hospital) and Domino's (restaurant) checked in 0F. Chains often name branches differently, so a hint, "Several listings match your search. Check the address…", now appears whenever two or more results match. No key in any response or log. |
| Unit, browser, `tsc`, build | **66 unit and 115 browser tests passed** (desktop 71, mobile 40, tablet 4), 0 failed, 0 skipped; `tsc` and build pass | |
| Real `.env` and `.data` | `.env` unchanged. `.data` changed **through the development server on port 3000, not the tests**: the account created at 14:40 linked a Google listing at 15:16. No test email; tests never use that port. | |

### 0G.2 Google Business Profile readiness (review only; nothing integrated yet)

**Already built and tested with stand-ins:**
- OAuth start with a state cookie, `access_type=offline`, `prompt=consent`, and the scopes `business.manage`, `openid` and `email`.
- The callback, with denied, forged-state and rejected-code handling.
- Token encryption (AES-256-GCM).
- Refresh.
- Revocation on disconnect and on "Delete my data".
- The location picker, which accepts only locations Google lists for the account.
- Live reviews (v4, 50 per page), posting replies (v4 `PUT …/reply`) and publishing posts (v4 `localPosts`, with Event and Offer details).
- The `GBP_API_APPROVED` switch, with sample reviews until it is on.

**What you need to set up in Google Cloud** (confirm each against Google's current documentation when you do it):
1. **OAuth consent screen:** app name, support email, privacy policy URL (`/privacy`), terms URL (`/terms`), authorised domain, and the scope `https://www.googleapis.com/auth/business.manage`. While the app is in "Testing", add yourself as a test user. Refresh tokens for Testing apps expire after about 7 days, so expect to reconnect weekly until the app is published and verified.
2. **OAuth client** (Web application): the redirect URI must equal `GOOGLE_REDIRECT_URI`. Locally that is `http://localhost:3000/api/google/callback`; in production, `https://<your-domain>/api/google/callback`.
3. **APIs to enable:** My Business Account Management API, My Business Business Information API, and Google My Business API (v4, used for reviews, replies and posts). Business Profile Performance API only if insights are built later.
4. **Basic API Access:** submit Google's Business Profile API access request. Until it is approved the quota is 0, and calls fail with 429 or 403; the app then shows sample data.
5. **`.env`:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (both empty now), `GOOGLE_REDIRECT_URI` (set), `TOKEN_ENCRYPTION_KEY` (set). After approval, `GBP_API_APPROVED=true`.

**Code changes recommended for the integration phase** (G1 to G5 are now done, see 0H; G6 is the live checklist in 0H.3):

| # | Change | Why |
|---|---|---|
| G1 | Read each location's `metadata.placeId` (add `metadata` to the Business Information `readMask`) and **pre-select the location that matches the listing chosen with the business finder**. Warn if the owner picks a location with a different Place ID. | Links the finder's listing to the Business Profile location, so reviews and posts go to the right business. |
| G2 | Clear Google error messages: parse the API's `status` and `reason`, as `PlacesError` does, instead of "Google blocked this request" for every 403 or 429. Tell these apart: not approved (quota 0), insufficient scope, not an owner or manager of the location, and quota exhausted. | Owners and you need the real reason. |
| G3 | Handle `invalid_grant` on refresh (revoked, password changed, or the 7-day Testing expiry). Mark the connection as needing reconnection and show a Reconnect button, instead of failing each page. | This is a common cause of failures in Testing mode. |
| G4 | Paging for accounts, locations (`nextPageToken`, more than 100) and reviews (more than 50). | Multi-branch owners and busy clinics. |
| G5 | Build a Google stand-in in the test server (token endpoint plus the three APIs, behind test-only base-URL settings, as was done for Places) and test connect, choose location, reviews, reply, post, refresh, revoke and errors end to end before approval. | Proves the whole flow without waiting for Google. |
| G6 | After approval: a live checklist with your own profile. Connect; check that the listing chosen in the finder is pre-selected; load reviews; post one reply and delete it; publish one Update post and delete it; disconnect and confirm access is removed in your Google account. | Before inviting customers. |

## 0F. Business finder: no more manual Place IDs (19 November 2026)

Owners find their business on Google by name and city (and an optional state) and choose it from cards. Typing a Place ID is now a small "Enter Place ID manually" link for edge cases. Only the Place ID is stored, as before.

### 0F.1 What was built

| Part | Behaviour | Files |
|---|---|---|
| Search | Places API (New) Text Search from the server: name + city + state, up to 5 results. Field mask: `id`, `displayName`, `formattedAddress`, `primaryType`, `primaryTypeDisplayName`. The older-API fallback stays. Same key, same integration, same rate limit (60 Places calls per hour per user). | `findPlaces` in `src/lib/places.ts`, `searchPlacesAction` |
| Results | Cards with name, full address, category and a Select button; **nothing is selected automatically**. Labels: "Same name", "Similar name" or "Different name". Same-name results come first, in Google's order. Branches with the same name are flagged "check the address". When no result has the name (real Google then suggests loosely related places), a plain warning is shown above them. "Google Maps" credit under the results. | `src/lib/discovery.ts`, `src/components/BusinessFinder.tsx` |
| Errors | Missing name or city; no results (with suggestions and the manual link); quota; Google outage; key problems. Each shows Google's reason without the key. | `searchPlacesAction` |
| Onboarding | The finder sits in the business form after the city. The chosen listing is shown as confirmation (name, address, category) and saved with the form. Google's name is offered ("Use … as the business name"), never applied by itself. Wording: "This lets the app read your public Google listing. It does not verify or connect your Google Business Profile." | `src/components/forms.tsx` |
| Settings | Its own "Your business on Google" section shows the saved listing, fetched fresh by Place ID, with no new search forced. "Change listing" uses the same search and saves straight away, **after a "Replace your Google listing?" confirmation**. The business details, earlier audits, scans and recommendations are kept. The business form there no longer sends the Place ID, so saving other details never erases it. | `src/app/app/settings/page.tsx`, `savePlaceIdAction` |
| Manual entry | Behind a link. A typed ID is checked with Google before use. "Google has no listing with this Place ID" cannot be overridden. "Save without checking" is offered only when Google could not be reached (key, quota or network). | `lookupPlaceAction`, `savePlaceIdAction`, `isNotFound` |
| Server protection | Replacing a saved Place ID needs `confirmReplace=yes` in the business form, or `replace` in the Settings action, so a hand-made request cannot swap it silently. | `saveBusinessAction`, `savePlaceIdAction` |

The selected Place ID is the one the profile audit, competitor intelligence, rank grid, checklist and growth engine already read. Nothing else changed in them.

### 0F.2 Tested

| Test | Result |
|---|---|
| Unit | **63 passed** (5 new in `discovery.test.ts`): name matching (case, punctuation, "&", Google's " \| …" suffix), ordering and branch flags, search request (query with state, field mask, 5 results), fresh lookup, and "not found" told apart from key, quota and network errors |
| Browser | **108 passed, 0 failed** (desktop 67, mobile 37, tablet 4). New `discovery.spec.ts` (8 tests, desktop and mobile): exact match, then select, save, and use in the audit; branches and similar names; Google's name only on request; only loosely related results (warning), no results, quota, outage, missing name or city; saved listing shown in Settings; change with Cancel then Replace, history kept, form save keeps the listing; unknown Place ID refused with no override; the server refuses a replacement without confirmation; phone layout. Existing tests that typed IDs now use Settings like an owner. |
| `tsc`, build | Pass |
| **Live, real Google** (isolated copy, real key) | "Indraprastha Apollo Hospitals", New Delhi, Delhi: 1 result marked "Same name"; nothing selected before Select; saved; Settings shows it fresh; profile audit on it 100/100. "Domino's Pizza", Pune: 5 branches, each with its own address and the branch flag; replaced with confirmation. A nonsense name: Google returned 5 unrelated places, all "Different name", with the warning shown. A typed Place ID was checked and showed whose listing it is. About 12 Places requests; no key in any browser response or the server log. |

### 0F.3 Limits and notes

- **State is used for the search only.** It is not saved; adding a saved state field would change the business data.
- **Similar names are labelled, not hidden.** The matcher is word-based ("Apollo Hospital" vs "Indraprastha Apollo Hospitals" is "Similar name"). The owner always decides.
- **Narrow desktop windows (found while testing; it existed before this change).** In a *desktop* browser narrowed to about 390 px, every app page scrolls sideways by about 20 px, because of the phone navigation strip. Real phone emulation and 600 px and wider are fine. Not fixed here.
- **A new account in the real `.data`.** It was created at 14:40 IST on the development server (port 3000). It does not have a test email, and no test used that port, so it appears to be a manual signup. Left untouched.

## 0E. Milestone: AI Business Growth Intelligence Engine V1 (19 November 2026)

All three phases are built, tested with stand-ins in the browser suite, and checked live with the real Claude and Google Places keys. GBP approval and Supabase were not needed, and the JSON storage design is unchanged: one new storage key, `growth`, and optional new fields in `places`.

### 0E.1 What was built

| Feature | What it does | Main files |
|---|---|---|
| **Categories** (Phase A) | 20 categories, including Hospital, Multi-speciality Hospital, General Hospital, Eye Hospital, Dental Clinic, Dermatology Clinic, Diagnostic Centre, Physiotherapy Centre and Pharmacy, plus local business types. Each has its own question wording, competitor search phrase, description and the Google place types that fit it. Old saved names (for example "Doctor or clinic") are read through a map; saved data is not rewritten. | `src/lib/business.ts`, `src/components/forms.tsx` |
| **Profile checklist from Google** (Phase A) | The profile audit now gives a verdict on 5 checklist items: hours, photos, website, phone (checked against the phone in Settings) and primary category (checked against the chosen category). Each row shows the owner's tick, Google's answer, the date, and a note after 30 days. Google's answer **never** replaces the owner's tick; when they differ, a "Use Google's answer" button lets the owner choose. Items Google cannot report stay "Not confirmed", never "Missing". | `src/lib/checklist.ts`, `src/lib/places.ts` (`auditVerdicts`), `src/app/app/google/page.tsx` |
| **Competitor intelligence** (Phase A) | The top-10 comparison now also fetches website, phone and hours (the same Google price tier as rating). It shows where others are ahead, where you are stronger, the measures that could not be compared, the recommended actions, and the most common category. Every sentence counts real results; a measure is compared only where Google returned it for both sides. The top-10 table remains, with Website and Phone columns. | `src/lib/competition.ts`, `src/components/Places.tsx` |
| **Recommendation engine** (Phase B) | Deterministic rules turn stored data into ranked issues: 23 issue types, each with priority, difficulty, steps, benefit and **evidence from the data**. Claude, given only derived facts, chooses and rewrites the top 3. Its answer is schema-checked; only known issue IDs are accepted; evidence and links always come from the data; promises of results, and healthcare wording in steps, fall back to the rules text. If Claude fails, the rules are shown. | `src/lib/growth.ts`, `src/lib/ai.ts` (`aiGrowthRecommendations`) |
| **Caching** (Phase B) | Recommendations are saved with a fingerprint of the input data. Claude is asked only when the fingerprint changes, at least one real measurement exists, and the limit of 12 per user per hour allows. The dashboard first renders with the rules, then updates; a failed attempt is saved so it is not repeated on every visit. "Ask Claude again" is available. | `refreshGrowthAction`, `src/components/GrowthRefresh.tsx` |
| **Dashboard** (Phase B) | Business health (weighted, only from measures that exist, "Based on N of 4 measures"); top 3 actions with priority, difficulty, evidence and benefit; competitor insights (counts); profile-score trend; AI-visibility trend; recent changes. The old fixed rules (`src/lib/recommend.ts`) were removed. | `src/app/app/page.tsx` |
| **Action plans** (Phase B) | `/app/actions/[id]`: problem, evidence, solution, steps, completion status, and (for 5 kinds) Claude-drafted content to review and copy: description, photo shot list, review request, website text, FAQ. Healthcare drafts are checked for risky wording. Nothing is published. "Mark as done" hides the issue until a newer measurement still shows it, then it reopens with a note. For owner-only checklist items, marking done also ticks the checklist. | `src/app/app/actions/[id]/page.tsx`, `src/components/ActionDraft.tsx` |
| **History** (Phase C) | Profile audits keep our points per item and our verdicts, so the Google page shows a date-wise score chart and per-item changes since the last audit. The rank grid compares the latest scan with the previous scan of the same phrase and spacing (top-3 points, points found, average position, and an arrow on each cell). Competitor snapshots keep counts only. Visibility history reuses the existing checks. Old data without these fields still reads; empty states say what to run. | `src/app/app/google/page.tsx`, `src/components/Places.tsx`, `src/components/bits.tsx` (`TrendBars`) |

**Google data rule.** Stored data and the Claude request contain only this app's own scores, points, verdicts, counts, our own search phrase and dates. They never contain Google's ratings, review counts, names, types, websites or Place IDs. Google values are shown only when freshly fetched. This is our reading of Google Maps Platform terms (only Place IDs may be kept; content is fetched fresh), and **it needs confirming against the current terms**. A unit test and a browser test check that the Claude request contains no Google content.

### 0E.2 Tested

| Test | Result |
|---|---|
| Unit | **58 passed, 0 failed**. 19 new: categories and old names, checklist verdicts and conflicts, gap analysis with missing data, health score, evidence, done and reopened, fingerprint, Claude-answer validation, cautions vs promises, no Google content sent to Claude, audit verdicts and competitor analysis from request-shaped data |
| Browser | **92 passed, 0 failed, 0 skipped** (desktop 59, mobile 29, tablet 4). New `growth.spec.ts` (6 tests): new account (no Claude call), hospital end to end with Claude, salon (owner-vs-Google conflict, gaps, unusable Claude answer, improved data and history), missing Google data with Claude failing, an old category name, and phone layout. Places comes from a stand-in in the test server only (`GOOGLE_PLACES_BASE_URL`); production calls Google directly. |
| `tsc`, build | Pass; new route `/app/actions/[id]` |
| **Live: Google Places (New)** | 2 businesses through the real UI on an isolated copy: Indraprastha Apollo (Multi-speciality Hospital, New Delhi) and a Delhi restaurant. Find on Google, audit (100 and 90 / 100), competitors ("multi-speciality hospitals in New Delhi", "restaurants in Delhi"), rank grid. About 30 Places requests per run, 2 runs. |
| **Live: Claude** | Dashboard recommendations for both businesses, about 8–9 s per call. 2 action-plan drafts (business descriptions with placeholders for unknown facts; no healthcare warnings). Plus 6 direct calls to measure validation: **18 of 18 items kept Claude's wording**. |
| Keys | No key in any browser response or server log in the live runs |
| Real `.env` and `.data` | Unchanged by any test |

**Fixed during testing:**
- At first the validation rejected Claude's honest cautions, such as "Avoid claims such as guaranteed results". It is now negation-aware, and the healthcare check covers the title and steps.
- "Mark as done" saved the standard title instead of the one shown.
- A login race in two auth tests (they now wait for the exact onboarding page).

### 0E.3 Limits

- **Claude adds latency.** The first dashboard visit after the data changes shows the standard recommendations for about 8–10 s, then Claude's.
- **The health score is our own composite.** It is not a Google metric.
- **The checklist only reports what Google returns.** Holiday hours, how recent photos are, description, services, secondary categories, booking link and review replies remain owner-confirmed.
- **Competitor photo counts top out at 10.** Google returns at most 10 photos per place.
- **Rank-grid comparisons** need a second scan with the same phrase and spacing.
- **History starts now.** Older audits have no per-item points, so per-item changes appear from the second audit after this update.
- **Places stand-in in tests.** The browser tests use a Places stand-in. The live checks were run by hand and are not part of the automated suite, because they cost money and need the real key.

## 0D. Bug-fix pass (19 November 2026)

Every open bug that can be fixed without Google approval, a Supabase project or a hosting decision was fixed and tested. Findings refer to section 0C.

| # | Bug | Fix | Files | Proof |
|---|---|---|---|---|
| 1 | Rank grid: after a scan, "Grid spacing" showed 3 km whatever was used, and the search phrase was wiped after an error. React 19 resets forms after an action, even controlled selects. | The chosen values are kept and put back after each submit, the same pattern the post composer uses. | `src/components/Places.tsx` | Browser test `places-errors.spec.ts`; it failed before the fix |
| 2 | **A3 account lockout:** anyone could lock any account for 15 minutes, including the owner's correct password. | Only failures count. 5 failures per account from one client (an address, or a browser that has logged in before). 20 per account per hour from anywhere, which unrecognised browsers wait for. A signed, httpOnly "recognised browser" cookie (`ge_device`, 180 days, holds only a keyed tag of the email). The per-address limit of 20 attempts per 15 minutes is unchanged. | `src/app/actions.ts`, `src/lib/device.ts` (new), `src/lib/ratelimit.ts` | 4 browser tests (attacker blocked at their address, owner elsewhere logs in, spread attack blocks new browsers but not the owner's, recognised browser still limited, successes never counted); unit test |
| 3 | **A13:** login timing revealed whether an email had an account (demo mode). | Unknown emails run one dummy password check. | `src/lib/session.ts` | Measured 8 times each: median 70 ms (real email) vs 74 ms (unknown) |
| 4 | **A14:** Supabase signup showed Supabase's own error text. | Supabase error codes become plain messages; unknown codes get a generic one. | `src/lib/session.ts` | Unit test; Supabase stand-in: duplicate signup shows "An account with this email already exists. Log in instead." |
| 5 | **A6:** Supabase login cookies were readable by JavaScript, had no Secure flag and lasted 400 days. | httpOnly, SameSite=Lax, Secure on https, at most 30 days (renewed whenever the session refreshes); deletions untouched. | `src/lib/supabase-cookies.ts` (new), `src/lib/session.ts`, `src/proxy.ts` | Unit test; Supabase stand-in in a browser: all 4 auth cookies httpOnly and 30 days, none readable by JavaScript, all cleared on logout, login again works |
| 6 | **N11:** the warnings on a saved post were worked out from the post text only, but saved from text plus event title. | The page uses the same text as saving. | `src/app/app/posts/page.tsx` | Code and type check |
| 7 | `supabase/schema.sql` failed when run a second time. | Policies are dropped if present, then created; the update policy also has an explicit `with check`. | `supabase/schema.sql` | Local PostgreSQL: ran 3 times in a row without errors; all 12 row-level-security checks pass on a fresh database |
| 8 | **A11:** disconnecting Google or "Delete my data" never revoked access at Google. | Google's revoke endpoint is called first (best effort); tokens are deleted either way. The Google page says whether Google confirmed, with a link to Google's permissions page if not. | `src/lib/google.ts`, `src/app/actions.ts`, `src/app/app/google/page.tsx` | Unit test (request and outcomes); browser test of the "not confirmed" message. **A real revocation needs a real Google connection (waiting on approval).** |
| 9 | Build warning about a `package-lock.json` in the home folder. Dead code: `recommendCopy()` and the `.skeleton` style. | `turbopack.root` set to the project folder; dead code removed after confirming nothing used it. | `next.config.ts`, `src/lib/ai.ts`, `src/app/globals.css` | Build has no warning |

**Configuration change:** `SESSION_SECRET` (32+ characters) is now required in **both** modes, because it also signs the recognised-browser cookie. Your local `.env` already has one, and the README already says to set a fresh one for production.

**Results:**

| Check | Result |
|---|---|
| `npm run test:unit` | 39 passed, 0 failed |
| `npm run test:e2e` | **86 passed**, 0 failed, 0 skipped |
| `npx tsc --noEmit`, `npm run build` | Pass, no warnings |
| Supabase mode (local stand-in, browser) | Signup, cookies, logout, login and duplicate message as above, no console errors |
| Real `.env` and `.data` | Not modified by any test (see the final check in the session report) |

**Still not fixable from here**, because each needs something outside the code:
- ~~Places API (New) refused by Google~~ **Resolved 19 Nov:** the original key now works with Places API (New), checked live (see 0E). The older-API fallback stays in place as a safety net.
- Live Google Business Profile: needs Google's approval.
- Real Supabase: needs a project.
- `TRUSTED_PROXY_HOPS` and the rate-limit store: need the hosting decision.
- Password reset, email or password change and full account deletion: need Supabase with SMTP.
- The privacy policy: needs owner facts and legal review.
- CSP nonce: planned for 2B-4.
- Editing an event or offer's details after saving: a feature, not a bug.

## 0C. Phase 2B: production security and deployment readiness audit (18 November 2026)

**Audit only. No application code, `.env` or `.data` was changed.**

Every finding was checked in the repository and in the installed packages:
- `next` 16.4.6;
- `@supabase/ssr` 0.12.7;
- `@supabase/supabase-js` 2.119.0.

`npm audit` reports **0 known vulnerabilities**, for production and for all dependencies.

### 0C.1 Risk-ranked findings

| # | Risk | Finding | Files |
|---|---|---|---|
| A1 | **Critical (launch blocker)** | **There is no hosting target.** The repository has no Dockerfile, `vercel.json`, proxy, CI or other deployment file; only the README mentions "Vercel or any Node host". The right `TRUSTED_PROXY_HOPS`, the rate-limit store and the monitoring setup all depend on this decision, so none can be set yet. | `README.md`, `.env.example`, `src/lib/ratelimit.ts` |
| A2 | **High** | **Rate limits are kept in each server process's memory.** On serverless hosting (for example Vercel) or with several instances, every instance counts separately and cold starts reset the counts. The signup, login, AI and Places limits would then mostly not hold. A restart also clears them. | `src/lib/ratelimit.ts` |
| A3 | ~~High~~ **Fixed 19 Nov (0D)** | **Anyone can lock any account.** Every attempt counts toward the account limit (5 per 15 minutes), from any address. Once reached, even the owner's correct password is refused; the Phase 2A test proves this. One address can keep 4 accounts locked indefinitely (20 attempts per 15 minutes divided by 5), and many addresses can lock any number. | `logInAction` in `src/app/actions.ts` |
| A4 | **High (before launch)** | **No password reset, no email or password change, no account deletion.** "Delete my data" removes the 7 data keys but keeps the login (`users.json` or the Supabase user) and does not revoke Google access at Google. The Supabase email-confirmation link has no route to land on. | `src/lib/store.ts` `deleteAll`, `deleteAllDataAction`, `src/lib/session.ts` |
| A5 | **High (legal)** | **The privacy policy is missing required disclosures** (see 0C.6). It also shows no contact unless `NEXT_PUBLIC_CONTACT_EMAIL` is set. | `src/app/privacy/page.tsx` |
| A6 | ~~Medium-High~~ **Fixed 19 Nov (0D)** | **Supabase login cookies are weaker than the demo ones.** `@supabase/ssr` defaults to `httpOnly: false`, a 400-day lifetime and no `Secure` flag, and the app doesn't override them. The app never uses Supabase from the browser, so `httpOnly` and `Secure` can be set safely. Combined with A8, an injected script could read the session. | `supabaseServer()` in `src/lib/session.ts`, `src/proxy.ts` |
| A7 | **Medium-High** | **No error logging or monitoring.** The only log line is the startup check. AI, Google, Places and storage failures are shown to the user but never recorded, so the operator can't see them. | `src/instrumentation.ts`, `src/app/actions.ts` |
| A8 | **Medium** | **CSP allows inline scripts (`'unsafe-inline'`).** Next.js writes 3 inline bootstrap scripts per page (checked in the build), so removing it without a nonce breaks the app. Next.js 16 supports nonces: it reads one from the request's CSP header and adds it to its own scripts. No unsafe HTML is inserted from user input; the only `dangerouslySetInnerHTML` is the landing page's FAQ data, built from fixed text. So this is defence in depth, not an open hole. | `next.config.ts`, `src/proxy.ts`, `src/app/page.tsx` |
| A9 | **Medium** | **Supabase sees the app server's address, not the user's.** Login and signup call Supabase from the server, so Supabase Auth's own per-address limits apply to the server: all users share them, and one attacker could use them up. Supabase's built-in email service also has a very low sending limit, which would block confirmation and reset emails. Both are Supabase project settings; check them in the Supabase dashboard and docs. | `src/lib/session.ts` |
| A10 | Low (preventive) | **`SUPABASE_SERVICE_ROLE_KEY` is listed in `.env.example` and present but empty in `.env`; no code reads it.** This key bypasses all row-level security, so the listing invites someone to fill it in. Keep it unset on the production host until a feature truly needs it; the account-deletion plan (2B-3) avoids needing it. | `.env.example`, `.env` (name only, value empty) |
| A11 | ~~Medium~~ **Fixed 19 Nov (0D), live revocation untested** | **Google tokens are not revoked** on disconnect or "Delete my data"; they are only deleted locally. | `disconnectGoogleAction`, `deleteAll` |
| A12 | **Medium** | **The Places API key restrictions are unknown.** The key is used only on the server, but if it has no API or address restrictions in Google Cloud, a leak would allow unlimited billable use. | Google Cloud setting |
| A13 | Low, **timing part fixed 19 Nov (0D)**; the signup message remains | **Account existence can be learned.** Demo login returns sooner for an unknown email (no password hash is computed), and signup says "An account with this email already exists". | `logIn`, `signUp` in `src/lib/session.ts` |
| A14 | ~~Low~~ **Fixed 19 Nov (0D)** | **Raw Supabase errors.** Supabase signup errors are shown word for word. | `signUp` in `src/lib/session.ts` |
| A15 | Low | **Weak password rules.** Passwords need 8 characters, with no check against known breached passwords. The demo store uses scrypt with Node's default cost, which is lower than current OWASP guidance; demo mode is not for production. | `passwordSchema`, `src/lib/crypto.ts` |
| A16 | Low | **HSTS covers subdomains.** `includeSubDomains` will force https on every subdomain of the production domain; confirm they all serve https. | `next.config.ts` |
| A17 | Info | **Demo sessions are sound.** They are stored on the server and signed (HMAC with a constant-time check), `httpOnly`, `SameSite=Lax`, `Secure` on https, last 14 days, and end on logout. Supabase uses `getUser()` (checked with Supabase on every request), and `signOut()` signs the user out of all devices. Server actions get Next.js's built-in origin check. | `src/lib/session.ts`, `src/lib/crypto.ts` |

### 0C.2 TRUSTED_PROXY_HOPS: how to find and verify the right value

The value can't be known until the host is chosen. Don't copy a number from the README without checking.

1. **Choose the host and draw the chain:** browser, then every proxy you control (CDN, load balancer, platform edge), then the app.
2. **Look at the raw header once.** From a computer whose public address you know, send a request with a made-up header, for example `X-Forwarded-For: 203.0.113.99`. Log the raw header once on the server, behind a temporary admin-only check, and remove the logging afterwards.
   - You should see `203.0.113.99, <your real address>[, <proxy addresses>]`.
   - The setting is **1 plus the number of entries to the right of your real address**.
   - If the platform replaces the header with just your address, the setting is `1`.
3. **Set it, then prove it:**
   - The app must report your real address whatever you put in the header.
   - A different computer must get a separate allowance.
   - The browser test `rate-limit-spoofing.spec.ts` shows the expected behaviour.
4. **Close the side door.** Make sure the app's own port can't be reached without going through the proxy. From outside, a request straight to the server's address and port must fail.
5. **Check again** whenever you add or remove a CDN or proxy.

### 0C.3 Shared rate-limit store: options and trade-offs (nothing added yet)

| Option | New dependency | Works on serverless or many instances | Trade-offs |
|---|---|---|---|
| **Keep in memory, one long-running server** | None | No | Correct only on a single Node process (a VPS, no cluster mode). Restarts reset counts. Zero cost. |
| **Supabase Postgres table plus one SQL function** (recommended once Supabase is set up) | **None** (`@supabase/supabase-js` is already installed) | Yes | One database round trip per limited action (only signup, login, AI and Places). Login and signup run before the user is signed in, so the function would be open to anonymous callers. To stop someone filling in another person's counter, the server would name each counter with a keyed hash (HMAC) that only it can compute, and the function would remove expired rows as it goes. |
| Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`) | 2 packages | Yes | Managed and well tested, made for serverless. But it adds another company that receives IP addresses and hashed emails, a second account and bill, and a privacy-policy entry. |
| Self-hosted Redis (`redis` client) | 1 package | Yes | For VPS setups with several instances. You run and secure Redis yourself. |
| Platform or CDN rules (Vercel Firewall, Cloudflare) | None | Yes | Per-address and per-path only; they can't do per-account or per-user limits. Good as an extra outer layer. |

**Recommendation:** decide the host first. With one VPS process, the in-memory limiter is acceptable for launch. On serverless or several instances, use the Supabase table, with platform rules as an outer layer.

### 0C.4 Account lockout: design that keeps brute-force protection (no new dependency)

1. **Count only failed attempts.** Today a correct password also counts until it succeeds.
2. **Hard limit per account and address:** 5 failures per 15 minutes for one account from one address. This stops one source from guessing, and an attacker at another address can no longer lock out the owner.
3. **Wider limit per account:** a looser limit across all addresses, for example 20 failures per hour, catches guessing spread over many addresses. Reaching it locks out **unrecognised browsers only**.
4. **Recognised browsers ("device cookie", the OWASP pattern):** after each successful login, the browser gets a signed, httpOnly cookie tied to that account. A browser holding it has its own counter and ignores the account-wide limit, so an attacker can't lock the owner out of their usual browser.
5. **Hide whether the account exists:** compute a dummy password hash for unknown emails, so both cases take the same time (A13).
6. **Later, with Supabase email:** an "unlock or reset" email, and an optional notice to the owner after repeated failures.
7. **Tests:**
   - an attacker can't lock out a browser that has logged in before;
   - guessing from one address is stopped after 5 failures;
   - guessing spread over many addresses is stopped by the wider limit;
   - the existing per-address and spoofing tests stay green.

### 0C.5 CSP: can it be tightened safely?

Yes, with a nonce:
- `src/proxy.ts` would create a random nonce per request, send `script-src 'self' 'nonce-…' 'strict-dynamic'`, and pass the nonce to Next.js. The proxy currently runs only for `/app`, `/login`, `/signup` and `/api/google`; it would need to run for all pages.
- **Cost:** the 5 pages built in advance (landing, privacy, terms, not-found, global-error) would be rendered on each request instead, which makes them slower and uncached.
- **Rollout:** run first as `Content-Security-Policy-Report-Only` for about a week, then enforce. Run the full Playwright suite in both modes. Any browser console error fails the tests, so a broken script would show up.
- **Styles:** keep `style-src 'unsafe-inline'`. React `style` props (35 on the landing page) need it, and inline styles are far less dangerous than inline scripts.
- **Alternative:** hash-based CSP isn't practical, because Next's inline scripts change on every page.

### 0C.6 Privacy policy: missing disclosures

Checked against `src/app/privacy/page.tsx`.

**Missing:**
- **The AI providers by name:** Anthropic (Claude), OpenAI (ChatGPT) and Google (Gemini), and that they are outside India. Also what is sent: business name, city, category, other names, custom questions, post topics, and review text with the reviewer's first name.
- **Health information in reviews.** Patient reviews can contain health details, and the review text goes to the AI provider when a reply is drafted.
- **Google Places API:**
  - the Place ID is stored;
  - your own and competitors' public listing details are fetched from Google when you ask, and not stored;
  - only your scores, ranks and times are kept.
  - Google Maps Platform terms expect the policy to say Google Maps features are used and to link Google's privacy policy. Check the current terms.
- **WhatsApp sharing:**
  - the customer phone number typed on the Google page stays in the browser and is never sent to our server;
  - pressing Share opens WhatsApp (Meta), which receives the number and the message.
- **Languages:** the language preference is stored, and drafts in Hindi and Hinglish are produced by the same AI providers. No new data flow; a list item is enough.
- **IP addresses:** they are used briefly for abuse limits (signup and login) and are not stored.
- **Cookies:** the session cookie (`ge_session`, or Supabase's), `g_state` during Google sign-in, and later the device cookie (0C.4). All are strictly necessary; there is no analytics.
- **Where data is stored, and the hosting provider.** These depend on the host and Supabase region choices (A1).
- **How long data is kept:**
  - visibility history: last 30 checks;
  - profile scores: last 30;
  - insights: up to 50;
  - account data: until deleted.
- **India's DPDP Act 2023 rights:**
  - access, correction and erasure;
  - a grievance contact and how to complain to the Data Protection Board;
  - how to delete the **account**, not only the data (A4).
- **Google tokens:** until revocation exists (A11), say that Google access can also be removed at Google's account permissions page.
- **Contact:** set `NEXT_PUBLIC_CONTACT_EMAIL`. Then get a legal review.

### 0C.7 Monitoring and safe logging

1. **No new dependency first:**
   - a small `log(event, fields)` helper that writes one JSON line to stdout;
   - it only writes allow-listed fields: event name, user id, provider, HTTP status, duration and a short error code;
   - it never writes request bodies, review or post text, emails, phone numbers, tokens, cookies or keys;
   - a unit test proves keys, tokens and emails are dropped.
2. **Log every caught failure** in AI, Google, Places, storage and auth, plus Next.js's built-in `onRequestError` hook in `src/instrumentation.ts` for uncaught errors. The hook is present in the installed Next 16.4.6.
3. **Health check:** a `/api/health` endpoint that says only "ok" and the mode, with no secrets, for an uptime monitor.
4. **On the host:** send logs to the platform's log store, and alert on error rates (for example, more than 5% of AI calls failing in 15 minutes) and on repeated login lockouts.
5. **Optional later: Sentry (`@sentry/nextjs`).**
   - Benefits: error grouping and alerts.
   - Costs: one package, a third party receiving error data, `sendDefaultPii: false` and a scrubbing hook required, and a privacy-policy entry.

### 0C.8 Hosting configuration required before launch

| Where | Setting |
|---|---|
| Host (to decide) | One long-running Node process, or serverless / several instances: this decides the rate-limit store (0C.3) |
| Host | `TRUSTED_PROXY_HOPS`, found as in 0C.2; the app port firewalled from direct access |
| Host | https only; `NEXT_PUBLIC_APP_URL` set to the https address (turns on Secure cookies); fresh `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`; `NEXT_PUBLIC_CONTACT_EMAIL` |
| Host | Do **not** set `SUPABASE_SERVICE_ROLE_KEY`; do not set `ALLOW_DEMO_IN_PRODUCTION` |
| Host | Log storage and alerts; an uptime monitor on `/api/health` once it exists |
| Supabase | Region (Mumbai, `ap-south-1`, keeps data in India); Site URL and redirect URLs; email confirmation on; custom SMTP; minimum password length at least 8; leaked-password protection if the plan has it; check Auth rate limits given A9 |
| Google Cloud | Places key: allow only Places API (New), plus the older Places API while the fallback is used; add an address restriction if the host has fixed outgoing addresses; enable Places API (New) |
| Google Cloud | OAuth client: production redirect URI only; consent screen verification |
| DNS | Confirm every subdomain serves https before relying on HSTS `includeSubDomains` |

### 0C.9 Phased implementation plan

| Phase | Work | Needs | New dependencies |
|---|---|---|---|
| **2B-1** (next, no outside decisions) | Lockout redesign (0C.4) with tests. Supabase cookies `httpOnly`, `Secure` and a shorter life (A6). Generic Supabase signup errors (A14). Equal timing for unknown emails (A13). Safe JSON logging, `onRequestError` and `/api/health` (0C.7). A privacy-policy draft with clearly marked blanks for the host, region and grievance contact (0C.6). | Nothing | None |
| **2B-2** | Choose the host; set and verify `TRUSTED_PROXY_HOPS` (0C.2); choose the rate-limit store and, if needed, build the Supabase table version (0C.3); log storage and alerts | Your hosting decision | None (Supabase option) |
| **2B-3** | Email-confirmation and password-reset routes; change email and password; full account deletion through a Supabase SQL function that deletes the signed-in user and their data, with no service-role key; Google token revocation on disconnect and deletion (A4, A10, A11) | A Supabase project with custom SMTP | None |
| **2B-4** | CSP nonce, report-only first, then enforced (0C.5) | Hosting in place, to watch the reports | None |
| Before launch | Legal review of the privacy policy and terms; Places key restrictions (A12); Supabase settings (A9) | You and a lawyer | None |

## 0B. Phase 2A: security hardening and remaining browser coverage (18 November 2026)

### 0B.1 Security issue: forged X-Forwarded-For bypassed the signup and login limits

**Root cause:**
- `clientIp()` in `src/lib/ratelimit.ts` keyed the per-address limits on the **leftmost** `X-Forwarded-For` entry.
- Next.js puts the socket address into that header only when the request has none (`??=` in `next/dist/server/base-server.js`). A header the client sends is passed through unchanged.
- The leftmost entry is written by the client in every setup: with no proxy in front, and behind proxies such as nginx that add the real address on the right.
- So any client could send a new made-up address each time and get a fresh allowance: 5 signups per hour and 20 logins per 15 minutes, unlimited times over.

**Proof, before and after:**
- A new browser test, `rate-limit-spoofing.spec.ts`, failed on the old code: the 6th signup with a forged header was accepted, both with no proxy and behind one.
- It passes on the fixed code.

**Deployment found:** the repository has no deployment configuration (no Dockerfile, `vercel.json` or proxy config). The README says "Vercel or any Node host". So the fix is a setting the operator must give, not a guess.

**Fix:**
- New setting `TRUSTED_PROXY_HOPS`: the number of reverse proxies the operator controls in front of the app.
  - Vercel, or one nginx, Caddy or load balancer: `1`.
  - Cloudflare in front of nginx: `2`.
- Only the entry that many places from the right (written by our own outermost proxy) is used. Entries the client added are ignored.
- `0` means no trusted proxy. Nothing in the header can be trusted, because a forged value and the socket address look the same to the app. Every request then shares one bucket, so forging never earns more attempts.
- Entries that are not valid addresses, and requests with fewer entries than proxies (they skipped a proxy), also go to the shared bucket.
- IPv6 addresses are grouped by /64, so one subscriber can't rotate addresses. IPv4-mapped IPv6 and ports are normalised.
- Startup check: a production server (`npm start`) refuses to start until `TRUSTED_PROXY_HOPS` is set. Checked: the built app returned HTTP 500 and printed the explanation. An invalid value is refused in any mode. Development is unaffected and defaults to `0`.
- No rate limit was loosened. The per-account login limit (5 per 15 minutes) is unchanged and does not depend on the address.

**Files:** `src/lib/ratelimit.ts`, `src/lib/env.ts`, `.env.example`, `README.md`.

**Tests:**
- `tests/unit/client-address.test.ts` (8 tests).
- `tests/e2e/rate-limit-spoofing.spec.ts` (3 browser tests):
  - behind one proxy, forged left-hand entries share the real client's allowance, and a different real client is unaffected;
  - with no proxy, forged signups and logins are capped.

**What you need to do when deploying:** set `TRUSTED_PROXY_HOPS` on the host. Behind a proxy, make sure the app's own port can't be reached directly (firewall it). Otherwise a client could skip the proxy and forge the right-most entry.

### 0B.2 Bug found and fixed: any text was accepted as a Place ID

Onboarding and Settings accepted anything up to 200 characters as a Place ID ("my clinic", a Maps URL, `ChIJ&evil=1`). It was saved and used for the review link, QR code and WhatsApp message, giving customers a broken link.

- Now the same rule as the Places code (`validPlaceId`) is applied on save, with a clear field error.
- The error is now linked to the field (`id` and `aria-describedby`), like the other fields.
- The new test failed before the fix and passes after it.

**Files:** `src/app/actions.ts`, `src/components/Places.tsx`.

### 0B.3 New browser tests

| Spec | Tests | What is checked |
|---|---|---|
| `auth.spec.ts` | 12 (desktop and mobile) | **Signup:** browser blocks empty or malformed forms; server errors for email and short or over-long passwords; email kept, password not echoed; email trimmed and lower-cased; same address in other letters refused as a duplicate; signed-in users sent away from signup and login. **Login:** wrong password and unknown email give the same message; empty password error; login with other letters works; 5 wrong passwords lock the account even from another address and for the real owner; a successful login resets the count. **Sessions:** app pages and `/api/google/start` need a session; cookie is httpOnly, SameSite=Lax and not readable from JavaScript; a tampered cookie is refused; logout deletes the cookie and kills a copied one on the server; the session survives a browser restart. |
| `onboarding.spec.ts` | 8 (desktop and mobile) | Every app page leads to onboarding until a business exists; per-field server errors with typed values kept and nothing saved; website gets `https://`; healthcare and local types with their own categories; coming back edits in place. **Place ID:** no Find button without a Places key, with the hint; pasted ID trimmed, saved, shown in Settings and used in the review link; empty is allowed and the Google page asks for it; invalid IDs refused. |
| `reviews-errors.spec.ts` | 5 | Claude 500, 429, refusal, cut-off answer and unreadable response each show their own message, keep the owner's text and save nothing; a working draft then fills the box; empty or over-4,000-character replies refused on save and approve; healthcare warnings on save and approve; forged review id refused; the 31st draft in an hour refused. |
| `google-connection.spec.ts` | 4 | Not connected: approval notice and Connect link; the OAuth redirect has the client id, callback, `business.manage` scope and a 48-hex state matching an httpOnly cookie. Callback: cancelled, forged or missing state, and a made-up code really refused by Google's token endpoint, each with its message and nothing stored. Connected (stored record): account, location and approval note; disconnect deletes the stored tokens. Not set up: link disabled with a hint; opening the address anyway explains what is missing. |
| `rate-limit-spoofing.spec.ts` | 3 | See 0B.1. |

The test infrastructure gained:
- a third app server on 3113 (`TRUSTED_PROXY_HOPS=0`);
- no Google keys on the partial-results server, for the "not set up" state;
- mock failure modes (429, refusal, cut-off, HTML).

Production code has no test mocks.

### 0B.4 Results

| Run | Result |
|---|---|
| `npm run test:unit` | **26 passed, 0 failed** |
| `npm run test:e2e`, run 1 | **78 passed, 0 failed, 0 skipped** (2.0 min) |
| `npm run test:e2e`, run 2, straight after | **78 passed** (2.0 min) |
| `npx tsc --noEmit`, `npm run build` | Pass |
| Real `.env` and `.data` | Checksums identical before and after |

The new tests failed at first for these reasons:
- **Expected failures (2):** the spoofing and invalid-Place-ID tests failed on the old code, as intended.
- **My test mistakes (5), all corrected:**
  - Next.js's empty route announcer also has `role="alert"`;
  - the sidebar's Log out form was the first form on the page;
  - the test data file doesn't exist before the first save;
  - React reset a hidden input that I had changed too early;
  - Playwright won't click an `aria-disabled` link, which is in fact inert to users too (`pointer-events: none`), so the test now checks exactly that.

No assertion was weakened.

### 0B.5 Remaining security risks

| Risk | Note |
|---|---|
| Rate limits are in memory, per process | Several instances or serverless functions each keep their own count, and a restart clears it. A shared store (for example Redis) is needed for that kind of hosting. |
| `TRUSTED_PROXY_HOPS` has to match the real setup | Too high: a client can forge the address. Too low: everyone behind the proxy shares one allowance. Vercel overwrites `X-Forwarded-For` (from Vercel's documentation; **not tested on Vercel**). |
| The app's port must not be reachable around the proxy | Otherwise the right-most entry can be forged. This is a hosting setting, outside the code. |
| With `0` (no proxy), one shared allowance | 5 signups per hour for the whole site: safe, but fine only for local use. Someone could use it up and block signups. |
| The per-account login lock can be triggered by anyone who knows an email address | 5 wrong passwords lock that account for 15 minutes. That is the trade-off of a per-account limit; there's no CAPTCHA or unlock email. |
| CSP allows inline scripts; Supabase auth cookies are not httpOnly | Unchanged from the audit. |
| No password reset or account deletion | Unchanged. |
| Development server shares one allowance | Because development defaults to `0`, `npm run dev` now allows 5 signups per hour in total. Set `TRUSTED_PROXY_HOPS` in `.env` if that gets in the way locally; `.env` was not changed. |

---

## 0A. Phase 1.5: permanent browser test suite (18 November 2026)

### 0A.1 What was added

- **One dev dependency:** `@playwright/test` 1.65.1. It runs the Chrome already installed on the machine (`channel: "chrome"`), and was installed with browser downloads turned off.
- **`playwright.config.ts`:** one worker; desktop (1,360px), tablet (820px) and mobile (390px, touch) projects; HTML report in `playwright-report/`, failure traces in `test-results/` (both git-ignored).
- **`tests/e2e/support/server.mjs`:** started by Playwright. It copies the app into a temporary folder outside the project (`$TMPDIR/gmb-growth-engine-e2e`), deletes that folder's `.data` so every run starts with no accounts, builds it, and starts:
  - a mock Claude API (records prompts; tests set its answers);
  - the app on port 3111 (Claude only) and on 3112 (Claude plus a deliberately invalid OpenAI key, for partial results).
  The copy has no `.env`; the servers get an explicit list of throwaway settings. The real `.env` and `.data` are never read or written.
- **`tests/e2e/support/fixtures.ts`:** a fresh demo account (`e2e-…@example.test`) for every test, so no test depends on another. A different client address per test keeps the app's signup limit (5 per address per hour) from blocking the suite. Any browser console error fails the test.
- **Commands:** `npm run test:unit`, `npm run test:e2e`, `npm run test:all`, `npm run test:e2e:report`. `npm test` still runs the unit tests. Setup is documented in `tests/README.md`.

### 0A.2 Coverage of the 12 Phase 1 features

| Feature | Spec | Viewports |
|---|---|---|
| Post editing | `posts.spec.ts` | desktop, mobile |
| ChatGPT insights edit and delete (including the stale second-tab edit) | `insights.spec.ts` | desktop |
| Status labels (posts and replies) | `posts.spec.ts` | desktop, mobile |
| Mobile navigation hint (shown on phones, hidden from 768px) | `layout.spec.ts` | desktop, tablet, mobile |
| WhatsApp sharing (the WhatsApp tab is answered locally, so the test doesn't depend on WhatsApp's site) | `review-share.spec.ts` | desktop, tablet, mobile |
| QR download (real download, PNG header and size checked) | `review-share.spec.ts` | desktop, tablet, mobile |
| Language settings (English, Hindi, Hinglish: saved, in reply and post prompts, WhatsApp message) | `language.spec.ts` | desktop |
| Business aliases | `visibility.spec.ts` | desktop |
| Custom visibility questions | `visibility.spec.ts` | desktop |
| Visibility score and trend (0, +100, -100, +100; dashboard) | `visibility.spec.ts` | desktop |
| Possible match | `visibility.spec.ts` | desktop |
| Partial results (real OpenAI 401; needs internet) | `partial-results.spec.ts` | desktop |
| Extra: no sideways scroll and no duplicate element ids on 7 app pages | `layout.spec.ts` | desktop, tablet, mobile |

### 0A.3 Results

| Run | Result |
|---|---|
| `npm run test:e2e`, final run | **26 passed, 0 failed, 0 skipped** (50.8 s) |
| `npm run test:e2e`, repeated straight after | **26 passed** (52.4 s), with fresh data and no leftover state |
| `npm run test:unit` | **18 passed, 0 failed** (the 14 Phase 1 tests plus 4 Places error tests) |
| `npx tsc --noEmit`, `npm run build` | Pass |
| Real `.env` and `.data` | Checksums identical before and after all runs |

The first runs failed for these reasons, all corrected and re-run:
- **Test-server set-up (2):** Turbopack refuses a `node_modules` symlink, so the copy gets cloned modules; the copy also has to use its own Next.js, or React loads twice.
- **Test mistakes (4):** the language tests needed a Place ID for the WhatsApp box; one guessed data field name was wrong.
- **One real bug (below).**

No assertion was weakened.

### 0A.4 Bug found and fixed

| Bug | Fix | File |
|---|---|---|
| Each insight's Edit form reused the ids of the "Add entry" form (`f-date`, `f-label`, `f-value`). The page had duplicate ids, so an edit form's labels pointed at the "Add entry" fields: clicking "Date" in an edit form focused the wrong field, and screen readers got mixed-up labels. The Phase 1 script missed it; Playwright's strict mode caught it. | `Field` takes an optional `idPrefix` (default unchanged, `f`); insight edit forms use `insight-<n>`. The insights test now finds its fields by label, and the layout test fails on any duplicate id on the 7 app pages. | `src/components/ui.tsx`, `src/components/forms.tsx` |

### 0A.5 The account created at 14:56 in the real `.data`

Inspected read-only; nothing was changed. The email is not repeated here.

- **When:** 18 November 2026, 14:56:27 IST. The account and its session were written together, and the session expiry (14 days later) confirms the time.
- **Where:** the development server on port 3000, which had started at 14:54:39.
- **Evidence from its log (`.next/dev/logs/next-development.log`):**
  - a real browser was attached at 14:54:46 (React DevTools notice) and loaded a page at 14:55:43;
  - the signup followed 44 seconds later.
- **Not a test account:**
  - it uses a free-mail address, unlike the test accounts (`audit-…` or `e2e-…@example.test`);
  - none of my commands in this session called port 3000;
  - the Phase 1 tests ran only on 3111.
- **State:** it has a session but no business details, so it stopped at onboarding. That matches the onboarding "Find on Google" error reported right after.

**Conclusion: a genuine manual signup, most likely the owner testing onboarding, not an accidental test account.** The demo store keeps no creation time or IP per account, so this rests on the timestamps and the log.

---

## 0. Phase 1: browser testing and bug fixes (18 November 2026)

### 0.1 How it was tested

- **Browser:** headless Google Chrome (driven by `puppeteer-core`, installed in a scratch folder only, not added to the project).
- **App:** a production build of a byte-identical copy of `src/`, on port 3111, with its own empty `.data/`. The real `.data/` and `.env` were not used or changed.
- **AI:** a local mock server stood in for Claude. It records each request, so the tests can check the exact prompts and questions sent.
- **Partial results:** Claude mocked, plus a deliberately invalid OpenAI key, so OpenAI returned a real 401.
- **Layouts:** phone 390px, tablet 820px, desktop 1,360px.
- **Interactions:** clicks, typing, form errors, reloads, two tabs at once, a real file download, and a new-tab WhatsApp open.
- **Visual checks:** the downloaded QR, the mobile nav and the mobile Google page were also reviewed by eye from screenshots.

### 0.2 Results

**Final run: 63/63 checks passed (main script) and 5/5 (partial results). No browser console errors.**

The first run had 6 failures and the first partial-results run had 1. **All 7 were mistakes in my test scripts, not the app:** a line-break pattern, a click on a `<summary>` element that the helper didn't look for, and a click that hit the wrong list. Each was corrected, and the full suite was re-run until clean. Separately, the tests found **one real bug** (0.3).

| Feature | Result | Evidence |
|---|---|---|
| Post editing | **Pass** (12 checks) | Edit opens with the saved text. Under 10 characters shows "Write at least 10 characters." and keeps both the saved post and the typed text. A valid edit saves and the list updates. Editing an approved post warns it goes back to draft, then it does. Healthcare warnings re-run on edit and show on the card. A posted post has no Edit. No sideways scroll on a phone with the editor open. |
| ChatGPT insights edit and delete | **Pass** (5 checks) | Add two, invalid edit shows "Say what the number is." and changes nothing, edit persists after reload, delete removes the entry. Editing an entry that another tab already deleted is refused ("This entry changed or was removed"), and the remaining entry is untouched. |
| Status labels | **Pass** | Posts show "Draft", "Approved" and "Posted"; review replies show "Draft" then "Approved". |
| Mobile navigation hint | **Pass** (5 checks) | On a phone the fade and arrow show while items are off-screen, fade out at the end of the row, return when scrolled back, and don't block taps. Hidden on desktop. |
| WhatsApp sharing | **Pass** (7 checks) | The link carries the message and review link. 10-digit numbers get +91, and a leading 0 is replaced. International numbers are kept. A short number disables the link with an error. Clicking opens WhatsApp in a new tab (`api.whatsapp.com/send/?phone=919876543210…`) with `noopener`. |
| QR code download | **Pass** | Real download, `review-qr-zentrix-skin-clinic.png`, 1000×1092 PNG. Checked by eye: business name above, QR, caption below. |
| Language settings | **Pass** (4 checks) | English, Hindi and Hinglish each save, survive a reload, and appear in the instructions sent for both reply and post drafts. The WhatsApp message follows the chosen language. |
| Business aliases | **Pass** | More than 5 is rejected, and the list saves and persists. An alias in an AI answer counts as Named (score 100). Aliases show on the check card. |
| Custom visibility questions | **Pass** | More than 3 is rejected and a rejected save changes nothing. The page lists 2 natural questions plus 2 custom ones, and all 4 were sent to the AI. |
| AI visibility score and trend | **Pass** | Successive scores of 0, 100, 0 and 100 showed "First check", "+100" (green), "-100" and "+100". The chart has one bar per check, and the dashboard shows the score, trend and named count. |
| Possible match | **Pass after fix** | A close variant gives 4 "Possible match" results, which are not counted, plus a "4 possible matches not counted" line and an explanation. The name was shown in lower case (bug fixed, 0.3). |
| Partial results | **Pass** (5 checks) | When ChatGPT fails (real 401), Claude's results are saved, a "Partial results" banner names ChatGPT and the reason, and the score uses Claude's answers only (2 of 2). When every provider fails, the error is shown and nothing is saved. Partial checks count toward the hourly limit; fully failed ones don't. |
| AI fix list (extra) | **Pass** | A suggestion containing "guaranteed results" was dropped by the healthcare wording filter, leaving 3. If the AI list can't be produced, the standard list shows instead. |
| Layouts (extra) | **Pass** | No sideways scroll on all 7 app pages at 390, 820 and 1,360px. |

### 0.3 Bugs fixed

| Bug | Fix | File |
|---|---|---|
| A possible match was shown in normalised form ("zentrix skin and hair clinic") instead of as the answer wrote it ("Zentrix Skin & Hair Clinic"), and the answer excerpt started at the beginning of the answer instead of at the name | The original words of the answer are now kept for display, and the excerpt search ignores case | `src/lib/ai.ts` (`matchBusiness`, `excerptAround`) |

No other app bugs were found in the 12 features.

### 0.4 Tests added to the repository

`npm test` now runs Node's built-in test runner (`node:test`) with **no new dependencies**. `tests/setup/` lets the tests import the app's TypeScript files directly. **14 tests, all passing**:

| File | Tests |
|---|---|
| `tests/unit/medical.test.ts` | 100% claims; discount wording; "offer" as a verb not flagged; Hindi and Hinglish phrases (with and without the nukta); ordinary sentences not flagged |
| `tests/unit/visibility-matching.test.ts` | Named (case and punctuation, "&" vs "and"); alias; possible match shown as written (regression test for 0.3); loose look-alikes not matched; natural and custom questions |
| `tests/unit/score-and-limits.test.ts` | Score ignores possible matches; old checks scored from `found`; trend text; rate limiter cost and refund |

`npx tsc --noEmit` (which now also covers the test files) and `npm run build` pass.

**Browser tests:** done in Phase 1.5 (section 0A). The Phase 1 scratch scripts are now `tests/e2e/` with Playwright.

### 0.5 Still needs real credentials or manual checks

| Item | Why |
|---|---|
| Hindi post drafts with the real Claude API | Not run yet (prompt instructions were verified in the browser with the mocked AI) |
| Real ChatGPT and Gemini answers | Partial results were tested with an OpenAI failure only |
| WhatsApp on a real phone | The link opens WhatsApp's web handler; actual delivery wasn't checked |
| QR scan with a phone camera | The PNG was checked by eye, not scanned |
| Places features, Google Business Profile, Supabase | Find on Google works (older-API fallback, see section 2). Profile audit, competitors and rank grid still wait on Places API (New) being enabled; Google approval and a Supabase project are unchanged |
| Privacy page changes | Not in the Phase 1 list; still compile-checked only |

---

## 1. Corrections to the "Current Features" document

The Current Features document is mostly accurate. These statuses needed correcting after checking the code and test logs:

| Claim in the document | Actual status | Why |
|---|---|---|
| "AI post drafts in English, Hindi, Hinglish: Working (real AI, 4/4 tests pass)" | English and Hinglish: tested, real service. **Hindi posts: not tested.** | The 4 real post tests were English and Hinglish only. |
| Local-business posts tested with real AI | Tested on an **earlier version** of the prompt | The post prompt was changed afterwards (80 to 130 words). Only the healthcare posts were re-run. |
| "AI fix list: Working (real AI)" | Generation tested, real service. **Wording filter: compile-checked only.** | The filter that drops fix-list items failing the medical wording check was added after the real test. |
| Edit saved posts, insight edit/delete, status labels, mobile nav hint, WhatsApp share, QR download, language setting, aliases, custom questions, score and trend, possible match, partial-results banner: "Working" | **Built, compile-checked only** at the time; **all browser-tested in Phase 1** (section 0) | |
| "Healthcare wording warnings on save and approve (English, Hindi, Hinglish): Working" | Warnings on save and approve: tested, browser (English). Hindi and Hinglish rules: pattern-checked in Node, not in the app. | |
| "'offers' as a verb … Prompt ready, not confirmed" (Pending #1) | **Done.** Pattern-checked (10/10 discount phrases caught, 5/5 verb uses ignored); TypeScript check and build pass. | Implemented after both documents were written. |
| "Rate limit: 6 successful checks per hour" | Correct, with one detail: a check where **at least one** provider answers counts. Only checks where every provider fails are not counted. | `refund(rlKey)` in `src/app/actions.ts` |
| "Profile audit score … score history" | The profile score **is saved** on every audit, but is **never shown** apart from the change against the previous audit. | `profileScores` is written in `actions.ts` and read by no page. |

---

## 2. Tested with real services

Only the Claude API has been tested live. On 18 November, the app's own `src/lib/ai.ts` was called directly against the real API, using the model named in `.env` (`ANTHROPIC_MODEL`).

| Feature | Result | Notes |
|---|---|---|
| Review reply drafts: healthcare 5-star and 1-star, local business 4-star, each in English, Hindi and Hinglish | 9/9 pass | Correct script per language. No patient details, symptoms or diagnosis. Wording check clean. 3 to 5 sentences. |
| Post drafts: healthcare Update in English and Hinglish | 2/2 pass | 765 to 793 characters, wording check clean |
| Post drafts: local business Offer in English and Hinglish | 2/2 pass | On the earlier prompt (see section 1) |
| AI visibility check with Claude only, including competitor extraction | Pass | Natural category questions; 9 competitors listed |
| AI fix list | Pass | 5 specific actions; no review gating, no medical claims |
| Bug found and fixed during this testing | Fixed | This Claude model thinks before answering, so short token limits produced empty or cut-off drafts. `claude()` now allows room for that thinking, uses low effort, and shows a clear error if Claude refuses or the answer is cut off. |
| Google Places API (New), one live Text Search | **Failed: HTTP 403 PERMISSION_DENIED, reason ACCESS_DENIED** (re-checked 18 Nov). The same key gets 200 OK from the older Places API, so the key and billing work. | Enable "Places API (New)" in the key's project; if the key has API restrictions, add it there. |
| Place ID "Find on Google" (onboarding), real search | **Passed** in a browser on a test copy, through the older Find Place API fallback; the key was found in no browser response, built file or log | — |
| All four Places features through the older-API fallback (19 Nov) | **Passed, real service and browser.** Profile audit 100/100 with every item filled; competitors: 10 results with position; rank grid: 9 positions. Places API (New) still refused (403 ACCESS_DENIED, rechecked 19 Nov). No key in 77 browser responses or the server log; no console errors. | Places API (New) for this key, still to be resolved in Google Cloud (the app switches back by itself) |

Not tested live: Google Business Profile API and OAuth, OpenAI, Gemini, Supabase.

---

## 3. Implemented features, by area

### 3.1 Public website

| Feature | Status | Evidence |
|---|---|---|
| Landing page: hero, features, dashboard preview, how it works, solutions, trust, FAQ with structured data | Tested, browser (audit) | `src/app/page.tsx` |
| Navigation with Platform dropdown and mobile menu | Tested, browser (audit) | `src/components/LandingNav.tsx` |
| Pricing section | Placeholder text only | `src/app/page.tsx#pricing` |
| Login and signup, split layout | Tested, browser (audit) | `src/components/AuthShell.tsx` |
| Privacy page: no account-deletion claim, contact hidden when unset | Built, compile-checked only | `src/app/privacy/page.tsx` |
| Terms, 404 page, social share image, favicon | Tested, browser (audit) | |
| Responsive layout at 390, 820 and 1,720px | Tested, browser (audit) | Pages changed today were not re-checked. |

### 3.2 Accounts and security

| Feature | Status | Evidence |
|---|---|---|
| Signup, login, logout (demo mode), with validation and edge cases | Tested, browser; Playwright (`auth.spec.ts`, Phase 2A) | `src/lib/session.ts` |
| Server-side demo sessions; logout kills the session; tampered cookie refused; Secure cookie on https | Tested, browser; Playwright except the https case | `session.ts` |
| Rate limits: login (per address and per account), signup, AI drafts, visibility | Tested, browser; Playwright | `src/lib/ratelimit.ts` |
| Client address for rate limits from trusted proxies only (`TRUSTED_PROXY_HOPS`); forged `X-Forwarded-For` ignored | Tested, unit and browser (Phase 2A). Not tested on a real host or proxy. | `clientKeyFrom` in `ratelimit.ts`, `env.ts` |
| Rate limit: Google Places (60 calls per hour per user, grid scan counts as 10) | Built, compile-checked only | `actions.ts` `placesBudget` |
| Startup check that refuses bad configuration | Tested | `src/lib/env.ts`, `src/instrumentation.ts` |
| Security headers (CSP, HSTS, frame blocking and more) | Tested, browser | `next.config.ts` |
| Per-user data isolation (demo mode) | Tested, browser | `src/lib/store.ts` |
| Supabase RLS policies | Tested in local PostgreSQL only | `supabase/schema.sql` |
| Forged review ids refused | Tested, browser; Playwright | `replyAction` |
| Location ids checked against Google's list | Built, waiting on Google approval | `chooseLocationAction` |
| Healthcare/local business allow-lists for checklist and guide keys | Built, compile-checked only | `toggleAuditAction`, `toggleGuideAction` |

### 3.3 Onboarding and settings

| Feature | Status | Evidence |
|---|---|---|
| Business type, name, website, city, category, phone | Tested, browser; Playwright (`onboarding.spec.ts`) | `BusinessForm` in `src/components/forms.tsx` |
| Place ID typed in by hand: trimmed, format checked (fixed in Phase 2A), saved, used for the review link | Tested, browser; Playwright | `PlaceIdField` in `src/components/Places.tsx`, `businessSchema` |
| Business finder: find by name, city and state, choose from cards, change with confirmation (replaces the Place ID box; manual ID behind a link) | Tested, real service and browser (19 Nov); Playwright (`discovery.spec.ts`) with the Places stand-in. See 0F. | `src/components/BusinessFinder.tsx`, `src/lib/discovery.ts`, `findPlaces` |
| Reply and post language: English, Hindi, Hinglish | Tested, browser (Phase 1); prompt output tested, real service, except Hindi posts | `language` in `types.ts`, `languageRule` in `ai.ts` |
| Other business names (up to 5) and custom visibility questions (up to 3) | Tested, browser (Phase 1) | `lines()` in `actions.ts` |
| Setup status, including the Places key | Built, compile-checked only | `src/app/app/settings/page.tsx` |
| Delete my data (now also deletes stored Places scores and scans) | Tested, browser for the original six keys; the `places` key was added today | `deleteAll` in `store.ts` |

### 3.4 Dashboard

| Feature | Status |
|---|---|
| Business overview, Google connection status (3 states), profile checklist progress | Tested, browser |
| AI visibility score (0–100) with change against the previous check | Tested, browser (Phase 1); unit tests |
| Next three actions | Tested, browser. **Still fixed rules** in `src/lib/recommend.ts`; they don't use the profile audit, rank grid or AI fix list. |
| Profile audit score on the dashboard | Not built |

### 3.5 Google profile page

| Feature | Status |
|---|---|
| Self-reported profile checklist (10 or 11 items), now titled "self-reported" | Tested, browser (original); title change compile-checked |
| Review link and QR code | Tested, browser |
| Download QR as a print-ready PNG with the business name | Tested, browser (Phase 1): real download, checked by eye |
| Share review request on WhatsApp, message in the chosen language | Tested, browser (Phase 1). A 10-digit number is assumed to be Indian (+91). |
| Connect and disconnect Google; callback guards; not-set-up state | Playwright (`google-connection.spec.ts`): redirect, state cookie, every callback error, stored-connection screen, disconnect. A real sign-in is waiting on Google approval. |
| Location selection | Built, waiting on Google approval |
| Profile audit score (8 items, fix tips) from live Google data, now with checklist verdicts and history | Tested, real service and browser (19 Nov), through Places API (New) and earlier through the older-API fallback. Playwright with the Places stand-in (`growth.spec.ts`). |
| Competitor comparison: top 10, your position, gap analysis (ahead, stronger, not comparable, actions) | Tested, real service and browser (19 Nov), through Places API (New). Playwright with the Places stand-in. Through the older fallback, photo, website and phone counts are unknown and not compared. |
| Rank grid: 3×3 points at 1, 3 or 5 km, positions 1–20 or "20+", 5 scans per 24 hours, compared with the previous scan | Tested, real service and browser (19 Nov), through Places API (New). Playwright with the Places stand-in. |
| "Google Maps" attribution wherever Places data is shown | Built, compile-checked only |

### 3.6 Reviews

| Feature | Status |
|---|---|
| Review list | Demo / mock only: 4 labelled sample reviews until Google approval |
| AI reply drafts in English, Hindi, Hinglish; healthcare safety | Tested, real service (prompt); the screen flow was tested in the browser with the mocked AI |
| Edit, save draft, approve; status shown as "Draft", "Approved", "Posted" | Tested, browser (Phase 1) |
| Healthcare wording warnings listed on save and approve | Tested, browser |
| Post reply to Google | Built, waiting on Google approval |

### 3.7 Posts

| Feature | Status |
|---|---|
| Manual post (10 to 1,500 characters), save, approve, delete | Tested, browser |
| AI post drafts | English and Hinglish tested, real service; Hindi not tested |
| Composer clears after a successful save | Tested, browser |
| Update, Event and Offer types; Offer hidden for healthcare | Tested, browser |
| Event and Offer fields (title, start and end, coupon, terms, redeem link) with validation | Tested, browser (app side) |
| Event and Offer fields sent to Google in `createPost` | Built, waiting on Google approval |
| Schedule date checked as a real date | Tested, browser. **The post is stored only and never publishes automatically.** |
| Edit a saved draft or approved post (goes back to draft), with an error message for bad length | Tested, browser (Phase 1). Only the text can be edited, not the event or offer details. |
| Healthcare wording check on save and edit | Tested, browser; unit tests for the rules |
| Publish to Google, with a "Not published: …" message on failure | Message tested, browser (not-connected case); real publishing waiting on Google approval |

### 3.8 AI visibility

| Feature | Status |
|---|---|
| Claude checks | Tested, real service |
| ChatGPT and Gemini checks | Built, waiting on keys |
| Natural questions per category plus custom questions | Tested, browser (Phase 1) and real service; unit tests |
| Name and alias matching; "Possible match" for close variants | Tested, browser (Phase 1); unit tests. The lower-case display bug is fixed. |
| Partial results when one provider fails | Tested, browser (Phase 1, with a real OpenAI 401) |
| Competitor extraction by the answering provider, Claude as fallback, note if it fails | Tested, real service (Claude only) |
| Visibility score 0–100 with trend; history of 30 checks with chart | Tested, browser (Phase 1) |
| AI fix list (3 to 5 actions; fixed list if generation fails; healthcare wording filter) | Generation tested, real service; filter and fallback tested, browser (Phase 1) |
| Limit: 6 counted checks per hour | Tested, browser |

### 3.9 ChatGPT Business Hub guide

| Feature | Status |
|---|---|
| Steps, preparation checklist, notes, add insight | Tested, browser |
| Edit and delete insights | Tested, browser (Phase 1); Playwright regression test. Duplicate field ids fixed in Phase 1.5. |
| OpenAI integration | Not built, by design |

---

## 4. Demo or mock data only

| Item | Detail |
|---|---|
| Review list | 4 hard-coded sample reviews (`sampleReviews()` in `src/lib/google.ts`), labelled "Sample" |
| Data storage on this machine | Demo mode, JSON files in `.data/`, for testing only |
| Landing page feature cards and dashboard preview | Labelled sample content |

---

## 5. Built, waiting on an approval or a key

| Waiting on | Unlocks |
|---|---|
| **Places API (New) enabled for the key** (it currently returns 403) | Place ID search, profile audit, competitor comparison, rank grid |
| **Google Business Profile API approval** plus an OAuth client | Google sign-in, location selection, live reviews, posting replies, publishing posts (including Event and Offer), token refresh |
| **Supabase project** | Production accounts, sessions and storage. Tested so far only against a local stand-in. |
| **OpenAI / Gemini keys** (optional) | ChatGPT and Gemini visibility checks |
| **OAuth consent-screen verification** | Google connection for users who are not test users |

---

## 6. Still incomplete

| Feature | What is missing |
|---|---|
| ~~Dashboard next actions~~ | **Done (0E):** recommendation engine from the audit, checklist, competitors, rank grid and visibility, with Claude and a rules fallback |
| ~~Profile score history~~ | **Done (0E):** chart and per-item changes on the Google page; trend on the dashboard |
| ~~Rank grid history~~ | **Done (0E):** comparison with the previous scan of the same phrase and spacing, per-cell arrows; earlier scans listed |
| Scheduled posts | Date stored only; no job runner |
| Post editing | Text only; event and offer details can't be changed |
| Pricing | Placeholder |
| Privacy policy | Doesn't mention the Google Places API, the WhatsApp share, or AI drafts in Hindi and Hinglish; still needs legal review and `NEXT_PUBLIC_CONTACT_EMAIL` |
| Supabase email confirmation | No callback route; users must log in by hand after confirming |
| `supabase/schema.sql` | **Fixed 19 Nov (0D):** safe to run again (tested 3 times in local PostgreSQL) |
| Google token revocation on disconnect | **Built 19 Nov (0D):** Google's revoke endpoint is called first; untested with a real connection |
| Google paging | Reviews capped at 50, locations at 100 |

---

## 7. Completed from the old "Pending Features" list

| Old item | Status now |
|---|---|
| #1 "offers" as a verb; wording check on the AI fix list | Done (see section 1) |
| All items under "Already done today" | Confirmed in the code: healthcare warnings before approval, medical wording rules, composer reset, visibility quota, privacy page, validation, publish error message, Event and Offer fields, post editing, insight editing, status labels, mobile nav hint, languages, WhatsApp and QR, visibility upgrades, the four Places features, and the real Claude tests (15/15). See sections 1 and 3 for which of these were only compile-checked. |

Still open from the old list: #2 and #3 (Places 403 and live test), #4 to #7 (report, history, smarter dashboard, multi-location), #8 to #15 (Supabase work), #16 to #23 (Google approval work), and #24 to #27 (launch). They are carried into the roadmap below.

---

## 8. New gaps found while checking the code

These were in neither document.

| # | Gap | Why it matters |
|---|---|---|
| N1 | ~~Most of today's screens were never opened in a browser~~ | **Done in Phase 1** (section 0). Still compile-checked only: the privacy page changes and the Places screens (blocked by the 403). |
| N2 | ~~No automated tests in the repository~~ | **Done:** 58 unit tests and 92 Playwright browser tests (sections 0A, 0B, 0E). Signup, login, sessions, onboarding, review drafting errors and Google connection states were added in Phase 2A (section 0B). Still not covered: dashboard checklist toggles, delete my data, the ChatGPT guide checklist and notes. |
| N3 | **Hindi post drafts untested with real AI**; local-business posts not re-tested on the final prompt | Language and length could still be wrong for these. |
| N4 | **Privacy policy doesn't cover the Places API, WhatsApp or the new languages** | Google's terms and Indian privacy rules expect accurate disclosure. |
| N5 | **The project context file is out of date** (`docs/product-audit/CLAUDE_PROJECT_CONTEXT.md` describes the app before today's work) | Future sessions would start from wrong assumptions. |
| N6 | ~~Profile scores are saved but never shown~~ | **Done (0E):** audit history chart and per-item changes; dashboard trend. |
| N7 | **No refusal fallback for Claude.** A refused draft now shows a clear error, but the request is not retried on another model. | Rare, but a refused healthcare draft simply fails. |
| N8 | **Places rate limit is per server process** (like the other limits) | It won't hold across several servers or serverless hosting. |
| N9 | ~~Possible-match names are shown in lower case~~ | **Fixed in Phase 1**, with a regression test. |
| N10 | ~~Dead code~~ | **Removed 19 Nov (0D).** |
| N11 | ~~Saved-post warnings ignored the event title~~ | **Fixed 19 Nov (0D).** |

---

## 9. Prioritised roadmap

Priorities follow the current state of the app. P0 means "do before building more"; later phases need outside setup.

### Phase 1: Make what exists trustworthy (now, no approvals needed)

| Priority | Work | Why first |
|---|---|---|
| ~~P0~~ | ~~Browser pass over every compile-checked-only screen~~ | **Done** 18 Nov (section 0): 68 checks, 1 bug fixed. |
| ~~P0~~ | ~~Automated tests in the repository~~ | **Done:** unit tests (Phase 1) and the Playwright browser suite (Phase 1.5, section 0A). |
| ~~P0~~ | ~~Forged X-Forwarded-For bypassing signup and login limits~~ | **Fixed** in Phase 2A (section 0B). Remaining: set `TRUSTED_PROXY_HOPS` when deploying. |
| **P0** | **Phase 2B-1** (section 0C.9): lockout redesign, Supabase cookie hardening, safe logging and health check, privacy draft | Closes the highest risks that need no outside decision. |
| **P0** | **Choose the hosting target** (0C.1 A1); it decides the proxy setting, rate-limit store and monitoring | Several launch settings wait on it. |
| **P0** | Fix the Places 403 in Google Cloud (your action), then run one live test of all four Places features (old #2, #3) | Four finished features are blocked on a setting. |
| **P1** | Real-AI test of Hindi posts and re-run local-business posts on the final prompt (N3) | Closes the last untested AI path. |
| **P1** | Update the project context file and mark the audit files as superseded by this file (N5); ask before overwriting | Keeps future sessions accurate. |

### Phase 2: Highest-value features with no outside dependency

| Priority | Work | Size |
|---|---|---|
| **P1** | Smarter dashboard actions using the visibility fix list, profile audit and rank grid (old #6) | S |
| **P1** | Score history: profile score and rank grid trends on the dashboard and Google page, from data already stored (old #5, N6) | S |
| **P2** | Monthly report: visibility score, profile score, rank grid, competitor position; Google insights added later (old #4) | M |
| **P2** | Edit event and offer details on saved posts | S |
| **P3** | Display fixes: possible-match capitalisation (N9), warnings using the event title (N11), dead code (N10) | S |

### Phase 3: Decide before production storage

| Priority | Work |
|---|---|
| **P1** | **Decide on multi-location now** (old #7). Today every user has exactly one business record. Changing that after real customer data exists means migrating it. |

### Phase 4: Supabase (needs a Supabase project)

| Priority | Work |
|---|---|
| **P0** | Set up the project, apply a re-runnable `schema.sql`, and test end to end: signup, email confirmation, login, isolation, session refresh (old #8) |
| **P1** | Email-confirmation callback route, password reset, change email or password, account deletion (old #9 to #12) |
| **P1** | Error logging and monitoring (old #14) |
| **P2** | Shared rate-limit store, only if hosting on more than one server or serverless (old #13, N8) |

### Phase 5: Google Business Profile (needs API approval)

| Priority | Work |
|---|---|
| **P0** | Live test of OAuth, locations, reviews, replies and posts, including Event and Offer (old #16) |
| **P1** | Revoke the token on disconnect; paging past 50 reviews and 100 locations (old #17, #18) |
| **P1** | New-review alerts, especially negative ones (old #22) |
| **P2** | Insights dashboard (Performance API), business info sync, auto-publishing scheduled posts, insights in the monthly report (old #19 to #21, #23) |

### Phase 6: Launch checklist

| Priority | Work |
|---|---|
| **P0** | Production settings: `APP_MODE=supabase`, https app URL, fresh secrets, `NEXT_PUBLIC_CONTACT_EMAIL`, Google redirect URI (old #24) |
| **P0** | Privacy policy updated for Places, WhatsApp and AI languages (N4), then legal review of privacy and terms (old #26) |
| **P0** | OAuth consent-screen verification (old #25) |
| **P1** | Real pricing on the landing page (old #27) |
| **P2** | Server-side refusal fallback for Claude drafts (N7) |

---

## Documentation

| File | State |
|---|---|
| `docs/MASTER_PROJECT_STATUS.md` (this file) | **Current.** Use this for status and priorities. |
| `docs/product-audit/CLAUDE_PROJECT_CONTEXT.md` | Out of date: describes the app before 18 November's feature work. Not changed here, as you asked. |
| `docs/product-audit/FEATURE_STATUS_MATRIX.md`, `KNOWN_ISSUES_AND_ROADMAP.md` | Out of date (audit snapshot). |
| `docs/product-audit/COMPLETE_WEBSITE_AUDIT.md`, `TECHNICAL_ARCHITECTURE.md` | Still correct on the foundations (stack, auth, storage, security). Missing today's additions: `src/lib/places.ts`, `src/lib/visibility.ts`, `src/components/Places.tsx`, `src/components/ReviewShare.tsx`, and the `places` storage key. |
