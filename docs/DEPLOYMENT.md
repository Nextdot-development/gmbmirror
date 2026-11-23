# GMBmirror: Vercel and Supabase deployment guide

Written 21 November 2026; updated the same day for a **fresh start** (section 10). **Not deployed, and not production ready yet:** the database layer, job runner and migration are built and tested against a local PostgreSQL with the production schema, but nothing has run against a real Supabase project, Vercel deployment or Google OAuth client. Section 9 lists what must be verified there.

## 1. Backend architecture (as built)

There is no separate backend service. Everything is one Next.js 16 (App Router) application on the Node.js runtime:

| Part | Where | What it does |
|---|---|---|
| Server actions | `src/app/actions.ts` | Every form and button: sign up and log in, business details, Google connection, reviews and replies, posts and schedules, audits, rank grid, competitors, visibility checks, reports, locations, settings. |
| Route handlers | `src/app/api/google/start`, `src/app/api/google/callback` | Google OAuth (PKCE, signed state cookie). |
| | `src/app/api/jobs/run` | Background jobs, called by a scheduler with `CRON_SECRET` (GET for Vercel Cron, or POST). |
| | `src/app/app/reports/[id]/pdf` | Report PDF download. |
| | `src/app/opengraph-image.tsx`, `src/app/manifest.ts` | Share image and web app manifest. |
| Proxy (middleware) | `src/proxy.ts` | Refreshes Supabase Auth sessions on `/app`, `/login`, `/signup`, `/api/google/*`. |
| Startup | `src/instrumentation.ts` | Refuses to start on bad configuration; optional in-process job timer (off on Vercel). |
| Storage | `src/lib/store.ts` | One storage API with two back ends: JSON files (`APP_MODE=demo`) or PostgreSQL (`APP_MODE=supabase`, `src/lib/db-pg.ts`). |

## 2. Storage inventory and where each item goes

| Data | Demo mode (JSON, `.data/`) | Supabase mode |
|---|---|---|
| Accounts and passwords | `users.json` (email, scrypt hash) | Supabase Auth (`auth.users`). Hashes cannot be moved; people get Supabase accounts with the same email. |
| Sessions | `sessions.json` + signed `ge_session` cookie | Supabase Auth cookies (httpOnly, Secure on https, 30 days) |
| Location list, active location | `user_data.json` key `locations` | `accounts` + `locations` |
| Business details and settings, AI preferences, automation settings | `business` | `location_records` key `business` |
| Review replies and reply history | `replies` | `location_records` key `replies` |
| Posts and scheduled posts | `posts` | `location_records` key `posts` |
| Visibility checks | `checks` | `location_records` key `checks` |
| Audits, rank scans, competitors | `places` | `location_records` key `places` |
| Growth plan, ChatGPT guide | `growth`, `guide`, `insights_notes` | `location_records` |
| Monthly reports | `reports` | `location_records` key `reports` |
| Automation log, share counts, review stats, profile scores | `automation_log`, `share_events`, `review_stats`, `gbp_scores` | `location_records` |
| Google connection and **encrypted** tokens | `google` | `google_connections` (no browser access at all) |
| Claude usage per month | `ai_usage` (per user) | `user_records` |
| Background jobs and their logs | `jobs` (per user, one list) | `jobs` table (one row per job, log in the row) |
| Rate limits (login lockout, Google, Places, Claude budgets) | process memory | `rate_limits` table + `take_rate_limit()` |
| Write ordering and job busy flag | process memory | transactions, advisory locks, job leases |
| Claude answer cache (1 hour) | process memory | process memory (a cache only; losing it costs one repeat call) |

Location data uses the prefix `loc:<id>:<key>` in demo mode; the first location ("main") uses the plain key. Every persistent feature needs the database; nothing persistent may stay on the file system on Vercel.

## 3. Database schema

File: `supabase/migrations/20261121000000_gmbmirror_core.sql` (safe to run again; it never drops data).

