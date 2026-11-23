import type { Page } from "@playwright/test";
import { aiCalls, expect, mockAI, PLACE, retype, setGoogleListing, sideways, submit, test } from "./support/fixtures";

// Settings: every change is validated, saved on the server, shown after a reload, and used by every page that needs
// it. The two forms (business information, AI preferences) never overwrite each other.

const saveBusiness = async (page: Page) => {
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved.");
};
const saveAi = async (page: Page) => {
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("AI preferences saved.");
};

test("sections: business information, Google connection, public listing, AI preferences and account", async ({ page, account }) => {
  await page.goto("/app/settings");
  for (const h of ["Business information", "Google connection", "Public Google listing", "AI preferences", "Account"]) {
    await expect(page.getByRole("heading", { name: h, exact: true }), h).toBeVisible();
  }
  await expect(page.locator("main")).toContainText(`Signed in as ${account.email}`);
  await expect(page.getByTestId("gbp-status")).toHaveText("Not connected");
  await expect(page.getByRole("link", { name: "Connect Google Business Profile" })).toHaveAttribute("href", "/api/google/start?from=settings");
  // No server setup details for customers.
  await expect(page.locator("main")).not.toContainText(/GOOGLE_|\.env|App mode/);
});

test("a new business name and city are used on every page and in AI drafts", async ({ page, account }) => {
  await mockAI("named");
  await setGoogleListing(page, "ChIJtestPlace123");
  await page.goto("/app/settings");
  await retype(page.locator("#f-name"), "Zentrix Skin & Hair Clinic");
  await retype(page.locator("#f-location"), "Cuttack");
  await saveBusiness(page);
  await page.reload();
  await expect(page.locator("#f-name")).toHaveValue("Zentrix Skin & Hair Clinic");
  expect(account.data().business).toMatchObject({ name: "Zentrix Skin & Hair Clinic", location: "Cuttack", sources: { name: "user" } });

  await page.goto("/app");
  await expect(page.locator("main h1")).toHaveText("Zentrix Skin & Hair Clinic");
  await expect(page.locator("header")).toContainText("Cuttack");
  await page.goto("/app/google-profile");
  await expect(page.locator("p", { hasText: /^Message:/ })).toContainText("Thank you for visiting Zentrix Skin & Hair Clinic");
  await page.goto("/app/ai-visibility");
  await expect(page.locator("main")).toContainText("Checking: Zentrix Skin & Hair Clinic");
  expect((await page.locator("details ul li").allTextContents()).some((q) => q.includes("in Cuttack"))).toBe(true);
  await page.goto("/app/reviews");
  await submit(page, page.getByRole("button", { name: "Draft with Claude" }).first());
  await expect.poll(async () => (await aiCalls()).at(-1)?.system ?? "").toContain("Business: Zentrix Skin & Hair Clinic, a doctor's clinic or polyclinic in Cuttack.");
});

test("business information and AI preferences are saved separately and never overwrite each other", async ({ page, account }) => {
  await page.goto("/app/settings");
  await page.locator("#f-language").selectOption("hinglish");
  await retype(page.locator("#f-aliases"), "Zentrix\nDr Rao Clinic");
  await saveAi(page);
  // Business form saved with an unsaved edit still in the AI form: the AI preferences on record stay as saved.
  await retype(page.locator("#f-aliases"), "Not saved");
  await retype(page.locator("#f-name"), "Zentrix Clinic");
  await saveBusiness(page);
  expect(account.data().business).toMatchObject({ name: "Zentrix Clinic", language: "hinglish", aliases: ["Zentrix", "Dr Rao Clinic"] });

  await page.reload();
  await expect(page.locator("#f-language")).toHaveValue("hinglish");
  await expect(page.locator("#f-aliases")).toHaveValue("Zentrix\nDr Rao Clinic");
  await retype(page.locator("#f-name"), "Unsaved name");
  await page.locator("#f-language").selectOption("hi");
  await saveAi(page);
  expect(account.data().business).toMatchObject({ name: "Zentrix Clinic", language: "hi", website: "https://example.test", location: "Bhubaneswar" });
});

