import fs from "node:fs";
import { expect, setGoogleListing, test } from "./support/fixtures";

// Phase 1 features: WhatsApp review-link sharing and QR code download. Runs on desktop, tablet and phone sizes.

test.beforeEach(async ({ page, account }) => {
  await setGoogleListing(page, "ChIJtestPlace123");
  await page.goto("/app/google-profile");
});

test("WhatsApp link: message, review link and phone number handling", async ({ page, context }) => {
  const link = page.locator('a[href^="https://wa.me/"]');
  const phone = page.locator("#wa-phone");

  let href = (await link.getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  const message = decodeURIComponent(href.split("?text=")[1]);
  expect(message.startsWith("Thank you for visiting Zentrix Skin Clinic")).toBe(true);
  expect(message).toContain("https://search.google.com/local/writereview?placeid=ChIJtestPlace123");

  await phone.fill("98765 43210");
  await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/919876543210\?text=/);
  await phone.fill("09876543210");
  await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/919876543210\?/);
  await phone.fill("+44 7700 900123");
  await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/447700900123\?/);

  await phone.fill("12345");
  await expect(link).toHaveAttribute("aria-disabled", "true");
  expect(await link.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  await expect(page.locator("main")).toContainText("Enter the full number");

  await phone.fill("98765 43210");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // Opening WhatsApp: the new tab is answered locally, so the test does not depend on WhatsApp's site.
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => r.fulfill({ body: "WhatsApp (stubbed in tests)" }));
  const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/^https:\/\/wa\.me\/919876543210\?text=Thank%20you%20for%20visiting/);
  await tab.close();
});

test("QR code downloads as a 1000px-wide PNG", async ({ page }) => {
  const button = page.getByRole("button", { name: /Download QR/ });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const buf = fs.readFileSync((await download.path())!);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.readUInt32BE(16)).toBe(1000);
  expect(buf.readUInt32BE(20)).toBeGreaterThan(1000);
  await expect(button).toBeEnabled();
});
