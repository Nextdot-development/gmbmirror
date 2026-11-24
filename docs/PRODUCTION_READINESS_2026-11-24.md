# GMBmirror production readiness (24 November 2026)

What was checked on the live site (https://www.gmbmirror.com, deployment of commit 83ba673), in Vercel, Supabase
(public settings and the database), Resend and DNS. "Verified live" means observed in production today; "stand-in"
means proven only against the test servers' fake Google.

## Checklist

### Working (verified live)
- Domain and build: the build's base URL is `https://gmbmirror.com` (sitemap, robots, email links).
- Sign-up: the confirmation email is sent by Supabase through Resend SMTP from `notifications@gmbmirror.com`;
  Resend reports it delivered (3 test sign-ups).
- Log in after confirming, log out, log in again; signed-out visitors are sent to log in.
- Password reset email: sent and delivered.
- Invalid or used email links: `/auth/confirm` → `/login?link=expired` with a clear message.
- Resend: `gmbmirror.com` verified (DKIM and both SPF/return-path records verified; DMARC `p=quarantine`).
- Google OAuth request: client ID, redirect URI `https://gmbmirror.com/api/google/callback`, scopes
  `business.manage openid email`, offline access, PKCE S256, 48-character state. Google accepts it (no
  `redirect_uri_mismatch`) and shows "Sign in to continue to gmbmirror.com" with the privacy policy and terms links.
- Database: all migrations applied; RLS on all 8 tables; 13 isolation and security checks pass.
- Cron: `/api/jobs/run` answers 200 every minute; no errors or configuration warnings in the logs.
- Region: functions in `syd1` next to Supabase `ap-southeast-2`.
- Preview deployments: `DATABASE_URL` is Production only, so a Preview build refuses to start and cannot reach
  customer data.

### Broken in production
- **Email links lead to `http://localhost:3000`.** Supabase's Site URL is still localhost and
  `https://gmbmirror.com/auth/confirm` is not on its Redirect URLs list, so after verifying, Supabase sends people to
  localhost. Sign-up confirmation and password reset are unusable for customers until fixed (Supabase dashboard,
  below). The account is confirmed by the click; the person just cannot see it.
- Email templates are Supabase's defaults (`{{ .ConfirmationURL }}`), which only finish in the browser that signed up.

### Implemented, not yet verified with a real Google account (stand-in tests pass)
OAuth code exchange, encrypted token storage, token refresh, account and location discovery (several accounts,
pages, shared locations), multiple locations, reviews and replies (draft with Claude, approval, automatic replies for
safe positive reviews), posts with photos and scheduling, insights, disconnect with revocation. Needs one real
connection by the owner (steps below).

### Implemented, needs real data to judge
Profile audit, competitor comparison and rank grid (Places API key set), AI visibility checks (Claude), monthly
reports and PDF, email notifications. They run on live data once a business is set up.

### Fixed today
- Sign-up said "Account created. Check your email" even when Supabase sent nothing (address already has an account).
  It now says the account may exist and to log in or reset the password.
- An email-sending failure showed "Could not create the account"; it now says the confirmation email could not be sent.
- No way to get a new confirmation link: "Send the confirmation link again" after sign-up and after a login refused
  for an unconfirmed email (rate limited; does not reveal whether an address has an account).
- A Supabase link that falls back to the home page (`/?code=…`) is now finished at `/auth/confirm`.

### Notes
- Supabase Auth emails have no Reply-To (Supabase's SMTP settings do not offer one). App emails sent through the
  Resend API use `EMAIL_REPLY_TO=gmbmirror@gmail.com`.
- `gmbmirror.com` redirects to `www.gmbmirror.com` in Vercel. Links still work (one extra hop), but make the apex the
  main address so cookies and Google's callback share one host.
- OpenAI and Gemini code paths exist for optional visibility checks but are off (`AI_EXTRA_PROVIDERS` unset, no keys
  on Vercel). Only Claude is used.
- Test accounts created today (all `gmbmirror+…@gmail.com`, in the support inbox): `signuptest-1795504256017`,
  `flowtest-1795504365726`, `oauthtest-…` (password in the local scratchpad file only). Delete them in Supabase >
  Authentication > Users when done.

## Supabase dashboard (owner)
1. Authentication > URL Configuration
   - Site URL: `https://gmbmirror.com`
   - Redirect URLs: `https://gmbmirror.com/auth/confirm`, `https://www.gmbmirror.com/auth/confirm`,
     `http://localhost:3000/auth/confirm`
2. Authentication > Email Templates
   - Confirm signup, link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app/onboarding`
   - Reset password, link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
3. Authentication > Emails > SMTP: already working through Resend; keep the sender `notifications@gmbmirror.com`.
4. Then sign up once with a new address and check the link opens `https://gmbmirror.com/app/onboarding`.

## Vercel (owner)
- Domains: `gmbmirror.com` without redirect; `www.gmbmirror.com` → 308 to `gmbmirror.com`;
  `gmbmirror.vercel.app` → 308 to `gmbmirror.com` if offered.
- Environment variables: all required ones are present in Production (names checked; values of Sensitive variables
  cannot be read back). Optional: `GOOGLE_SITE_VERIFICATION` (the domain is already verified by a DNS TXT record).

## Google (owner)
1. Connect a real Business Profile from https://gmbmirror.com/app/google-profile with the Google account that manages
   it; confirm reviews, a reply, a post and insights.
2. Google Auth Platform: publishing status, verification of the sensitive scope `business.manage` (Verification
   Center), branding (logo upload), authorized domain `gmbmirror.com`. Business Profile API access is reported approved.
