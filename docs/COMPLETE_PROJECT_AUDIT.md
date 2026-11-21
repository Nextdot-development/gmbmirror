# GMBmirror (formerly GMB Growth Engine): Complete Current-State Audit

**Date:** 19 November 2026.

**Scope:** the whole repository, checked against the code and against tests run on the day.

**Rules followed:**
- No code, schema, `.env` or `.data` was changed.
- No dependency was installed.
- The only file created is this report.

**How evidence is labelled:**

| Label | Meaning |
|---|---|
| **Verified today** | Run or inspected on 19 November 2026 during this audit |
| **Verified earlier** | Run in an earlier session, with the date given; the code it covers has not changed since, except where noted |
| **Code only** | Read in the code; not run |
| **Assumption** | Stated as such; not checked |

---

## Addendum 3, 19 November 2026: pre-OAuth verification

- **History:** audit, rank-grid and competitor history is now linked to the Google listing it was measured for. Before this fix, changing the listing mixed two businesses' history.
- **Overflow:** the reported narrow-window overflow came from the phone "Log out (email)" button and affected real phones with long emails. Fixed and tested.
- **Persistence:** the listing persists across refresh, logout and login, edits and Settings.
- **Live finder check:** a local salon this time.
- **Tests:** 66 unit and 115 browser (desktop 71, mobile 40, tablet 4), all passing, none skipped.

The Google Business Profile readiness checklist and the recommended changes G1–G6 are in `docs/MASTER_PROJECT_STATUS.md`, section 0G.

---

## Addendum 2, 19 November 2026: business finder

Owners now find their business by name, city and an optional state, and choose it from result cards. The Place ID box is gone from the main flow; manual entry sits behind a link and is checked with Google. Changing a saved listing asks for confirmation (also enforced on the server) and keeps history.

Verified live with real Google:
- Apollo, New Delhi: exact match, saved, audited at 100/100.
- Domino's, Pune: 5 branches told apart by address, replaced with confirmation.
- A nonsense name: loosely related places shown with a warning.

Tests now total **63 unit** and **108 browser** (desktop 67, mobile 37, tablet 4), all passing.

New finding (Low, it existed before): every app page scrolls sideways by about 20 px in a *desktop* browser narrowed to 390 px (phone navigation strip). Real phone emulation is fine.

Details: `docs/MASTER_PROJECT_STATUS.md`, section 0F. Onboarding row B and the "Place ID paste" and "Find on Google" rows in section C are superseded by this.

---

## Addendum, 19 November 2026 (later): AI Business Growth Intelligence Engine V1

This report was written before the milestone; the items below changed since. Details are in `docs/MASTER_PROJECT_STATUS.md`, section 0E.

**Built and tested:**
- **Categories:** 20 categories, including Hospital and Multi-speciality Hospital; old saved names still work (fixes **U3**).
- **Checklist from Google:** the profile checklist uses Google-verified verdicts with dates; the owner's ticks are never overwritten (fixes **U4**).
- **Competitor gap analysis:** counts only, nothing guessed.
- **Recommendation engine:** evidence from stored data; Claude picks and rewrites the top 3 within a schema and falls back to rules; cached by data fingerprint.
- **New dashboard:** health, top actions, competitor insights, trends, recent changes. The wrong "Run another visibility check" button is gone (fixes **U1**).
- **Action plans:** at `/app/actions/[id]`, with Claude drafts that are never published.
- **History:** audit history with per-item changes; rank-grid comparison with the previous scan.

**Verified:**

| Check | Result |
|---|---|
| Unit tests | **58** passed (was 39) |
| Playwright | **92** passed (was 86): desktop 59, mobile 29, tablet 4 |
| `tsc`, build | Pass |
| Live through the UI | Google Places (New) and Claude, for a hospital and a restaurant |
| Claude validation | 6 direct Claude calls: 18 of 18 items passed |

**Assumption to confirm:** stored data and Claude requests contain only this app's derived results, never Google's own content. This reads Google Maps Platform terms conservatively.

**Unchanged:** the security findings F (H1–H4, M1–M6, L1–L6), production readiness I, and the P0 and P1 roadmap. Section L items 12, 13 and 14 are now done.

---

## A. Executive summary

GMB Growth Engine is a Next.js 16 web app for Indian local businesses, especially clinics. It helps them:
- manage a Google Business Profile (review replies, posts, a profile checklist, a review link and QR code);
- measure whether AI assistants name the business ("AI visibility");
- benchmark against Google Places data (profile audit, competitors, local rank grid).

**Current state, verified today:**
- **Runs locally in demo mode.** Accounts and data are JSON files in `.data/`.
- **Every page works** at phone, tablet and desktop sizes:
  - 18 routes respond correctly;
  - no sideways scrolling, no duplicate IDs, no unlabeled form fields, no images without alt text;
  - no console errors apart from the deliberate 404.
