/** Runs once when the server starts. A misconfigured server stops here instead of serving requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configProblems } = await import("./lib/env");
  const problems = configProblems();
  if (problems.length) {
    console.error(`\nGMBmirror cannot start:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    throw new Error("Configuration error. See the list above.");
  }
  // Background jobs: an in-process timer for a single long-running server. On by default for `npm start` in demo mode;
  // under `next dev` only with JOBS_RUNNER=inprocess, so a development server never acts on stored data by surprise.
  // Serverless or multi-instance deployments set JOBS_RUNNER=off and call POST /api/jobs/run from a scheduler.
  const runner = process.env.JOBS_RUNNER;
  const inProcess = runner === "inprocess" || (runner !== "off" && process.env.NODE_ENV === "production" && process.env.APP_MODE === "demo");
  if (inProcess) {
    const every = Math.max(15, Number(process.env.JOBS_INTERVAL_SECONDS) || 60) * 1000;
    const timer = setInterval(async () => {
      try {
        const { runJobs } = await import("./lib/job-handlers");
        const r = await runJobs();
        if (r.ran) console.log(`[jobs] ran ${r.ran} job(s)`);
      } catch (e) {
        console.error("[jobs] background run failed:", e instanceof Error ? e.message : e);
      }
    }, every);
    timer.unref();
  }
}
