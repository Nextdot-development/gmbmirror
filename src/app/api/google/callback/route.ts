import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { env } from "@/lib/env";
import { unsign } from "@/lib/crypto";
import { exchangeCode } from "@/lib/google";
import { autoLocation, discoverLocations, locationFields, syncBusinessFromGoogle, withGoogle } from "@/lib/gbp";
import { GbpError } from "@/lib/gbp-api";
import { db } from "@/lib/store";
import type { GoogleConnection } from "@/lib/types";

const PAGES = ["/app/google", "/app/onboarding/connect", "/app/settings"];

export async function GET(req: NextRequest) {
  // The page that started the sign-in, from the signed cookie (checked against a fixed list).
  const signed = (unsign(req.cookies.get("g_pkce")?.value ?? "") ?? "").split("|");
  const page = PAGES.includes(signed[3]) ? signed[3] : "/app/google";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`${page}?${q}`, env.appUrl()));
    res.cookies.delete("g_state");
    res.cookies.set("g_pkce", "", { path: "/api/google", maxAge: 0 });
    return res;
  };
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl()));

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return back("error=denied");
  if (!env.googleConfigured()) return back("error=not_configured");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || state !== req.cookies.get("g_state")?.value) return back("error=state");
  // The verifier cookie is signed and names the user who started the sign-in.
  const [pkceState, pkceUser, verifier] = signed;
  if (pkceState !== state || pkceUser !== user.id || !verifier) return back("error=state");
  const { ids } = await db.getLocations(user.id);
  if (!ids.includes(signed[4])) return back("error=state");
  const scope = { userId: user.id, loc: signed[4] };

  let conn: GoogleConnection;
  try {
    const { conn: fresh } = await exchangeCode(code, verifier);
    const prev = await db.getGoogle(scope);
    // The chosen location is kept only when the same Google account signs in again.
    const keep = prev && prev.email && prev.email === fresh.email
      ? { accountName: prev.accountName, locationName: prev.locationName, locationTitle: prev.locationTitle, locationAddress: prev.locationAddress, locationPlaceId: prev.locationPlaceId, lastSync: prev.lastSync, insights: prev.insights }
      : {};
    conn = { ...keep, ...fresh, connectedAt: new Date().toISOString() };
    await db.saveGoogle(scope, conn);
  } catch (e) {
    return back(e instanceof GbpError && e.kind === "scope" ? "error=scope" : "error=exchange");
  }

  // Choose the location straight away when there is only one, or one that is the listing chosen in Settings.
  if (env.gbpApproved() && !conn.locationName) {
    try {
      const { locations } = await withGoogle(scope, conn, "locations", discoverLocations);
      const business = await db.getBusiness(scope);
      const pick = autoLocation(locations, business?.placeId);
      if (pick) {
        let picked = false;
        await db.updateGoogle(scope, conn.connectedAt, (cur) => {
          picked = true;
          return { ...cur, ...locationFields(pick) };
        });
        if (picked) await syncBusinessFromGoogle(scope);
      }
    } catch {
      /* the Google page shows the error and the location list */
    }
  }
  return back("connected=1");
}
