import { NextRequest, NextResponse } from "next/server";

/**
 * Receives page-speed measurements from browsers (components/WebVitals.tsx) and writes one log line each, for Vercel
 * logs: `[vitals] LCP 1830 good /app/posts`. Accepts only known metric names, a number and a route pattern; anything
 * else is dropped. Limited per server instance, without storing anything (no database writes).
 */
const NAMES = new Set(["LCP", "INP", "CLS", "FCP", "TTFB", "NAV"]);
const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const budget = { windowStart: 0, count: 0 };

export async function POST(req: NextRequest) {
  const now = Date.now();
  if (now - budget.windowStart > 60_000) { budget.windowStart = now; budget.count = 0; }
  if (++budget.count > 600) return new NextResponse(null, { status: 204 });
  let m: { name?: unknown; value?: unknown; rating?: unknown; route?: unknown };
  try {
    m = JSON.parse((await req.text()).slice(0, 500));
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const name = typeof m.name === "string" && NAMES.has(m.name) ? m.name : null;
  const value = typeof m.value === "number" && Number.isFinite(m.value) && m.value >= 0 && m.value < 600_000 ? Math.round(m.value) : null;
  const route = typeof m.route === "string" && /^\/[A-Za-z0-9/_\-[\]]{0,80}$/.test(m.route) ? m.route : null;
  if (name && value !== null && route) {
    const rating = typeof m.rating === "string" && RATINGS.has(m.rating) ? m.rating : "-";
    console.log(`[vitals] ${name} ${value}${name === "CLS" ? "e-3" : "ms"} ${rating} ${route}`);
  }
  return new NextResponse(null, { status: 204 });
}