test("validation: website optional but must be real, phone digits only, name and city required; nothing saved on error", async ({ page, account }) => {
  await page.goto("/app/settings");
  // Server checks only: the browser's own checks are switched off before each save (the form is re-created after one).
  const serverOnly = () => page.locator("#business form").first().evaluate((f) => ((f as HTMLFormElement).noValidate = true));
  await retype(page.locator("#f-website"), "not a website");
  await serverOnly();
  await submit(page, "Save changes");
  await expect(page.locator("#f-website-e")).toHaveText("Enter a valid website address.");
  await retype(page.locator("#f-website"), "example.test");
  await retype(page.locator("#f-phone"), "call me");
  await serverOnly();
  await submit(page, "Save changes");
  await expect(page.locator("#f-phone-e")).toHaveText("Use digits, spaces, + and - only.");
  await retype(page.locator("#f-phone"), "");
  await retype(page.locator("#f-name"), "");
  await retype(page.locator("#f-location"), "");
  await serverOnly();
  await submit(page, "Save changes");
  await expect(page.locator("#f-name-e")).toHaveText("Enter your business name.");
  await expect(page.locator("#f-location-e")).toHaveText("Enter the city or area.");
  expect(account.data().business).toMatchObject({ name: "Zentrix Skin Clinic", website: "https://example.test", location: "Bhubaneswar" });

  await retype(page.locator("#f-name"), "Zentrix Skin Clinic");
  await retype(page.locator("#f-location"), "Bhubaneswar");
  await retype(page.locator("#f-website"), "");
  await retype(page.locator("#f-phone"), "+91 98765-43210");
  await saveBusiness(page);
  expect(account.data().business).toMatchObject({ website: "", phone: "+91 98765-43210" });
  expect(account.data().business.sources.website).toBeUndefined();
});

test("changing the type or category updates questions, comparisons and the dashboard, without stale results", async ({ page, account }) => {
  await setGoogleListing(page, PLACE.hospital);
  await page.goto("/app/settings");
  await page.locator("#f-category").selectOption("Hospital");
  await saveBusiness(page);
  await page.goto("/app/google-profile");
  const cmp = page.locator("section", { has: page.locator("#cmp-h") });
  await submit(page, cmp.getByRole("button", { name: "Compare with competitors" }));
  await expect.poll(() => account.data().places?.competitors?.[0]?.query).toBe("hospitals in Bhubaneswar");
  await page.goto("/app");
  await expect(page.locator("main")).toContainText("competitor comparison,");

  // A different category compares the owner with different businesses: the old comparison is not shown as current.
  await page.goto("/app/settings");
  await page.locator("#f-category").selectOption("Eye Hospital");
  await saveBusiness(page);
  await page.goto("/app");
  await expect(page.locator("header")).toContainText("Eye Hospital");
  await expect(page.locator("main")).toContainText("No comparison yet.");
  await page.goto("/app/ai-visibility");
  expect((await page.locator("details ul li").allTextContents()).some((q) => q.includes("eye hospitals in Bhubaneswar"))).toBe(true);
  expect(account.data().places.competitors).toHaveLength(1); // kept in history, just not shown as current

  // A new type: the category list changes and an invalid old category is never kept.
  await page.goto("/app/settings");
  await page.getByLabel("Local business").check();
  await expect(page.locator("#f-category")).toHaveValue("Other local business");
  await saveBusiness(page);
  expect(account.data().business).toMatchObject({ type: "general", category: "Other local business" });
  await page.goto("/app");
  await expect(page.locator("header")).toContainText("Other local business");
});

test("a category not on the list is refused by the server", async ({ page, account }) => {
  await page.goto("/app/settings");
  await page.locator("#f-category").evaluate((s) => {
    const o = document.createElement("option");
    o.value = o.textContent = "Casino";
    s.appendChild(o);
    (s as HTMLSelectElement).value = "Casino";
  });
  await submit(page, "Save changes");
  await expect(page.locator("#f-category-e")).toHaveText("Choose a category from the list.");
  expect(account.data().business.category).toBe("Doctor / Clinic");
});

test("settings fit a phone screen", async ({ page, account }) => {
  await page.goto("/app/settings");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});
