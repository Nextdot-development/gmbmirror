import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardReturn, loginFor } from "@/lib/return-to";

test("after login, only this site's own dashboard pages can be returned to", () => {
  for (const ok of ["/app", "/app/reviews", "/app/google-profile?change=1", "/app/reports/abc-123/pdf", "/app/posts?shown=30"]) {
    assert.equal(dashboardReturn(ok), ok, ok);
  }
  for (const bad of [
    "https://evil.example/app", "//evil.example", "/app//evil.example", "/\\evil.example", "/app\\x", "/apps", "/application",
    "/login", "/", "javascript:alert(1)", " /app", "/app\n", "/app#x", "/app/../login", "/app/" + "a".repeat(400), "", null, undefined,
  ]) {
    assert.equal(dashboardReturn(bad as string), undefined, String(bad));
  }
});

test("the login address carries the page asked for, and nothing else", () => {
  assert.equal(loginFor("/app/reports"), "/login?next=%2Fapp%2Freports");
  assert.equal(loginFor("/app/google-profile?change=1"), "/login?next=%2Fapp%2Fgoogle-profile%3Fchange%3D1");
  assert.equal(loginFor("/app"), "/login");
  assert.equal(loginFor(""), "/login");
  assert.equal(loginFor(null), "/login");
  assert.equal(loginFor("https://evil.example"), "/login");
});