- **Tests:**
  - 39/39 unit tests pass;
  - **86/86 Playwright browser tests** pass (desktop 53, mobile 29, tablet 4);
  - TypeScript and the production build pass with no warnings.
- **Live services that work today:**
  - Claude, with one real call;
  - Google Places API (New): search, profile audit, competitors and rank grid, run through the real UI.
- **Live services not working yet:**
  - Google Business Profile (OAuth, reviews, replies, posts): Google sign-in keys are empty and the API is not approved;
  - Supabase: no project;
  - OpenAI and Gemini: no keys;
  - email: not implemented.
- **Not production-ready.** Missing:
  - a hosting decision and deployment configuration;
  - a real database;
  - a shared rate-limit store;
  - password reset, email or password change and account deletion;
  - monitoring;
  - a complete privacy policy.

---

## B. Pages and routes (verified today with the build route table and a browser crawl)

| Route | Type | What it does | Status today |
|---|---|---|---|
| `/` | Static | Landing page: hero, how it works, features, solutions, pricing, FAQ (with FAQ structured data), footer | 200; all 10 in-page anchors exist; **pricing is a placeholder** ("Plans will be listed here when they are available") |
| `/signup` | Dynamic | Create an account (email, password with at least 8 characters) | 200; signed-in users are sent to `/app` |
| `/login` | Dynamic | Log in | 200; signed-in users are sent to `/app` |
| `/privacy` | Static | Privacy policy | 200; **missing disclosures** (section F) |
| `/terms` | Static | Terms of service | 200; short; no liability, governing law, payment or termination clauses |
| `/_not-found` | Static | 404 page | 404 with its own message; page title is the generic site title |
| `/opengraph-image`, `/icon.svg` | Static | Social preview image, favicon | Built |
| `/app/onboarding` | Dynamic | Business form: type, name, website, city, category, phone, language, other names, custom questions, Place ID with "Find on Google" | 200 |
| `/app` | Dynamic | Dashboard: Google connection, latest visibility score and trend, checklist progress, 3 next actions | 200; **button says "Run another visibility check" before any check exists** |
| `/app/google` | Dynamic | Approval notice, connection, profile audit, competitors, rank grid, self-reported checklist, review link, QR, WhatsApp | 200; long single page; **shows server-setup instructions to owners** |
| `/app/reviews` | Dynamic | Review list with AI reply drafts, save, approve | 200; **4 labelled sample reviews** (Google not approved) |
| `/app/posts` | Dynamic | Composer (Update, Event, Offer; Offer hidden for healthcare), AI draft, schedule date, list with edit, approve, delete | 200 |
| `/app/visibility` | Dynamic | Questions, providers, run check, score, trend, results, possible matches, partial results, fix list, history chart | 200 |
| `/app/chatgpt` | Dynamic | ChatGPT Business Hub guide: steps, checklist, notes, manual insights (add, edit, delete) | 200 |
| `/app/settings` | Dynamic | Business details form, "Setup status" list, "Delete my data" | 200; **"Setup status" shows server configuration to every owner** |
| `/api/google/start` | Route | Starts Google OAuth (state cookie) | Redirects correctly; without keys it goes to `?error=not_configured` |
| `/api/google/callback` | Route | Finishes Google OAuth | Error handling verified; a real exchange has never run |
| `src/proxy.ts` | Proxy | Refreshes Supabase sessions | Supabase mode only |

**The browser crawl, verified today.** The 14 user-facing pages were opened at 390, 820 and 1,360 px on an isolated copy with its own empty data, using the real Claude and Places keys, which were never printed.

| Check | Result |
|---|---|
| HTTP status | Correct on every page |
| Sideways scrolling | None |
| Missing `h1` | None |
| Unlabeled fields | None |
| Images without `alt` | None |
| Duplicate IDs | None |
| Internal links | All 23 resolve |
| Console errors | Only the deliberate 404 |
| API keys in any of 915 responses or the server log | None |

---

## C. Feature status

Status values:
- **Working and tested**
- **Implemented, not fully tested**
- **Waiting for credentials or approval**
- **Demo / mock only**
- **Partial**
- **Not implemented**

### Accounts and security

| Feature | Status | Evidence |
|---|---|---|
| Signup, login, logout (demo mode) | Working and tested | `auth.spec.ts`: 15 tests on desktop and mobile |
| Email normalisation, duplicate detection, same message for wrong password and unknown email | Working and tested | `auth.spec.ts` |
| Server-side demo sessions: httpOnly, SameSite=Lax, 14 days, tampered cookie refused, copied cookie dies on logout | Working and tested | `auth.spec.ts` |
| Login limits: 20 attempts per address per 15 minutes; 5 failures per account and client; 20 failures per account per hour; recognised-browser cookie | Working and tested | `auth.spec.ts` (4 lockout tests), unit tests |
| Signup limit (5 per address per hour), client address from trusted proxies only (`TRUSTED_PROXY_HOPS`) | Working and tested (locally) | `rate-limit-spoofing.spec.ts`, `client-address.test.ts`. Not tested on a real host. |
| Equal login timing for unknown emails | Working and tested | Measured 19 Nov: median 70 ms vs 74 ms |
| Supabase signup, login, logout, refresh; hardened cookies; plain error messages | Implemented, not fully tested | Verified earlier (19 Nov) against a **local stand-in** only |
| Supabase email confirmation | Not implemented | No callback route |
| Password reset; change email or password | Not implemented | No code (verified today: no email or reset calls anywhere) |
| Account deletion (the login itself) | Not implemented | "Delete my data" keeps the account |
| Startup configuration check | Working and tested | Unit tests; production refusal checked 18 Nov |

