import crypto from "node:crypto";
import type { Browser } from "@playwright/test";
import { DIRECT_URL, expect, test } from "./support/fixtures";

// Security: a client must not escape the per-address signup and login limits by sending its own X-Forwarded-For.
// Signup allows 5 per address per hour; login allows 20 per address per 15 minutes (src/lib/ratelimit.ts).

const spoof = () => `${crypto.randomInt(1, 223)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 254)}`;
const email = (tag: string) => `e2e-${tag}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.test`;

// The app's own messages are <p role="alert">; Next.js also renders an empty route announcer with role="alert".

/** One signup in a fresh browser context. Returns "created" or the error shown. */
async function signUp(browser: Browser, baseURL: string, xff: string) {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": xff } });
  const page = await ctx.newPage();
  await page.goto("/signup");
  await page.locator("#f-email").fill(email("spoof"));
  await page.locator("#f-password").fill("e2e-pass-X1-not-real");
  await page.getByRole("button", { name: "Create account" }).click();
  const outcome = await Promise.race([
    page.waitForURL(/\/onboarding$/).then(() => "created"),
    page.locator('p[role="alert"]').first().waitFor().then(() => page.locator('p[role="alert"]').first().innerText()),
  ]);
  await ctx.close();
  return outcome;
}

/** One failed login in a fresh browser context, for an address that has no account. Returns the error shown. */
async function badLogin(browser: Browser, baseURL: string, xff: string) {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": xff } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator("#f-email").fill(email("nobody"));
  await page.locator("#f-password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  const text = await page.locator('p[role="alert"]').first().innerText();
  await ctx.close();
  return text;
}

test.describe("behind one trusted proxy (TRUSTED_PROXY_HOPS=1)", () => {
  test("fake entries added by the client do not give it a new signup allowance", async ({ browser, baseURL }) => {
    const real = "198.51.100.7"; // the address the trusted proxy saw and appended last
    for (let i = 1; i <= 5; i++) expect(await signUp(browser, baseURL!, `${spoof()}, ${spoof()}, ${real}`), `signup ${i}`).toBe("created");
    expect(await signUp(browser, baseURL!, `${spoof()}, ${real}`)).toMatch(/Too many sign up attempts/);
    expect(await signUp(browser, baseURL!, real)).toMatch(/Too many sign up attempts/);
    // A different real client behind the same proxy is not affected.
    expect(await signUp(browser, baseURL!, `${spoof()}, 198.51.100.8`)).toBe("created");
  });
});

test.describe("reached directly, no trusted proxy (TRUSTED_PROXY_HOPS=0)", () => {
  test("a forged X-Forwarded-For does not give a client a new signup allowance", async ({ browser }) => {
    for (let i = 1; i <= 5; i++) expect(await signUp(browser, DIRECT_URL, spoof()), `signup ${i}`).toBe("created");
    expect(await signUp(browser, DIRECT_URL, spoof())).toMatch(/Too many sign up attempts/);
    expect(await signUp(browser, DIRECT_URL, `${spoof()}, ${spoof()}`)).toMatch(/Too many sign up attempts/);
  });

  test("a forged X-Forwarded-For does not give a client a new login allowance", async ({ browser }) => {
    for (let i = 1; i <= 20; i++) expect(await badLogin(browser, DIRECT_URL, spoof()), `login ${i}`).not.toMatch(/Too many/);
    expect(await badLogin(browser, DIRECT_URL, spoof())).toMatch(/Too many login attempts/);
  });
});
