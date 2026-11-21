import type { Page } from "@playwright/test";
import { expect, NOPLACES_URL, PARTIAL_URL, retype, sideways, submit, test } from "./support/fixtures";

// Onboarding: step 1 asks only for the business type, name, city and an optional website; step 2 connects Google
// Business Profile (live connection flows are in gbp-onboarding.spec.ts). The public-listing search is a fallback.

test.use({ onboard: false });

// The business form (the sidebar also has a Log out form).
const serverValidationOnly = (page: Page) => page.locator("main form").first().evaluate((f) => ((f as HTMLFormElement).noValidate = true));
const finder = (page: Page) => page.getByTestId("business-finder");

async function fillBasics(page: Page, name = "Sunrise Dental Care", city = "Pune", website = "sunrise-dental.example") {
  await retype(page.locator("#f-name"), name);
  await retype(page.locator("#f-location"), city);
  await retype(page.locator("#f-website"), website);
}
async function continueToConnect(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\/onboarding\/connect$/);
}

test("until a business is saved, every app page leads to onboarding", async ({ page, account }) => {
  for (const path of ["/app", "/app/posts", "/app/reviews", "/app/google", "/app/visibility", "/app/settings", "/app/onboarding/connect"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/app\/onboarding$/);
  }
  await expect(page.getByRole("heading", { name: "Tell us about your business" })).toBeVisible();
});

test("step 1 asks only for type, name, city and an optional website", async ({ page, account }) => {
  await page.goto("/app/onboarding");
  await expect(page.getByRole("list", { name: "Step 1 of 2" })).toBeVisible();
  const fields = await page.locator("main form").first().locator("input:not([type=hidden]), select, textarea").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
  expect([...new Set(fields)]).toEqual(["type", "name", "location", "website"]);
  for (const gone of ["#f-phone", "#f-aliases", "#f-customQuestions", "#f-category", "#f-language", "#f-placeId"]) await expect(page.locator(gone), gone).toHaveCount(0);
  await expect(page.getByLabel("Website (optional)")).toBeVisible();
});

test("required fields: server errors per field, typed values kept, nothing saved", async ({ page, account }) => {
  await page.goto("/app/onboarding");
  await serverValidationOnly(page);
  await retype(page.locator("#f-name"), "A");
  await retype(page.locator("#f-location"), "");
  await retype(page.locator("#f-website"), "sunrise.example");
  await submit(page, "Continue");
  await expect(page.locator("#f-name-e")).toHaveText("Enter your business name.");
  await expect(page.locator("#f-location-e")).toHaveText("Enter the city or area.");
  await expect(page.locator("#f-website")).toHaveValue("sunrise.example");
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  expect(account.data()?.business).toBeUndefined();

  await serverValidationOnly(page);
  await fillBasics(page, "Sunrise Dental Care", "Pune", "not a website");
  await submit(page, "Continue");
  await expect(page.locator("#f-website-e")).toHaveText("Enter a valid website address.");
  expect(account.data()?.business).toBeUndefined();
});

test("healthcare business with no website: saved, then the Google step, then the dashboard", async ({ page, account }) => {
  await page.goto("/app/onboarding");
  await expect(page.getByLabel("Healthcare or wellness")).toBeChecked();
  await fillBasics(page, "Sunrise Dental Care", "Pune", "");
  await continueToConnect(page);
  const b = account.data().business;
  expect(b).toMatchObject({ type: "healthcare", name: "Sunrise Dental Care", website: "", location: "Pune", language: "en", category: "Other healthcare" });
  expect(b.placeId ?? "").toBe("");
  expect(b.sources).toEqual({ name: "user" });

  // Step 2 on a server with Google sign-in set up: a real connect button and a way to skip. Nothing claims a connection.
  await expect(page.getByRole("list", { name: "Step 2 of 2" })).toBeVisible();
  await expect(page.getByTestId("onboarding-connect")).toHaveAttribute("data-status", "not_connected");
  await expect(page.getByRole("link", { name: "Connect Google Business Profile" })).toHaveAttribute("href", "/api/google/start?from=onboarding");
  await expect(page.locator("main")).not.toContainText("Connected");
  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.locator("main h1")).toHaveText("Sunrise Dental Care");
  await expect(page.getByTestId("connect-cta")).toContainText("Connect your Google Business Profile");

  // Coming back to step 1 shows the saved details and saves in place instead of starting over.
  await page.goto("/app/onboarding");
  await expect(page.locator("#f-name")).toHaveValue("Sunrise Dental Care");
  await retype(page.locator("#f-location"), "Pune West");
  await retype(page.locator("#f-website"), "sunrise-dental.example");
  await continueToConnect(page);
  expect(account.data().business).toMatchObject({ location: "Pune West", website: "https://sunrise-dental.example", createdAt: b.createdAt });
});

