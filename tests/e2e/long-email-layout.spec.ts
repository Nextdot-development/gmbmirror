import { expect, sideways, test } from "./support/fixtures";

// The phone-layout "Log out (email)" button once pushed the page wider than the screen for long emails.
// Runs in the desktop project only; it opens its own phone and narrow-window browsers.

test("a long email address does not make the page wider than the screen, on a phone or a narrow desktop window", async ({ browser, baseURL }) => {
  const email = `a.really.long.owner.name.for.layout.${Date.now()}@clinic-with-a-long-domain.example.test`;
  for (const [n, opts] of [
    ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ["narrow desktop", { viewport: { width: 390, height: 844 } }],
  ] as const) {
    const ctx = await browser.newContext({ baseURL, ...opts, extraHTTPHeaders: { "x-forwarded-for": `10.77.${n.length}.${Date.now() % 250}` } });
    const page = await ctx.newPage();
    if (n === "phone") {
      await page.goto("/signup");
      await page.locator("#f-email").fill(email);
      await page.locator("#f-password").fill("e2e-pass-X1-not-real");
      await page.getByRole("button", { name: "Create account" }).click();
      await page.waitForURL(/\/onboarding$/);
    } else {
      await page.goto("/login");
      await page.locator("#f-email").fill(email);
      await page.locator("#f-password").fill("e2e-pass-X1-not-real");
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL(/\/onboarding$/);
    }
    for (const path of ["/app/onboarding", "/app/settings"]) {
      await page.goto(path);
      expect(await sideways(page), `${n} ${path}`).toBeLessThanOrEqual(0);
    }
    await expect(page.getByRole("button", { name: /Log out/ }).last()).toBeVisible();
    await ctx.close();
  }
});
