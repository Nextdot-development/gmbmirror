export type Mode = "supabase" | "demo";

/**
 * Everything that must be true before the app may serve requests. Returns plain-language problems.
 * Nothing is guessed: a missing or misspelt APP_MODE is a problem, not a silent fall back to demo.
 */
export function configProblems(e: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const mode = e.APP_MODE;
  if (mode !== "demo" && mode !== "supabase") {
    out.push(`APP_MODE must be exactly "demo" or "supabase" (it is ${mode ? `"${mode}"` : "not set"}).`);
    return out;
  }
  if (mode === "demo") {
    // Vercel (and other serverless hosts) do not keep written files: demo accounts and data would vanish. No override.
    if (e.VERCEL === "1" || e.VERCEL_ENV) {
      out.push("APP_MODE=demo cannot run on Vercel: it stores accounts and data in local files, which Vercel does not keep. Set APP_MODE=supabase.");
      return out;
    }
    if (e.NODE_ENV === "production" && e.ALLOW_DEMO_IN_PRODUCTION !== "true") {
      out.push('APP_MODE=demo stores accounts in local files and is for testing only. Use APP_MODE=supabase, or set ALLOW_DEMO_IN_PRODUCTION=true to run a production build in demo mode on your own machine.');
    }
  }
  // Signs demo sessions and, in both modes, the "recognised browser" cookie that protects logins from lockout.
  if ((e.SESSION_SECRET ?? "").length < 32) out.push("SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32");
  if (mode === "supabase") {
    if (!e.NEXT_PUBLIC_SUPABASE_URL) out.push("NEXT_PUBLIC_SUPABASE_URL is required when APP_MODE=supabase.");
    if (!e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) out.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is required when APP_MODE=supabase.");
    // App data is stored from the server through PostgreSQL (the Supabase connection pooler).
    if (!e.DATABASE_URL) out.push("DATABASE_URL is required when APP_MODE=supabase: the Supabase transaction pooler connection string (Supabase dashboard > Connect > Transaction pooler, port 6543).");
    else if (!/^postgres(ql)?:\/\//.test(e.DATABASE_URL)) out.push("DATABASE_URL must start with postgresql:// (the Supabase connection string).");
    else if (/\[YOUR-PASSWORD\]/i.test(e.DATABASE_URL)) out.push("DATABASE_URL still contains [YOUR-PASSWORD]. Run npm run db:setup to enter the password safely.");
    else if (/@db\.[a-z0-9]+\.supabase\.co[:/]/i.test(e.DATABASE_URL)) out.push("DATABASE_URL is Supabase's direct connection, which does not work from Vercel (IPv6 only). Use the Transaction pooler string (port 6543): run npm run db:setup.");
  }
  // Rate limits key on the client address, which can only be read safely when we know how many proxies we control.
  const hops = e.TRUSTED_PROXY_HOPS?.trim();
  if (hops && !/^(10|[0-9])$/.test(hops)) {
    out.push(`TRUSTED_PROXY_HOPS must be a whole number from 0 to 10 (it is "${hops}").`);
  } else if (!hops && e.NODE_ENV === "production") {
    out.push(
      "TRUSTED_PROXY_HOPS must be set: the number of reverse proxies you control in front of the app (Vercel, nginx, Caddy or a load balancer: 1; Cloudflare in front of nginx: 2). Use 0 only when browsers reach the app directly, such as on your own machine; every visitor then shares one signup and login allowance.",
    );
  }
  const googleOn = Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  if ((googleOn || e.TOKEN_ENCRYPTION_KEY) && !/^[0-9a-fA-F]{64}$/.test(e.TOKEN_ENCRYPTION_KEY ?? "")) {
    out.push("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32");
  }
  return out;
}

let checked: Mode | undefined;

/** The validated mode. Throws instead of guessing, so a misconfigured server refuses to serve. */
function mode(): Mode {
  if (checked) return checked;
  // `next build` imports pages to analyse them; it serves nothing, so it is allowed through.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const problems = configProblems();
    if (problems.length) throw new Error(`Configuration error. ${problems.join(" ")}`);
  }
  checked = process.env.APP_MODE === "supabase" ? "supabase" : "demo";
  return checked;
}

export const env = {
  mode,
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  gbpApproved: () => process.env.GBP_API_APPROVED === "true",
  googleConfigured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  anthropicConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  // OpenAI and Gemini are used only when explicitly allowed (AI_EXTRA_PROVIDERS=true); Claude is the provider otherwise.
  openaiConfigured: () => process.env.AI_EXTRA_PROVIDERS === "true" && Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  geminiConfigured: () => process.env.AI_EXTRA_PROVIDERS === "true" && Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL),
  placesConfigured: () => Boolean(process.env.GOOGLE_PLACES_API_KEY),
};

export function requireSecret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}