### Onboarding and settings

| Feature | Status | Evidence |
|---|---|---|
| Business form with validation, website normalisation, type and category | Working and tested | `onboarding.spec.ts`: 8 tests on desktop and mobile |
| Languages: English, Hindi, Hinglish (saved, used in prompts and the WhatsApp message) | Working and tested | `language.spec.ts`; real Claude output checked 18 Nov except **Hindi posts** |
| Other names (up to 5) and custom visibility questions (up to 3) | Working and tested | `visibility.spec.ts` |
| Place ID paste, trim, format check, save, used in the review link | Working and tested | `onboarding.spec.ts` |
| "Find on Google" Place ID search | Working (real service) | Verified today through the UI with Places API (New). Not in the automated suite, which has no real key. |
| One business per account | By design (single `business` key) | Code |
| Settings "Setup status" | Working, but **shown to every owner** | Crawl and code |
| Delete my data (7 keys) plus Google revocation | Working and tested (revocation not confirmed live) | Unit and browser tests; a real revocation needs a real Google connection |

### Google Places

| Feature | Status | Evidence |
|---|---|---|
| Places API (New) with automatic fallback to the older Places API | Working (real service) | Verified today: Places API (New) answers 200 for the configured key. The fallback was verified live on 19 Nov while the new API was refused; unit tests cover the switching. |
| Profile audit (8 items, 100 points) | Working (real service) | Verified today: 100/100, every item read from Google, category "Hospital" |
| Competitor comparison (top 10, position, gaps) | Working (real service) | Verified today: 10 results with real photo counts. **Limitation:** the search uses the business category, and there is no "Hospital" category, so a hospital is compared with "clinics" |
| Local rank grid (3×3; 1, 3 or 5 km; 5 scans per 24 hours) | Working (real service) | Verified today: 9 positions; the spacing is kept after a scan |
| Errors show Google's reason, never the key | Working and tested | `places-errors.spec.ts`; no key in 915 responses today |
| "Google Maps" attribution | Implemented | Shown on every Places result (crawl screenshots) |

### Reviews and posts

| Feature | Status | Evidence |
|---|---|---|
| Review list | Demo / mock only | 4 labelled sample reviews until Google approves |
| AI reply drafts (language and healthcare rules) | Working and tested (mock AI); real Claude checked 18 Nov | `reviews-errors.spec.ts`, `language.spec.ts` |
| Claude failures (500, 429, refusal, cut-off, unreadable): own message, text kept | Working and tested | `reviews-errors.spec.ts` |
| Save, approve, labels (Draft / Approved / Posted), healthcare warnings, forged id refused, 30 drafts per hour | Working and tested | `reviews-errors.spec.ts`, `posts.spec.ts` |
| Posting a reply to Google | Waiting for credentials or approval | Code only (`postReply`) |
| Post composer, AI post draft, Event and Offer fields, edit, approve, delete | Working and tested (mock AI) | `posts.spec.ts` |
| Publishing posts to Google | Waiting for credentials or approval | Code only (`createPost`) |
| Scheduled posts | Partial | The date is stored and shown; nothing publishes automatically |

### AI visibility

| Feature | Status | Evidence |
|---|---|---|
| Claude checks | Working (real service, checked 18 Nov); pipeline tested with mock | `visibility.spec.ts` |
| ChatGPT and Gemini checks | Waiting for credentials | Keys are empty in `.env`. Only a real OpenAI 401 (deliberately invalid key) has been seen. |
| Name, alias and possible-match detection | Working and tested | Unit and browser tests |
| Natural and custom questions | Working and tested | Browser tests |
| Partial results when one provider fails | Working and tested | `partial-results.spec.ts` (real OpenAI 401) |
| Score (0–100), trend, history (30 checks), chart, dashboard summary | Working and tested | `visibility.spec.ts` |
| AI fix list (healthcare-filtered) with fixed fallback | Working and tested (mock) | `visibility.spec.ts` |
| Dashboard "next three actions" | **Replaced 19 Nov** by the recommendation engine (see Addendum) | `growth.spec.ts`, `growth-intelligence.test.ts`; live Claude |

### Guide, sharing and other

