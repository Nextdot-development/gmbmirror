import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "./env";
import { hashPassword, sign, unsign, verifyPassword } from "./crypto";
import { supabaseCookieOptions, supabasePublicKey } from "./supabase-cookies";

export type User = { id: string; email: string };

const DEMO_DIR = path.join(process.cwd(), ".data");
const USERS_FILE = path.join(DEMO_DIR, "users.json");
const SESSIONS_FILE = path.join(DEMO_DIR, "sessions.json");
const COOKIE = "ge_session";
const SESSION_DAYS = 14;

type DemoSession = { userId: string; expiresAt: number };

/**
 * Demo sessions live on the server. The cookie carries only a signed random id, so logging out
 * (deleting the record) kills the session even if someone kept a copy of the cookie.
 */
async function startDemoSession(userId: string) {
  const now = Date.now();
  const all = await readJson<Record<string, DemoSession>>(SESSIONS_FILE, {});
  for (const [k, s] of Object.entries(all)) if (s.expiresAt <= now) delete all[k];
  const sid = randomBytes(32).toString("hex");
  all[sid] = { userId, expiresAt: now + SESSION_DAYS * 86_400_000 };
  await writeJson(SESSIONS_FILE, all);
  (await cookies()).set(COOKIE, sign(sid), {
    httpOnly: true,
    sameSite: "lax",
    // Secure whenever the site is served over https. Plain http://localhost keeps working for local testing.
    secure: env.appUrl().startsWith("https://"),
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

async function demoSessionUserId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const sid = raw ? unsign(raw) : null;
  if (!sid) return null;
  const s = (await readJson<Record<string, DemoSession>>(SESSIONS_FILE, {}))[sid];
  return s && s.expiresAt > Date.now() ? s.userId : null;
}

async function endDemoSession() {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  const sid = raw ? unsign(raw) : null;
  if (sid) {
    const all = await readJson<Record<string, DemoSession>>(SESSIONS_FILE, {});
    if (all[sid]) {
      delete all[sid];
      await writeJson(SESSIONS_FILE, all);
    }
  }
  store.delete(COOKIE);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error("Could not read stored accounts.");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A damaged file must not look like "no accounts", or the next sign up would overwrite everyone.
    throw new Error("Stored accounts are damaged and could not be read.");
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabasePublicKey()!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, supabaseCookieOptions(options, env.appUrl())));
        } catch {
          /* called from a Server Component; session refresh happens on the next action */
        }
      },
    },
  });
}

export async function getUser(): Promise<User | null> {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  }
  const id = await demoSessionUserId();
  if (!id) return null;
  const users = await readJson<Record<string, { id: string; email: string; hash: string }>>(USERS_FILE, {});
  const u = Object.values(users).find((x) => x.id === id);
  return u ? { id: u.id, email: u.email } : null;
}

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Plain messages for Supabase signup errors; Supabase's own text can expose internals. */
export function signupError(code?: string): string {
  switch (code) {
    case "user_already_exists":
      return "An account with this email already exists. Log in instead.";
    case "weak_password":
      return "Choose a stronger password: longer, and not a common one.";
    case "email_address_invalid":
    case "email_address_not_authorized":
      return "This email address cannot be used. Try another one.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many sign up attempts. Try again in about an hour.";
    case "signup_disabled":
      return "New accounts are not being accepted right now.";
    default:
      return "Could not create the account. Try again in a few minutes.";
  }
}

export async function signUp(email: string, password: string): Promise<{ error?: string; needsConfirm?: boolean }> {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    // The confirmation email links back to /auth/confirm on this site, which signs the person in.
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${env.appUrl()}/auth/confirm?next=/app/onboarding` } });
    if (error) return { error: signupError((error as { code?: string }).code) };
    return { needsConfirm: !data.session };
  }
  const users = await readJson<Record<string, { id: string; email: string; hash: string }>>(USERS_FILE, {});
  const key = email.toLowerCase();
  if (users[key]) return { error: "An account with this email already exists. Log in instead." };
  const id = randomUUID();
  users[key] = { id, email: key, hash: hashPassword(password) };
  await writeJson(USERS_FILE, users);
  await startDemoSession(id);
  return {};
}

let dummy: string | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

export async function logIn(email: string, password: string): Promise<{ error?: string }> {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    // Only said after a correct password, so it does not reveal which emails have accounts.
    if ((error as { code?: string } | null)?.code === "email_not_confirmed") return { error: "Confirm your email first: open the link we sent when you signed up, then log in." };
    return error ? { error: "Email or password is incorrect." } : {};
  }
  const users = await readJson<Record<string, { id: string; email: string; hash: string }>>(USERS_FILE, {});
  const u = users[email.toLowerCase()];
  // An unknown email still runs one password check, so the answer takes as long as for a real account.
  if (!verifyPassword(password, u?.hash ?? dummyHash())) return { error: "Email or password is incorrect." };
  if (!u) return { error: "Email or password is incorrect." };
  await startDemoSession(u.id);
  return {};
}

export async function logOut() {
  if (env.mode() === "supabase") {
    const sb = await supabaseServer();
    await sb.auth.signOut();
  } else {
    await endDemoSession();
  }
}

/* ---------------- Email links and password reset (Supabase mode) ---------------- */

/** Where a link from an email may send the person afterwards: only a path on this site. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  return next && /^\/(?!\/)[A-Za-z0-9/_\-?=&.]*$/.test(next) ? next : fallback;
}

/**
 * Completes a link from a Supabase email (sign-up confirmation or password reset) and starts the session.
 * Two link forms are accepted: `token_hash` + `type` (the recommended email template, works in any browser), and
 * `code` (Supabase's default PKCE link, which works only in the browser that asked for it).
 */
export async function completeEmailLink(p: { tokenHash?: string | null; type?: string | null; code?: string | null }): Promise<boolean> {
  if (env.mode() !== "supabase") return false;
  const sb = await supabaseServer();
  const types = ["signup", "email", "recovery", "invite", "magiclink", "email_change"] as const;
  if (p.tokenHash && p.type && (types as readonly string[]).includes(p.type)) {
    const { error } = await sb.auth.verifyOtp({ token_hash: p.tokenHash, type: p.type as (typeof types)[number] });
    return !error;
  }
  if (p.code) {
    const { error } = await sb.auth.exchangeCodeForSession(p.code);
    return !error;
  }
  return false;
}

/**
 * Sends a password reset email if an account exists. The answer is the same either way, so it does not reveal
 * which emails have accounts. Demo mode has no email, so it cannot reset passwords.
 */
export async function requestPasswordReset(email: string): Promise<{ error?: string }> {
  if (env.mode() !== "supabase") return { error: "Password reset needs the live service. It is not available in this local demo." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm?next=/reset-password` });
  const code = (error as { code?: string } | null)?.code;
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return { error: "Too many reset emails were sent. Try again in about an hour." };
  return {};
}

/** Sets a new password for the signed-in person (after opening a reset link). */
export async function setNewPassword(password: string): Promise<{ error?: string }> {
  if (env.mode() !== "supabase") return { error: "Password reset is not available in this local demo." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password });
  if (!error) return {};
  const code = (error as { code?: string }).code;
  if (code === "same_password") return { error: "Choose a password different from your current one." };
  if (code === "weak_password") return { error: "Choose a stronger password: longer, and not a common one." };
  return { error: "The password could not be changed. Open the link from the email again." };
}
