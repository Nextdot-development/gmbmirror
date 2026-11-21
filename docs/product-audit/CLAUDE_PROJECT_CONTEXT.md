# GMB Growth Engine: Project Context for Claude

Last updated: 18 November 2026 (after a full audit). Read this first in any new session. Details live in the other files in `docs/product-audit/`.

## What it is

A Next.js 16 web app for local businesses, mainly doctors and clinics in India, to:

1. **Manage their Google Business Profile.** AI-drafted review replies and posts that the owner edits and approves, a self-reported profile checklist, and a review link and QR code.
2. **Run AI visibility checks.** Ask Claude (and optionally ChatGPT and Gemini, through their APIs) "best {category} in {city}" questions and record whether the business is named.
3. **Follow a ChatGPT Business Hub guide.** A checklist, notes and manual numbers. There is no OpenAI integration, by design.

Product principles: nothing posts without owner approval; no review gating; no ranking or lead promises; every number says where it came from; sample data is always labelled.

## Stack and layout

- Next.js 16.4.6 App Router with Server Actions, React 19, Tailwind 4, TypeScript 7 strict, Zod 4.
- Supabase via `@supabase/ssr` in production; JSON files in `.data/` in demo mode.
- All AI and Google calls use plain `fetch` from the server. No SDKs. The browser never calls third parties.
- **All mutations are in `src/app/actions.ts`.** Domain logic is in `src/lib/`. Pages are in `src/app/app/*`. Client forms are in `src/components/forms.tsx`. Design tokens are in `src/app/globals.css`.
- Storage is a per-user key-value store (`src/lib/store.ts`) with keys `business`, `checks`, `google`, `replies`, `posts`, `guide`. In Supabase it is one table, `public.user_data(user_id, key, value jsonb)`, with RLS `auth.uid() = user_id`.
- `APP_MODE` must be `demo` or `supabase`, or the server refuses to start. `npm start` refuses demo mode unless `ALLOW_DEMO_IN_PRODUCTION=true`.
- `GBP_API_APPROVED=true` is the switch for any live Google API call. Without it, the reviews page shows 4 labelled sample reviews.

## Business types

`healthcare` (11-item checklist, no Offer posts, medical wording scan, strict reply rules) or `general` (10 items, Offer allowed). Categories are in `src/lib/business.ts`.

## Status at a glance

| Area | Status |
|---|---|
| Demo-mode auth, sessions, onboarding, dashboard, checklist, QR, posts and replies drafting flow, guide, settings, delete data, isolation | WORKING (tested 18 Nov) |
| Rate limits, security headers, startup config check, server-side demo sessions, forged review id rejection | WORKING (tested 18 Nov) |
| AI features | App flow tested with a **mock** provider only; real output NOT VERIFIED |
| AI visibility | PARTIALLY WORKING: exact whole-word matching, 2 fixed questions, one provider failure fails all |
| Google OAuth | Redirect and callback guards WORKING; real exchange NOT VERIFIED |
| Google locations, reviews, replies, posts | NOT VERIFIED; needs Google API approval |
| Supabase mode | Tested against a local **stand-in** and local PostgreSQL for RLS only; NOT VERIFIED with a real project |
| Reviews list | DEMO / MOCK sample data |
| Scheduling | Date stored only, no auto-publish |
| Password reset, account deletion, Google token revocation, performance insights, automated tests, logging | NOT IMPLEMENTED |

## Known bugs to remember

- Event and Offer posts lack event or offer fields, so Google will likely reject them. Publish failures are silent (`postItemAction`).
- Healthcare reply warnings only appear after a live post (`replyAction`).
- The `100%` medical rule never matches; "offer" gives false positives (`src/lib/medical.ts`).
- The privacy page shows `{{contact_email}}`; it mentions account deletion that does not exist.
- `supabase/schema.sql` fails if re-run.
- There is no Supabase email-confirmation callback route.
- Rate limits are in-memory per process and trust `x-forwarded-for`.

## Local environment facts

- The project is not a git repository, and there is no test suite in the repo.
- The local `.env` is in demo mode, with no AI keys, no Google keys and no Supabase. `npm run dev` works. `npm start` needs `ALLOW_DEMO_IN_PRODUCTION=true`.
- The user's real demo accounts live in `.data/`. Do not overwrite them. Test against a copy of the project or a separate `.data`.
- The build downloads the DM Sans font, so it needs internet access.

## How it was tested (reuse this approach)

The audit copied the project to a scratch folder and ran `next start` there on port 3111 with throwaway secrets. It used:

- headless Chrome via `puppeteer-core`, installed outside the project;
- a mock Anthropic server through `ANTHROPIC_BASE_URL`;
- fake Google client keys;
- a small Supabase Auth and PostgREST stand-in;
- a throwaway PostgreSQL for `schema.sql` RLS.

About 140 checks passed with no genuine failures. Never claim Google, Supabase or AI work live until tested against the real services.

## Working rules the owner has set

- Do not redesign or add features unless asked. Do not change architecture, auth or database logic without being asked.
- Do not add unnecessary dependencies. Never print or commit secrets. Do not modify `.env`.
- Do not claim something works unless it was tested; distinguish mock, stand-in and real tests.
- Current design is an earthy brown theme (DM Sans, cream backgrounds, brown buttons, caramel accents), with a full-width app layout and a 232px left sidebar.

## Next priorities

1. Real Supabase project, then an end-to-end account and data test.
2. Real Anthropic key, then review real drafts, especially healthcare.
3. Healthcare reply warnings before approval; fix the medical wording rules.
4. Password reset, account deletion, email-confirmation route.
5. Tests in the repository, plus error logging.
6. After Google approval: live Google tests; fix Event and Offer posts, silent publish failures and token revocation.
7. Legal review and contact email before launch.
