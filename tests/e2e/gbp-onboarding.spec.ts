import type { Page } from "@playwright/test";
import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, retype, sideways, submit, test } from "./support/fixtures";

// The new-owner journey with live Google Business Profile, against the local stand-in (server.mjs): a few details,
// connect Google, choose the location, and the details are brought in from Google. Nothing reaches Google.
// Stand-in locations: 1001 Saheed Nagar (full profile, verified), 1002 Patia (no phone, website or hours), 1003, 2001.

test.use({ baseURL: GBP_URL, onboard: false });
test.beforeEach(async () => gbpMode({ reset: true }));

const fromGoogle = (page: Page) => page.getByTestId("from-google");

async function basics(page: Page) {
  await page.goto("/app/onboarding");
  await retype(page.locator("#f-name"), "Zentrix Skin Clinic");
  await retype(page.locator("#f-location"), "Bhubaneswar");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\/onboarding\/connect$/);
}

async function onboardWithGoogle(page: Page, location: RegExp) {
  await basics(page);
  await connectGoogle(page, "e2e-good", "onboarding");
  await expect(page).toHaveURL(/\/app\/onboarding\/connect\?connected=1$/);
  await expect(page.getByTestId("onboarding-connect")).toHaveAttribute("data-status", "choose_location");
  await expect(page.getByRole("radio")).toHaveCount(4);
  await page.getByRole("radio", { name: location }).check();
  await page.getByRole("button", { name: "Use this location and continue" }).click();
  await page.waitForURL(/\/app$/);
}

test("new owner: few details, connect Google, choose a location, details brought in from Google", async ({ page, account }) => {
  await onboardWithGoogle(page, /Saheed Nagar/);
  const b = account.data().business;
  // Typed by the owner: name and city. From Google: website, phone, category and the listing (Place ID).
  expect(b).toMatchObject({ name: "Zentrix Skin Clinic", location: "Bhubaneswar", website: "https://zentrix.example", phone: "0674 123 4567",
    category: "Dermatology Clinic", placeId: "ChIJtestPlace123", sources: { name: "user", website: "google", phone: "google", category: "google" } });
  const g = account.data().google;
  expect(g).toMatchObject({ locationName: "locations/1001", profile: { location: "locations/1001", title: "Zentrix Skin Clinic, Saheed Nagar", rating: 4.2, reviewCount: 60, verified: true } });
  expect(g.profile.hours).toEqual(["Monday 09:00–18:00"]);

  await expect(page.locator("header .badge")).toHaveText("Google connected");
  await expect(page.getByTestId("connect-cta")).toHaveCount(0);
  await expect(page.locator("header")).toContainText("Dermatology Clinic");

  // Settings shows where each value came from, and what Google reports that the owner does not type.
  await page.goto("/app/settings");
  await expect(page.locator("#f-website")).toHaveValue("https://zentrix.example");
  await expect(page.locator("#f-website-h")).toContainText("From your Google Business Profile.");
  await expect(page.locator("#f-name-h")).toContainText("Added by you.");
  await expect(fromGoogle(page)).toContainText("Plot 12, Saheed Nagar, Bhubaneswar, 751007");
  await expect(fromGoogle(page)).toContainText("Monday 09:00–18:00");
  await expect(fromGoogle(page)).toContainText("4.2 from 60 reviews");
  await expect(fromGoogle(page)).toContainText("Verified");
  // Google's name differs from the one typed: offered, not applied.
  await expect(page.getByTestId("differs-name")).toContainText("Zentrix Skin Clinic, Saheed Nagar");
  await expect(page.getByTestId("listing-from-profile")).toContainText("Linked to your Business Profile location");
  await page.getByTestId("differs-name").getByRole("button", { name: "Use Google's name" }).click();
  await expect.poll(() => account.data().business.name).toBe("Zentrix Skin Clinic, Saheed Nagar");
  await page.goto("/app");
  await expect(page.locator("main h1")).toHaveText("Zentrix Skin Clinic, Saheed Nagar");
});

test("the owner's own values are never replaced by Google; missing details are pointed out, not invented", async ({ page, account }) => {
  await basics(page);
  await page.goto("/app/settings");
  await retype(page.locator("#f-website"), "my-own-site.example");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved.");
  await connectGoogle(page, "e2e-good", "settings");
  await expect(page).toHaveURL(/\/app\/settings\?connected=1$/);
  await page.getByRole("radio", { name: /Patia/ }).check();
  await submit(page, "Use this location");
  await expect(page).toHaveURL(/\/app\/settings\?location=saved/);
  await expect(page.getByRole("status")).toHaveText("Location saved. Your details were updated from Google.");
  const b = account.data().business;
  expect(b.website).toBe("https://my-own-site.example");
  expect(b.sources.website).toBe("user");
  expect(b.phone).toBeUndefined(); // Patia has no phone on Google: nothing is made up
  await page.reload();
  await expect(fromGoogle(page)).toContainText("Your Google profile has no phone number.");
  await expect(fromGoogle(page)).toContainText("Your Google profile has no opening hours.");
  await expect(fromGoogle(page)).toContainText("Google does not show this profile as verified.");
  await expect(page.getByTestId("differs-website")).toHaveCount(0); // Google has no website for Patia
});

