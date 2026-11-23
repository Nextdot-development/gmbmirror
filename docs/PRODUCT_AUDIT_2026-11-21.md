# GMBmirror product audit and completion pass (21 November 2026)

Every row below was checked against the code and against tests that were actually run. "Stand-in" means a local
server that answers like the real API (used by the automated tests); it proves our side of the integration, not
Google's or Resend's. Nothing is called working against a real service unless it was run against that service.

## 1. Working, verified against the real service

| Area | Evidence |
|---|---|
| Supabase database | `npm run db:setup -- --check` against the production project: TLS with a verified certificate, 8 tables, RLS on every table, 13/13 isolation checks (own rows only, no token access, no browser writes, functions blocked), 0 records. |
| Supabase Auth settings | Read live: email sign-up on, email confirmation on. |
| Claude (Anthropic) | Real API calls in the 20 November pass (reply, rewrite, Hindi reply, post variations, report summary). Only provider; OpenAI/Gemini are off unless `AI_EXTRA_PROVIDERS=true`. |
| Report PDF, Hindi and English | Rendered and inspected: conjuncts, vowel signs, reph, nukta, mixed lines. **Fixed today:** symbols the fonts lack (★, ✓, emoji) were silently dropped; they now print as plain stand-ins (`*`, `OK`, `?`). |
| Vercel build | The deployment of commit 1719df9 built successfully. |

## 2. Working against faithful stand-ins; waits on real credentials

| Area | What exists | Needs |
|---|---|---|
| Google Business Profile | OAuth 2.0 with PKCE and signed state; tokens AES-256-GCM encrypted, refreshed, revoked on disconnect; account and location discovery (paged); multiple locations; live reviews; reply publish/update; profile details; posts create/update/list with recovery against duplicates; Performance API metrics (shown "Not reported by Google" when absent); connection states and errors (reconnect, scope, permission, API disabled, quota). Official endpoints only: Account Management v1, Business Information v1, My Business v4 (reviews, localPosts), Business Profile Performance v1. | OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), production redirect URI, the four APIs enabled, Business Profile API access approval, OAuth verification before public launch. |
| Review management | Live list from Google; waiting/answered status; Claude drafts in English, Hindi, Hinglish; rewrite options; safety checks; edit and approve; manual publish; automatic mode only with explicit opt-in and only for safe 4–5★ reviews; duplicate protection; reply history; retries with back-off. | Google credentials. |
| Posts | Claude writes 3 variations; standard, event and offer posts; buttons; **new: photo by public https link (sent as the post's media)**; scheduling; calendar; draft/scheduled/published/failed states; real publishing via jobs; retry; no duplicate on lost answers. | Google credentials. Photos are links, not uploads (see section 3). |
| Background jobs | Vercel Cron every minute, `CRON_SECRET` (exact `Bearer` form, constant time); Supabase queue with `FOR UPDATE SKIP LOCKED`, leases, lease tokens; one live job per key; back-off; job history and logs; safe across instances; no timers or files in production. | Cron runs only on a working production deployment (see blockers). |
| **Email (new today)** | Resend integration; welcome, security notices, monthly report with PDF, failure alerts, post published, "Email me this report", contact form to gmbmirror@gmail.com; preferences; per-account log with honest outcomes; idempotency keys; rate limits. Supabase sign-up and reset emails go through Resend SMTP (configuration only). | `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain, Supabase SMTP settings, and the database migration. |
| Multi-location | Add (by hand or from Google), edit (Settings acts on the active location), switch, remove safely (typed confirmation, jobs cancelled, Google access revoked only when unshared), isolation tested, per-location reviews, posts, reports, analytics; overview comparison. | — |
| Local SEO | Saved phrases; 3×3 and 5×5 grid scans with exact cost; history; competitor movement; daily limits; labelled as estimates from Google Places search, not Business Profile data. | — |
| Competitors | Discovery from search results, gap analysis, most common category, Claude explanation from counts only. | — |
| Analytics | 28-day comparison, daily views, 6-month table, Claude explanation; only metrics Google returns. | Google credentials. |
| Reports | Monthly per location, "All locations" view, PDF in English and Hindi, review/ranking/competitor/AI sections, Claude summary from the facts, missing data marked. **New: email delivery.** | — |

## 3. Partial

| Area | What is missing |
|---|---|
| Map visualisation of the grid | The grid is a 3×3/5×5 table of positions, not a map. A map needs a tile provider and its terms (Google Maps Static API with billing, or another provider). |
| Post photos | Link only. Uploading needs file storage (for example Supabase Storage with a public bucket) — a product decision. |
| Review synchronisation when automation is off | Reviews are read live on each visit to the Reviews page; the 30-minute background sweep runs only when review automation (approval or automatic) is on. |
| Website traffic | Only what the Performance API reports (website clicks, calls, directions, views). Visits to the website itself need the site's own analytics. |
| Hindi text copied from the PDF in Apple Preview | Printed text is correct everywhere; Preview ignores the text map for some syllables. |

## 4. Missing or broken

| Item | Status |
|---|---|
| **Production returns 500** on every server-rendered page and API route (`/login`, `/api/jobs/run`); only the static home page loads. The API route answers with Next's error page instead of its own JSON, so the server stops at its startup configuration check (it refuses to run with a missing or invalid setting). The exact list is in Vercel's runtime logs ("GMBmirror cannot start"). | Needs the Vercel logs or the variable list checked (see deployment steps). |
| Email migration on the production database | Written and tested; not applied (needs `npm run db:migrate`). |
| Google OAuth client | Not created (`GOOGLE_CLIENT_ID` is empty). |
| Resend | No key or verified domain yet. |
| Supabase custom SMTP | Not set: the built-in sender only reaches the project team, so customers cannot confirm sign-ups. |
| Live end-to-end test with a new account | Not possible until production starts and email confirmation can be delivered. |
