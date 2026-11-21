import type { Page } from "@playwright/test";
import { aiCalls, connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, mockAI, readData, retype, setGoogleListing, sideways, submit, test } from "./support/fixtures";

// Several business locations in one account: each has its own details, posts, reviews and settings; nothing mixes.

async function addLocation(page: Page, name: string) {
  await page.goto("/app/locations");
  await submit(page, "Add a location by hand");
  await page.waitForURL(/\/app\/onboarding$/);
  await retype(page.locator("#f-name"), name);
  await retype(page.locator("#f-location"), "Cuttack");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\/onboarding\/connect$/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await page.waitForURL(/\/app$/);
}
const switchTo = async (page: Page, name: string) => {
  await page.locator("#loc-switch").selectOption({ label: name });
  await page.waitForURL(/\/app$/);
  await expect(page.locator("main h1")).toHaveText(name);
};

test("a second location has its own details, posts and settings; switching never mixes them", async ({ page, account }) => {
  await addLocation(page, "Zentrix Cuttack");
  await expect(page.locator("main h1")).toHaveText("Zentrix Cuttack");
  await expect(page.locator("#loc-switch option")).toHaveText(["Zentrix Skin Clinic", "Zentrix Cuttack"]);
  const idx = account.data().locations;
  expect(idx.ids).toHaveLength(2);
  const loc = idx.ids[1];
  expect(account.data()[`loc:${loc}:business`]).toMatchObject({ name: "Zentrix Cuttack", location: "Cuttack" });
  expect(account.data().business.name).toBe("Zentrix Skin Clinic"); // the first location is untouched

  // A post and a language change in the new location only.
  await page.goto("/app/posts");
  await page.locator("#p-text").fill("Cuttack branch opening hours this week.");
  await submit(page, "Save as draft");
  await page.goto("/app/settings");
  await page.locator("#f-language").selectOption("hi");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("AI preferences saved.");
  expect(account.data()[`loc:${loc}:posts`]).toHaveLength(1);
  expect(account.data().posts ?? []).toHaveLength(0);

  await switchTo(page, "Zentrix Skin Clinic");
  await page.goto("/app/posts");
  await expect(page.locator("main")).toContainText("No posts yet");
  await page.goto("/app/settings");
  await expect(page.locator("#f-language")).toHaveValue("en");
  await expect(page.locator("#f-name")).toHaveValue("Zentrix Skin Clinic");
  await page.reload();
  await expect(page.locator("#f-name")).toHaveValue("Zentrix Skin Clinic"); // the choice survives a reload

  await switchTo(page, "Zentrix Cuttack");
  await page.goto("/app/posts");
  await expect(page.locator("main")).toContainText("Cuttack branch opening hours this week.");
});

test("account overview lists every location with its own figures; switching from there works", async ({ page, account }) => {
  await addLocation(page, "Zentrix Cuttack");
  await page.goto("/app/locations");
  await expect(page.getByTestId("account-overview")).toContainText("Locations2");
  const rows = page.getByRole("list", { name: "Your locations" }).locator(":scope > li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Showing now");
  await submit(page, rows.nth(0).getByRole("button", { name: "Switch to this location" }));
  await page.waitForURL(/\/app$/);
  await expect(page.locator("main h1")).toHaveText("Zentrix Skin Clinic");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("AI drafts use the active location's business, and usage is counted for the account", async ({ page, account }) => {
  await mockAI("named");
  await addLocation(page, "Zentrix Cuttack");
  await page.goto("/app/reviews");
  await submit(page, page.getByRole("button", { name: "Draft with Claude" }).first());
  await expect.poll(async () => (await aiCalls()).at(-1)?.system ?? "").toContain("Business: Zentrix Cuttack,");
  expect(Object.values(account.data().ai_usage as Record<string, { byFeature: Record<string, number> }>)[0].byFeature.review_reply).toBe(1);
});

test("deleting my data removes every location", async ({ page, account }) => {
  await addLocation(page, "Zentrix Cuttack");
  await page.goto("/app/settings");
  await page.getByLabel("I understand this cannot be undone").check();
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await page.waitForURL(/\/app\/onboarding$/);
  const left = Object.keys(account.data() ?? {});
  expect(left.filter((k) => k !== "guide")).toEqual([]);
});

test.describe("with Google Business Profile", () => {
  test.use({ baseURL: GBP_URL });
  test.beforeEach(async () => gbpMode({ reset: true }));

  test("add another Business Profile location from the connected account; each location reads its own reviews", async ({ page, account }) => {
    await setGoogleListing(page, "ChIJtestPlace123");
    await connectGoogle(page);
    await page.goto("/app/locations");
    const add = page.getByRole("group", { name: "Other locations on your connected Google account" });
    await expect(add.getByRole("radio")).toHaveCount(3); // Saheed Nagar is already in the account
    await add.getByRole("radio", { name: /Patia/ }).check();
    await submit(page, "Add this location");
    await page.waitForURL(/\/app\?added=1$/);
    await expect(page.locator("main h1")).toHaveText("Zentrix Skin Clinic, Patia");
    await expect(page.locator("header .badge")).toHaveText("Google connected");
    const loc = account.data().locations.ids[1];
    expect(account.data()[`loc:${loc}:business`]).toMatchObject({ name: "Zentrix Skin Clinic, Patia", location: "Patia", category: "Dermatology Clinic", placeId: "ChIJe2eZentrixPatia1" });

    await page.goto("/app/reviews");
    await expect(page.locator("main")).toContainText("Zentrix Skin Clinic, Patia");
    expect((await gbpCalls()).calls.some((c) => c.path === "/v4/v4/accounts/100/locations/1002/reviews")).toBe(true);
    // Adding it again is refused.
    await page.goto("/app/locations");
    await expect(page.getByRole("group", { name: "Other locations on your connected Google account" }).getByRole("radio", { name: /Patia/ })).toHaveCount(0);

    // Disconnecting one location keeps the shared Google access for the other.
    await page.goto("/app/settings");
    await submit(page, "Disconnect and delete stored tokens");
    await expect(page.getByRole("status")).toContainText("Your other locations still use this Google account");
    expect((await gbpCalls()).revoked).toBe(0);
    await page.locator("#loc-switch").selectOption({ label: "Zentrix Skin Clinic" });
    await page.waitForURL(/\/app$/);
    await expect(page.locator("header .badge")).toHaveText("Google connected");
    const before = (await gbpCalls()).calls.filter((c) => c.path === "/v4/v4/accounts/100/locations/1001/reviews").length;
    await page.goto("/app/reviews");
    expect((await gbpCalls()).calls.filter((c) => c.path === "/v4/v4/accounts/100/locations/1001/reviews").length).toBe(before + 1);
    expect(readData()[account.id][`loc:${loc}:google`]).toBeUndefined();
  });
});
