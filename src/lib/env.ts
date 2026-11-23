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
    else {
      const p = databaseUrlProblem(e.DATABASE_URL, e.NEXT_PUBLIC_SUPABASE_URL);
      if (p) out.push(p);
    }
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
  // Email (Resend): both settings or neither. The sender must be on a domain verified in Resend, which a free
  // mailbox domain (gmail.com and the like) can never be.
  const resend = e.RESEND_API_KEY?.trim(), from = e.EMAIL_FROM?.trim();
  if (resend && !from) out.push('EMAIL_FROM is required with RESEND_API_KEY: the sender, for example "GMBmirror <notifications@yourdomain.com>", on a domain verified in Resend.');
  if (from && !resend) out.push("RESEND_API_KEY is required with EMAIL_FROM (Resend > API Keys; sending access is enough).");
  if (from) {
    const addr = from.match(/<([^>]+)>\s*$/)?.[1] ?? from;
    const domain = addr.split("@")[1]?.toLowerCase() ?? "";
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr)) out.push('EMAIL_FROM must be an address, or a name and an address: "GMBmirror <notifications@yourdomain.com>".');
    else if (/^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail|rediffmail)\.[a-z.]+$/.test(domain)) out.push(`EMAIL_FROM cannot use ${domain}: Resend sends only from a domain you own and have verified. Keep ${"gmbmirror@gmail.com"} as the reply-to address (the default).`);
  }
  if (resend && !resend.startsWith("re_")) out.push("RESEND_API_KEY does not look like a Resend key (they start with re_).");
  const googleOn = Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
  if ((googleOn || e.TOKEN_ENCRYPTION_KEY) && !/^[0-9a-fA-F]{64}$/.test(e.TOKEN_ENCRYPTION_KEY ?? "")) {
    out.push("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32");
  }
  return out;
}

/**
 * Settings that only affect one feature, so they are warnings (logged at startup) rather than reasons to refuse to
 * start. Values are never repeated.
 */
export function configWarnings(e: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const app = e.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const redirect = e.GOOGLE_REDIRECT_URI?.trim();
  if (redirect && app && e.NODE_ENV === "production" && redirect !== `${app}/api/google/callback`) {
    out.push("GOOGLE_REDIRECT_URI is not NEXT_PUBLIC_APP_URL + /api/google/callback. Connecting Google will fail (the sign-in cookies belong to the app's own address). Set it to exactly that, and register the same URI in Google Cloud.");
  }
  if (e.NODE_ENV === "production" && e.SUPABASE_SERVICE_ROLE_KEY) out.push("SUPABASE_SERVICE_ROLE_KEY is set but never used. Remove it: an unused admin key is a needless risk.");
  return out;
}

/**
 * The structure of DATABASE_URL, without ever repeating its value (it holds the password): user and password before
 * an "@", a real host name, a numeric port, and, for Supabase's pooler, the user of this project. Catches a value
 * that was cut short or pasted with unencoded special characters before the first query fails with an unclear error.
 */
export function databaseUrlProblem(raw: string, supabaseUrl?: string): string | undefined {
  const help = "Copy the whole Transaction pooler string again (Supabase: Connect > Transaction pooler) and paste it as the value, nothing else.";
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return `DATABASE_URL could not be read as a connection string. If the password contains / # ? @ or spaces, they must be URL-encoded (npm run db:setup does this and saves the result to .env.local, ready to copy). ${help}`;
  }
  if (!raw.includes("@") || !u.username) return `DATABASE_URL has no user, password and host ("user:password@host"): the value looks cut short. ${help}`;
  const host = u.hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!u.password && !local) return `DATABASE_URL has no password. ${help}`;
  if (!host || host.endsWith(".") || (!host.includes(".") && !local)) return `DATABASE_URL's host name is not a real address. ${help}`;
  if (u.port && !/^\d+$/.test(u.port)) return `DATABASE_URL's port is not a number. ${help}`;
  if (/\.pooler\.supabase\.com$/i.test(host)) {
    const ref = supabaseUrl?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
    if (ref && decodeURIComponent(u.username) !== `postgres.${ref}`) return `DATABASE_URL belongs to a different Supabase project than NEXT_PUBLIC_SUPABASE_URL (its user should be postgres.<your project id>). ${help}`;
  }
  return undefined;
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