| Feature | Status | Evidence |
|---|---|---|
| ChatGPT Business Hub guide: steps, checklist, notes | Working (static guide; no OpenAI integration, by design) | Tested earlier in the browser |
| Insights: add, edit, delete, stale-edit protection | Working and tested | `insights.spec.ts` |
| Review link and QR code (on screen and as a 1000 px PNG download) | Working and tested | `review-share.spec.ts` on 3 viewports |
| WhatsApp share (+91 handling, disabled for short numbers) | Working and tested | `review-share.spec.ts`. Delivery on a real phone is not verified. |
| Profile checklist | **Linked to the Places audit 19 Nov:** 5 items verified on Google, the rest owner-confirmed | `growth.spec.ts` |
| Pricing and billing | Not implemented | Placeholder section |
| Logging and monitoring | Not implemented | Only the startup check logs |

---

## D. Integration status

| Integration | Status | Evidence |
|---|---|---|
| **Claude (Anthropic)** | **Real integration working** | Verified today: one live call (`claude-sonnet-5-5`, HTTP 200, normal answer). Prompts checked live 15/15 on 18 Nov. |
| **Google Places API (New)** | **Real integration working** | Verified today: search, audit, competitors and grid through the UI. Earlier, `.env` held a second, blocked key; it now has one key, and that one works. |
| Older Places API (fallback) | Real integration working | Verified live 19 Nov; used only if the new API is refused |
| Google Business Profile OAuth and APIs | Code implemented; credentials and approval missing | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty; `GBP_API_APPROVED=false`. OAuth redirect, state and callback errors are tested with fake keys; a real token exchange, locations, reviews, replies and posts have never run. |
| OpenAI (ChatGPT checks) | Code implemented; credentials missing | Keys empty; only a 401 path is tested |
| Gemini | Code implemented; credentials missing | Keys empty; never called |
| Supabase (auth and database) | Code implemented; project missing | URL and key empty. Tested against a local stand-in and local PostgreSQL only. |
| Email (confirmation, reset, notices) | Not implemented | No email code |
| WhatsApp | Real link (wa.me), no API | Opens WhatsApp with the message; the number never reaches the server |
| Google Maps attribution, Roboto font | Implemented | Self-hosted through `next/font` |

---

## E. Database and architecture

**Stack, verified today:**
- Next.js 16.4.6 (App Router, Server Actions, Turbopack, `proxy.ts`, `instrumentation.ts`), React 19.3, TypeScript 7, Tailwind 4, Zod 4;
- `@supabase/ssr` 0.12.7, `qrcode`, `@phosphor-icons/react`, `geist`;
- Node 24.

| Layer | Where |
|---|---|
| Pages | `src/app/**/page.tsx` |
| All writes (22 server actions) | `src/app/actions.ts` |
| Two API routes | `src/app/api/google/*` |
| Domain logic | `src/lib/*` (17 modules) |
| Client components | `src/components/*` |

**Storage:**
- One key-value table per user: `user_data(user_id, key, value jsonb)`.
- 7 keys: `business`, `checks`, `google`, `replies`, `posts`, `guide`, `places`.
- Demo mode puts all users in one file, `.data/user_data.json`; accounts and sessions are in `users.json` and `sessions.json`.

**What was checked:**

| Topic | Finding |
|---|---|
| Businesses per account | **One**, and one Google location. Several branches would need a data model change. |
| Isolation, demo | Every read and write is keyed by the signed-in user's id. Browser tests use a separate account each. |
| Isolation, Supabase | RLS: select, insert, update and delete only own rows, and rows are deleted when the auth user is deleted. Verified earlier (19 Nov) in local PostgreSQL: 12/12 checks, and the schema can be re-run 3 times. **Never run in a real Supabase project.** |
| Migrations | One file, `supabase/schema.sql` (now safe to re-run). No migration tool and no versioning of the JSON shapes. |
| Migration risks | No tool moves demo data to Supabase. JSON blobs are rewritten whole on every save. The demo file has no locking, so two simultaneous writes can lose one. |
| Growth | Checks are capped at 30, insights at 50, profile scores at 30 and scans at 20. **Saved posts have no cap.** |
| Backups | Demo: none. Supabase: depends on the plan (assumption, not checked). |
| Deletion | "Delete my data" removes the 7 keys and asks Google to revoke access. The account (demo `users.json` entry or Supabase auth user) remains. |
| Unused or outdated code | No dead functions found after the 19 Nov clean-up. The `geist` package only loads Geist Mono, and the `font-mono` style is never used, so it is an unused dependency and font. `SUPABASE_SERVICE_ROLE_KEY` is listed in `.env.example` but never read. `AGENTS.md` is generated by `next dev` and is not project documentation. |

---

## F. Security findings, by severity

Verified today in code and by tests, unless noted. Items fixed in earlier sessions are listed at the end, with their proof.

### High