test("local business: the type is saved with the general category for it; the category is set later from Google or Settings", async ({ page, account }) => {
  await page.goto("/app/onboarding");
  await page.getByLabel("Local business").check();
  await fillBasics(page, "Chai Point Cafe", "Bengaluru");
  await continueToConnect(page);
  expect(account.data().business).toMatchObject({ type: "general", category: "Other local business", website: "https://sunrise-dental.example" });
  await page.goto("/app/settings");
  await page.locator("#f-category").selectOption("Cafe");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved.");
  expect(account.data().business).toMatchObject({ category: "Cafe", sources: { category: "user" } });
});

test.describe("Google sign-in not set up on the server", () => {
  test.use({ baseURL: PARTIAL_URL });
  test("step 2 says setup is needed, offers no fake connection, and lets the owner continue", async ({ page, account }) => {
    await page.goto("/app/onboarding");
    await fillBasics(page);
    await continueToConnect(page);
    await expect(page.getByTestId("onboarding-connect")).toHaveAttribute("data-status", "not_configured");
    await expect(page.locator("main")).toContainText("Google connection needs setting up");
    await expect(page.getByRole("link", { name: "Connect Google Business Profile" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/\.env|GOOGLE_CLIENT/);
    await page.getByRole("link", { name: "Continue to your dashboard" }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.getByTestId("connect-cta")).toHaveCount(0); // nothing to connect yet
  });
});

test.describe("public listing fallback", () => {
  test.describe("on a server with no Places key", () => {
    test.use({ baseURL: NOPLACES_URL });
    test("the listing is paste-only, without server details", async ({ page, account }) => {
      await page.goto("/app/onboarding");
      await fillBasics(page);
      await continueToConnect(page);
      await page.getByText("Can't connect now? Find your public Google listing instead").click();
      await expect(page.getByRole("button", { name: "Find my business" })).toHaveCount(0);
      await expect(finder(page)).toContainText("Searching Google is not available right now. Paste your Place ID if you know it.");
      await expect(page.locator("main")).not.toContainText("GOOGLE_PLACES_API_KEY");
    });
  });

  test("a pasted Place ID is trimmed, checked, saved, shown in Settings and used for the review link; it is not called a connection", async ({ page, account }) => {
    await page.goto("/app/onboarding");
    await fillBasics(page);
    await continueToConnect(page);
    const fallback = page.getByTestId("public-listing");
    await fallback.getByText("Find your public Google listing instead").click();
    await expect(fallback).toContainText("It does not connect, verify or prove ownership of your Business Profile.");
    await finder(page).getByRole("button", { name: "Enter Place ID manually" }).click();
    await retype(page.locator("#f-placeId"), "  ChIJmarqE63mDDkRd228dtR6wDs  ");
    await finder(page).getByRole("button", { name: "Use this ID" }).click();
    await expect(finder(page).getByRole("status")).toHaveText("Google listing saved.");
    expect(account.data().business.placeId).toBe("ChIJmarqE63mDDkRd228dtR6wDs");
    await expect(page.getByLabel("Your Google listing")).toContainText("It does not verify or connect your Google Business Profile.");
    await page.getByRole("link", { name: "Continue to your dashboard" }).click();
    await page.waitForURL(/\/app$/);

    // Settings shows the saved listing, fetched fresh from Google (here the Places stand-in), instead of a raw ID box.
    await page.goto("/app/settings");
    await expect(page.getByLabel("Your Google listing")).toContainText("Test listing");
    await page.goto("/app/google");
    const href = await page.locator('a[href^="https://wa.me/"]').getAttribute("href");
    expect(decodeURIComponent(href!)).toContain("https://search.google.com/local/writereview?placeid=ChIJmarqE63mDDkRd228dtR6wDs");
  });

  test("leaving it empty is fine: the Google page asks for it instead of showing a broken link", async ({ page, account }) => {
    await page.goto("/app/onboarding");
    await fillBasics(page);
    await continueToConnect(page);
    await page.getByRole("link", { name: "Skip for now" }).click();
    await page.waitForURL(/\/app$/);
    await page.goto("/app/google");
    await expect(page.locator("main")).toContainText("Add your Google Place ID in Settings to generate your review link and QR code.");
    await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  });

  test("something that is not a Place ID is refused, and nothing is saved", async ({ page, account }) => {
    await page.goto("/app/onboarding");
    await fillBasics(page);
    await continueToConnect(page);
    await page.getByText("Find your public Google listing instead").click();
    await finder(page).getByRole("button", { name: "Enter Place ID manually" }).click();
    for (const bad of ["my clinic", "https://maps.google.com/?cid=123", "ChIJ&evil=1", "short"]) {
      await retype(page.locator("#f-placeId"), bad);
      await finder(page).getByRole("button", { name: "Use this ID" }).click();
      await expect(finder(page).getByRole("alert"), bad).toBeVisible();
      await expect(finder(page).getByRole("button", { name: "Save without checking" }), bad).toHaveCount(0);
      await expect(page.locator("#f-placeId"), bad).toHaveValue(bad);
      expect(account.data().business.placeId, bad).toBeUndefined();
    }
  });
});

test("onboarding fits a phone screen", async ({ page, account }) => {
  await page.goto("/app/onboarding");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await fillBasics(page);
  await continueToConnect(page);
  await page.getByText("Find your public Google listing instead").click();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});
