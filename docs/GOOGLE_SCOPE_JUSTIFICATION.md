# GMBmirror: Google OAuth scope justification

Scopes requested (exactly, from `src/lib/google.ts` `SCOPES`), and nothing else:

| Scope | Type (check the classification shown in Google Cloud > Data access) |
|---|---|
| `https://www.googleapis.com/auth/business.manage` | Sensitive |
| `openid` | Non-sensitive |
| `email` (`https://www.googleapis.com/auth/userinfo.email`) | Non-sensitive |

Request parameters: `access_type=offline` (scheduled posts and opted-in review automation run when the owner is
not online), `prompt=select_account consent`, `include_granted_scopes=true`, PKCE S256, random `state`.

## `business.manage`

**Why it is needed.** It is the only OAuth scope for the Google Business Profile APIs; there is no read-only or
narrower scope. GMBmirror is a Business Profile management tool: every core feature reads or writes the owner's
own Business Profile.

**APIs and calls made with it** (all in `src/lib/gbp-api.ts`):

| API | Call | User-facing feature |
|---|---|---|
| My Business Account Management API v1 | `GET /v1/accounts` | List the business accounts the owner manages |
| My Business Business Information API v1 | `GET /v1/{account}/locations`, `GET /v1/{location}` | Choose a location; show the profile (name, address, phone, website, category, description, hours, open and verification status); fill in the owner's business details; profile completeness score |
| Google My Business API v4 | `GET .../reviews` | Show reviews; draft replies; review automation the owner turns on; review counts and rating over time |
| Google My Business API v4 | `PUT .../reviews/{id}/reply` | Publish or update a reply **the owner approved** (or an automatic reply the owner explicitly enabled, limited to safe 4–5 star reviews) |
| Google My Business API v4 | `GET .../localPosts`, `POST .../localPosts`, `PATCH .../localPosts/{id}` | Show post status; publish or update posts the owner approved, at the time they scheduled; avoid duplicates on retries |
| Business Profile Performance API v1 | `GET {location}:fetchMultiDailyMetricsTimeSeries` | Performance dashboard, period comparison, monthly report |

**Not done with it:** no deletion of reviews, posts, media or locations; no edits to business information;
no access to other users' locations; no use outside the owner's own session or the owner's own scheduled jobs.

**Why the less permissive alternative will not work:** none exists for these APIs. Read-only access would also
break the core purpose (publishing approved replies and posts).

## `openid` and `email`

**Why needed.** To show the owner which Google account is connected ("Connected as …"), and to tell whether a
reconnect or a second location uses the same Google account (so access is not revoked while another location
still uses it, and a location chosen under one account is not kept under another). Only the email address from
the ID token is stored. No profile photo, name, contacts or other Google account data is requested.

## Data handling summary (for the verification form)

- Stored: Google account email; access and refresh tokens encrypted with AES-256-GCM by the application before
  storage (Supabase PostgreSQL, Sydney); chosen location's resource name, title, address, Place ID; latest profile
  snapshot; performance totals; review counts and rating history; the owner's replies and posts with Google IDs.
  Review text is not stored.
- Shared: Anthropic (Claude) receives review text with phone numbers and email addresses removed, the reviewer's
  first name and rating, only to draft a reply the owner asked for or automation the owner enabled. Hosting
  (Vercel) and database (Supabase) process all data as infrastructure providers.
- Never: sold, used for advertising, used to train generalised AI models, used for credit or lending decisions.
- Deletion: Disconnect (revokes at Google, deletes tokens and Google profile copies); Delete my business data;
  Delete my account (also deletes the login). Public page: `/data-deletion`.
- Limited Use statement: in the privacy policy, section 3 (`/privacy#google`).
