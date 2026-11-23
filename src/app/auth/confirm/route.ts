import { NextRequest, NextResponse, after } from "next/server";
import { completeEmailLink, safeNext } from "@/lib/session";
import { env } from "@/lib/env";
import { notifyWelcome } from "@/lib/notify";

/**
 * Where links in Supabase emails land (sign-up confirmation, password reset). It verifies the link, which signs the
 * person in (httpOnly session cookies), then sends them on: to onboarding after confirming, to /reset-password after
 * a reset link. A failed or expired link goes to the login page with a message.
 * After a sign-up confirmation, the welcome email is sent once per account, after the response.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const type = q.get("type");
  const next = safeNext(q.get("next"), type === "recovery" ? "/reset-password" : "/app");
  const user = await completeEmailLink({ tokenHash: q.get("token_hash"), type, code: q.get("code") });
  if (user && type !== "recovery" && user.email) after(() => notifyWelcome(user).then(() => undefined, () => undefined));
  return NextResponse.redirect(new URL(user ? next : "/login?link=expired", env.appUrl()));
}