- `accounts (user_id → auth.users, active_location, main_removed, migration_batch)`
- `locations (user_id → accounts, id, position)`, primary key `(user_id, id)`
- `location_records (user_id, location_id → locations, key, value jsonb, version)`, primary key `(user_id, location_id, key)`, key limited to the 13 known kinds
- `google_connections (user_id, location_id → locations, connection jsonb, connected_at, version)`; tokens inside are AES-256-GCM encrypted by the app with `TOKEN_ENCRYPTION_KEY` before they reach the database
- `user_records (user_id → accounts, key, value jsonb)` (Claude usage)
- `jobs (id, user_id → accounts, location_id, kind, key, status, run_at, lease_until, lease_token, attempts, max_attempts, payload, last_error, log, timestamps)`; unique index on `(user_id, key)` for live and succeeded jobs (duplicate protection); indexes for due jobs, expired leases, per user and per location
- `rate_limits (key, count, reset_at)`
- `migration_runs (batch, source, started_at, finished_at, summary)`
- Functions: `claim_next_job(now, lease_seconds)` (FOR UPDATE SKIP LOCKED, fresh lease token) and `take_rate_limit(key, limit, window_ms, cost)` (atomic).
- Deleting a user in Supabase Auth deletes their account and, through foreign keys, everything they own. Removing a location deletes its rows the same way.

**Access:** the app reads and writes only from the server through `DATABASE_URL` (privileged; it bypasses RLS, and every query names its user). **Row Level Security is on for every table.** With the public key a signed-in user can read only their own accounts, locations, records and usage rows, and can write nothing; `google_connections`, `jobs`, `rate_limits` and `migration_runs` have no policies (no access), and the two functions are revoked from the public roles. The browser never talks to the database: all Supabase calls are server side, and the auth cookies are httpOnly.

**Atomicity:** every read-change-write (`updateKey`, `updateGoogle`, `updateLocal`, `updateLocations`) runs in a transaction under a per-user, per-record advisory lock with `SELECT … FOR UPDATE`, so it is safe across instances. A location must exist before data is written to it, so a late write can never bring back a removed location.

## 4. Environment variables

Names are exactly as the code reads them. **Public** means compiled into browser code (`NEXT_PUBLIC_`); everything else is server only.