test("switching location replaces the old location's details; nothing from the old one is shown", async ({ page, account }) => {
  await onboardWithGoogle(page, /Saheed Nagar/);
  await page.goto("/app/google-profile");
  await expect(page.locator("[data-metric=searchViews]")).toContainText("168");
  await page.goto("/app/settings?change=1#google");
  await page.getByRole("radio", { name: /Patia/ }).check();
  await submit(page, "Use this location");
  await expect.poll(() => account.data().google.locationName).toBe("locations/1002");
  const b = account.data().business;
  // Website and phone came from Saheed Nagar: removed, since Patia has none. The listing moved with the location.
  expect([b.website, b.phone, b.placeId]).toEqual(["", undefined, "ChIJe2eZentrixPatia1"]);
  expect(b.category).toBe("Dermatology Clinic"); // Patia's own category ("Skin care clinic")
  const g = account.data().google;
  expect(g.profile.location).toBe("locations/1002");
  expect(g.insights).toBeUndefined(); // Saheed Nagar's insights are not kept for Patia
  await page.goto("/app/settings");
  await expect(fromGoogle(page)).toContainText("KIIT Road, Patia, 751024");
  await expect(fromGoogle(page)).not.toContainText("Saheed Nagar");
  await expect(page.locator("#f-phone")).toHaveValue("");
  await page.goto("/app/google-profile");
  await expect(page.locator("section", { has: page.locator("#bp-h") })).toContainText("Zentrix Skin Clinic, Patia");
  await expect(page.locator("section", { has: page.locator("#bp-h") })).not.toContainText("0674 123 4567");
  await page.goto("/app/reviews");
  await expect(page.locator("main")).toContainText("Zentrix Skin Clinic, Patia");
  expect((await gbpCalls()).calls.some((c) => c.path.includes("/locations/1002/reviews"))).toBe(true);
});

test("disconnect and reconnect from Settings: the status changes everywhere, and the location comes back", async ({ page, account }) => {
  await onboardWithGoogle(page, /Saheed Nagar/);
  await page.goto("/app/settings");
  await submit(page, "Disconnect and delete stored tokens");
  await expect(page).toHaveURL(/\/app\/settings\?disconnected=1/);
  await expect(page.getByRole("status")).toContainText("Disconnected.");
  await expect(page.getByTestId("gbp-status")).toHaveText("Not connected");
  await expect(fromGoogle(page)).toContainText("Connect Google below to bring in your address");
  expect(account.data().google).toBeUndefined();
  // The details stay: they are the owner's business details now, still marked as having come from Google.
  expect(account.data().business).toMatchObject({ website: "https://zentrix.example", placeId: "ChIJtestPlace123" });
  await page.goto("/app");
  await expect(page.locator("header .badge")).toHaveText("Google not connected");
  await expect(page.getByTestId("connect-cta")).toBeVisible();
  await page.goto("/app/reviews");
  await expect(page.locator("main")).toContainText("Sample data");
  await page.goto("/app/google-profile");
  await expect(page.getByTestId("gbp-status")).toHaveText("Not connected");

  // Reconnecting: the location matching the listing is chosen again automatically.
  await connectGoogle(page, "e2e-good", "settings");
  await expect(page).toHaveURL(/\/app\/settings\?connected=1$/);
  await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
  expect(account.data().google.locationName).toBe("locations/1001");
});

test("no business locations on the Google account: a clear fallback, never a pretend connection", async ({ page, account }) => {
  await gbpMode({ fail: "permission", failPath: "/info/v1/accounts/" });
  await basics(page);
  await connectGoogle(page, "e2e-good", "onboarding");
  await expect(page.getByTestId("onboarding-connect")).toHaveAttribute("data-status", "choose_location");
  await expect(page.locator("main").getByRole("alert")).toContainText("does not have permission");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Skip for now" })).toBeVisible();
  await expect(page.getByTestId("public-listing")).toBeVisible();
  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.locator("header .badge")).toHaveText("Google connected: choose a location");
});

test("onboarding and settings fit a phone screen with Google connected", async ({ page, account }) => {
  await onboardWithGoogle(page, /Saheed Nagar/);
  for (const path of ["/app/onboarding", "/app/onboarding/connect", "/app/settings", "/app/settings?change=1"]) {
    await page.goto(path);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});
