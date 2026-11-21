import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getUser } from "@/lib/session";
import { db } from "@/lib/store";
import { env } from "@/lib/env";
import { sign } from "@/lib/crypto";
import { authUrl, pkcePair } from "@/lib/google";

/**
 * Starts the Google sign-in. Two short-lived, httpOnly cookies tie the answer to this browser and this user:
 * g_state (the state Google sends back) and g_pkce (signed: state, user id, the PKCE verifier, the page to return to and the location).
 * `?from=onboarding|settings` returns there afterwards; anything else returns to the Google page.
 */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.appUrl()));
  const from = returnPage(req.nextUrl.searchParams.get("from"));
  if (!env.googleConfigured()) return NextResponse.redirect(new URL(`${from}?error=not_configured`, env.appUrl()));
  const state = randomBytes(24).toString("hex");
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.redirect(authUrl(state, challenge));
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: env.appUrl().startsWith("https"), path: "/api/google", maxAge: 600 };
  res.cookies.set("g_state", state, { ...opts, path: "/" });
  // The location the sign-in is for: the connection is saved there even if the owner switches location meanwhile.
  const { active } = await db.getLocations(user.id);
  res.cookies.set("g_pkce", sign(`${state}|${user.id}|${verifier}|${from}|${active}`), opts);
  return res;
}

/** Only these pages can be returned to, so the parameter cannot redirect anywhere else. */
function returnPage(from: string | null): string {
  return from === "onboarding" ? "/app/onboarding/connect" : from === "settings" ? "/app/settings" : "/app/google";
}
