# GMBmirror performance audit (23 November 2026)

All numbers below were measured, not estimated. How:

- **Production (public pages only):** `curl` from India to `https://gmbmirror.vercel.app`; Vercel project settings
  and logs read with the Vercel CLI. Signed-in production pages were not measured: that needs a production
  account, which would change production data.
- **Signed-in pages:** `tests/perf/rig.mjs` (run it yourself:
  `node --import ./tests/setup/register.mjs tests/perf/rig.mjs --rtt 200 --label x`). Production build of a clean
  copy of the app, Supabase mode, a throwaway PostgreSQL with the real schema behind a proxy adding the round-trip
  time to every exchange, and a Supabase Auth stand-in with the same delay and real ES256-signed sessions (like the
  production project). One user with 3 locations, 40 posts, 60 replies, 12 reports and full logs per location.
  RTT 200 ms ≈ Vercel `iad1` (Washington) to Supabase `ap-southeast-2` (Sydney), today's production layout.
  Results: `tests/perf/result-*.json`.

## Root causes (in order of impact)

1. **Functions run in Washington (`iad1`); the database and Supabase Auth are in Sydney.** Every database query and
   every Auth call crossed the Pacific (≈200 ms each). Measured: page time ≈ round trips × 200 ms.
2. **Two Supabase Auth network calls on every dashboard request** (`auth.getUser()` in the proxy and again in the
   page; it always calls the Auth server, despite the old comment). The project signs sessions with ES256, so the
   session can be verified locally (`getClaims()`).
3. **Too many sequential database round trips: 9–31 per page.** The layout and the page each read the location
   list (2 queries each time) and the business; the layout read every location's business one query at a time;
   pages awaited independent reads one after another; the Locations page made ~7 reads per location.
4. **No loading state for dashboard pages.** With dynamic pages and no `loading.tsx`, a click showed nothing until
   the whole next page had rendered on the server, so navigation felt frozen.
5. **Large pages:** Posts rendered every post's editors (202 KB of HTML for 40 posts), Reports every report (127 KB).

