# Feature Status Matrix

Audit date: 18 November 2026. Full reasoning: [COMPLETE_WEBSITE_AUDIT.md](COMPLETE_WEBSITE_AUDIT.md).

## How to read this

| Status | Meaning |
|---|---|
| WORKING | Tested successfully in this audit with the real application logic |
| PARTIALLY WORKING | Some of it works; limitations remain |
| DEMO / MOCK | Sample data, local file store or a mocked service |
| NOT WORKING | Code exists but fails |
| NOT IMPLEMENTED | Absent from the code |
| NOT VERIFIED | Cannot be tested without credentials, approval or an external service |

**Tested** column:
- **Today** means tested on 18 Nov 2026 on an isolated copy of the project.
- **Mock** means the AI provider was a local mock server.
- **Stand-in** means Supabase was a local stand-in.
- **PG** means local PostgreSQL.
- **Code** means code inspection only.

**Most WORKING items were tested in demo mode (local JSON files).** The Supabase path was tested only against the stand-in.

---

## Authentication and accounts

| Feature | Status | Tested | Evidence (files) | Limitations / requirements |
|---|---|---|---|---|
| Sign up (demo) | WORKING | Today | `src/app/actions.ts` `signUpAction`, `src/lib/session.ts` | Local files only |
| Sign up (Supabase) | NOT VERIFIED | Stand-in | `src/lib/session.ts` | Needs a real Supabase project |
| Log in (demo) | WORKING | Today | `logInAction` | |
| Log in (Supabase) | NOT VERIFIED | Stand-in | `logIn` | |
| Log out and session revocation | WORKING | Today | `logOut`, `endDemoSession` | Copied cookie dies after logout |
| Password rules | WORKING | Today | `passwordSchema` | 8 to 128 characters, no complexity rule |
| Password hashing (demo) | WORKING | Today | `src/lib/crypto.ts` | scrypt, random salt |
| Session expiry (demo, 14 days) | WORKING | Today | `session.ts` | |
| Secure cookie on https | WORKING | Today | `startDemoSession` | Only when `NEXT_PUBLIC_APP_URL` is https |
| Supabase session refresh | NOT VERIFIED | Stand-in | `src/proxy.ts` | Passed against the stand-in |
| Rate limit: login | WORKING | Today | `src/lib/ratelimit.ts` | 5 per email, 20 per address per 15 min; per process |
| Rate limit: signup | WORKING | Today | `ratelimit.ts` | 5 per address per hour |
| Email verification | NOT VERIFIED (Supabase) / NOT IMPLEMENTED (demo) | Code | `signUpAction` | No route to finish the confirmation link |
| Password reset | NOT IMPLEMENTED | Code | | |
| Change email or password | NOT IMPLEMENTED | Code | | |
| Delete account | NOT IMPLEMENTED | Today | | Only data deletion exists |

## Onboarding

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Business type (healthcare / local) | WORKING | Today | `src/components/forms.tsx` `BusinessForm` | |
| Name, website, city, category | WORKING | Today | `businessSchema` in `actions.ts` | |
| Phone, Place ID | WORKING | Today | | Place ID typed by hand; not checked with Google |
| Field validation | WORKING | Today | | |
| Redirect to onboarding until a business exists | WORKING | Today | `src/lib/ctx.ts` | |

## Dashboard

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Business overview | WORKING | Today | `src/app/app/page.tsx` | |
| Google connection status (3 states) | WORKING | Today | | "Connected" state needs live Google, so it is NOT VERIFIED |
| Latest AI visibility result with ring chart | WORKING | Today | `src/components/bits.tsx` `Ring` | |
| Profile checklist progress | WORKING | Today | | Self-reported |
| Three recommended actions | WORKING | Today | `src/lib/recommend.ts` | Fixed rules, no AI |
| Performance statistics | NOT IMPLEMENTED | Code | | Needs Google Performance API |

## Google Business Profile

| Feature | Status | Tested | Evidence | Requirements |
|---|---|---|---|---|
| Approval gate (`GBP_API_APPROVED`) | WORKING | Today | `src/lib/gbp.ts` `live()` | |
| OAuth start (redirect, scopes, state) | WORKING | Today, fake keys | `src/app/api/google/start/route.ts` | |
| OAuth callback guards | WORKING | Today | `src/app/api/google/callback/route.ts` | |
| Full OAuth sign-in and token exchange | NOT VERIFIED | Code | `src/lib/google.ts` `exchangeCode` | Real OAuth client; test users |
| Token encryption at rest | NOT VERIFIED | Code | `src/lib/crypto.ts` | Never exercised |
| Token refresh | NOT VERIFIED | Code | `accessToken()` | |
| Location discovery | NOT VERIFIED | Code | `listLocations` | API approval; max 100 locations per account |
| Location selection (validated) | NOT VERIFIED | Code | `chooseLocationAction` | Form appears only with live locations |
| Business info sync | NOT IMPLEMENTED | Code | | |
| Connected-state screens | WORKING | Today, seeded record | `src/app/app/google/page.tsx` | |
| Disconnect (local delete) | PARTIALLY WORKING | Today | `disconnectGoogleAction` | Not revoked at Google |
| Performance insights | NOT IMPLEMENTED | Code | | |

