import { test } from "node:test";
import assert from "node:assert/strict";

process.env.APP_MODE = "demo";
process.env.SESSION_SECRET = "s".repeat(40);

test("email links may only send people to a path on this site", async () => {
  const { safeNext } = await import("@/lib/session");
  assert.equal(safeNext("/app/onboarding"), "/app/onboarding");
  assert.equal(safeNext("/reset-password"), "/reset-password");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined, " /app", "/app\n"]) {
    assert.equal(safeNext(bad as string), "/app", String(bad));
  }
  assert.equal(safeNext("//evil.example", "/reset-password"), "/reset-password");
});

test("demo mode: email links do nothing and password reset says it is unavailable", async () => {
  const { completeEmailLink, requestPasswordReset } = await import("@/lib/session");
  assert.equal(await completeEmailLink({ tokenHash: "x", type: "recovery" }), false);
  assert.match((await requestPasswordReset("a@example.test")).error!, /not available/);
});
