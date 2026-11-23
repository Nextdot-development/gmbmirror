import type { Page } from "@playwright/test";
import { expect, PLACE, placesFinds, placesMode, retype, setGoogleListing, sideways, submit, test } from "./support/fixtures";

// Business finder: find the public Google listing by name and city instead of typing a Place ID. It is the fallback
// on onboarding step 2 (and a section in Settings); choosing a listing saves it straight away. It never claims a
// Business Profile connection. Google Places is the test server's stand-in; the real search was checked by hand.

test.use({ onboard: false });

const finder = (page: Page) => page.getByTestId("business-finder");
const results = (page: Page) => page.getByRole("list", { name: "Matches on Google" }).locator(":scope > li");
const GLOW_BRANCH = "ChIJe2eSalon0000002";

/** Onboarding step 1, then the public-listing fallback on step 2. The finder starts with the saved name and city. */
async function startOnboarding(page: Page, name: string, city = "Pune", type?: "Local business") {
  await page.goto("/app/onboarding");
  if (type) await page.getByLabel(type).check();
  await retype(page.locator("#f-name"), name);
  await retype(page.locator("#f-website"), "example.test");
  await retype(page.locator("#f-location"), city);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\/onboarding\/connect$/);
  await page.getByText("Find your public Google listing instead").click();
  await expect(page.locator("#find-name")).toHaveValue(name);
}
const toDashboard = async (page: Page) => {
  await page.getByRole("link", { name: "Continue to your dashboard" }).click();
  await page.waitForURL(/\/app$/);
};

async function findMyBusiness(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined),
    finder(page).getByRole("button", { name: "Find my business" }).click(),
  ]);
}

test.beforeEach(async () => {
  await placesMode({ reset: true });
});

test("exact match: results are shown, nothing is chosen until Select, then it is saved and used", async ({ page, account }) => {
  await startOnboarding(page, "Sunrise Multi-speciality Hospital");
  await expect(finder(page).locator("#f-placeId")).toHaveCount(0); // no Place ID box by default
  await page.locator("#f-state").fill("Maharashtra");
  await findMyBusiness(page);
  expect(await placesFinds()).toEqual(["Sunrise Multi-speciality Hospital Pune Maharashtra"]);
  await expect(results(page)).toHaveCount(1);
  await expect(page.getByTestId("finder-branches")).toHaveCount(0);
  await expect(results(page).first()).toContainText("MG Road, Pune");
  await expect(results(page).first()).toContainText("General Hospital");
  await expect(results(page).first()).toContainText("Same name");
  expect(account.data().business.placeId).toBeUndefined(); // not auto-selected
  await expect(finder(page)).toContainText("Google Maps");

  await results(page).first().getByRole("button", { name: /^Select Sunrise Multi-speciality Hospital/ }).click();
  const chosen = page.getByLabel("Your Google listing");
  await expect(chosen).toContainText("Sunrise Multi-speciality Hospital");
  await expect(chosen).toContainText("It does not verify or connect your Google Business Profile.");
  await expect(finder(page).getByRole("status")).toHaveText("Google listing saved.");
  expect(account.data().business).toMatchObject({ placeId: PLACE.hospital, name: "Sunrise Multi-speciality Hospital", location: "Pune" });
  await toDashboard(page);

  // The saved listing feeds the existing Places features.
  await page.goto("/app/google-profile");
  await submit(page, page.locator("section", { has: page.locator("#pa-h") }).getByRole("button", { name: "Run profile audit" }));
  await expect(page.locator("section", { has: page.locator("#pa-h") })).toContainText("100 / 100");
});

