import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseCookieOptions, supabasePublicKey } from "@/lib/supabase-cookies";

/**
 * Keeps Supabase sessions alive. Server Components cannot write cookies, so a session refreshed while
 * rendering a page was thrown away and the user was logged out when the access token ran out.
 * This runs before the page, refreshes the session if needed (getClaims: a local check otherwise), and writes the new cookies to both the
 * request (so the page sees them) and the response (so the browser keeps them).
 * In demo mode it does nothing.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabasePublicKey();
  if (process.env.APP_MODE !== "supabase" || !url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, supabaseCookieOptions(options, process.env.NEXT_PUBLIC_APP_URL ?? "")));
      },
    },
  });
  // Refreshes the session when the access token is about to expire (the only time Supabase Auth is contacted) and
  // verifies the token locally with the project's public signing key. No Auth server call on ordinary requests.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/signup", "/forgot-password", "/reset-password", "/auth/:path*", "/api/google/:path*"],
};
