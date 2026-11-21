import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseCookieOptions } from "@/lib/supabase-cookies";

/**
 * Keeps Supabase sessions alive. Server Components cannot write cookies, so a session refreshed while
 * rendering a page was thrown away and the user was logged out when the access token ran out.
 * This runs before the page, refreshes the session if needed, and writes the new cookies to both the
 * request (so the page sees them) and the response (so the browser keeps them).
 * In demo mode it does nothing.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
  // Contacts Supabase only when the stored token is close to expiry; it also validates the session.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/signup", "/api/google/:path*"],
};