test("branches and similar names: addresses tell them apart; the chosen branch is saved; names are only changed on request", async ({ page, account }) => {
  await startOnboarding(page, "Glow Salon");
  await findMyBusiness(page);
  await expect(results(page)).toHaveCount(3);
  await expect(page.getByTestId("finder-branches")).toHaveText("Several listings match your search. Check the address to pick the right branch.");
  // Same-name results first (Google's order kept within each group), each flagged as a branch.
  await expect(results(page).nth(0)).toContainText("FC Road, Pune");
  await expect(results(page).nth(1)).toContainText("Kothrud, Pune");
  for (const i of [0, 1]) {
    await expect(results(page).nth(i)).toContainText("Same name");
    await expect(results(page).nth(i)).toContainText("Same name as another result: check the address");
  }
  await expect(results(page).nth(2)).toContainText("Glow Salon & Spa");
  await expect(results(page).nth(2)).toContainText("Similar name");
  await expect(results(page).nth(2)).not.toContainText("check the address");

  await results(page).nth(2).getByRole("button", { name: /^Select/ }).click();
  await expect(page.getByLabel("Your Google listing")).toContainText("Baner, Pune");
  // A different name on Google is offered, never applied by itself.
  await expect(page.getByRole("button", { name: "Use “Glow Salon & Spa” as the business name" })).toBeVisible();
  expect(account.data().business.name).toBe("Glow Salon");
  // Changing a saved listing asks first.
  await page.getByRole("button", { name: "Change listing" }).click();
  await findMyBusiness(page);
  await results(page).nth(1).getByRole("button", { name: /^Select/ }).click();
  await page.getByRole("alertdialog", { name: "Replace your Google listing?" }).getByRole("button", { name: "Replace listing" }).click();
  await expect(page.getByLabel("Your Google listing")).toContainText("Kothrud, Pune");
  await toDashboard(page);
  expect(account.data().business.placeId).toBe(GLOW_BRANCH);
  expect(account.data().business.name).toBe("Glow Salon");
});

test("using Google's name is the owner's choice", async ({ page, account }) => {
  await startOnboarding(page, "Glow");
  await findMyBusiness(page);
  await results(page).nth(0).getByRole("button", { name: /^Select/ }).click();
  expect(account.data().business.name).toBe("Glow");
  await page.getByRole("button", { name: "Use “Glow Salon & Spa” as the business name" }).click();
  await expect(finder(page).getByRole("status")).toHaveText("Business name changed to “Glow Salon & Spa”.");
  expect(account.data().business).toMatchObject({ name: "Glow Salon & Spa", sources: { name: "user" } });
  await toDashboard(page);
  await expect(page.locator("main h1")).toHaveText("Glow Salon & Spa");
});

test("no results, quota and outage errors, and missing details: clear messages and a way forward, nothing saved", async ({ page, account }) => {
  const alert = finder(page).getByRole("alert");
  await startOnboarding(page, "Nothing Matches Clinic");
  await findMyBusiness(page);
  await expect(alert).toContainText("Google found no business with that name in that city");
  await expect(finder(page).getByRole("button", { name: "Enter Place ID manually" })).toBeVisible();

  // Only loosely related places: shown, labelled, and with a plain warning (real Google does this).
  await retype(page.locator("#find-name"), "Zzq Herbal Wellness Studio");
  await findMyBusiness(page);
  await expect(page.getByTestId("finder-note")).toHaveText(/^Google found no business with this name/);
  await expect(results(page)).toHaveCount(2);
  for (const i of [0, 1]) await expect(results(page).nth(i)).toContainText("Different name");

  await retype(page.locator("#find-name"), "Quota Clinic");
  await findMyBusiness(page);
  await expect(alert).toContainText("quota or rate limit");
  await expect(alert).not.toContainText("e2e-places-key");

  await retype(page.locator("#find-name"), "Outage Clinic");
  await findMyBusiness(page);
  await expect(alert).toContainText("Google Places is having problems");

  await retype(page.locator("#find-name"), "");
  await findMyBusiness(page);
  await expect(alert).toHaveText("Enter your business name first.");
  await retype(page.locator("#find-name"), "Glow Salon");
  await retype(page.locator("#find-city"), "");
  await findMyBusiness(page);
  await expect(alert).toHaveText("Enter the city or area first.");
  await expect(results(page)).toHaveCount(0);
  expect(account.data().business.placeId).toBeUndefined();
  expect(account.data().business.name).toBe("Nothing Matches Clinic"); // searching never changes the saved details
});