| # | Finding | Affected | Recommendation |
|---|---|---|---|
| H1 | **Rate limits live in each server process's memory.** On serverless hosting or with several instances they mostly don't hold, and restarts reset them. | `src/lib/ratelimit.ts` | Choose the host first. On one long-running server, memory is acceptable. Otherwise use a Postgres-backed limiter in Supabase, which needs no new dependency (design in the status document, 0C.3). |
| H2 | **No password reset, no email or password change, no account deletion.** | `src/lib/session.ts`, `deleteAllDataAction` | Build these with Supabase and an email service: confirmation and reset routes, and a SQL function that deletes the signed-in user. |
| H3 | **The privacy policy is incomplete.** It doesn't name the AI providers or say they are outside India; doesn't mention health details in reviews being sent to them; doesn't mention Places, WhatsApp, IP addresses or cookies; gives no storage location or retention; has no DPDP Act rights, grievance contact or account-deletion process. The contact is hidden unless `NEXT_PUBLIC_CONTACT_EMAIL` is set. The terms lack liability, governing law, payment and termination clauses. | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Draft the full text with blanks for the owner's facts, then get a legal review. |
| H4 | **There is no hosting target or deployment configuration.** `TRUSTED_PROXY_HOPS` can't be set correctly yet; a wrong value reopens address spoofing or groups all users together. | Repository (no deploy files) | Decide the host, then verify the proxy chain (status document, 0C.2). |

### Medium

| # | Finding | Affected | Recommendation |
|---|---|---|---|
| M1 | **No error logging or monitoring.** Failures are shown to users but never recorded. | `src/instrumentation.ts`, `actions.ts` | A JSON logger that writes only allow-listed fields, Next's `onRequestError` hook, a `/api/health` endpoint, and alerts on the host. |
| M2 | **CSP allows inline scripts.** No unsafe HTML from user input was found; the only `dangerouslySetInnerHTML` is fixed FAQ data. | `next.config.ts`, `src/proxy.ts` | Nonce-based CSP, report-only first (the 5 static pages become dynamic). |
| M3 | **Server configuration is shown to owners.** Settings → "Setup status"; texts such as "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file", "Set GBP_API_APPROVED=true in .env" and "Add ANTHROPIC_API_KEY to your .env file". This reveals how the server is set up and confuses customers. | `src/app/app/google/page.tsx`, `src/app/app/settings/page.tsx`, `src/app/actions.ts`, `src/components/forms.tsx`, `src/components/Places.tsx` | Show owners plain messages ("This feature is not available yet"), and show setup details only to an operator. |
| M4 | **Supabase sees the app server's address,** so its own per-address login limits are shared by all users. Its built-in email sending is very limited. | Supabase settings | Check the Supabase Auth limits and set up your own SMTP (assumption about Supabase defaults; check in the dashboard). |
| M5 | **Places key restrictions are unknown.** | Google Cloud | Allow only the Places APIs, and the server's address if fixed. |
| M6 | **Visibility checks can be long.** Each question can make two AI calls one after the other (45-second timeout each), then the fix-list call. A check can run longer than short serverless limits. | `src/lib/ai.ts` | Check the host's limit; consider running checks in the background. |

### Low

| # | Finding | Affected |
|---|---|---|
| L1 | The signup message reveals that an email already has an account (the login-timing part was fixed 19 Nov). | `signUp` |
| L2 | Passwords need only 8 characters, with no breached-password check (Supabase can add one). | `passwordSchema` |
| L3 | HSTS `includeSubDomains` needs every subdomain on https. | `next.config.ts` |
| L4 | `SUPABASE_SERVICE_ROLE_KEY` is listed but unused (empty locally). | `.env.example` |
| L5 | Saved posts have no limit. | `postComposerAction` |
| L6 | The demo file store has no locking (demo only). | `src/lib/store.ts` |

### Verified secure today

- Every server action except signup, login and logout requires a signed-in user. All 22 actions were checked; the post actions go through `postItem`, which calls `requireUser()`.
- Inputs are validated with Zod or explicit checks; Place IDs and URLs are checked or encoded.
- React escapes AI and user text.
- Server actions get Next.js's origin check (CSRF); the OAuth callback checks a state cookie.
- Google tokens are encrypted with AES-256-GCM.
- Keys stay on the server: none found in browser responses, built files or logs.
- `npm audit`: 0 known vulnerabilities (checked 18 Nov).

### Fixed in earlier sessions (with tests)

- Forged `X-Forwarded-For` bypassing the signup and login limits.
- Targeted account lockout.
- Login timing revealing accounts.
- Weak Supabase cookies.
- Raw Supabase errors.
- Google tokens not revoked.
- `schema.sql` failing on a re-run.
- Invalid Place IDs being saved.

---

## G. UI/UX and responsiveness

