import { NextRequest, NextResponse } from "next/server";
import { completeEmailLink, safeNext } from "@/lib/session";
import { env } from "@/lib/env";

/**
 * Where links in Supabase emails land (sign-up confirmation, password reset). It verifies the link, which signs the
 * person in (httpOnly session cookies), then sends them on: to onboarding after confirming, to /reset-password after
 * a reset link. A failed or expired link goes to the login page with a message.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const type = q.get("type");
  const next = safeNext(q.get("next"), type === "recovery" ? "/reset-password" : "/app");
  const ok = await completeEmailLink({ tokenHash: q.get("token_hash"), type, code: q.get("code") });
  const base = env.appUrl();
  return NextResponse.redirect(new URL(ok ? next : "/login?link=expired", base));
}
