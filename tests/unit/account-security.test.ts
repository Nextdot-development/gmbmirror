import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { supabaseCookieOptions } from "@/lib/supabase-cookies";
import { signupError } from "@/lib/session";
import { revokeGoogle } from "@/lib/google";
import { encrypt } from "@/lib/crypto";
import { LIMITS, peek, take } from "@/lib/ratelimit";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("Supabase cookies: httpOnly, SameSite=Lax, Secure on https, at most 30 days; deletions untouched", () => {
  const set = supabaseCookieOptions({ path: "/", maxAge: 400 * 86_400, httpOnly: false }, "https://app.example");
  assert.deepEqual([set.httpOnly, set.secure, set.sameSite, set.maxAge, set.path], [true, true, "lax", 30 * 86_400, "/"]);
  assert.equal(supabaseCookieOptions({ maxAge: 400 * 86_400 }, "http://localhost:3000").secure, false);
  assert.equal(supabaseCookieOptions({ maxAge: 0 }, "https://app.example").maxAge, 0);
  assert.equal(supabaseCookieOptions(undefined, "https://app.example").maxAge, 30 * 86_400);
});

test("Supabase signup errors become plain messages; unknown ones never show Supabase's text", () => {
  assert.equal(signupError("user_already_exists"), "An account with this email already exists. Log in instead.");
  assert.match(signupError("weak_password"), /stronger password/);
  assert.match(signupError("over_email_send_rate_limit"), /Too many sign up attempts/);
  assert.equal(signupError("something_internal"), "Could not create the account. Try again in a few minutes.");
  assert.equal(signupError(undefined), "Could not create the account. Try again in a few minutes.");
});

test("login limits: checking does not count; only recorded failures do", () => {
  const k = `login:fail:test-${Date.now()}`;
  for (let i = 0; i < 50; i++) assert.equal(peek(k, LIMITS.loginFailPerClient).ok, true);
  for (let i = 0; i < 5; i++) take(k, LIMITS.loginFailPerClient);
  assert.equal(peek(k, LIMITS.loginFailPerClient).ok, false);
  assert.ok(peek(k, LIMITS.loginFailPerClient).retryAfterSec > 0);
});

test("Google revocation sends the refresh token to Google's revoke endpoint and reports the answer", async () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const conn = { email: "o@example.test", connectedAt: "", tokens: encrypt(JSON.stringify({ access_token: "acc-1", refresh_token: "ref-1", expires_at: 0 })) };
  const sent: { url: string; body: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: String(init?.body) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal(await revokeGoogle(conn), true);
  assert.deepEqual(sent, [{ url: "https://oauth2.googleapis.com/revoke", body: "token=ref-1" }]);

  globalThis.fetch = (async () => new Response('{"error":"invalid_token"}', { status: 400 })) as unknown as typeof fetch;
  assert.equal(await revokeGoogle(conn), false);
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await revokeGoogle(conn), false);
  assert.equal(await revokeGoogle({ ...conn, tokens: "damaged" }), false);
});