| # | Finding | Where | Severity |
|---|---|---|---|
| U1 | ~~The button says "Run **another** visibility check" before any check has run~~ **Fixed 19 Nov** (new dashboard) | `src/app/app/page.tsx` | Low (wording) |
| U2 | Server-setup instructions and variable names shown to owners (see M3) | Google, Settings, Reviews and Visibility messages | Medium |
| U3 | **Fixed 19 Nov.** ~~No "Hospital" (or similar) category.~~ A hospital becomes "Doctor or clinic", so competitor and visibility questions use "clinics". Verified today: Apollo Hospitals was compared with skin clinics. | `src/lib/business.ts` | Medium (product accuracy) |
| U4 | **Fixed 19 Nov.** ~~The profile checklist is self-reported~~, but the Places audit now reads hours, website, phone, photos, category and status from Google, so the two can disagree | `/app/google` | Low |
| U5 | 12 footer links on the landing page are 18 px tall, below the 24 px minimum touch target (WCAG 2.2 AA) | `src/components/Footer.tsx` | Low |
| U6 | The 404 page uses the generic site title | `src/app/not-found.tsx` | Low |
| U7 | The Google page puts 7 sections on one long page (about 4,300 px on desktop) | `/app/google` | Low |
| U8 | Pricing is a placeholder | Landing page | Product decision |

**Responsiveness, verified today:**
- No sideways scrolling on any of the 14 user-facing pages at 390, 820 or 1,360 px.
- The phone navigation shows a "more items" hint, and the sidebar appears from 768 px.
- The browser tests repeat these checks on every run.

**Broken links or buttons:** none found. All 23 internal links resolve, and every form tested submits and validates.

---

## H. Test results (run today)

| Check | Exact result |
|---|---|
| `npm run test:unit` | **39 tests, 39 passed, 0 failed, 0 skipped** (7 files) |
| `npm run test:e2e` | **86 passed, 0 failed, 0 skipped** in 2.5 minutes. Desktop 53, mobile 29, tablet 4, across 13 spec files. |
| `npx tsc --noEmit` | Exit 0 |
| `npm run build` | Exit 0, no warnings. 18 routes: 6 static, 12 dynamic or API, plus the proxy. |
| Browser crawl | 14 pages × 3 sizes = 42 page views; 0 problems apart from U1–U8 |
| Live checks | Claude 200; Places API (New) 200 (search, audit, competitors, grid) |

**Browser tests per spec (desktop / mobile / tablet):**

| Spec | Tests |
|---|---|
| auth | 15 / 15 / – |
| onboarding | 8 / 8 / – |
| reviews-errors | 5 |
| google-connection | 4 |
| language | 4 |
| visibility | 3 |
| rate-limit-spoofing | 3 |
| layout | 2 / 2 / 2 |
| posts | 2 / 2 / – |
| review-share | 2 / 2 / 2 |
| partial-results | 2 |
| places-errors | 2 |
| insights | 1 |

**Important flows with no automated test:**
- Places success paths (they need a real key, so they are checked by hand only).
- Dashboard checklist toggles.
- Delete my data.
- ChatGPT guide checklist and notes.
- Supabase mode (only one-off runs against the stand-in).
- Every live Google Business Profile flow.
- Real AI output quality (checked by hand 18 Nov).
- Hindi post drafts with real AI.

---

## I. Production readiness

**Verdict: not ready for real customers.**

| Area | State |
|---|---|
| Hosting and deployment | **No configuration in the repository.** `npm run build` and `npm start` work. Production refuses to start without `TRUSTED_PROXY_HOPS`, and in demo mode without `ALLOW_DEMO_IN_PRODUCTION` (both by design). |
| Database | Demo JSON files only. No Supabase project; the schema is ready and tested locally. |
| Authentication | Solid in demo mode. The Supabase path is tested only against a stand-in. Reset, change and deletion are missing. |
| Integrations | Claude and Places are ready. Google Business Profile needs approval. OpenAI and Gemini are optional. |
| Configuration | **Missing from `.env`:** Supabase values, Google OAuth keys, `TRUSTED_PROXY_HOPS`, `NEXT_PUBLIC_CONTACT_EMAIL`. `NEXT_PUBLIC_APP_URL` is http (local). |
| Logging and monitoring | None |
| Error handling | Good, with clear messages for users. An `/app` error page exists; there is no root `error.tsx` or `global-error.tsx`. |
| Performance and scale | Rate limits in memory (H1); long visibility checks (M6); demo file store not for concurrent use; 5 marketing pages prerendered. |
| Legal | Privacy and terms are incomplete (H3) |

---

## J. Outdated documentation and discrepancies

