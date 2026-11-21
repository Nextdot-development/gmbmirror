# Known Issues and Roadmap

Audit date: 18 November 2026. Evidence for each item is in [COMPLETE_WEBSITE_AUDIT.md](COMPLETE_WEBSITE_AUDIT.md).

## Priority scale

| Priority | Meaning |
|---|---|
| **P0** | Blocks a real launch. Customers cannot safely use the product until it is done. |
| **P1** | Should be fixed before or right after launch; affects trust, compliance or core features. |
| **P2** | Real problem with limited impact, or an important improvement. |
| **P3** | Polish, clean-up or nice to have. |

---

## 1. Critical issues (P0)

| # | Issue | Why P0 | Where |
|---|---|---|---|
| 1 | **The production backend has never run against a real Supabase project.** Signup, email confirmation, login, session refresh, RLS in Supabase and data saving are proven only against a local stand-in and local PostgreSQL. | Every real customer depends on this path. | `src/lib/session.ts`, `src/lib/store.ts`, `src/proxy.ts`, `supabase/schema.sql` |
| 2 | **No live Google feature has run.** OAuth exchange, token encryption and refresh, locations, reviews, replies and posting are all untested. | Reviews and posts are the core promise of the product. | `src/lib/google.ts`, `src/lib/gbp.ts` |
| 3 | **No real AI output has been seen.** Reply drafts, post drafts and visibility answers were tested only with a mock. | Bad or unsafe drafts would reach customers' public profiles. Clinics need the medical rules followed. | `src/lib/ai.ts` |
| 4 | **Production configuration is not set.** `APP_MODE=supabase`, an https `NEXT_PUBLIC_APP_URL`, fresh secrets, `GOOGLE_REDIRECT_URI` and `NEXT_PUBLIC_CONTACT_EMAIL` are all missing. | The server refuses to start without them; that is intended. | `.env` |
| 5 | **Legal pages are not ready.** The privacy page shows `{{contact_email}}`. Neither page has had legal review. The privacy page mentions account deletion, which does not exist. | Google OAuth verification and Indian data-protection rules expect accurate policies. | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` |

## 2. Partially implemented features

| # | Feature | What is missing | Priority |
|---|---|---|---|
| 6 | Google post publishing | Event and Offer posts are sent without event or offer details, so Google will most likely reject them. A failed publish shows no message. | P1 |
| 7 | Google disconnect | Tokens are deleted locally but never revoked at Google. | P1 |
| 8 | Healthcare wording check on replies | Warnings are shown only after a live post to Google, never on save or approve. | P1 |
| 9 | Medical wording rules | The "100%" rule can never match (word boundary after `%`). "We offer ..." triggers the discount warning. | P2 |
| 10 | AI visibility accuracy | Whole-word exact name only; variants and non-Latin names are missed. Two fixed questions, awkward for some categories ("best doctor or clinic in ..."). One failing provider fails the whole check. Competitor extraction always uses Claude and fails silently. | P2 |
| 11 | Visibility quota | Failed checks count toward the 6-per-hour limit. | P3 |
| 12 | Post scheduling | The date is stored only; nothing publishes automatically. | P2 |
| 13 | Supabase email confirmation | No route finishes the confirmation link; the user must log in by hand afterwards. Not tested. | P1 |
| 14 | Rate limiting | In-memory per process; trusts `x-forwarded-for`. Fine for one server behind a trusted proxy, not for serverless or multiple instances. | P1 if multi-instance, otherwise P2 |
| 15 | Google list sizes | Reviews capped at 50 and locations at 100, with no paging. | P2 |
| 16 | Post composer | Text is not cleared after saving, which invites duplicate saves. Saved posts cannot be edited. | P3 |
| 17 | ChatGPT guide insights | Entries cannot be edited or deleted. | P3 |
| 18 | `supabase/schema.sql` | Fails if run a second time. No migration tool. | P2 |

## 3. Missing functionality

| # | Feature | Priority | Why |
|---|---|---|---|
| 19 | Password reset | P1 | Users who forget a password are locked out. |
| 20 | Account deletion (not just data) | P1 | Privacy expectations and the privacy page's own wording. |
| 21 | Automated tests in the repository | P1 | Today's ~140 checks live outside the project and are not repeatable by others. |
| 22 | Error logging and monitoring | P1 | AI and Google failures are invisible to the operator in production. |
| 23 | Google performance insights (views, calls, directions) | P2 | Expected by owners; needs the Business Profile Performance API. |
| 24 | Business information sync from Google (hours, categories, description) | P2 | The checklist is self-reported today. |
| 25 | Automatic scheduled publishing | P2 | Needs a job runner. |
| 26 | Change email or password | P2 | |
| 27 | Visibility score or trend explanation | P3 | Only "Named in X of Y" exists. |
| 28 | Real pricing and billing | P2 for a paid launch | The Pricing section is a placeholder. |
| 29 | Page-level loading states | P3 | The `.skeleton` style exists but is unused. |
| 30 | Place ID lookup | P3 | Owners must find and paste their Place ID themselves. |

## 4. Features that need Google approval

These need Google Business Profile API "Basic API Access" approval for the Cloud project, plus `GBP_API_APPROVED=true`. Public use also needs OAuth consent-screen verification; until then only test users can connect.

- Location discovery and selection
- Live reviews
- Posting review replies
- Publishing posts
- Performance insights (not built)
- Business information sync (not built)

## 5. Features that need API credentials

| Credential (variable names) | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | Reply drafts, post drafts, Claude visibility checks, competitor extraction |
| `OPENAI_API_KEY` + `OPENAI_MODEL` | ChatGPT visibility checks |
| `GEMINI_API_KEY` + `GEMINI_MODEL` | Gemini visibility checks |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REDIRECT_URI` + `TOKEN_ENCRYPTION_KEY` | Google sign-in |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production accounts and storage |

