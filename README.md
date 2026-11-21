# GMBmirror

AI-Powered Google Business Profile Growth Platform (formerly GMB Growth Engine). Contact: gmbmirror@gmail.com.

Local business visibility platform: Google Business Profile reviews and posts, AI visibility checks, and a ChatGPT Business Hub guide.
Stack: Next.js 16, Tailwind 4, Supabase (optional in demo mode), Claude API.

## Run locally (demo mode, no database)
1. `npm install`
2. Open `.env`, set `ANTHROPIC_API_KEY`. Keep `APP_MODE=demo`.
3. `npm run dev` then open http://localhost:3000

Demo mode stores data in `.data/` on your machine. Use it for testing only.

`APP_MODE` must be set to exactly `demo` or `supabase`. If it is missing or misspelt the server refuses to start and prints what to fix.
A production build (`npm run build` then `npm start`) also refuses to run in demo mode. To try the production build on your own machine, set `ALLOW_DEMO_IN_PRODUCTION=true`.

## Production (Supabase)
1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. In `.env` set `APP_MODE=supabase` and the three Supabase values.
3. Generate fresh `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`.
4. Deploy (Vercel or any Node host) and set the same variables there.
5. Set `TRUSTED_PROXY_HOPS` to the number of reverse proxies you control in front of the app: `1` on Vercel or behind one nginx, Caddy or load balancer; `2` for Cloudflare in front of nginx. The app refuses to start in production without it. Behind a proxy, make sure browsers cannot reach the app's own port directly (firewall it), or they could send a forged address.

## Google Business Profile
1. Create a Google Cloud project. Submit the Business Profile API "Basic API Access" form with your 60+ day verified profile.
2. After approval, enable the Business Profile APIs, create an OAuth client (Web application), and set the redirect URI to `GOOGLE_REDIRECT_URI`.
3. Fill `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `GBP_API_APPROVED=true` only once Google has approved access.
4. Before OAuth verification, only test users you add in Cloud Console can connect.

Until approval the Google pages show clearly labelled sample data. Live Google calls are untested because they need an approved project.

## AI providers
Claude is required for reply drafts, post drafts and the base visibility check. Add `OPENAI_API_KEY` + `OPENAI_MODEL` and/or `GEMINI_API_KEY` + `GEMINI_MODEL` to also check ChatGPT and Gemini through their APIs.

## Before launch
- Set `NEXT_PUBLIC_APP_URL`. The product name and public contact email are set in `src/lib/brand.ts`.
- Have a lawyer review `/privacy` and `/terms`.