| Document | Discrepancy |
|---|---|
| `docs/MASTER_PROJECT_STATUS.md` | The header says "26 unit tests" and "78 Playwright tests"; actual: **39 and 86**. Row N2 says "18 unit tests and 26 Playwright". Section 0D and several Places rows still say **Places API (New) is refused**; today it works with the remaining key. The main Places rows describe the fallback as the live path. |
| `docs/product-audit/*` (5 files, 18 Nov morning) | A snapshot from before all later work. For example: "no tests in the repo", the medical-rule bugs, the composer and quota issues, no Places features, `schema.sql` not re-runnable. `CLAUDE_PROJECT_CONTEXT.md` would mislead a new session. |
| `README.md` | No test commands (`npm test`, `test:e2e`), no Playwright, no `GOOGLE_PLACES_API_KEY`, no Places features. Production steps don't mention that `SESSION_SECRET` is now needed in both modes (the production step does say to generate one). |
| `tests/README.md` | Missing `places-errors.spec.ts`, `account-security.test.ts` and `places-fallback.test.ts`. It doesn't say the partial-results server has an invalid Places key. |
| `.env.example` | `NEXT_PUBLIC_CONTACT_EMAIL` is read by the code but missing. `SUPABASE_SERVICE_ROLE_KEY` is listed but unused. |
| `AGENTS.md` | Generated by `next dev` (Next.js agent notice); not project documentation |

---

## K. Missing features and technical debt

**Missing features:**
- password reset, email or password change, account deletion, email confirmation route;
- an email service;
- several businesses or locations per account;
- automatic scheduled publishing;
- Google performance insights;
- business information sync from Google;
- editing an event or offer's details after saving;
- pricing and billing;
- a "Hospital" (and similar) category;
- linking the checklist to the Places audit;
- profile score and rank-grid history charts;
- smarter dashboard actions;
- a privacy and terms rewrite.

**Technical debt:**
- in-memory rate limits;
- no logging;
- CSP inline scripts;
- the unused `geist` dependency;
- no cap on saved posts;
- JSON-blob storage with no migration tool;
- the demo store has no locking;
- the operator and customer messages mixed (M3);
- outdated docs (section J);
- Places success paths not in the automated suite.

---

## L. Recommended roadmap

For each item: **why** it's needed, what **already exists**, its **dependencies** and its **impact**.

### P0: Critical blockers (before any real customer)

1. **Choose the hosting target and add its deployment configuration.**
   - **Why:** the proxy setting, rate-limit store, timeouts and monitoring all depend on it (H4, H1, M6).
   - **Exists:** `TRUSTED_PROXY_HOPS` support and the startup check.
   - **Depends on:** your decision.
   - **Impact:** unblocks every other production step.
2. **Create a Supabase project, connect it, and run the full account and data flow live.**
   - **Why:** demo files can't serve customers.
   - **Exists:** all the code, a re-runnable schema, local RLS proof.
   - **Depends on:** the Supabase project, a region (Mumbai for data in India), and your own SMTP.
   - **Impact:** real accounts.
3. **Account lifecycle:** password reset, email confirmation route, change email and password, full account deletion.
   - **Why:** H2 and DPDP Act rights.
   - **Exists:** "Delete my data", Google revocation, rows deleted with the user.
   - **Depends on:** item 2 and SMTP.
   - **Impact:** legal and support readiness.
4. **Privacy policy and terms rewrite, then legal review.**
   - **Why:** H3.
   - **Exists:** short versions.
   - **Depends on:** the owner's facts (host, region, contact, grievance officer).
   - **Impact:** launch compliance, and Google OAuth verification.
5. **Shared rate limits, if the host is serverless or runs several instances.**
   - **Why:** H1.
   - **Exists:** limiter logic and tests.
   - **Depends on:** items 1 and 2.
   - **Impact:** abuse protection that actually holds.

### P1: Important improvements

6. **Monitoring:** safe JSON logging, `onRequestError`, `/api/health`, alerts (M1).
   - **Exists:** nothing.
   - **Depends on:** the host's logging.
   - **Impact:** failures become visible.
7. **Separate operator and owner messages (M3, U2).**
   - **Exists:** messages are already clear, just aimed at the wrong person.
   - **Depends on:** nothing.
   - **Impact:** professional UX and less information exposure.
8. **Google Business Profile go-live:** API approval, OAuth keys, live tests of locations, reviews, replies and posts (Event and Offer), revocation.
   - **Exists:** all the code and guards.
   - **Depends on:** Google approval.
   - **Impact:** the core promise of the product.
9. **CSP nonce, report-only first (M2).**
   - **Exists:** a strict CSP apart from inline scripts.
   - **Depends on:** item 1, to collect reports.
   - **Impact:** defence in depth.
10. **Update the documentation (section J)** and mark `docs/product-audit/` as superseded.
    - **Depends on:** nothing.
    - **Impact:** future work starts from facts.
11. **Supabase Auth settings and Places key restrictions (M4, M5).**
    - **Depends on:** items 2 and Google Cloud access.
    - **Impact:** fewer abuse and billing risks.

### P2: Product improvements

12. **Done 19 Nov.** **Better categories (U3).** Add Hospital, Multi-speciality hospital and others, with phrases for competitor and visibility questions.
    - **Impact:** correct comparisons for larger healthcare providers.
13. **Done 19 Nov.** **Fill the checklist from the Places audit (U4).**
    - **Exists:** both features.
    - **Impact:** less manual ticking and consistent data.
14. **Done 19 Nov.** **Dashboard:** use the audit, grid and fix list for the next actions; show profile-score and grid history; fix the U1 wording.
    - **Exists:** the stored history.
