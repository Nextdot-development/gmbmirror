# Technical Architecture

Audit date: 18 November 2026. Describes the code as it exists, not a plan.

## Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router, Turbopack, Server Actions, `proxy.ts`, `instrumentation.ts` | 16.4.6 |
| UI | React, Tailwind CSS 4 (tokens in `@theme`), Phosphor icons | 19.3.1, 4.3.5, 2.1.10 |
| Font | DM Sans via `next/font/google` (downloaded at build, served by the app); Geist Mono | |
| Language | TypeScript strict | 7.0.2 |
| Validation | Zod | 4.6.7 |
| Auth and DB (production) | Supabase via `@supabase/ssr`, `@supabase/supabase-js` | 0.12.7, 2.119.0 |
| Auth and DB (demo) | JSON files in `.data/` | |
| AI | Anthropic, OpenAI and Gemini HTTP APIs via `fetch`, no SDKs | |
| Google | OAuth 2.0 and Business Profile APIs via `fetch`, no SDK | |
| QR | `qrcode` | 1.5.4 |

There is no test framework, linter config, CI, Dockerfile or git repository.

## Folder structure

```
.
├── .env / .env.example         configuration (never commit .env)
├── .data/                      demo-mode storage (gitignored): users.json, sessions.json, user_data.json
├── next.config.ts              security headers, CSP, poweredByHeader off
├── supabase/schema.sql         the only database script: user_data table + RLS
├── docs/product-audit/         this audit
└── src/
    ├── instrumentation.ts      startup configuration check (refuses to serve if misconfigured)
    ├── proxy.ts                Supabase session refresh before /app, /login, /signup, /api/google
    ├── app/
    │   ├── layout.tsx          root HTML, fonts, metadata
    │   ├── globals.css         design tokens and shared component classes
    │   ├── actions.ts          ALL server actions (auth, business, AI, Google, reviews, posts, guide, settings)
    │   ├── page.tsx            landing page
    │   ├── login/, signup/, privacy/, terms/, not-found.tsx, opengraph-image.tsx, icon.svg
    │   ├── api/google/start/route.ts, api/google/callback/route.ts
    │   └── app/                signed-in area
    │       ├── layout.tsx      requires a user; sidebar
    │       ├── error.tsx       "We could not load your data"
    │       ├── page.tsx        dashboard
    │       └── onboarding/, google/, reviews/, posts/, visibility/, chatgpt/, settings/
    ├── components/
    │   ├── forms.tsx           all client-side forms (useActionState)
    │   ├── ui.tsx              SubmitButton, Msg, Field
    │   ├── bits.tsx            Source label, date format, Stars, Meter, Ring
    │   ├── AppNav.tsx, LandingNav.tsx, Footer.tsx, Logo.tsx, AuthShell.tsx, HeroArt.tsx, Reveal.tsx, TaglineReveal.tsx
    └── lib/
        ├── env.ts              mode, config validation, feature flags from env
        ├── session.ts          sign up, log in, log out, current user (demo + Supabase); Supabase server client
        ├── store.ts            per-user key/value store (demo files or Supabase table)
        ├── ctx.ts              requireBusiness()
        ├── crypto.ts           AES-256-GCM token encryption, HMAC cookie signing, scrypt passwords
        ├── ratelimit.ts        in-memory fixed-window limiter
        ├── ai.ts               provider calls, reply/post drafting, visibility checks
        ├── google.ts           OAuth URL, token exchange/refresh, GBP API calls, sample reviews
        ├── gbp.ts              live/sample switch, token refresh + save, location loading
        ├── recommend.ts        dashboard "next three actions" rules
        ├── medical.ts          healthcare wording rules
        ├── business.ts         categories, checklist items, ChatGPT guide content
        └── types.ts            shared types
```

## Request flow

### Reading a page

1. `src/proxy.ts` runs for `/app/*`, `/login`, `/signup` and `/api/google/*`. In supabase mode it refreshes the session cookie if needed. In demo mode it does nothing.
2. `src/app/app/layout.tsx` calls `requireUser()`. With no user, it redirects to `/login`.
3. The page calls `requireBusiness()`. With no business saved, it redirects to `/app/onboarding`.
4. The page reads with `db.get*(user.id)` and renders on the server.
5. If a read throws, `src/app/app/error.tsx` is shown.