## Reviews

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Review list | DEMO / MOCK | Today | `sampleReviews()` | 4 labelled sample reviews |
| Live reviews from Google | NOT VERIFIED | Code | `listReviews` | API approval; max 50, no paging |
| AI reply draft | NOT VERIFIED (real AI); app flow tested with mock | Mock | `draftReply`, `replyAction` | Needs `ANTHROPIC_API_KEY` |
| Edit, save draft | WORKING | Today | `replyAction` | |
| Approve | WORKING | Today | | Says clearly it is not posted |
| Post reply to Google | NOT VERIFIED | Code | `postReply` | API approval |
| Forged review id refused | WORKING | Today | `replyAction` | |
| Healthcare wording warning on replies | PARTIALLY WORKING | Today | `medicalWarnings` | Only shown after a live post |
| Review link | WORKING | Today | `google/page.tsx` | Place ID not validated |
| Review QR code | WORKING | Today | `qrcode` | |

## Posts

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Manual post creation | WORKING | Today | `postComposerAction` | 10 to 1,500 characters |
| AI post draft | NOT VERIFIED (real AI); app flow tested with mock | Mock | `draftPost` | |
| Draft list | WORKING | Today | `posts/page.tsx` | Composer not cleared after save |
| Edit a saved post | NOT IMPLEMENTED | Today | | Delete and re-create |
| Approve | WORKING | Today | `postItemAction` | |
| Delete | WORKING | Today | | |
| Scheduling | PARTIALLY WORKING | Today | `scheduledFor` | Stored and shown; never auto-publishes |
| Publish to Google | NOT VERIFIED | Code | `createPost` | Event and Offer details missing; failures silent |
| Post types | WORKING (UI) | Today | | Offer hidden for healthcare |
| Medical wording check | PARTIALLY WORKING | Today | `src/lib/medical.ts` | "100%" rule never fires; "offer" false positives |

## AI visibility

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Claude checks | NOT VERIFIED (real); pipeline tested with mock | Mock | `src/lib/ai.ts` | Needs `ANTHROPIC_API_KEY` |
| ChatGPT checks | NOT VERIFIED | Code | `openai()` | Needs `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Gemini checks | NOT VERIFIED | Code | `gemini()` | Needs `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Question generation | WORKING | Today | `questionsFor` | 2 fixed questions; awkward for some categories |
| Name matching | PARTIALLY WORKING | Today, mock | `mentions()` | Whole-word exact only; variants and non-Latin names missed |
| Competitors named instead | PARTIALLY WORKING | Today, mock | `listNames` | Always uses Claude; silently empty on failure |
| Results display | WORKING | Today | `visibility/page.tsx` | |
| History (30) and bar chart | WORKING | Today | `store.ts`, `visibility/page.tsx` | |
| Score | NOT IMPLEMENTED | Code | | Only "Named in X of Y" |
| Recommendations | WORKING (fixed text) | Today | | Not tailored by AI |
| Error handling (429, 500, bad JSON, empty, timeout) | WORKING | Today, mock | `call()` in `ai.ts` | One failing provider fails the whole check |
| Rate limit (6 per hour) | WORKING | Today | `ratelimit.ts` | Failed checks count toward it |
| Overall | PARTIALLY WORKING | | | |

## ChatGPT Business Hub guide

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Steps | WORKING (static) | Today | `CHATGPT_STEPS` | General, not tied to OpenAI's current process |
| Preparation checklist | WORKING | Today | `toggleGuideAction` | |
| Notes | WORKING | Today | `saveGuideNotesAction` | Up to 4,000 characters |
| Manual insights | WORKING | Today | `addInsightAction` | Cannot edit or delete; up to 50 |
| OpenAI integration | NOT IMPLEMENTED (by design) | Code | | |

## Settings

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Edit business details | WORKING | Today | `settings/page.tsx` | |
| Setup status | WORKING | Today | | Read-only |
| Delete my data | WORKING | Today | `deleteAllDataAction` | Account stays |
| User settings | NOT IMPLEMENTED | | | |
| Integration settings in the UI | NOT IMPLEMENTED | | | `.env` only |

## Platform, security and infrastructure

| Feature | Status | Tested | Evidence | Limitations |
|---|---|---|---|---|
| Route protection | WORKING | Today | `requireUser`, app layout | |
| Account data isolation (demo) | WORKING | Today | `store.ts` | |
| RLS policies | WORKING in local PostgreSQL; NOT VERIFIED in Supabase | Today, PG | `supabase/schema.sql` | Schema not re-runnable |
| Startup configuration check | WORKING | Today | `env.ts`, `instrumentation.ts` | |
| Security headers | WORKING | Today | `next.config.ts` | CSP allows inline scripts |
| Database read-error handling | WORKING (stand-in) | Stand-in | `store.ts`, `app/error.tsx` | |
| Demo file store | DEMO / MOCK | Today | `store.ts`, `session.ts` | No locking; testing only |
| Supabase data store | NOT VERIFIED | Stand-in | `store.ts` | |
| Logging and monitoring | NOT IMPLEMENTED | Code | | |
| Automated tests | NOT IMPLEMENTED | | | |
| Landing page | WORKING | Today | `src/app/page.tsx` | Pricing placeholder |
| Privacy and terms pages | PARTIALLY WORKING | Today | | `{{contact_email}}` placeholder; legal review needed |
| Responsive layout | WORKING | Today | | No overflow at 390, 820 or 1,720px |

## Totals

| Status | Count |
|---|---|
| WORKING | 54 |
| PARTIALLY WORKING | 8 |
| DEMO / MOCK | 2 |
| NOT WORKING | 0 |
| NOT IMPLEMENTED | 13 |
| NOT VERIFIED | 18 |
| **Total rows** | **95** |

Rows with a combined status (for example "NOT VERIFIED (Supabase) / NOT IMPLEMENTED (demo)") are counted once, under the first status listed. The "Overall" row for AI visibility is counted too.