test.describe("existing businesses", () => {
  test.use({ onboard: true });

  test("Settings shows the saved listing; changing it asks first and keeps details and history", async ({ page, account }) => {
    await setGoogleListing(page, PLACE.hospital);
    await page.goto("/app/google-profile");
    await submit(page, page.locator("section", { has: page.locator("#pa-h") }).getByRole("button", { name: "Run profile audit" }));
    await expect(page.locator("section", { has: page.locator("#pa-h") })).toContainText("100 / 100");

    await page.goto("/app/settings");
    const listing = page.getByLabel("Your Google listing");
    await expect(listing).toContainText("Sunrise Multi-speciality Hospital"); // shown, not a new search
    await expect(page.getByRole("button", { name: "Find my business" })).toHaveCount(0);

    await page.getByRole("button", { name: "Change listing" }).click();
    await retype(page.locator("#find-name"), "Glow Salon");
    await retype(page.locator("#find-city"), "Pune");
    await findMyBusiness(page);
    await results(page).nth(1).getByRole("button", { name: /^Select/ }).click();
    const dialog = page.getByRole("alertdialog", { name: "Replace your Google listing?" });
    await expect(dialog).toContainText("Kothrud, Pune");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(account.data().business.placeId).toBe(PLACE.hospital);

    await results(page).nth(1).getByRole("button", { name: /^Select/ }).click();
    await dialog.getByRole("button", { name: "Replace listing" }).click();
    await expect(page.getByRole("status")).toHaveText("Google listing saved.");
    await expect(page.getByLabel("Your Google listing")).toContainText("Kothrud, Pune");
    const after = account.data();
    expect(after.business).toMatchObject({ placeId: GLOW_BRANCH, name: "Zentrix Skin Clinic", location: "Bhubaneswar" });
    expect(after.places.profileScores).toHaveLength(1); // history kept

    // Saving the other business details leaves the listing alone.
    await page.reload();
    await submit(page, "Save changes");
    await expect(page.locator("main")).toContainText("Business details saved");
    expect(account.data().business.placeId).toBe(GLOW_BRANCH);
  });

  test("a Place ID Google does not know is refused, with no way to save it anyway", async ({ page, account }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Enter Place ID manually" }).click();
    await page.locator("#f-placeId").fill("ChIJe2eMissing00001");
    await page.getByRole("button", { name: "Use this ID" }).click();
    await expect(finder(page).getByRole("alert")).toContainText("Google has no listing with this Place ID");
    await expect(page.getByRole("button", { name: "Save without checking" })).toHaveCount(0);
    expect(account.data().business.placeId ?? "").toBe("");
  });

  test("the business details form cannot change the listing, even from a hand-made form", async ({ page, account }) => {
    await setGoogleListing(page, PLACE.hospital);
    await page.goto("/app/settings");
    // Extra fields added by hand, as a crafted request would send them.
    await page.locator("#business form").first().evaluate((f, salon) => {
      for (const [n, v] of [["placeId", salon], ["confirmReplace", "yes"]]) {
        const i = document.createElement("input");
        i.type = "hidden"; i.name = n; i.value = v;
        f.appendChild(i);
      }
    }, PLACE.salon);
    await submit(page, "Save changes");
    await expect(page.locator("main")).toContainText("Business details saved.");
    expect(account.data().business.placeId).toBe(PLACE.hospital); // only the finder (with its confirmation) changes it
  });
});

test("a local business (salon) is found and linked the same way as a hospital", async ({ page, account }) => {
  await startOnboarding(page, "Glow Salon", "Pune", "Local business");
  await findMyBusiness(page);
  await results(page).nth(0).getByRole("button", { name: /^Select/ }).click();
  await expect(page.getByLabel("Your Google listing")).toContainText("Beauty Salon");
  await toDashboard(page);
  // The public listing is not a Business Profile connection, so it does not set the category: the owner does.
  expect(account.data().business).toMatchObject({ type: "general", category: "Other local business", placeId: PLACE.salon });
  await page.goto("/app/settings");
  await page.locator("#f-category").selectOption("Salon");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved.");
  expect(account.data().business).toMatchObject({ type: "general", category: "Salon", placeId: PLACE.salon });
});

