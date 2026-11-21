import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/lib/job-handlers";

/**
 * Runs due background jobs (scheduled posts, review automation, Google refreshes, monthly reports).
 * For a scheduler such as cron, Vercel Cron or a cloud scheduler: POST with "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set on the server the endpoint is off.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return NextResponse.json({ error: "Background job endpoint is not configured." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    // Test servers only (JOBS_TEST_CLOCK=on): run as if it were a later time, to test schedules without waiting.
    const at = process.env.JOBS_TEST_CLOCK === "on" && req.nextUrl.searchParams.get("at") ? new Date(req.nextUrl.searchParams.get("at")!) : undefined;
    const r = await runJobs(at && !Number.isNaN(at.getTime()) ? { at } : {});
    return NextResponse.json(r);
  } catch (e) {
    console.error("[jobs] run failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The run failed. See the server log." }, { status: 500 });
  }
}
