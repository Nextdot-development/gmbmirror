import type { VisibilityCheck, VisibilityResult } from "./types";

/** Older checks only stored `found`; newer ones also store `match`. */
export function resultMatch(r: VisibilityResult): "named" | "possible" | "none" {
  return r.match ?? (r.found ? "named" : "none");
}

/** Visibility score 0-100: answers that named the business / all answers. Possible matches do not count. */
export function checkScore(c: VisibilityCheck): number {
  if (!c.results.length) return 0;
  return Math.round((100 * c.results.filter((r) => resultMatch(r) === "named").length) / c.results.length);
}

/** Score change against the previous check, or null if there is none. */
export function scoreTrend(checks: VisibilityCheck[]): number | null {
  return checks.length > 1 ? checkScore(checks[0]) - checkScore(checks[1]) : null;
}

export function trendText(delta: number | null): string {
  if (delta === null) return "First check";
  if (delta === 0) return "No change vs previous check";
  return `${delta > 0 ? "+" : ""}${delta} vs previous check`;
}