test("the chosen listing stays linked after refresh, logout and login, editing details, and reopening Settings", async ({ page, account }) => {
  await startOnboarding(page, "Sunrise Multi-speciality Hospital");
  await findMyBusiness(page);
  await results(page).first().getByRole("button", { name: /^Select/ }).click();
  await expect(finder(page).getByRole("status")).toHaveText("Google listing saved.");
  await toDashboard(page);
  const listed = async () => {
    await page.goto("/app/settings");
    await expect(page.getByLabel("Your Google listing")).toContainText("Sunrise Multi-speciality Hospital");
    expect(account.data().business.placeId).toBe(PLACE.hospital);
  };
  await listed();
  await page.reload();
  await expect(page.getByLabel("Your Google listing")).toContainText("Sunrise Multi-speciality Hospital");

  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/login");
  await page.locator("#f-email").fill(account.email);
  await page.locator("#f-password").fill("e2e-pass-X1-not-real");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/app$/);
  await listed();

  // Editing the other details keeps the listing.
  await retype(page.locator("#f-location"), "Pune West");
  await page.locator("#f-category").selectOption("Hospital");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved");
  expect(account.data().business).toMatchObject({ location: "Pune West", category: "Hospital", placeId: PLACE.hospital });
  await listed();
  await page.goto("/app/google-profile");
  await expect(page.locator("main")).toContainText(`placeid=${PLACE.hospital}`);
});

test.describe("history after changing the listing", () => {
  test.use({ onboard: true });

  test("old audits and scans stay with the old listing and come back if it is chosen again", async ({ page, account }) => {
    const audit = () => page.locator("section", { has: page.locator("#pa-h") });
    const runAudit = async () => {
      await page.goto("/app/google-profile");
      await submit(page, audit().getByRole("button", { name: /Run profile audit|Run again/ }));
      await expect(audit()).toContainText("/ 100");
      await page.reload();
    };
    await setGoogleListing(page, PLACE.hospital);
    await runAudit();
    await page.locator("#g-keyword").fill("hospital");
    await submit(page, page.locator("section", { has: page.locator("#grid-h") }).getByRole("button", { name: "Run grid scan" }));
    await expect(audit()).toContainText("100 / 100");

    await setGoogleListing(page, PLACE.salon); // asks to replace, then saves
    await page.goto("/app/google-profile");
    await expect(audit()).toContainText("No audits saved yet");
    await expect(page.getByTestId("earlier-listing-history")).toContainText("1 audit, 1 rank scan, 0 comparisons");
    await expect(page.locator("section", { has: page.locator("#grid-h") })).not.toContainText("“hospital”");
    await page.goto("/app");
    await expect(page.locator("section", { has: page.locator("#ptrend-h") })).toContainText("No profile audits yet");
    expect(account.data().places.profileScores).toHaveLength(1); // kept

    await runAudit();
    await expect(audit()).toContainText("30 / 100");
    await expect(audit()).toContainText("First measurement"); // not compared with the hospital's 100
    await page.goto("/app");
    await expect(page.locator("section", { has: page.locator("#chg-h") })).not.toContainText("Profile audit score");

    await setGoogleListing(page, PLACE.hospital);
    await page.goto("/app/google-profile");
    await expect(audit().getByRole("img", { name: /Profile audit score over time/ })).toHaveAttribute("aria-label", /^Profile audit score over time: \d+ \w+ \d{4} 100$/); // only the hospital's audit
    await expect(page.getByTestId("earlier-listing-history")).toContainText("1 audit, 0 rank scans");
    await expect(page.locator("section", { has: page.locator("#grid-h") })).toContainText("“hospital”");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("the finder and its results fit the screen", async ({ page, account }) => {
  await startOnboarding(page, "Glow Salon");
  await findMyBusiness(page);
  await expect(results(page)).toHaveCount(3);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  const select = results(page).first().getByRole("button", { name: /^Select/ });
  const box = await select.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(24); // a comfortable tap target
  await select.click();
  await expect(page.getByLabel("Your Google listing")).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});
});
