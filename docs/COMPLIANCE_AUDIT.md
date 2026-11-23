# GMBmirror compliance audit (21 November 2026)

Checked against the code in `src/` and the production Supabase project. Policies compared: Google API Services
User Data Policy (including Limited Use), Google OAuth 2.0 policies and brand verification requirements, Google
Business Profile API policies, Google Maps Platform terms (Places API). This is an engineering review, not legal advice.

## What exists

| Area | Finding (from the code) |
|---|---|
| Privacy policy | `/privacy`: short. Has a Google user data and Limited Use paragraph, AI and email sections. **Gaps:** no list of each Google data category and why; no retention periods; no subprocessors (Supabase, Vercel, Anthropic, Resend, Google); no international processing; no rights/requests process; says "AI providers you have enabled" (only Anthropic is used); no cookie detail. |
| Terms | `/terms`: short. **Gaps:** no eligibility, acceptable use, AI-output responsibility in detail, Google dependency, availability, IP, suspension, liability, changes, governing law, contact. |
| Cookie policy | **Missing.** Cookies in use (all first-party, strictly necessary, httpOnly): Supabase session `sb-<project>-auth-token` (max 30 days), `ge_device` (recognised browser for login protection, 180 days), `g_state` and `g_pkce` (Google sign-in, 10 minutes, path `/api/google`), `ge_session` (local demo only, 14 days). No analytics, advertising or third-party cookies; no localStorage. |
| Account deletion | Settings > "Delete all my data" removes all business data in every location, revokes Google access and deletes tokens. **Gap:** the sign-in account (Supabase Auth user) is kept, so it is data deletion, not account deletion. No confirmation page or email. |
| Data deletion procedure | **No public page** explaining how to delete data or what remains. |
| Google OAuth | Authorization code flow with PKCE (S256), `state` checked against an httpOnly cookie, signed verifier cookie naming the user and location, fixed list of return pages, `access_type=offline`, `prompt=select_account consent`. A grant without the Business Profile scope is revoked and refused. |
| Scopes | `https://www.googleapis.com/auth/business.manage`, `openid`, `email`. No broader scope. `business.manage` is the only scope for the Business Profile APIs. |
| Token storage | Access and refresh tokens AES-256-GCM encrypted by the app with `TOKEN_ENCRYPTION_KEY` before storage (`google_connections`), decrypted only on the server; never sent to the browser. Refresh on expiry; `invalid_grant` marks the connection "reconnect". Revoked at Google on disconnect (unless another location shares the grant) and on data deletion. |
| Google data stored | Connected Google account email; encrypted tokens; chosen account/location resource names, title, address, Place ID; profile snapshot (title, address, phone, website, category, description, hours, open status, verification); performance metrics (28-day totals, daily views, monthly totals); review count and rating over time; profile score history; reply drafts and history keyed by Google review name; posts with Google post name/state/link. **Review text is not stored** (read live). |
| Google data use | Only user-facing features: show reviews, draft and publish replies the owner approves (or opts into automatically), publish posts, show insights, profile score, reports. No advertising, no sale, no profiling across users, no model training (Anthropic's commercial API terms: inputs not used for training). |
| Google data to Anthropic | Review text (contact details removed by `redactForAi`), reviewer first name and star rating, the business's own details, the owner's previous replies (style), performance totals (insights explanation), counts for reports and competitor comparisons. Only on owner actions or enabled automation. |
| Places API (Maps Platform) | Business finder, public listing audit, competitor counts, rank grid. Competitor names are not stored (read on request). **Finding:** the listing audit history stores rating and review counts from Places results; Google Maps Platform terms restrict caching Places content (Place IDs may be stored). See "Findings". |
| Third parties | Supabase (database, authentication), Vercel (hosting, functions, logs), Anthropic (Claude), Google (OAuth, Business Profile APIs, Places API), Resend (email, when configured). No analytics, ads or tracking scripts. |
| Email | Resend, when configured (see DEPLOYMENT.md section 11); Supabase Auth sends confirmation and reset emails. |
| Payments | **None implemented.** The pricing section says no card is needed and plans are not yet listed. |
| Security | RLS on every table (browser roles read own rows only; tokens, jobs, rate limits unreachable); server-side access with a verified TLS connection; httpOnly Secure SameSite=Lax cookies; CSP, HSTS, frame denial; rate limits shared in the database; Cron protected by `CRON_SECRET`; open-redirect protection on email links. |
| Logs | No tokens, review text, email bodies or passwords are logged. Google API errors log the request path (account and location IDs) and status. |
| Contact | gmbmirror@gmail.com on every page footer, legal pages, Settings; `/contact` form (when email is configured). |

## Findings and fixes in this pass

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High (verification blocker) | No true account deletion: the sign-in account survives "Delete all my data". | New "Delete my account": revokes Google, deletes all data and the Supabase Auth user (sessions and identities go with it), signs out, honest confirmation page and email (when email is set up). |
| 2 | High (verification blocker) | Privacy policy does not itemise Google data, purposes, retention, subprocessors, rights. | Rewritten from the code. |
| 3 | Medium | Rate-limit records are never deleted; some keys contain an email address or IP address. | Expired records are removed by the job runner after 24 hours; an account's reset-limit record is removed on deletion. |
| 4 | Medium | No cookie, data-deletion, security or about pages. | Added. |
| 5 | Medium | Connect screen explains little before sending the owner to Google. | Permission explainer with the exact scopes, data read, actions, AI use, disconnect, policy links. |
| 6 | Medium | No way to add Google Search Console's ownership tag (needed for authorised domain verification). | `GOOGLE_SITE_VERIFICATION` adds the meta tag. |
| 7 | Low (report only) | Places listing-audit history keeps rating and review counts from Places results beyond what Maps Platform terms allow for cached content. | Not changed (it would remove a feature). Decide: keep only the latest audit for 30 days, or store Place IDs only. |
| 8 | Info | `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel but unused. | Remove it from Vercel. |

## Needs the owner's confirmation (not invented)

Legal name of the operator (person or company), postal address, country and governing law/courts, minimum age,
whether the service is offered to consumers or only businesses, future pricing/refund terms, a developer contact
email for Google Cloud (can differ from the public support address), and the production domain.