### Submitting a form

1. A client form in `src/components/forms.tsx` uses `useActionState` with a Server Action.
2. The action in `src/app/actions.ts` runs on the server. It calls `requireUser()`, applies any rate limit, validates input, and calls AI or Google if needed.
3. It writes with `db.save*(user.id, ...)`.
4. It calls `revalidatePath()` and returns `{ ok | error | fieldErrors | values | text }`.
5. The form shows the message.

Simple toggles (checklist, guide, post approve, publish and delete) use plain `<form action={serverAction}>` without returned state.

The browser never calls Google, Supabase or AI providers. The CSP `connect-src 'self'` enforces this.

## Authentication

### Demo mode

- **Accounts:** `.data/users.json`, keyed by lower-cased email, storing `{ id, email, hash }`. The hash is `salt:scrypt(password, salt, 64)`.
- **Sessions:** `.data/sessions.json` maps a 32-byte random hex session id to `{ userId, expiresAt }`. Records last 14 days. Expired ones are pruned when a new session starts.
- **Cookie:** `ge_session = sid.HMAC_SHA256(sid, SESSION_SECRET)`. Flags: httpOnly, SameSite=Lax, Secure when `NEXT_PUBLIC_APP_URL` starts with `https://`, 14-day max age.
- **Logout:** deletes the session record and the cookie.

### Supabase mode

- `createServerClient` with the anon key and Next.js cookies (`supabaseServer()` in `session.ts`).
- Signup uses `auth.signUp`. If no session comes back, the user is told to confirm their email. There is no confirmation callback route.
- Login uses `auth.signInWithPassword`, logout uses `auth.signOut`, and the current user comes from `auth.getUser()`.
- `proxy.ts` refreshes tokens and copies new cookies onto both the request and the response.
- The service role key is never used.

## Data model

One logical record per user per key. In Supabase this is a row in `public.user_data (user_id, key, value jsonb, updated_at)`. In demo mode it is `user_data.json[userId][key]`.

| Key | Shape | Limits |
|---|---|---|
| `business` | `{ name, website, location, category, type: "healthcare" or "general", phone?, placeId?, audit: Record<itemKey, boolean>, createdAt }` | |
| `checks` | `VisibilityCheck[]`: `{ id, checkedAt, businessName, location, category, methodology, results: [{ provider, providerLabel, question, found, excerpt, mentionedBusinesses[] }] }` | newest 30 kept |
| `google` | `{ email, tokens (AES-GCM encrypted JSON of access_token, refresh_token, expires_at), accountName?, locationName?, locationTitle?, connectedAt }` | |
| `replies` | `Record<reviewId, { text, status: draft, approved or posted, updatedAt }>` | no cap |
| `posts` | `PostDraft[]`: `{ id, text, kind: STANDARD, EVENT or OFFER, scheduledFor?, status, warnings[], createdAt }` | no cap |
| `guide` | `{ done: Record<key, boolean>, notes, insights: [{ date, label, value }] }` | notes 4,000 characters, insights 50 |

Types are in `src/lib/types.ts`. Each write replaces the whole value for its key. There is no partial update and no row versioning.

### Supabase schema and RLS

```sql
create table public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null, value jsonb not null, updated_at timestamptz not null default now(),
  primary key (user_id, key));
alter table public.user_data enable row level security;
-- select / insert / update / delete policies: auth.uid() = user_id
```

There is no migration tool. Running the script a second time fails on `create policy` because the policies already exist.

## Integrations

