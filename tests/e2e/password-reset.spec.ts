import { expect, test } from "./support/fixtures";

// Password reset and email links. The test servers run in demo mode (no email), so this checks the pages and the
// safe failure paths; sending and opening real emails needs the Supabase project (see docs/DEPLOYMENT.md).

test.use({ onboard: false });

test("login links to password reset; in demo mode reset is clearly unavailable; bad links go to login with a message", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.waitForURL(/\/forgot-password$/);
  await expect(page).toHaveTitle(/Reset your password \| GMBmirror/);
  await expect(page.getByTestId("reset-unavailable")).toContainText("not available in this local demo");

  await page.goto("/reset-password");
  await page.waitForURL(/\/forgot-password$/);

  // A link without a valid token, or one pointing elsewhere, never signs anyone in or leaves the site.
  await page.goto("/auth/confirm?token_hash=forged&type=recovery&next=https://evil.example");
  await page.waitForURL(/\/login\?link=expired$/);
  await expect(page.getByTestId("link-expired")).toContainText("That link has expired or was already used.");
  expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
});
