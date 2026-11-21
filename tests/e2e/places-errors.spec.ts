import { expect, PARTIAL_URL, setGoogleListing, submit, test } from "./support/fixtures";

// Google Places features with a key Google rejects (the partial-results test server has a deliberately invalid
// Places key). Checks the real error reaches the owner, the key never does, and the forms keep what was chosen.
// Live results with a real key were checked by hand on 19 November (docs/MASTER_PROJECT_STATUS.md).
test.use({ baseURL: PARTIAL_URL });

test.beforeEach(async ({ page, account }) => {
  // Google rejects this server's key, so the listing is saved without the check (the owner is offered that).
  await setGoogleListing(page, "ChIJmarqE63mDDkRd228dtR6wDs");
  await page.goto("/app/google");
});

test("Google's own reason is shown, never the key", async ({ page }) => {
  const audit = page.locator("section", { has: page.locator("#pa-h") });
  await submit(page, audit.getByRole("button", { name: "Run profile audit" }));
  const message = audit.locator('[role="alert"]');
  await expect(message).toContainText("not a valid key");
  await expect(message).toContainText("API_KEY_INVALID");
  await expect(message).not.toContainText("AIzaE2E");
});

test("rank grid: a failed scan keeps the chosen spacing and phrase", async ({ page }) => {
  const grid = page.locator("section", { has: page.locator("#grid-h") });
  await page.locator("#g-keyword").fill("skin clinic");
  await page.locator("#g-radius").selectOption("1");
  await submit(page, grid.getByRole("button", { name: "Run grid scan" }));
  await expect(grid.locator('[role="alert"]')).toContainText("not a valid key");
  await expect(page.locator("#g-radius")).toHaveValue("1");
  await expect(page.locator("#g-keyword")).toHaveValue("skin clinic");
});
