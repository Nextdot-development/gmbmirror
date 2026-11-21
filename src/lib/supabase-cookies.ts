/**
 * Options for every Supabase auth cookie the app writes (supabase mode).
 * @supabase/ssr defaults to httpOnly: false (so browser code can read the session) and always sets a 400-day
 * lifetime. This app never uses Supabase from the browser, so the cookies can be httpOnly, Secure on https, and
 * shorter-lived. The 30 days restart whenever Supabase refreshes the session, so active users stay logged in.
 * Deletions (maxAge 0) pass through unchanged, so logging out still clears the cookies.
 */
const MAX_AGE = 30 * 86_400;

export function supabaseCookieOptions<T extends { maxAge?: number }>(options: T | undefined, appUrl: string): T & { httpOnly: true; secure: boolean; sameSite: "lax" } {
  const o = { ...(options ?? ({} as T)) };
  if (o.maxAge === undefined || o.maxAge > MAX_AGE) o.maxAge = MAX_AGE;
  return { ...o, httpOnly: true, secure: appUrl.startsWith("https://"), sameSite: "lax" };
}
