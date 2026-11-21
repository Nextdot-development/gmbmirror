import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScore, resultMatch, scoreTrend, trendText } from "@/lib/visibility";
import { refund, take } from "@/lib/ratelimit";
import type { VisibilityCheck, VisibilityResult } from "@/lib/types";

const r = (match: "named" | "possible" | "none"): VisibilityResult => ({ provider: "claude", providerLabel: "Claude", question: "q", found: match === "named", match, excerpt: "", mentionedBusinesses: [] });
const check = (...m: ("named" | "possible" | "none")[]): VisibilityCheck => ({ id: "x", checkedAt: "", businessName: "", location: "", category: "", methodology: "", results: m.map(r) });

test("score counts named answers only; possible matches do not count", () => {
  assert.equal(checkScore(check("named", "named", "possible", "none")), 50);
  assert.equal(checkScore(check("possible", "possible")), 0);
  assert.equal(checkScore(check()), 0);
});

test("older checks without `match` are scored from `found`", () => {
  const legacy = { ...r("named"), match: undefined };
  assert.equal(resultMatch(legacy), "named");
  assert.equal(resultMatch({ ...r("none"), match: undefined }), "none");
});

test("trend compares the latest check with the previous one", () => {
  assert.equal(scoreTrend([check("named"), check("none")]), 100);
  assert.equal(scoreTrend([check("none")]), null);
  assert.equal(trendText(null), "First check");
  assert.equal(trendText(0), "No change vs previous check");
  assert.equal(trendText(-25), "-25 vs previous check");
  assert.equal(trendText(40), "+40 vs previous check");
});

test("rate limiter: limit, cost per call and refund", () => {
  const lim = { limit: 3, windowMs: 60_000 }, key = `test:${Math.random()}`;
  assert.ok(take(key, lim).ok && take(key, lim).ok && take(key, lim).ok);
  assert.equal(take(key, lim).ok, false);
  refund(key);
  assert.equal(take(key, lim).ok, true);
  const k2 = `test:${Math.random()}`;
  assert.equal(take(k2, { limit: 10, windowMs: 60_000 }, 11).ok, false, "a single request costing more than the limit is refused");
  assert.ok(take(k2, { limit: 10, windowMs: 60_000 }, 10).ok);
  assert.equal(take(k2, { limit: 10, windowMs: 60_000 }, 1).ok, false);
});
