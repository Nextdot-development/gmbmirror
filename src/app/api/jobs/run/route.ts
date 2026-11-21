import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/lib/job-handlers";

/**
 * Runs due background jobs (scheduled posts, review automation, Google refreshes, monthly reports).
 * Called by a scheduler with "Authorization: Bearer <CRON_SECRET>":
 *  - Vercel Cron calls it with GET (and sends that header itself when CRON_SECRET is set on the project);
 *  - any other scheduler (an external cron service, Render Cron, GitHub Actions) may use GET or POST.
 * Without CRON_SECRET set on the server the endpoint is off.
 *
 * On Vercel the function may run for up to 300 seconds. New jobs stop being started after 240 seconds; the rest
 * wait for the next call. In Supabase mode several calls may overlap safely (jobs are claimed with leases).
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return NextResponse.json({ error: "Background job endpoint is not configured." }, { status: 503 });
  // Exactly "Bearer <CRON_SECRET>", the form Vercel Cron sends; compared in constant time.
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    // Test servers only (JOBS_TEST_CLOCK=on): run as if it were a later time, to test schedules without waiting.
    const at = process.env.JOBS_TEST_CLOCK === "on" && req.nextUrl.searchParams.get("at") ? new Date(req.nextUrl.searchParams.get("at")!) : undefined;
    const r = await runJobs({ ...(at && !Number.isNaN(at.getTime()) ? { at } : {}), budgetMs: 240_000 });
    return NextResponse.json(r);
  } catch (e) {
    console.error("[jobs] run failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The run failed. See the server log." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
