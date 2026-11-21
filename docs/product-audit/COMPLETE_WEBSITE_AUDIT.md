# GMB Growth Engine: Complete Website Audit

Audit date: 18 November 2026
Scope: the whole repository as it exists today, every route, every feature, and every external integration.
Method: code inspection plus automated browser and server tests on an isolated copy of the project. The real `.data/` folder and `.env` file were not read by the tests and were not changed.

Related documents in this folder:

- [FEATURE_STATUS_MATRIX.md](FEATURE_STATUS_MATRIX.md): one line per feature with its status and evidence.
- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md): stack, structure, data flow, database, integrations.
- [KNOWN_ISSUES_AND_ROADMAP.md](KNOWN_ISSUES_AND_ROADMAP.md): every open issue with a P0 to P3 priority.
- [CLAUDE_PROJECT_CONTEXT.md](CLAUDE_PROJECT_CONTEXT.md): short context file for future development sessions.

---

## Contents

1. [Status labels used in this audit](#1-status-labels-used-in-this-audit)
2. [Project overview](#2-project-overview)
3. [How the audit was tested](#3-how-the-audit-was-tested)
4. [Page-by-page audit](#4-page-by-page-audit)
5. [Feature audit](#5-feature-audit)
6. [Backend and database audit](#6-backend-and-database-audit)
7. [External integrations](#7-external-integrations)
8. [Security and reliability audit](#8-security-and-reliability-audit)
9. [UI and UX audit](#9-ui-and-ux-audit)
10. [Testing and build audit](#10-testing-and-build-audit)
11. [What is required before launch](#11-what-is-required-before-launch)

---

## 1. Status labels used in this audit

| Status | Meaning |
|---|---|
| **WORKING** | Tested successfully in this audit with the real application logic. |
| **PARTIALLY WORKING** | Some of it works; known limitations remain. |
| **DEMO / MOCK** | Uses sample data, the local file store, or a mocked service. |
| **NOT WORKING** | The code exists but fails. |
| **NOT IMPLEMENTED** | The feature does not exist in the code. |
| **NOT VERIFIED** | Cannot be tested here because credentials, approval or an external service is missing. |

Two rules applied throughout:

- **Anything that needs Claude, OpenAI or Gemini was tested only against a mock AI server.** The application flow around the AI call is tested; the quality and format of real AI answers is NOT VERIFIED.
- **Most WORKING features were tested in demo mode**, where data is saved to local JSON files. The same code saves to Supabase in production mode, but that path was tested only against a local stand-in for Supabase, never a real Supabase project.

No feature reached NOT WORKING in today's tests. Several features are PARTIALLY WORKING because of specific bugs or gaps, listed with each feature.

---

## 2. Project overview

### What the product is

GMB Growth Engine is a web app for local business owners, especially doctors and clinics, that brings three jobs into one place:

1. **Google Business Profile upkeep.** Reply to Google reviews and write Google posts with AI drafts that the owner edits and approves. Work through a profile checklist. Get a review link and QR code.
2. **AI visibility checks.** Ask AI models (Claude, and optionally ChatGPT and Gemini) the questions a customer would ask, such as "best dentist in Bhubaneswar", and record whether the business is named.
3. **ChatGPT Business Hub guide.** A checklist and notes page to prepare for claiming a business listing with OpenAI. The app has no connection to OpenAI's Business Hub.

The product promises that nothing is posted to Google without the owner's approval, that negative reviews are never hidden, and that no rankings or leads are guaranteed.

### Target customers and business categories

Two business types, chosen during onboarding. The type changes wording, AI prompt rules, checklist items and post options.

| Type | Categories offered | What changes |
|---|---|---|
| Healthcare or wellness | Doctor or clinic, Dentist, Diagnostic centre, Therapist or counsellor, Physiotherapy, Other healthcare | Reply drafts must not mention diagnoses or patient details. Posts are scanned for risky medical advertising wording. No "Offer" post type. An extra checklist item for doctor names and qualifications (11 items instead of 10). |
| Local business | Salon or spa, Restaurant or cafe, Gym or fitness, Hotel, Retail shop, Other local service | Plain reply rules. "Offer" posts allowed. 10-item checklist. |

Source: [src/lib/business.ts](../../src/lib/business.ts), [src/lib/ai.ts](../../src/lib/ai.ts), [src/components/forms.tsx](../../src/components/forms.tsx).

### Technology stack (installed versions)

| Layer | Technology |
|---|---|
| Framework | Next.js 16.4.6 (App Router, Turbopack, Server Actions, `proxy.ts`) |
| UI | React 19.3.1, Tailwind CSS 4.3.5, Phosphor icons 2.1.10, DM Sans font through `next/font/google` |
| Language | TypeScript 7.0.2, strict mode |
| Validation | Zod 4.6.7 |
| Database and auth (production) | Supabase via `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.119.0 |
| Database and auth (demo) | JSON files in `.data/` |
| AI | Anthropic Messages API, OpenAI Chat Completions, Google Gemini `generateContent`, all called with plain `fetch` |
| Google | Google OAuth 2.0 and the Business Profile APIs, called with plain `fetch` |
| QR codes | `qrcode` 1.5.4, generated on the server |

There are no automated tests, no CI configuration, and no git repository.

### Architecture in one paragraph

Everything runs in one Next.js app. Pages are server-rendered React components that read the signed-in user's data directly on the server. Forms submit to **Server Actions** in [src/app/actions.ts](../../src/app/actions.ts), which check the user, validate input, call AI or Google if needed, and save through a small key-value store in [src/lib/store.ts](../../src/lib/store.ts). The store writes either to local JSON files (demo mode) or to one Supabase table protected by row level security (supabase mode). Only two classic API routes exist, both for Google sign-in. The browser never talks to Google, Supabase or an AI provider directly.

Full detail: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md).

### Modes

`APP_MODE` must be exactly `demo` or `supabase`. If it is missing or misspelt the server refuses to start. A production build (`npm run build` then `npm start`) also refuses demo mode unless `ALLOW_DEMO_IN_PRODUCTION=true`. Source: [src/lib/env.ts](../../src/lib/env.ts), [src/instrumentation.ts](../../src/instrumentation.ts).

| | Demo mode | Supabase mode |
|---|---|---|
| Accounts | `.data/users.json`, scrypt password hashes | Supabase Auth (email and password) |
| Sessions | Random id in a signed cookie, record in `.data/sessions.json` | Supabase cookies, refreshed by `src/proxy.ts` |
| User data | `.data/user_data.json` | `public.user_data` table with RLS |
| Intended use | Local testing only | Production |

### Current local setup (names only, no values)

The local `.env` sets `NEXT_PUBLIC_APP_URL`, `APP_MODE`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_REDIRECT_URI`, `GBP_API_APPROVED` and `ANTHROPIC_MODEL`.

It leaves empty: all Supabase values, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and all OpenAI and Gemini values.

So the app on this machine runs in demo mode, with no AI provider and no Google sign-in configured. Running `npm start` with this `.env` will refuse to start because `ALLOW_DEMO_IN_PRODUCTION` is not set. `npm run dev` works.

---

## 3. How the audit was tested

| Item | Detail |
|---|---|
| Machine | macOS, Node 24.21.0, npm 11.19.0 |
| Isolation | The project source was copied to a scratch folder and checked byte-for-byte against the real source (checksums matched). All builds and test servers ran from the copy on port 3111 with its own empty `.data/`. |
| Secrets | Random throwaway `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` per run. The real `.env` was never loaded by a test server. |
| Browser | Headless Google Chrome driven by `puppeteer-core`, installed in the scratch folder only (not added to the project). |
| AI | A local mock server stood in for the Anthropic API (via `ANTHROPIC_BASE_URL`). It returns canned answers and can simulate 429, 500, non-JSON, empty answers and a provider that never replies. |
| Google | Fake client id and secret, so the redirect to Google and all callback guards could run. No request ever reached a real Google account. |
| Supabase | A local stand-in that implements the parts of Supabase Auth and PostgREST the app uses, with strict refresh-token rotation and a switchable database outage. It does **not** enforce RLS. |
| RLS | `supabase/schema.sql` applied to a throwaway local PostgreSQL with simulated `anon` and `authenticated` roles and an `auth.uid()` function. |

"Previous session" in this document means tests run on 17 November 2026 during the earlier audit and fix work. Every important previous result was re-run today unless marked otherwise.

---

## 4. Page-by-page audit

### Route map

| Route | Type | Login needed | Business needed | File |
|---|---|---|---|---|
| `/` | Landing page, static | No | No | [src/app/page.tsx](../../src/app/page.tsx) |
| `/login` | Log in | No (logged-in users are sent to `/app`) | No | [src/app/login/page.tsx](../../src/app/login/page.tsx) |
| `/signup` | Create account | No (logged-in users are sent to `/app`) | No | [src/app/signup/page.tsx](../../src/app/signup/page.tsx) |
| `/privacy` | Privacy policy, static | No | No | [src/app/privacy/page.tsx](../../src/app/privacy/page.tsx) |
| `/terms` | Terms of service, static | No | No | [src/app/terms/page.tsx](../../src/app/terms/page.tsx) |
| any unknown path | 404 page | No | No | [src/app/not-found.tsx](../../src/app/not-found.tsx) |
| `/opengraph-image` | Social share image (1200x630 PNG) | No | No | [src/app/opengraph-image.tsx](../../src/app/opengraph-image.tsx) |
| `/icon.svg` | Favicon | No | No | [src/app/icon.svg](../../src/app/icon.svg) |
| `/app` | Dashboard | Yes | Yes | [src/app/app/page.tsx](../../src/app/app/page.tsx) |
| `/app/onboarding` | Add or edit business | Yes | No | [src/app/app/onboarding/page.tsx](../../src/app/app/onboarding/page.tsx) |
| `/app/google` | Google profile, checklist, QR | Yes | Yes | [src/app/app/google/page.tsx](../../src/app/app/google/page.tsx) |
| `/app/reviews` | Reviews and replies | Yes | Yes | [src/app/app/reviews/page.tsx](../../src/app/app/reviews/page.tsx) |
| `/app/posts` | Google posts | Yes | Yes | [src/app/app/posts/page.tsx](../../src/app/app/posts/page.tsx) |
| `/app/visibility` | AI visibility checks | Yes | Yes | [src/app/app/visibility/page.tsx](../../src/app/app/visibility/page.tsx) |
| `/app/chatgpt` | ChatGPT Business Hub guide | Yes | Yes | [src/app/app/chatgpt/page.tsx](../../src/app/app/chatgpt/page.tsx) |
| `/app/settings` | Settings | Yes | Yes | [src/app/app/settings/page.tsx](../../src/app/app/settings/page.tsx) |
| `/api/google/start` | API route (GET): starts Google sign-in | Yes | No | [src/app/api/google/start/route.ts](../../src/app/api/google/start/route.ts) |
| `/api/google/callback` | API route (GET): finishes Google sign-in | Yes | No | [src/app/api/google/callback/route.ts](../../src/app/api/google/callback/route.ts) |

Shared pieces that are not routes:

- [src/app/app/layout.tsx](../../src/app/app/layout.tsx) wraps every `/app` page. It requires a signed-in user and draws the sidebar, user email and Log out button. Search engines are told not to index `/app`.
- [src/app/app/error.tsx](../../src/app/app/error.tsx) is shown when an `/app` page cannot load its data. It reads "We could not load your data" and has a Try again button.
- [src/proxy.ts](../../src/proxy.ts) runs before `/app/*`, `/login`, `/signup` and `/api/google/*`. In supabase mode it refreshes the session. In demo mode it does nothing.

Tested today: all 8 public routes return the expected status (200, or 404 for unknown paths). All 8 `/app` routes and both API routes redirect to `/login` when not signed in.

---

### `/` Landing page

**Purpose:** explain the product and get visitors to create an account.

**Sections, top to bottom:**
1. Fixed navigation bar: logo, Platform dropdown (Review replies, AI visibility checks, Google posts, Profile checklist), Features, Solutions, Pricing, Resources, Sign in, Create account. Transparent over the hero, solid once scrolled. Phones get a full-screen menu.
2. Dark brown hero: headline, description, Create your account and See how it works buttons, a note that Google's official API is used, an illustrated neighbourhood map with three floating example cards, and four product facts (3 AI models, 2 questions per model, 11-point checklist, 0 posts without approval).
3. Why it matters.
4. Features: four cards (reviews, AI visibility, medical wording check, profile checklist), each with a small mock-up labelled "Sample".
5. Dashboard preview with sample data, labelled "Sample data".
6. A scroll-driven tagline.
7. How it works: 3 steps.
8. Solutions: clinics and doctors, local businesses.
9. Trust: what the product will not do.
10. Pricing: placeholder text, "Plans will be listed here when they are available".
11. Resources: 8 FAQ items with FAQPage structured data for search engines.
12. Final call to action and footer.

**Backend actions, database, authentication:** none. The page is static.

**Status: WORKING.** Tested today: all sections render, the dropdown opens by mouse and keyboard, every in-page link (`/#features`, `/#pricing` and so on) has a matching section, the FAQ expands, structured data is present, there is no horizontal scroll on a 390px phone, and the mobile menu opens.

**Limitations:** Pricing has no real plans. No testimonials or customer numbers exist, intentionally, because there are no real customers to quote.

---

### `/login` and `/signup`

**Purpose:** sign in, or create an account.

**Layout:** split screen with a dark brown panel (headline and three promises) and a form card. On phones only the form shows. Source: [src/components/AuthShell.tsx](../../src/components/AuthShell.tsx).

**Form fields:** Email, Password. Sign up adds the hint "At least 8 characters". A link switches between the two pages.

**Backend actions:** `logInAction` and `signUpAction` in [src/app/actions.ts](../../src/app/actions.ts), which call `logIn` and `signUp` in [src/lib/session.ts](../../src/lib/session.ts).

**Validation:** email must be valid (Zod, checked on the server). Signup password 8 to 128 characters. Email is trimmed and lower-cased. After an error the email is kept in the field and the password is cleared.

**Rate limits:** login 5 attempts per email and 20 per network address per 15 minutes. A correct login clears the email counter. Signup 5 per network address per hour.

**Database:** demo mode writes `.data/users.json` and `.data/sessions.json`. Supabase mode uses Supabase Auth.

**Status: WORKING in demo mode. NOT VERIFIED against a real Supabase project.** Tested today: invalid email rejected on the server, short password rejected with the email kept, unknown email gives a generic error, signup lands on onboarding, login is case-insensitive for email, a signed-in user visiting `/login` is sent to `/app`, and all rate limits trip at the right count.

**Missing:** password reset, "show password", email verification in demo mode, and a Supabase email-confirmation callback route (see Section 5.1).

---

### `/privacy` and `/terms`

**Purpose:** legal pages. Static, no backend.

**Status: PARTIALLY WORKING.** They render. The privacy page shows the literal text `{{contact_email}}` because `NEXT_PUBLIC_CONTACT_EMAIL` is not set (seen in today's test). The README says both pages need a lawyer's review. The privacy page says Google tokens are deleted "when you delete your account". The app can delete data but has no account deletion, so this wording does not match the product.

---

### `/app/onboarding`

**Purpose:** first-time business setup. The same form is reused on the Settings page.

**Fields:** business type (Healthcare or wellness / Local business), business name (2 to 120 characters), website (required; `https://` is added if missing; must be a valid URL), city or area (2 to 120), category (dropdown that depends on the type), phone (optional, up to 30), Google Place ID (optional, up to 200).

**Backend:** `saveBusinessAction`, which saves the `business` key. The first save redirects to `/app`.

**Gate:** until a business is saved, every other `/app` page redirects here (`requireBusiness` in [src/lib/ctx.ts](../../src/lib/ctx.ts)).

**Status: WORKING** (demo mode). Tested today: field errors for a short name and short city, invalid website rejected, the chosen type is kept after an error, a successful save opens the dashboard, and the redirect gate works.

---

### `/app` Dashboard

**Purpose:** a one-screen overview with the next three things to do.

**Shows:**
- Business name, city and category.
- **Google connection card:** "Not connected", "Connected, waiting for Google approval" (tokens stored but `GBP_API_APPROVED` is not true, or no location chosen), or "Connected".
- **Latest AI visibility check card:** a ring chart and "Named in X of Y answers" with the date, or "No check yet".
- **Profile checklist card:** "X of 11 done" (10 for local businesses) with a progress bar.
- **Your next three actions:** chosen by fixed rules in [src/lib/recommend.ts](../../src/lib/recommend.ts). In order: connect Google if not connected; run a first check, or fix why AI skipped you if any answer missed you; the first two unticked checklist items; the ChatGPT guide. Only the first three are shown. No AI is involved.
- Every card shows where its number came from, for example "Source: manually entered by you".

**Actions:** "Run another visibility check" links to `/app/visibility`. Each recommended action links to the relevant page.

**Data:** reads `business`, `google` and `checks`.

**Status: WORKING** (demo mode). Tested today: correct initial state, exactly three actions, the checklist count updates after toggling, the latest check result appears, the "Connected, waiting for Google approval" state appears with a seeded connection record, and the connect recommendation disappears once connected.

**Limitation:** there is no "dashboard statistic" beyond these three cards. No review counts, ratings or Google performance data, because no live Google data exists yet.

---

### `/app/google` Google profile

**Purpose:** connect Google, choose a location, work through the profile checklist, and get the review link and QR code.

**Sections:**
1. Error or success banner after the Google sign-in round trip. Four error messages: cancelled, state check failed, exchange failed, not configured.
2. "Waiting for Google approval" notice while `GBP_API_APPROVED` is not `true`.
3. **Connection.** Not connected: a "Connect Google Business Profile" link to `/api/google/start`, greyed out if Google keys are missing. Connected: "Connected as (email) on (date)", the managed location, a location dropdown (only when Google returns locations), and "Disconnect and delete stored tokens".
4. **Profile checklist:** 10 or 11 toggle buttons, each with a reason. Saved in `business.audit`. These are the owner's own answers, not data read from Google.
5. **Review link and QR code:** built from the Place ID entered in Settings, as `https://search.google.com/local/writereview?placeid=...`. The QR image is generated on the server as a PNG data URL.

**Backend actions:** `toggleAuditAction`, `chooseLocationAction`, `disconnectGoogleAction`, plus the two API routes.

**Status:**
- Checklist: **WORKING**. Toggles on and off and persists; tested today.
- Review link and QR: **WORKING**. QR renders (192px) with the correct link; tested today.
- Connect, callback guards, disconnect: **PARTIALLY WORKING**. The guards and local disconnect work. The full Google sign-in is NOT VERIFIED (see 5.4).
- Location discovery and selection: **NOT VERIFIED**. Needs an approved Google project.

---

### `/app/reviews` Reviews

**Purpose:** read reviews and reply with AI help.

**Shows:** a "Sample data" banner and a "Sample" label on every review while live Google data is unavailable. Each review shows reviewer name, star rating, date, source label, "Already replied" if it has a reply, and the text, or "The reviewer left a rating without text".

**Actions per unreplied review:** a text area, then **Draft with Claude**, **Save draft**, and **Approve**. Approve becomes **Approve and post to Google** when a live connection exists. The saved status (draft, approved, posted) appears as a badge.

**Backend:** `replyAction`. The server first looks the review up in the user's own loaded reviews. A review id that is not in that list is refused. The AI prompt is built from the server's copy of the review, not from form fields.

**Data:** `replies` key, a map from review id to `{ text, status, updatedAt }`.

**Status:**
- Review listing: **DEMO / MOCK**. Four hard-coded sample reviews ([src/lib/google.ts](../../src/lib/google.ts), `sampleReviews`).
- Draft, save and approve flow: **WORKING** for app logic (tested today). The AI draft text itself is NOT VERIFIED; it came from the mock.
- Posting replies to Google: **NOT VERIFIED**.

---

### `/app/posts` Posts

**Purpose:** write, approve and publish Google posts.

**Composer fields:** "What is the post about?" (topic for the AI), Post text (10 to 1,500 characters, live counter), Type (Update and Event; Offer only for local businesses), Schedule for (optional date and time). Buttons: **Draft with Claude**, **Save as draft**.

**Post list:** type badge, status badge, created date, "planned for" date if set, text, healthcare wording warnings, and buttons **Approve** (drafts), **Publish to Google** (approved posts; disabled without a live connection), and **Delete**.

**Backend:** `postComposerAction` (draft, save) and `postItemAction` (approve, publish, delete). Actions only ever act on the signed-in user's own list.

**Status:**
- Write, save, approve, delete: **WORKING** (tested today).
- AI draft: app flow works; real AI text NOT VERIFIED.
- Healthcare wording warnings on posts: **PARTIALLY WORKING**. Four of five rules fired in today's test. The "100%" rule never fires (bug, see 5.6).
- Scheduling: **PARTIALLY WORKING**. The date is saved and shown, but nothing ever publishes automatically. The form says "Publishing is always manual in this version".
- Publishing to Google: **NOT VERIFIED**. The code also has known gaps: Event and Offer posts are sent without the event or offer details Google expects, and a failed publish shows no message.

---

### `/app/visibility` AI visibility

**Purpose:** check whether AI models name the business.

**Shows:** the business, category and city being checked; provider badges (Claude on or off, ChatGPT on or off, Gemini on or off); a **Run a new check** button with the loading text "Asking the AI models. This takes up to a minute."; the latest result card per question (provider, Named or Not named, the exact question, an answer excerpt when named, or other businesses named instead); a methodology note; a "What to do next" list; and a bar chart and list of earlier checks.

**Backend:** `runVisibilityAction`, which calls `runVisibility` in [src/lib/ai.ts](../../src/lib/ai.ts).

**Data:** the `checks` key; the latest 30 are kept.

**Status: PARTIALLY WORKING.** The pipeline, error handling, history and chart all work against the mock (tested today). The accuracy of matching is limited, and real provider answers are NOT VERIFIED. Details in 5.7.

---

### `/app/chatgpt` ChatGPT Business Hub guide

**Purpose:** help an owner prepare to claim their listing with OpenAI.

**Shows:** a clear notice that the product has no connection to ChatGPT Business Hub; six general steps; an 8-item preparation checklist with a "(n of 8 ready)" count; a notes box (up to 4,000 characters); and a form to record numbers OpenAI shows, with date, label and value, newest first, up to 50.

**Backend:** `toggleGuideAction`, `saveGuideNotesAction`, `addInsightAction`. **Data:** `guide` key.

**Status: WORKING** as a manual tracker (tested today). Entries cannot be edited or deleted one by one. There is no integration with OpenAI, by design.

---

### `/app/settings` Settings

**Sections:**
1. **Business details:** the onboarding form, pre-filled. Saving shows "Business details saved."
2. **Setup status**, read-only: app mode, Google sign-in configured, Google API approved, and whether Claude, OpenAI and Gemini are on.
3. **Delete my data:** a confirmation checkbox, then "Delete all my data". This removes business, checks, google tokens, replies, posts and guide progress, then redirects to onboarding.

**Status:**
- Business details and setup status: **WORKING** (tested today).
- Delete my data: **WORKING**. All six data keys were removed and another account was untouched, tested today. It does not delete the login account itself.
- User settings (change email or password) and account deletion: **NOT IMPLEMENTED**.

---

### `/api/google/start` and `/api/google/callback`

**Start:** requires a signed-in user. If Google keys are missing it redirects to `/app/google?error=not_configured`. Otherwise it creates a random 48-character state value, stores it in an httpOnly cookie for 10 minutes, and redirects to Google with scopes `https://www.googleapis.com/auth/business.manage openid email`, `access_type=offline` and `prompt=consent`.

**Callback:** requires a signed-in user. It handles a cancelled sign-in (`error=denied`), checks that the state matches the cookie (`error=state`), exchanges the code for tokens (`error=exchange` on failure), encrypts the tokens with AES-256-GCM, saves them under the `google` key, and redirects with `connected=1`.

**Status:** guards **WORKING** (tested today with fake credentials). The real exchange and token storage are **NOT VERIFIED**.

---

## 5. Feature audit

The single-line version of every status is in [FEATURE_STATUS_MATRIX.md](FEATURE_STATUS_MATRIX.md). This section explains the reasoning.

### 5.1 Authentication and accounts

| Feature | Status | Evidence |
|---|---|---|
| Signup | WORKING (demo); NOT VERIFIED (Supabase) | Tested today. Supabase signup was tested only against the stand-in. |
| Login | WORKING (demo); NOT VERIFIED (Supabase) | Tested today, including the generic error and case-insensitive email. |
| Logout | WORKING | Tested today. A copied cookie stops working after logout. |
| Password validation | WORKING | 8 to 128 characters on signup. No complexity rule. |
| Password storage (demo) | WORKING | scrypt with a 16-byte random salt and 64-byte key; constant-time compare. The stored file holds only hashes (checked today). |
| Session management (demo) | WORKING | Random 64-character session id, HMAC-signed cookie, server-side record, 14-day expiry, deleted on logout. Tested today: forged, tampered, old-format and expired cookies are refused; a second device stays signed in when the first logs out. |
| Session management (Supabase) | NOT VERIFIED | `src/proxy.ts` refreshes sessions. Tested only against the stand-in: one refresh, rotated cookie kept, still signed in across five page loads. |
| Rate limiting | WORKING | Tested today. Limits live in one server process's memory. |
| User isolation | WORKING (demo); policies verified in PostgreSQL | See 6.5. |
| Email verification | NOT IMPLEMENTED (demo); NOT VERIFIED (Supabase) | Supabase may require email confirmation. The app shows "Check your email" when no session comes back, but has no route to finish the confirmation link (no `exchangeCodeForSession` handler). After confirming, the user must log in by hand. |
| Password reset | NOT IMPLEMENTED | No page or action. |
| Change email or password | NOT IMPLEMENTED | |
| Delete account | NOT IMPLEMENTED | Only "Delete my data" exists. The login account stays (confirmed today). |

### 5.2 Business onboarding

Business registration, name, category, location, website, phone and Place ID are **WORKING** (tested today). Changing the business type changes the categories, the checklist length, the post types and the AI rules (tested today for both types). There is no separate "onboarding checklist". The profile checklist on the Google page serves that role.

### 5.3 Dashboard

Business overview, Google connection status, latest AI visibility result, profile checklist progress and the three recommended actions are all **WORKING** (tested today). The recommendations follow fixed rules, not AI. There are no performance statistics because live Google data is not available.

### 5.4 Google Business Profile

| Feature | Status | Notes |
|---|---|---|
| OAuth start | WORKING | Correct redirect, scopes and state cookie (tested today with fake keys). |
| OAuth callback guards | WORKING | Missing state, wrong state, cancel and bad code all handled; nothing stored (tested today). |
| Full OAuth sign-in and token exchange | NOT VERIFIED | Needs a real Google Cloud OAuth client. Before OAuth verification, only test users added in Google Cloud Console can connect. |
| Token encryption at rest | NOT VERIFIED (code inspection only) | AES-256-GCM with a random 12-byte IV and auth tag ([src/lib/crypto.ts](../../src/lib/crypto.ts)). Never exercised, because no real token exchange happened. |
| Token refresh | NOT VERIFIED | `accessToken()` refreshes when within 60 seconds of expiry and saves the new encrypted token. |
| Location discovery | NOT VERIFIED | Lists accounts, then up to 100 locations per account. No paging beyond that. |
| Location selection | NOT VERIFIED | The server now accepts only a location Google lists for this user. The form only appears once Google returns locations, so it could not be reached. |
| Business information sync (hours, categories and so on) | NOT IMPLEMENTED | Only the location title is read. The checklist is self-reported. |
| Reviews from Google | NOT VERIFIED | Up to 50 reviews, no paging. |
| Review replies to Google | NOT VERIFIED | PUT to `.../reviews/{id}/reply`. Only allowed for reviews from the selected location. |
| Post publishing | NOT VERIFIED, with known gaps | Sends only `languageCode`, `summary` and `topicType`. Event and Offer posts need event or offer details, so they will most likely be rejected. Failures are swallowed silently. |
| Scheduling | PARTIALLY WORKING | Date stored and shown; no automatic publishing. |
| Performance insights | NOT IMPLEMENTED | No Business Profile Performance API calls. |
| Disconnect | PARTIALLY WORKING | Deletes the stored tokens (tested today with a seeded record) but does not revoke them at Google. |
| Approval gate (`GBP_API_APPROVED`) | WORKING | While false, no Google API is called and sample data is shown, labelled (tested today). |

### 5.5 Review management

| Feature | Status |
|---|---|
| Review listing | DEMO / MOCK (four sample reviews, each labelled) |
| Review details (name, stars, date, text, replied flag) | WORKING for sample data |
| AI reply generation | App flow WORKING with the mock; real Claude output NOT VERIFIED |
| Reply editing | WORKING |
| Draft saving | WORKING |
| Approval | WORKING; clearly says it will not post yet |
| Publishing to Google | NOT VERIFIED |
| Healthcare wording check on replies | PARTIALLY WORKING: warnings appear only after a live post to Google, not on save or approve (confirmed today) |
| Review link and QR code | WORKING |
| Forged review ids | Refused (tested today for draft, save and approve) |

### 5.6 Posts management

| Feature | Status |
|---|---|
| Post creation (manual text) | WORKING |
| AI content generation | App flow WORKING with the mock; real output NOT VERIFIED |
| Editing | WORKING in the composer before saving. Saved posts cannot be edited, only approved or deleted. |
| Draft list | WORKING. The composer text is not cleared after saving. |
| Approval | WORKING |
| Scheduling | PARTIALLY WORKING (stored only) |
| Publishing | NOT VERIFIED |
| Post types | Update, Event, Offer. Offer is hidden for healthcare. WORKING in the UI; Event and Offer will most likely fail at Google (see 5.4). |
| Medical wording check | PARTIALLY WORKING. Seven rules in [src/lib/medical.ts](../../src/lib/medical.ts). The "100%" pattern can never match because of a word-boundary bug (re-checked today). "We offer consultations" triggers the discount warning (false positive). |

### 5.7 AI visibility

**Providers:** Claude, if `ANTHROPIC_API_KEY` is set. ChatGPT through the OpenAI API, if `OPENAI_API_KEY` and `OPENAI_MODEL` are set. Gemini through the Google API, if `GEMINI_API_KEY` and `GEMINI_MODEL` are set. Only Claude-compatible calls were exercised, against the mock.

**Questions generated:** two per provider, in the form "{category} in {city}". Healthcare: "Which are the best {category} in {city}? Name a few specific ones." and "I need a trusted {category} in {city}. Who would you suggest?". Local business: "What are the best {category} in {city}? Name a few specific ones." and "Can you recommend a good {category} in {city}?". The categories are lower-cased as written, so some questions read awkwardly, for example "best doctor or clinic in Bhubaneswar" (seen today).

**Business name matching:** the answer and the business name are lower-cased, punctuation is removed, and the name must appear as whole words. "Azentrix skin clinical" does not count for "Zentrix Skin Clinic", and "ZENTRIX SKIN-CLINIC" does (both tested today). Variants are missed: "Zentrix Skin & Hair Clinic" is not counted. Names in non-Latin scripts can never match.

**Competitors:** when the business is not named, an extra Claude call extracts up to six business names from the answer. This always uses Claude, even for ChatGPT or Gemini answers. If that call fails or returns malformed JSON the list is silently empty and the check is still saved (tested today).

**Results and history:** stored per check with the date, questions, found or not, excerpt, competitors and methodology. The latest 30 are kept. The dashboard shows the latest. The visibility page shows a bar chart of up to 16 checks and a list.

**Scoring:** there is no score, only "Named in X of Y answers".

**Recommendations:** a fixed "What to do next" list, which changes one line for healthcare. No AI.

**Error handling, tested today against the mock:**
- 429: "Claude is rate limiting this account (429). Wait a minute and try again."
- 500: "Claude is having problems (500). Try again in a few minutes."
- Non-JSON response: "Claude sent a response that could not be read. Try again."
- Empty answer: "Claude returned an empty answer, so this check was not saved."
- No answer: "Claude did not answer within 45 seconds." (returned after 46 seconds)
- In all of these, nothing is saved.

**Limits that affect accuracy:** answers come from the API and the model's own knowledge, not the public ChatGPT or Gemini apps with web search. The methodology note says so on screen. If one provider fails, the whole check fails and nothing is saved. Failed checks still use up the 6-per-hour quota (seen today).

**Overall status: PARTIALLY WORKING.**

### 5.8 ChatGPT Business Hub guide

Claiming instructions (six general steps), verification checklist (8 items), progress count, notes and manual insights are **WORKING** (tested today). Limitations: no OpenAI connection by design; the steps are general and not tied to OpenAI's current process; insights cannot be edited or deleted; values are free text.

### 5.9 Settings

Business settings and setup status are **WORKING**. Data deletion is **WORKING** (all six keys removed, tested today). User settings, account deletion and integration toggles are **NOT IMPLEMENTED**. Google connect and disconnect live on the Google page, and AI providers are controlled only through `.env`.

### 5.10 Other features found in the repository

| Feature | Status | Notes |
|---|---|---|
| Startup configuration check | WORKING | Refuses to serve when `APP_MODE` is missing, misspelt, demo without opt-in, Supabase without keys, or a short session secret (tested today). |
| Security headers | WORKING | Seven headers on every response type (tested today). |
| Error page for `/app` | WORKING | Shown when a data read fails (tested today against the stand-in). |
| Social share image and favicon | WORKING | Returns 200. |
| FAQ structured data | WORKING | Present on the landing page. |
| `recommendCopy()` in `ai.ts` | Dead code | Never called. |
| `.skeleton` CSS class | Dead code | Not used anywhere. No loading skeletons exist. |
| `SUPABASE_SERVICE_ROLE_KEY` | Unused | Listed in `.env.example` but not read by any code. That is good, because the app only uses the user's own session. |

---

## 6. Backend and database audit

### 6.1 How data moves

```
Browser form
  -> Server Action in src/app/actions.ts   (POST to the same page, handled by Next.js)
       1. requireUser(): who is signed in? (session.ts)
       2. rate limit check, where relevant (ratelimit.ts)
       3. validate input (Zod or manual checks)
       4. call AI (ai.ts) or Google (google.ts / gbp.ts) if needed
       5. read and write through db.* (store.ts)
            demo mode     -> .data/user_data.json, keyed by user id
            supabase mode -> public.user_data, filtered by user_id, enforced by RLS
       6. revalidatePath() so the page re-renders with new data
  <- the page re-renders on the server with the new data
```

Pages read data the same way: a server component calls `requireBusiness()` or `requireUser()`, then the `db.*` helpers. Every read and write is keyed by the signed-in user's id taken from the session, never from form input.

### 6.2 Server Actions

| Action | Login | Input checks | Writes |
|---|---|---|---|
| `signUpAction` | No | Zod email and password; rate limit | account, session |
| `logInAction` | No | Zod; rate limits per email and address | session |
| `logOutAction` | No | none | deletes session |
| `saveBusinessAction` | Yes | Zod business schema | `business` |
| `toggleAuditAction` | Yes | key is any string | `business.audit` |
| `runVisibilityAction` | Yes | business must exist; provider configured; rate limit | `checks` |
| `chooseLocationAction` | Yes | must match a location Google lists for this user | `google` |
| `disconnectGoogleAction` | Yes | none | deletes `google` |
| `replyAction` | Yes | review must be in the user's loaded reviews; text up to 4,000; rate limit for drafts | `replies` |
| `postComposerAction` | Yes | topic at least 5; text 10 to 1,500; kind enum; rate limit for drafts | `posts` |
| `postItemAction` | Yes | acts only on the user's own posts | `posts` |
| `toggleGuideAction` | Yes | key is any string | `guide.done` |
| `saveGuideNotesAction` | Yes | cut to 4,000 characters | `guide.notes` |
| `addInsightAction` | Yes | Zod: date, label 2 to 80, value 1 to 40 | `guide.insights` |
| `deleteAllDataAction` | Yes | confirmation checkbox in the browser only | deletes all six keys |

Small validation gaps (low risk, the user can only affect their own data): `toggleAuditAction` and `toggleGuideAction` accept any key name; the post topic has no maximum length; `scheduledFor` is stored without checking it is a valid date.

### 6.3 Database schema (Supabase)

File: [supabase/schema.sql](../../supabase/schema.sql). One table:

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | references `auth.users(id)` and is deleted with the user (`on delete cascade`) |
| `key` | text | one of `business`, `checks`, `google`, `replies`, `posts`, `guide` |
| `value` | jsonb | the whole value for that key |
| `updated_at` | timestamptz | set on every write |

Primary key `(user_id, key)`. Row level security is on, with four policies (select, insert, update, delete), each `auth.uid() = user_id`.

There are no migrations or migration tool, only this one script. Running it a second time fails with "policy already exists" (re-checked today).

The value shapes are described in [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md#data-model).

### 6.4 Demo file store

| File | Contents |
|---|---|
| `.data/users.json` | email -> `{ id, email, hash }` |
| `.data/sessions.json` | session id -> `{ userId, expiresAt }` |
| `.data/user_data.json` | user id -> `{ business, checks, google, replies, posts, guide }` |

Writes read the whole file, change it and write it back, with no locking. Two requests at the same moment can overwrite each other. This is acceptable for local testing only. A damaged file now raises an error instead of being treated as empty, so it cannot wipe accounts.

### 6.5 User data isolation

| Layer | Evidence | Status |
|---|---|---|
| App code | Every `db.*` call uses `user.id` from the session. No action takes a user id from input. | Inspected today |
| Demo mode | Account B saw none of account A's data on all 7 app pages; B could not delete A's post by submitting its id; B's "delete all" left A intact. | Tested today |
| RLS policies | In local PostgreSQL: `anon` sees 0 rows and cannot insert. User B cannot read, insert as A, update, re-assign, upsert onto or delete A's rows. B can manage their own rows. A's rows were intact after all attempts. Deleting a user removes their rows. 12 of 13 checks matched; the 13th found the re-run problem in 6.3. | Tested today |
| Real Supabase | Not tested. | NOT VERIFIED |

### 6.6 Error handling

- AI calls: specific messages, a 45-second time limit, and nothing saved on failure (tested today).
- Google calls: 403 or 429 shows "Google blocked this request. Basic API Access ... may not be approved yet". Other codes show "Google API error {status}". Reviews fall back to sample data with the error shown.
- Database reads and deletes in Supabase mode now throw instead of returning "no data". The `/app` error page catches them (tested against the stand-in).
- Post publishing failures are swallowed with no message (code inspection).
- There is no logging or monitoring beyond the startup configuration message.

### 6.7 Data deletion

- **Delete my data** removes all six keys (tested today).
- **Disconnect Google** removes stored tokens locally (tested today) but does not revoke them at Google.
- **Account deletion** does not exist. In Supabase, deleting the auth user from the Supabase dashboard would remove the user's rows through the cascade (verified in PostgreSQL).

---

## 7. External integrations

| Integration | Purpose | Environment variable names | Endpoints and scopes | Works today | Needs credentials | Needs external approval | Missing |
|---|---|---|---|---|---|---|---|
| **Google OAuth** | Owner signs in to Google to grant profile access | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`; scopes `business.manage`, `openid`, `email`; offline access | Redirect and all callback guards (fake keys) | Yes | OAuth consent screen verification for public use; test users until then | Token revocation on disconnect; the id_token email is read without signature checks (display only) |
| **Google Business Profile APIs** | Locations, reviews, replies, posts | `GBP_API_APPROVED` plus the OAuth variables | `mybusinessaccountmanagement.googleapis.com/v1/accounts`; `mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title`; `mybusiness.googleapis.com/v4/{account}/{location}/reviews`, `.../reviews/{id}/reply` (PUT), `.../localPosts` (POST) | Approval gate and sample-data fallback | Yes | Yes: Basic API Access approval for the Google Cloud project | Paging; event and offer fields; performance insights; business info sync; error message on failed publish |
| **Claude (Anthropic)** | Reply drafts, post drafts, visibility answers, competitor extraction | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_BASE_URL` (optional) | `POST {base}/v1/messages`, `anthropic-version: 2023-06-01` | Full app flow and error handling against the mock | Yes | No | Real output never checked |
| **OpenAI** | Visibility answers only | `OPENAI_API_KEY`, `OPENAI_MODEL` | `POST api.openai.com/v1/chat/completions` | Not exercised | Yes | No | Never tested |
| **Gemini** | Visibility answers only | `GEMINI_API_KEY`, `GEMINI_MODEL` | `POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | Not exercised | Yes | No | Never tested |
| **Supabase** | Production accounts, sessions and data | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`SUPABASE_SERVICE_ROLE_KEY` is listed but unused) | Supabase Auth (signup, password login, refresh, logout, get user); PostgREST on `user_data` | Against a local stand-in only; RLS in local PostgreSQL | Yes | No | Email-confirmation callback route; password reset; real-project test |
| **QR code** (`qrcode` package) | Review QR image | none | runs on the server, no network | Yes, tested today | No | No | None |
| **Google Fonts** (`next/font/google`) | Downloads DM Sans at build time and serves it from the app | none | fonts.googleapis.com during `npm run build` only | Yes; the font loads (tested today) | No | No | A build without internet access will fail |
| **Google review link** | Link customers use to leave a review | none | `https://search.google.com/local/writereview?placeid={Place ID}` | Link generated (tested). Whether Google accepts a given Place ID is NOT VERIFIED. | No | No | Place ID lookup (the owner types it in) |

No other third-party services, analytics or tracking scripts were found.

---

## 8. Security and reliability audit

### 8.1 Fixes from the 17 November audit: still present?

| Fix | Present in code today | Re-tested today |
|---|---|---|
| AI calls: 45-second timeout, clear error messages, empty answers rejected, whole-word name matching | Yes, [src/lib/ai.ts](../../src/lib/ai.ts) | Yes, all pass |
| Rate limits for login, signup and AI actions | Yes, [src/lib/ratelimit.ts](../../src/lib/ratelimit.ts) | Yes, 12/12 pass |
| Explicit `APP_MODE`; refuse to start when misconfigured | Yes, [src/lib/env.ts](../../src/lib/env.ts), [src/instrumentation.ts](../../src/instrumentation.ts) | Yes, 3 bad configurations refuse; good one serves |
| Server-side demo sessions, revoked on logout; Secure cookie on https | Yes, [src/lib/session.ts](../../src/lib/session.ts) | Yes, 12/12 plus the https cookie check |
| Security headers | Yes, [next.config.ts](../../next.config.ts) | Yes, 7/7 |
| Review and location ids checked against the user's own resources | Yes, [src/app/actions.ts](../../src/app/actions.ts) | Reviews yes (8/8); locations NOT VERIFIED |
| Supabase session refresh; read errors no longer look like empty data | Yes, [src/proxy.ts](../../src/proxy.ts), [src/lib/store.ts](../../src/lib/store.ts), [src/app/app/error.tsx](../../src/app/app/error.tsx) | Yes, against the stand-in (8/8) |

### 8.2 Findings

| Area | Finding | Risk |
|---|---|---|
| Authentication | Every `/app` page and both API routes require a session (tested). Server Actions call `requireUser()` themselves. | OK |
| Authorization | All data is keyed by the session user id. No admin roles exist. | OK |
| Session security (demo) | httpOnly, SameSite=Lax, Secure on https, 14-day server-side expiry, revoked on logout. | OK for testing |
| Session security (Supabase) | Supabase auth cookies are readable by page JavaScript (library default, seen in the stand-in test). This app has no browser-side Supabase code, so they could be made httpOnly. | Low to medium |
| Rate limiting | In-memory, per server process. With several instances or serverless functions each keeps its own count, and a restart clears it. The client address comes from `x-forwarded-for`, which a client can fake unless a trusted proxy overwrites it. | Medium in production |
| CSRF | Server Actions use Next.js's built-in Origin check (not tested in this audit). Cookies are SameSite=Lax. | OK, not tested |
| OAuth state | Random 24-byte state in an httpOnly 10-minute cookie, compared exactly (tested). | OK |
| Security headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP on every response (tested). CSP allows `'unsafe-inline'` scripts because Next.js needs it without per-request nonces. | Low to medium |
| Input validation | Zod on auth, business and insights; manual checks elsewhere. React escapes all output. No `dangerouslySetInnerHTML` except the JSON-LD block of fixed FAQ text. | OK |
| Secrets | No secret appears in client code (checked on 17 Nov; not re-scanned today). `.env` and `.data` are in `.gitignore`. Google tokens are encrypted at rest (code inspection). | OK |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities (today). | OK |
| Data deletion | Data yes; account no; Google tokens not revoked. | Medium (policy and privacy) |
| Logging | No application logging, error tracking or audit trail. | Medium in production |
| Production configuration | Startup check blocks the dangerous mistakes (tested). | OK |
| Demo store | No file locking; concurrent writes can be lost. | Demo only |

---

## 9. UI and UX audit

### 9.1 Design system

- **Colours:** earthy brown theme. Tokens are defined once in [src/app/globals.css](../../src/app/globals.css): page `#F7F3EC`, cream `#EFE5D6`, beige `#DCC8AE`, primary brown `#6B422B` (buttons and links), dark brown `#3B281F` (text), deep chocolate `#291D18`, caramel `#B98250` (icons, charts, stars), secondary text `#75685D`, white cards. Status colours for ok, warn and bad are muted green, amber and red.
- **Type:** DM Sans. Named text styles (`heading-1` to `heading-6`, `title-*`, `body-*`, `caption-*`) with tighter spacing on large headings. Headings shrink on phones.
- **Components:** `.btn` (primary, secondary, ghost, light and on-dark variants), `.card`, `.inset`, `.field`, `.badge` (ok, warn, bad, accent), `.meter`, a ring chart and a bar chart (no chart library), `.eyebrow` labels, and `.side-link` for the sidebar.
- **Motion:** scroll reveal, floating hero cards, a pulsing ring, and nav and menu transitions. All are turned off for people who ask for reduced motion.

### 9.2 Layout and navigation

- **Landing:** fixed top navigation, transparent over the dark hero.
- **App:** a 232px sidebar fixed to the left edge and full height, and content beginning 40px after it, up to 1,320px wide. Measured today: wide screen sidebar 0 to 232px and content 272 to 1,592px of 1,720px; tablet 0 to 232px and content 256 to 796px of 820px; phone sidebar becomes a top bar with a sideways-scrolling nav row.
- No horizontal page scroll at 390px, 820px or 1,720px on the dashboard, reviews or posts pages (tested today).

### 9.3 States

| State | What exists |
|---|---|
| Empty | No reviews, no posts, no checks, no insights, no Place ID (QR), no business (redirect to onboarding) |
| Loading | Submit buttons change their text ("Drafting", "Saving", "Asking the AI models. This takes up to a minute.") and all buttons in the form are disabled while the request runs (tested today). There are no page-level loading screens or skeletons when moving between pages. |
| Error | Inline field errors; form messages; an error banner on the Google page; the `/app` error boundary; the 404 page. There is no error page for public routes beyond Next.js's default. |
| Success | Short green messages ("Draft saved", "Business details saved"). |

### 9.4 Visual improvements (not bugs)

1. On phones the app nav is a sideways-scrolling row with no hint that more items exist off-screen.
2. Status badges show raw lower-case values ("draft", "approved", "posted").
3. Long emails are cut off in the sidebar (full email on hover only).
4. No page-level loading skeletons, although a `.skeleton` style exists unused.
5. The Pricing section is a placeholder.
6. The dashboard's Google card has no next step besides the recommended actions list.
7. Post cards have no edit button; owners must delete and re-create.

### 9.5 Functional UX bugs

1. The privacy page shows `{{contact_email}}` until `NEXT_PUBLIC_CONTACT_EMAIL` is set.
2. Healthcare reply warnings appear only after a live post, never before approval.
3. The post composer keeps the text after "Save as draft", which invites duplicate saves.
4. A failed Google publish gives no message (code inspection).
5. Failed visibility checks use up the hourly quota.

---

## 10. Testing and build audit

All results below are from **18 November 2026**, on the isolated copy, unless marked "previous session".

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Exit code 0, no errors |
| `npm run build` | Success. 18 routes plus Proxy. Built 4 times today (demo, supabase stand-in, https URL, final demo). |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Existing automated tests | **None.** No test files, test runner or `test` script in `package.json`. |
| Route and protection checks | 18 of 18 pass |
| Full browser walkthrough (all pages, both business types) | 76 passed plus 6 follow-up checks. 3 first-run failures were mistakes in my test script and passed when corrected. |
| Rate limits | 12/12 |
| Demo sessions | 12/12, plus the Secure cookie on https |
| Security headers and CSP | 7/7, plus headers present on 6 route types |
| Forged review ids | 8/8 |
| AI error handling and name matching (mock) | All cases pass. Two cases first hit the 6-per-hour limit and passed on a fresh server. |
| Connected-state screens and disconnect (seeded record) | 5/5 |
| Supabase mode (local stand-in) | 8/8 |
| RLS policies (local PostgreSQL) | 12 of 13 as expected; re-running the schema fails |
| Startup refusal on bad configuration | 3 of 3 refused |

About 140 automated checks passed today. No genuine failures were found; every issue in this report comes from code inspection or from behaviour the tests recorded as a finding.

**What these tests do not prove:**
- Nothing here proves real Claude, OpenAI or Gemini answers.
- Nothing here proves real Google sign-in, locations, reviews, replies or posts.
- Nothing here proves a real Supabase project: real email confirmation, real RLS in Supabase, or a real token refresh.
- Previous session only: an A/B run that showed the logout bug in Supabase mode without `src/proxy.ts` (40 failed refresh attempts). Today only the fixed side was run.

---

## 11. What is required before launch

In short (full prioritised list in [KNOWN_ISSUES_AND_ROADMAP.md](KNOWN_ISSUES_AND_ROADMAP.md)):

1. A real Supabase project with `schema.sql` applied, and an end-to-end test of signup, email confirmation, login, data isolation and session refresh.
2. Google Business Profile API approval and OAuth setup, then a live test of every Google feature, fixing Event and Offer posts and silent publish failures first.
3. A real Anthropic key and a review of real reply drafts, post drafts and visibility answers.
4. Production settings: `APP_MODE=supabase`, an https `NEXT_PUBLIC_APP_URL`, fresh secrets, `NEXT_PUBLIC_CONTACT_EMAIL`, and the Google redirect URI.
5. Legal review of `/privacy` and `/terms`, and wording that matches what the product really deletes.
6. Account deletion, password reset and Google token revocation.
7. A shared rate-limit store and trusted client addresses if deploying to more than one server or to serverless.
8. Basic error logging, and at least a smoke-test suite in the repository.