| Service | Code | Calls |
|---|---|---|
| Anthropic | `claude()` in `src/lib/ai.ts` | `POST {ANTHROPIC_BASE_URL or https://api.anthropic.com}/v1/messages`; headers `x-api-key` and `anthropic-version: 2023-06-01`; model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`); `max_tokens` 120 to 600 |
| OpenAI | `openai()` | `POST https://api.openai.com/v1/chat/completions`, model `OPENAI_MODEL` |
| Gemini | `gemini()` | `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent`, header `x-goog-api-key` |
| All AI | `call()` | 45-second `AbortSignal.timeout`; 401/403, 400/404, 429, 5xx and unreadable bodies mapped to plain messages |
| Google OAuth | `authUrl`, `exchangeCode`, `accessToken` in `src/lib/google.ts` | scopes `business.manage openid email`; `access_type=offline`; `prompt=consent`; token endpoint `oauth2.googleapis.com/token` |
| GBP: accounts | `listLocations` | `GET mybusinessaccountmanagement.googleapis.com/v1/accounts` |
| GBP: locations | `listLocations` | `GET mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title&pageSize=100` |
| GBP: reviews | `listReviews` | `GET mybusiness.googleapis.com/v4/{account}/{location}/reviews?pageSize=50` |
| GBP: reply | `postReply` | `PUT mybusiness.googleapis.com/v4/{reviewName}/reply` |
| GBP: posts | `createPost` | `POST mybusiness.googleapis.com/v4/{account}/{location}/localPosts` with `{ languageCode: "en", summary, topicType }` |
| QR | `QRCode.toDataURL` in `google/page.tsx` | local |

Live Google calls happen only when `GBP_API_APPROVED=true` and a location is chosen (`live()` in `src/lib/gbp.ts`). Otherwise the reviews page shows labelled sample data.

## Configuration

| Variable | Required | Used for |
|---|---|---|
| `APP_MODE` | Always; must be `demo` or `supabase` | storage and auth backend |
| `ALLOW_DEMO_IN_PRODUCTION` | Only to run a production build in demo mode | safety switch |
| `SESSION_SECRET` | Demo; at least 32 characters | cookie signing |
| `TOKEN_ENCRYPTION_KEY` | When Google keys are set; 64 hex characters | token encryption |
| `NEXT_PUBLIC_APP_URL` | Recommended; https in production | redirects, metadata, Secure cookie |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase mode | |
| `SUPABASE_SERVICE_ROLE_KEY` | Not used by any code | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | For Google sign-in | |
| `GBP_API_APPROVED` | `true` only after Google approval | live Google calls |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL` | Key needed for all AI features | |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional; visibility only | |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Before launch | privacy page and footer |

The startup check (`configProblems()` in `src/lib/env.ts`, run from `src/instrumentation.ts`) refuses to serve when:

- `APP_MODE` is missing or misspelt;
- a production build runs in demo mode without `ALLOW_DEMO_IN_PRODUCTION=true`;
- demo mode has a `SESSION_SECRET` shorter than 32 characters;
- supabase mode is missing its URL or anon key;
- `TOKEN_ENCRYPTION_KEY` is malformed while Google keys or the key itself are set.

`next build` skips the runtime check.

## Security controls

| Control | Where |
|---|---|
| Route protection | `src/app/app/layout.tsx`, `requireUser()` in every action |
| Per-user data scoping | `db.*(user.id, ...)`; RLS in Supabase |
| Rate limits | `src/lib/ratelimit.ts`. In-memory per process. Login 5 per email and 20 per address per 15 minutes; signup 5 per address per hour; visibility 6 per user per hour; drafts 30 per user per hour. |
| OAuth CSRF | random state plus httpOnly 10-minute cookie |
| Token encryption | AES-256-GCM, random IV, auth tag |
| Headers | CSP (self only, `'unsafe-inline'` scripts and styles, `frame-ancestors 'none'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS (2 years), COOP |
| Untrusted ids | review ids checked against the user's loaded reviews; location ids against Google's list for the user |
| Server Action CSRF | Next.js built-in Origin check (not separately tested) |

## Development and production

| Task | Command | Notes |
|---|---|---|
| Install | `npm install` | |
| Develop | `npm run dev` | Demo mode allowed |
| Build | `npm run build` | Needs internet for the font download |
| Run production build | `npm start` | Refuses demo mode unless `ALLOW_DEMO_IN_PRODUCTION=true` |
| Production setup | Supabase project, `schema.sql`, `APP_MODE=supabase`, fresh secrets, https app URL | See the README |

Build note: Next.js warns that it ignored a `package-lock.json` in the user's home folder and suggests setting `turbopack.root` / `outputFileTracingRoot`. The warning is harmless but noisy.

Hosting note: rate limits and demo sessions assume a single long-running Node process. Serverless or multi-instance hosting needs a shared store for rate limits. Demo mode is not for hosting at all.