15. **Places success-path tests** with a recorded or test key, kept out of normal runs.
    - **Impact:** regression safety for the paid features.
16. **Post improvements:** edit event and offer details, cap saved posts (L5), real Hindi post check with Claude.
17. **Long-running visibility checks in the background (M6),** if the host's request limit is short.

### P3: Future enhancements

- Several businesses or locations per account (needs a data model change).
- Automatic scheduled publishing (needs a job runner).
- Google performance insights and business information sync.
- Pricing and billing.
- Remove the unused `geist` dependency.
- Split the Google page into tabs (U7).
- Larger footer tap targets (U5) and a 404 page title (U6).

---

## Verified facts, assumptions and recommendations

| Kind | What it covers |
|---|---|
| **Verified facts** | Everything marked "Verified today" or with a test or crawl result: test counts, build output, crawl results, live Claude and Places calls, environment variable **names** and whether they are set (values never printed), code locations |
| **Verified earlier** | Real Claude prompt quality (18 Nov), Supabase stand-in runs (19 Nov), local PostgreSQL RLS (19 Nov), Places fallback live (19 Nov), production startup refusal (18 Nov), `npm audit` (18 Nov) |
| **Assumptions** | Supabase plan backups and email limits; Vercel's handling of `X-Forwarded-For`; serverless time limits; Google Maps Platform policy wording. Each needs checking against the provider when the host is chosen. |
| **Recommendations** | Section L, and the "Recommendation" columns in section F |

---

## Addendum 4: Google Business Profile integration (19 November 2026)

Google approved the Business Profile API project (300 QPM). The integration is now built end to end; see `docs/MASTER_PROJECT_STATUS.md` section 0H for the full list, files and the live checklist.

**Changes to earlier findings in this audit:**
- "Google errors are generic (every 403/429 is 'blocked')": **fixed.** Errors are classified (reconnect, scope, permission, not enabled, quota, not found, invalid, unavailable, network) with plain messages; setup details are logged server-side only.
- "Expired or revoked refresh tokens fail every page": **fixed.** `invalid_grant` marks the connection "Reconnect needed".
- "No paging for accounts, locations or reviews": **fixed.**
- "Location picker does not use the finder's listing": **fixed.** Automatic choice by Place ID, mismatch warning.
- "Approve and post in one click": **changed.** Approve and Publish are separate; publishing requires the approved text unchanged, checked on the server.
- "Published posts cannot be edited": **changed.** Edits need approval, then `localPosts.patch` with an update mask (accepted fields not documented by Google: verify live).
- OAuth now uses PKCE, and the callback checks a signed cookie naming the user who started the sign-in.
- Customer pages no longer show `.env` instructions (Google page, Reviews, Posts). The Settings page "Setup status" list is unchanged and still names `GOOGLE_PLACES_API_KEY`; consider hiding it from customers (not changed: outside this task).

- Demo store writes (`user_data.json`) are now atomic; `users.json` is not yet (same risk, outside this task).
- Background writes to the Google connection are tied to the sign-in they started from, so a slow request cannot restore an older connection.
- The reply length check is now Google's documented 4096 bytes, instead of 4000 characters (Hindi replies are limited earlier, at about 1365 characters).

**New risks and notes:**
- Rate guard for the 300 QPM quota is per process memory, like the other limiters. Several instances need a shared store.
- `GOOGLE_API_BASE_URL` is a test-only setting. It is ignored unless it is an `http://` loopback address, so a misconfiguration cannot send tokens elsewhere.
- Insights are stored on the connection (the owner's own Business Profile data); they are deleted on disconnect and on "Delete my data".
- Not verified against real Google: every Business Profile call. All tests use a local stand-in. See the separation in 0H.3.

---

## Addendum 5: intelligence and automation upgrade (20 November 2026)

See `docs/MASTER_PROJECT_STATUS.md` section 0K for the feature-by-feature status.

**Changes to earlier findings:**
- **Multi-location:** "not built" is now built. The first location keeps its original storage keys; others are prefixed.
- **Scheduling:** "saved date only" is now a persistent job queue with retries and logs.
- **AI providers:** Claude only by default; OpenAI and Gemini need `AI_EXTRA_PROVIDERS=true`.
- **Fixed** (route handlers and pages each had their own copies, which allowed lost updates):
  - the in-process write lock;
  - the rate-limit counters.

**New risks:**
- **Background jobs on serverless or multi-instance hosting need an external scheduler.** The in-process lease protects one process only.
- **Demo-mode job runner reads every user's data in one file.** Fine for a single server, not for scale.
- **Automatic review replies publish without a human read.** They are limited to positive, non-sensitive reviews that pass every check, need an explicit opt-in and a live connection, and are logged. The opt-in date is stored.
- **Report PDFs use Helvetica (Latin only).** Non-Latin text appears as "?" in the PDF; the page shows it correctly.
