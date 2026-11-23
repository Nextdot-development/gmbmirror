# GMBmirror: Google OAuth verification package

**Status: not submitted, not verified.** This package prepares the submission; Google decides.
Scope details: `docs/GOOGLE_SCOPE_JUSTIFICATION.md`. Compliance audit: `docs/COMPLIANCE_AUDIT.md`.

## 1. Prerequisites (in this order)

1. **Business Profile API access.** Request access for the Google Cloud project through Google's Business Profile
   API access request (the APIs return 0 quota until approved). Without it, `GBP_API_APPROVED` must stay off.
2. **Production domain** (owner decision). Options:
   - Keep `gmbmirror.vercel.app`. `vercel.app` is on the Public Suffix List, so `gmbmirror.vercel.app` is the
     registrable domain to authorise. Verify it in Google Search Console with a URL-prefix property and the HTML
     meta tag (set `GOOGLE_SITE_VERIFICATION` in Vercel and redeploy). Google may still question a platform
     subdomain during brand review.
   - **Recommended:** a custom domain you own (for example `gmbmirror.com`), added to Vercel, verified in Search
     Console with a DNS TXT record. Then update `NEXT_PUBLIC_APP_URL`, `GOOGLE_REDIRECT_URI` and Supabase Auth URLs.
3. The Search Console owner must be an Owner or Editor of the Google Cloud project.
4. Legal pages live and linked from the homepage (done: footer on every page).
5. Owner-confirmed legal details filled in `src/lib/legal.ts` (operator name, address, governing law).

## 2. OAuth consent screen (Google Auth Platform > Branding)

| Field | Value |
|---|---|
| App name | GMBmirror |
| User support email | gmbmirror@gmail.com |
| App logo | 120×120 px PNG of the GMBmirror mark (blue pin tile + wordmark). **To produce:** the repo has the SVG icon `src/app/icon.svg`; export a square PNG (no Google marks). |
| Application home page | `https://<domain>/` |
| Application privacy policy | `https://<domain>/privacy` |
| Application terms of service | `https://<domain>/terms` |
| Authorised domains | `<domain>` (see prerequisites) |
| Developer contact email | **Owner to provide** (receives Google's verification mail; can be gmbmirror@gmail.com) |
| Audience | External; publishing status "In production" when submitting |
| Data access (scopes) | `.../auth/business.manage`, `openid`, `.../auth/userinfo.email` |

**Clients > Web application:** authorised redirect URI exactly `https://<domain>/api/google/callback`
(same value as `GOOGLE_REDIRECT_URI`). No JavaScript origins are needed (no browser-side Google calls).

**APIs to enable:** My Business Account Management API, My Business Business Information API, Google My Business
API, Business Profile Performance API. (Places API is used with a server API key, not OAuth.)

## 3. App description (for the form)

GMBmirror is a web app for doctors, clinics and local businesses to manage their own Google Business Profile.
After signing in to GMBmirror, the owner connects the Google account that manages their profile and chooses a
location. GMBmirror then shows the location's reviews, profile and performance; drafts replies and posts with
AI (Anthropic Claude) for the owner to edit and approve; publishes approved replies and posts (posts at the time
the owner scheduled); and produces monthly reports. Owners can opt into automatic replies, limited to positive,
non-sensitive reviews that pass safety checks. GMBmirror never deletes Google content or edits business
information. Disconnecting revokes access and deletes stored tokens.

## 4. Scope justification (short form answers)

- **business.manage:** Required to read the owner's own Business Profile locations, reviews, posts and
  performance, and to publish the replies and posts the owner approves. It is the only scope for these APIs.
  Used in: location picker, Reviews page, Posts page, performance dashboard, monthly reports.
- **openid, email:** Show which Google account is connected and keep connections of the same Google account
  together across the owner's locations. Only the email address is stored.

## 5. Demo video script (2–4 minutes, unlisted YouTube link)

Record on the production domain, English narration or captions, browser address bar visible.

1. Homepage at `https://<domain>`: show the app name, scroll to the footer, open the privacy policy (Google user
   data section) and terms.
2. Sign up / sign in to GMBmirror with a test account.
3. Open **Google profile**: show the permission explainer (what is read, what can be done, scopes).
4. Click **Connect Google Business Profile**. Show Google's consent screen **with the app name GMBmirror and the
   requested scopes visible**, choose the test Google account, approve.
5. Back in GMBmirror: choose the location; show the connected state ("Connected as …").
6. **Reviews:** show live reviews; draft a reply with AI; edit it; approve and publish; show it on Google
   (Business Profile on Search/Maps) to prove the scope's use.
7. **Posts:** draft, approve and publish a post (or schedule one); show it on Google.
8. **Performance:** show the metrics from the Performance API.
9. **Settings:** show Disconnect; click it; show that access is removed (and optionally the entry gone from
   myaccount.google.com/connections). Show "Delete my account" and the data deletion page.

## 6. Screenshots to prepare

Consent screen with scopes; permission explainer; location picker; Reviews with a published reply; Posts;
Performance; Settings > Google connection with Disconnect; Settings > Delete my account; `/privacy#google`.

## 7. Reviewer test instructions

Google's reviewers usually need: a GMBmirror test account (email + password) **and** a Google account that
manages a Business Profile location (a test location you control), or the video above if they cannot use one.
Provide: sign-in URL, test credentials (create a dedicated account; do not reuse personal passwords), the steps
in section 5, and a note that publishing creates real replies/posts on the test location.

## 8. Remaining blockers before submitting

1. Production must run cleanly (see the DATABASE_URL fix and redeploy).
2. Business Profile API access approval for the Cloud project.
3. Google OAuth client created; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` set in Vercel.
4. Domain decision and Search Console verification (`GOOGLE_SITE_VERIFICATION`).
5. Owner legal details confirmed (operator, address, governing law) and published.
6. App logo PNG.
7. Email confirmation must work for real users (Resend + Supabase custom SMTP), so reviewers can sign up.
8. Demo video recorded against the real integration (cannot be recorded before items 2–3).
