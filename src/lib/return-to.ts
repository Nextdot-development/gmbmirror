/**
 * Returning to the page asked for after logging in. Shared by the proxy (edge), the session guard and the login
 * page and action, so it imports nothing.
 */

/** Request header the proxy sets on dashboard page loads: the path and query asked for. */
export const ASKED_HEADER = "x-gmb-asked-path";

/**
 * A dashboard address that is safe to send someone to after logging in, or undefined. Only this site's own /app
 * pages: no other site, no "//host", no backslashes or odd characters, no fragments, bounded length.
 */
export function dashboardReturn(next: string | null | undefined): string | undefined {
  if (!next || next.length > 300) return undefined;
  if (!/^\/app(?:[/?][A-Za-z0-9/_\-?=&.%]*)?$/.test(next)) return undefined;
  if (next.includes("//") || next.includes("/..")) return undefined;
  return next;
}

/** The login address that comes back to `asked` afterwards (plain /login when there is nothing worth returning to). */
export function loginFor(asked: string | null | undefined): string {
  const back = dashboardReturn(asked);
  return back && back !== "/app" ? `/login?next=${encodeURIComponent(back)}` : "/login";
}