Not causes (checked): client JavaScript (≈805 KB raw in total, of which React DOM 70 KB gz and the Next.js runtime
≈83 KB gz; app code is split per page, largest app chunk 10 KB gz; no heavy browser libraries), fonts (self-hosted
by `next/font`), images (only small SVG icons), external scripts (none), AI (no page waits for Claude: drafts run
on request, cached per user for an hour; growth recommendations only when their data changed), public pages
(static, served from Vercel's Mumbai edge cache: `x-vercel-cache: HIT`).

## Before and after (signed-in pages, server time, median of 5 after one warm-up)

| Page | Before, 200 ms RTT | After code fixes, 200 ms RTT | After code fixes + `syd1` (2 ms RTT) | Auth calls | DB round trips | HTML |
|---|---|---|---|---|---|---|
| `/app` dashboard | 1,654 ms | 435 ms | 16 ms | 2 → 0 | 12 → 3 | 46 → 51 KB |
| `/app/reviews` | 1,462 ms | 433 ms | 14 ms | 2 → 0 | 12 → 3 | 49 → 54 KB |
| `/app/posts` | 1,674 ms | 642 ms | 21 ms | 2 → 0 | 11 → 4 | **202 → 112 KB** |
| `/app/reports` | 1,872 ms | 633 ms | 17 ms | 2 → 0 | 12 → 4 | **127 → 84 KB** |
| `/app/locations` | 3,087 ms | 633 ms | 13 ms | 2 → 0 | 31 → 5 | 38 → 43 KB |
| `/app/settings` | 2,063 ms | 633 ms | 13 ms | 2 → 0 | 13 → 5 | 48 → 54 KB |
| `/app/google` | 3,078 ms | 635 ms | 13 ms | 2 → 0 | 17 → 5 | 60 → 65 KB |
| `/app/visibility` | 1,444 ms | 428 ms | 10 ms | 2 → 0 | 9 → 3 | 29 → 34 KB |

(Measured before three pages were renamed: `/app/google` is now `/app/google-profile`, `/app/visibility` is
`/app/ai-visibility`, `/app/chatgpt` is `/app/chatgpt-guide`; the old addresses redirect. The `syd1` column was measured with the "after code fixes" build. HTML grew by ~5 KB per page: the loading
skeleton and the page-speed reporter.)

Production public pages (from India, before any change): static pages 0.24–0.6 s (edge cache hit), `/login`
0.5–1.6 s (dynamic: Mumbai edge → Washington), `/api/jobs/run` refusal 0.45 s.

In-browser (local production build, Playwright, `tests/e2e/performance.spec.ts`, desktop and mobile): dashboard LCP
under 2.5 s, CLS under 0.1, click-to-page under 1 s for Reviews, Posts, Reports, Settings, Dashboard. These guard
against regressions; real-user numbers come from the new reporting below once deployed.

## Changes

| Area | Change | Files |
|---|---|---|
| Region | `"regions": ["syd1"]` (functions and Cron next to Supabase Sydney) | `vercel.json` |
| Auth | Sessions verified locally (`getClaims`, ES256 public key cached 10 min by supabase-js) in the proxy and pages; one check per request (React `cache`); full Auth-server check kept for account deletion and password change (`getVerifiedUser`) | `src/proxy.ts`, `src/lib/session.ts`, `src/app/actions.ts` |
| Database | Location list in one query (was 2); all location names in one query, only when the menu shows them; per-request reuse of reads (React `cache`, cleared by any write, copies per reader, not used by actions or jobs); `db.preload` reads several records of a location in one round trip; pages declare what they read (`requireBusiness([...])`); independent reads in parallel (Google page, grid allowance) | `src/lib/db-pg.ts`, `src/lib/store.ts`, `src/lib/ctx.ts`, `src/app/app/layout.tsx`, `src/app/app/*/page.tsx`, `src/lib/grid-server.ts` |
| Pagination | Posts editors 15 at a time, reports 6 at a time ("Show more", keeps other filters; the calendar still uses all posts). Reviews were already paged by Google (50); the activity log shows the latest 30 | `src/components/ShowMore.tsx`, posts and reports pages |
| Navigation | `loading.tsx` skeleton (shown instantly, sidebar stays), pending dot on the clicked menu link (`useLinkStatus`) | `src/app/app/loading.tsx`, `src/components/AppNav.tsx`, `globals.css` |
| Monitoring | Web Vitals (LCP, INP, CLS, FCP, TTFB) and click-to-page time ("NAV") from browsers to `/api/vitals` → one Vercel log line each (`[vitals] LCP 1830ms good /app/posts`), route pattern only, IDs removed, nothing stored; slow database queries and transactions logged (`[db] slow …`, statement start only, never values; `DB_SLOW_MS`, default 250); job runs log count, duration and outcomes | `src/components/WebVitals.tsx`, `src/app/api/vitals/route.ts`, `src/lib/db-pg.ts`, `src/app/api/jobs/run/route.ts` |

Security is unchanged: RLS untouched; no cross-user caching (the read cache is per request and keyed by user);
sensitive actions still confirm with the Auth server.

## Remaining bottlenecks

1. **Browser-to-server distance.** Users in India reach `syd1` in ~130–150 ms per round trip (less than to
   Washington). Unavoidable without moving the database; edge caching already covers the public pages.
2. **Reviews page waits for Google** (one live Business Profile call per visit, by design). The loading skeleton
   covers it; streaming the list behind its own Suspense boundary is a possible next step.
3. **The job runner plans recurring work for every user on every run** (`planRecurring`: a few queries per user
   and location each minute). Fine for hundreds of accounts in `syd1`; for thousands, plan less often or in SQL.
4. **Cold starts:** the first request on a new function instance opens a TLS connection to the pooler. Fluid
   compute keeps instances warm; watch `[db] waited` lines.
5. Each dashboard page is still 3–5 dependent round trips (user → location → its records → page extras); in
   `syd1` that is a few milliseconds.