| Variable | Public | Required on Vercel | Notes |
|---|---|---|---|
| `APP_MODE` | no | yes: `supabase` | Demo mode stores files and cannot run on Vercel. |
| `NEXT_PUBLIC_APP_URL` | **yes** | yes | `https://<your domain>`. Fixed at build time: set it for the Production environment before building. Turns on Secure cookies. |
| `NEXT_PUBLIC_SUPABASE_URL` | **yes** | yes | Supabase project URL (Auth only). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | **yes** | yes | The publishable key (`sb_publishable_…`) or the legacy anon key; either name is read, the publishable one first. Installed clients: `@supabase/supabase-js` 2.119.0, `@supabase/ssr` 0.12.7; the key is only sent as the API key, so both forms should work (to confirm on the real project). Your `.env` already uses the publishable name. |
| `DATABASE_URL` | no | yes | Supabase **Transaction pooler** string (port 6543). Locally, `npm run db:setup` enters it for you. |
| `DATABASE_CA_CERT` | no | no | Not needed for Supabase: its certificate authority (Supabase Root 2021 CA) is built into `src/lib/db-ssl.ts`, and certificates and host names are always verified. Only for a non-Supabase database. |
| `DATABASE_POOL_MAX` | no | no | Default 3 per instance. |
| `DB_SLOW_MS` | no | no | Database queries slower than this are logged (default 250). |
| `SESSION_SECRET` | no | yes | 32+ characters; signs the "recognised browser" cookie and the OAuth state cookie. |
| `TOKEN_ENCRYPTION_KEY` | no | yes (with Google) | 64 hex characters. **Must be the same value as wherever the tokens were encrypted**, or migrated tokens cannot be read. |
| `TRUSTED_PROXY_HOPS` | no | yes: `1` | Vercel is one trusted proxy. |
| `CRON_SECRET` | no | yes | 16+ characters (`openssl rand -hex 24`). Vercel Cron sends it automatically. |
| `JOBS_RUNNER` | no | `off` | No in-process timer on Vercel (it is already off in Supabase mode unless set to `inprocess`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | for Google | Web OAuth client. |
| `GOOGLE_REDIRECT_URI` | no | for Google | `https://<your domain>/api/google/callback`, registered exactly. |
| `GBP_API_APPROVED` | no | for Google | `true` once the client exists and Google approved the project. |
| `GOOGLE_PLACES_API_KEY` | no | for finder, audit, grid | |
| `ANTHROPIC_API_KEY` | no | yes | `ANTHROPIC_MODEL` optional. |
| `AI_MONTHLY_CALL_LIMIT`, `GRID_POINTS_PER_DAY`, `GBP_QPM_GUARD` | no | no | Defaults 600, 75, 250. |
| `AI_EXTRA_PROVIDERS`, `OPENAI_*`, `GEMINI_*` | no | no | Leave `AI_EXTRA_PROVIDERS` unset (Claude only). |
| `GOOGLE_SITE_VERIFICATION` | yes (in page HTML, by design) | for verification | Search Console HTML-tag code; proves domain ownership for Google OAuth. |
| `RESEND_API_KEY` | no | for email | Resend API key (`re_…`, sending access). Without it and `EMAIL_FROM`, no email is sent and the app says so. |
| `EMAIL_FROM` | no | for email | Sender on a domain verified in Resend, e.g. `GMBmirror <notifications@yourdomain.com>`. A free-mail domain (gmail.com…) is refused at startup. |
| `EMAIL_REPLY_TO` | no | no | Default `gmbmirror@gmail.com`. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | **no** | Not used by the code. Do not add it to Vercel. |
| `ALLOW_DEMO_IN_PRODUCTION`, `JOBS_TEST_CLOCK`, `GOOGLE_API_BASE_URL`, `GOOGLE_PLACES_BASE_URL`, `RESEND_API_BASE_URL`, `GBP_EDITS_PER_MIN`, `AI_RETRY_DELAY_MS`, `JOBS_INTERVAL_SECONDS` | no | never | Local testing only. |

## 5. Vercel compatibility

| Item | Status |
|---|---|
| Runtime | Node.js everywhere (no Edge-only code). `pg` and `harfbuzzjs` run as external server packages. |
| File system writes | Only demo mode writes files. Supabase mode writes nothing to disk. |
| Files read at run time | Report PDF fonts and HarfBuzz WebAssembly: added to the route's trace (`outputFileTracingIncludes`); verified in `.next/.../route.js.nft.json`. |
| Background jobs | No timers, no in-memory state: jobs are claimed from the database with leases; overlapping cron calls are safe. |
| Function duration | `/api/jobs/run` sets `maxDuration = 300` and stops starting jobs after 240 s; the rest run on the next call. A job cut off by a timeout is retried after its 5-minute lease (scheduled posts check Google first, so they are not posted twice). Other pages use the default (300 s with Fluid compute, per Vercel's docs). |
| Database connections | One small pool per instance (3) through Supabase's transaction pooler; no session features are used. |
| Cookies and sessions | httpOnly, SameSite=Lax, Secure on https. Set `NEXT_PUBLIC_APP_URL` to the https domain. |
| Security headers | CSP, HSTS, frame denial and others from `next.config.ts`; no CORS needed (the browser calls only its own origin). |
| OAuth callback | Exact `GOOGLE_REDIRECT_URI` on the production domain. **Preview deployments** have other URLs: Google sign-in and cron run only on production. |
| Incompatible | `APP_MODE=demo` on Vercel (files are not kept). `JOBS_RUNNER=inprocess` on Vercel (no long-running process). Per-minute Vercel Cron on the Hobby plan. |

## 6. Scheduled jobs

Confirmed from Vercel's documentation (21 November 2026): Vercel Cron calls the path with **GET** on the **production** deployment and sends `Authorization: Bearer <CRON_SECRET>` itself when `CRON_SECRET` is set. **Hobby allows at most one run a day**, and more frequent schedules fail the deployment; **Pro allows once a minute**.

- **Vercel Pro (chosen, 21 November):** `vercel.json` is now in the project with this schedule (it runs only on production deployments):
  ```json
  { "$schema": "https://openapi.vercel.sh/vercel.json", "crons": [{ "path": "/api/jobs/run", "schedule": "* * * * *" }] }
  ```
- **Vercel Hobby:** use an external scheduler (for example cron-job.org, a Render Cron Job, or any server's cron) every 1 to 5 minutes:
  `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your domain>/api/jobs/run`
  Scheduled posts then publish within that interval.

## 7. Migration runbook (JSON or old `user_data` table → new tables)

Script: `scripts/migrate-to-supabase.mjs`. It only reads the source, is a dry run unless `--apply`, skips users already in the database, copies each user in one checked transaction, and tags the batch for exact rollback.

1. **Back up first.** Copy the `.data` folder somewhere safe (the script never writes to it). In Supabase, confirm daily backups (or point-in-time recovery) and take a dump: `pg_dump "$DIRECT_DATABASE_URL" -Fc -f before-migration.dump`.
2. Apply the schema: Supabase SQL editor (paste `supabase/migrations/20261121000000_gmbmirror_core.sql`) or `supabase db push`.
3. Create or invite each person in Supabase Auth **with the same email** as in demo mode (they set a new password).
4. Dry run: `DATABASE_URL=<direct or session connection string> node scripts/migrate-to-supabase.mjs --json .data` and read the report (emails are masked).
5. Apply: add `--apply`. Note the batch id in the report. Unmatched users are reported and can be copied later by running it again.
6. Verify: log in as a migrated user; check locations, posts, replies, reports. The tokens need the same `TOKEN_ENCRYPTION_KEY`.
7. **Rollback** if needed: `node scripts/migrate-to-supabase.mjs --rollback <batch>` removes exactly that batch. The source files are unchanged, so nothing is lost.

A read-only dry run of the real `.data` (against a throwaway local database) on 21 November parsed 3 users, each with 1 location and 1 record, nothing skipped; they were reported as "no Supabase Auth user yet", as expected. The files were unchanged (same fingerprint and dates).

## 8. Tests

- `npm run test:db` starts a throwaway local PostgreSQL (needs `initdb` and `pg_ctl`, PostgreSQL 15+), applies a test-only Supabase stub (`tests/db/supabase-stub.sql`: `auth.users`, `auth.uid()`, `anon` and `authenticated` roles) and the real schema, and runs 17 tests: user and location isolation; atomic updates across many connections and across two processes; stale Google sign-in; location removal and account deletion; restart persistence; Row Level Security with the public roles; duplicate jobs; several runners and two processes claiming jobs (each job exactly once); lost leases; retries, waiting, cancellation; jobs after restart; shared rate limits; the migration (dry run, apply, no duplicates, source unchanged, rollback, old table source).
- Checked to fail without the protection: removing the locks loses 34 of 40 updates; removing SKIP LOCKED runs jobs twice.

## 9. Exact next steps to deploy safely

1. Create the Supabase project (region near India). Auth: Site URL and redirect URLs = the production domain; email templates; decide on email confirmation.
2. Apply the schema: `npm run db:setup` (section 10), or paste the migration into the Supabase SQL editor.
3. Vercel project: set the variables of section 4 for **Production** (`APP_MODE=supabase`, `TRUSTED_PROXY_HOPS=1`, `JOBS_RUNNER=off`, https `NEXT_PUBLIC_APP_URL`, fresh `SESSION_SECRET` and `CRON_SECRET`; keep the existing `TOKEN_ENCRYPTION_KEY`). Do not add `SUPABASE_SERVICE_ROLE_KEY`.
4. Deploy; sign up and log in on the real domain; check that a business saves and survives a redeploy.
5. Scheduler (section 6); call `/api/jobs/run` once by hand with the secret and check the JSON answer.
6. Migrate existing users (section 7).
7. Google OAuth (MASTER_PROJECT_STATUS.md 0L.6): client with the production redirect URI, consent screen, the four APIs, `GBP_API_APPROVED=true`; run the live checklist (0H.3).
8. Only then call it production ready.

Still to verify on the real services: Supabase Auth with the publishable key; cron delivery and the 300-second limit on the actual plan; Google OAuth end to end.

## 10. Fresh start (decided 21 November 2026)

GMBmirror launches with **new accounts and new data only**. Nothing from the demo files is imported: the migration script (`scripts/migrate-to-supabase.mjs`) stays in the project but is **not run**, and none of the earlier demo users are created in Supabase.

### Supabase Auth settings (dashboard)
1. **Authentication > URL Configuration:** Site URL `http://localhost:3000` for the local trial (later the production https address). Redirect URLs: `http://localhost:3000/auth/confirm` and, later, `https://<domain>/auth/confirm`.
2. **Authentication > Email Templates** (the app verifies email links on its own `/auth/confirm` route; this form works in any browser):
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app/onboarding`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   Supabase's default links (`{{ .ConfirmationURL }}`) are also handled, but only in the browser that signed up.
3. **Email confirmation:** on (as the project is set now). Supabase's built-in email sender is limited and meant for testing; set up custom SMTP (Authentication > Emails > SMTP) before real customers sign up. Check in the dashboard which addresses the built-in sender will deliver to.

### What the app now does
- Sign up (email and password) sends the confirmation link; logging in before confirming says so.
- `/auth/confirm` verifies sign-up and reset links (`token_hash` + `type`, or `code`), starts the session in httpOnly cookies, and only redirects to paths on this site.
- `/forgot-password` sends a reset link (same answer whether or not the account exists; limited to 5 requests an hour per address and 3 per email). `/reset-password` sets the new password.
- Demo mode refuses to start on Vercel, with no override; production builds elsewhere still need `ALLOW_DEMO_IN_PRODUCTION=true` to use it.

### Steps
1. Run `npm run db:setup` in a terminal and paste the **Transaction pooler** string when asked (Supabase: Connect > Connection string > Transaction pooler), then the database password. Both are hidden and never printed. Any older `DATABASE_URL` in `.env` or `.env.local` is ignored (not shown, not changed); a refused password can be retyped up to 3 times. The script:
   - checks the string belongs to this project and uses the pooler (port 6543), and connects with a verified certificate;
   - looks at what already exists, and asks before creating the missing tables (`supabase/migrations/20261121000000_gmbmirror_core.sql`; it never drops anything);
   - runs `supabase/verify/verify_schema.sql` (structure, RLS, isolation between users, no token access, functions blocked; temporary users rolled back);
   - asks, then saves `APP_MODE=supabase` and `DATABASE_URL` to `.env.local` (readable only by you; `.env` is not touched).
   `npm run db:setup -- --check` repeats the checks without writing anything.
2. Restart the dev server.
3. Sign up with a brand-new email, confirm, and run the fresh-account checks; then confirm the database holds only those new records.
4. After the trial: the demo `.data` files can be removed (backed up first, only with the owner's approval).


## 11. Email (Resend), added 21 November 2026

**Code:** `src/lib/email.ts` (Resend REST API, server only), `src/lib/notify.ts` (messages and preferences).
Outcomes are recorded honestly per account (Settings > Email notifications > Recent emails): *Accepted* (Resend
took it for delivery; it cannot confirm the inbox), *Not sent* with the reason, or *email not set up*.

| Email | Sent by | When | Can be turned off |
|---|---|---|---|
| Sign-up confirmation, password reset | **Supabase Auth** | Sign-up, "Forgot your password?" | no |
| Welcome | app | Once, after the email address is confirmed | no (once only) |
| Security notice | app | Password changed; Google connected or disconnected | no |
| Monthly report (PDF attached) | job runner | 1st of the month, with the scheduled report | yes |
| Failure alert | job runner | A scheduled post, review automation, refresh or report failed for good | yes |
| Post published | job runner | Google accepted a scheduled post | yes (off by default) |
| Report on request | app | "Email me this report" on Reports | — (owner's own action) |
| Contact form | app | `/contact`, to gmbmirror@gmail.com, reply-to the visitor | — |

Limits: 20 emails an hour per account, 3 contact messages an hour per address, 5 report emails an hour per account.
Retried jobs never send twice (Resend idempotency keys: welcome, report, job failure, post published).

**Setup**
1. Resend: add and verify your sending domain (DNS records Resend shows: SPF, DKIM; DMARC recommended).
2. Create an API key with sending access. Vercel (Production): `RESEND_API_KEY`, `EMAIL_FROM` (an address on that domain). Redeploy.
3. Supabase > Authentication > Emails > SMTP Settings: enable custom SMTP with host `smtp.resend.com`, port `465`,
   user `resend`, password = a Resend API key, sender = the same address as `EMAIL_FROM`. This sends sign-up and
   reset emails through your verified domain and lifts Supabase's built-in sender limits. Keep the templates of section 10.
4. Database: `npm run db:migrate` (applies `supabase/migrations/20261122000000_email_notifications.sql`, which widens
   the per-user record kinds; no data is changed). Then `npm run db:setup -- --check`.
5. Check: `/contact` shows the form; send yourself a report from Reports; Settings shows it as Accepted.


## 12. Region and performance (23 November 2026)

`vercel.json` sets `"regions": ["syd1"]`: functions and the Cron job run in Sydney, next to the Supabase database
(`ap-southeast-2`). Measured effect on signed-in pages: 430–640 ms → 10–21 ms of server time (see
`docs/PERFORMANCE_AUDIT.md`). After deploying, check Vercel > Settings > Functions shows Sydney, and that the build
log lists `syd1`. Page-speed lines appear in the logs as `[vitals] …`, slow queries as `[db] slow …`.