## 6. Production deployment requirements

1. Create a Supabase project, run `supabase/schema.sql`, and configure Auth: site URL, redirect URLs and email templates.
2. Set `APP_MODE=supabase`, the Supabase URL and anon key, an https `NEXT_PUBLIC_APP_URL`, a fresh `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`), and `NEXT_PUBLIC_CONTACT_EMAIL`.
3. Configure the Google OAuth client with the production redirect URI, apply for Business Profile API access, and complete OAuth verification.
4. Host on a single long-running Node server behind a proxy that sets `x-forwarded-for`, or add a shared rate-limit store first.
5. Allow internet access at build time (font download).
6. Run an end-to-end test against the real services before inviting customers.
7. Get the privacy policy and terms reviewed.

## 7. Recommended future improvements

| # | Improvement | Priority |
|---|---|---|
| 31 | Make Supabase auth cookies httpOnly (the app has no browser-side Supabase code). | P2 |
| 32 | Replace CSP `'unsafe-inline'` scripts with nonces. | P2 |
| 33 | Allow partial visibility results when one provider fails. | P2 |
| 34 | Better name matching: aliases entered by the owner, and fuzzy matching with a "possible match" state. | P2 |
| 35 | Let owners write their own visibility questions. | P3 |
| 36 | Mobile app nav: show that more items exist off-screen. | P3 |
| 37 | Friendly status badge labels ("Draft", "Approved", "Posted"). | P3 |
| 38 | Remove dead code: `recommendCopy()` and the unused `.skeleton` style. | P3 |
| 39 | File locking in the demo store (demo only). | P3 |
| 40 | Remove the stray `package-lock.json` in the home folder, or set `turbopack.root`, to silence the build warning. | P3 |

## Suggested order of work

1. **P0 #4, #1:** set up a real Supabase project and run the full account and data flow against it.
2. **P0 #3:** add an Anthropic key; review real reply and post drafts for healthcare and local businesses.
3. **P1 #8, #9:** show healthcare wording warnings before approving replies; fix the wording rules.
4. **P1 #19, #20, #13:** password reset, account deletion, email-confirmation route.
5. **P1 #21, #22:** move the audit tests into the repository; add error logging.
6. **P0 #2 with P1 #6, #7:** once Google approves, test every Google feature live; fix Event and Offer posts, publish errors and token revocation.
7. **P0 #5:** legal review and contact email before inviting customers.
8. P2 items, starting with visibility accuracy (#10, #33, #34).
