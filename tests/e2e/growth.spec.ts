import type { Page } from "@playwright/test";
import { aiCalls, expect, mockAI, PLACE, placesMode, readData, retype, setGoogleListing, sideways, submit, test, writeData } from "./support/fixtures";

// AI Business Growth Intelligence: categories, checklist from Google, competitor gaps, recommendations, action plans,
// history. Google Places is the test server's stand-in (fixed businesses); Claude is the mock.

const section = (page: Page, headingId: string) => page.locator("section", { has: page.locator(`#${headingId}`) });
const growthCalls = async () => (await aiCalls()).filter((c) => c.system.startsWith("You prioritise growth"));
const checklistRow = (page: Page, label: string) => page.getByRole("list", { name: "Profile checklist items" }).locator("li").filter({ hasText: label });

async function setBusiness(page: Page, o: { local?: boolean; category: string; placeId: string; phone?: string }) {
  await page.goto("/app/settings");
  if (o.local) await page.getByLabel("Local business").check();
  await page.locator("#f-category").selectOption(o.category);
  if (o.phone) await retype(page.locator("#f-phone"), o.phone);
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved");
  await setGoogleListing(page, o.placeId);
}

async function runAudit(page: Page) {
  await page.goto("/app/google");
  await submit(page, section(page, "pa-h").getByRole("button", { name: /Run profile audit|Run again/ }));
  await expect(section(page, "pa-h")).toContainText("/ 100");
}

async function runGrid(page: Page, ranks: (number | null)[]) {
  await placesMode({ grid: ranks });
  await page.goto("/app/google");
  await page.locator("#g-keyword").fill("hospital");
  await page.locator("#g-radius").selectOption("3");
  await submit(page, section(page, "grid-h").getByRole("button", { name: "Run grid scan" }));
  await expect(section(page, "grid-h")).toContainText("Scan saved");
}

test.beforeEach(async () => {
  await placesMode({ reset: true });
});

test("a new account: setup actions from the rules, no health score, no Claude call", async ({ page, account }) => {
  await mockAI("named");
  await page.goto("/app");
  await expect(section(page, "health-h")).toContainText("Not measured yet");
  const recs = page.getByRole("list", { name: "Recommended actions" });
  await expect(recs.locator("li").first()).toContainText("Link your Google listing");
  await expect(recs.locator("li").first()).toContainText("Critical");
  await expect(recs.locator("li").first()).toContainText("No Google Place ID is saved for your business.");
  await expect(page.getByText("Standard recommendations", { exact: true })).toBeVisible();
  await expect(section(page, "cmp-h")).toContainText("No comparison yet");
  await expect(section(page, "ptrend-h")).toContainText("No profile audits yet");
  await expect(section(page, "chg-h")).toContainText("Changes appear once a check has been run twice");
  await page.waitForTimeout(1500);
  expect(await growthCalls()).toHaveLength(0);
});

test("hospital: category, verified checklist, competitor gaps, rank history, Claude recommendations and an action plan", async ({ page, account }) => {
  await mockAI("named");
  await setBusiness(page, { category: "Multi-speciality Hospital", placeId: PLACE.hospital, phone: "98765 43210" });

  // Profile audit through the Places stand-in.
  await runAudit(page);
  await expect(section(page, "pa-h")).toContainText("100 / 100");
  await expect(section(page, "pa-h")).toContainText("General Hospital");

  // Checklist: the five items Google can report are verified, the rest stay with the owner.
  await page.reload();
  for (const label of ["Website is listed", "Opening hours", "At least 10 recent photos", "Phone number matches", "Primary category"])
    await expect(checklistRow(page, label), label).toHaveAttribute("data-status", "verified");
  await expect(checklistRow(page, "Every service is listed")).toHaveAttribute("data-status", "unknown");
  await expect(checklistRow(page, "Every service is listed")).toContainText("Google does not report this item");
  await expect(checklistRow(page, "Website is listed")).toContainText(/Checked \d+ \w+ \d{4}/);

  // Competitors: a hospital is compared with hospitals, with counted gaps and strengths.
  const cmp = section(page, "cmp-h");
  await submit(page, cmp.getByRole("button", { name: "Compare with competitors" }));
  await expect(cmp).toContainText("“multi-speciality hospitals in Bhubaneswar”");
  await expect(cmp).toContainText("You are #3 of 10.");
  await expect(cmp).toContainText("Your rating is higher than 8 of the 9 businesses compared.");
  await expect(cmp).toContainText("You have fewer reviews than 5 of the 9 businesses compared.");
  await expect(cmp).toContainText("Most common Google category among them: Hospital (9 of 9).");

  // Rank grid twice for the same phrase: the second is compared with the first.
  await runGrid(page, [5, 5, 5, 5, 1, 5, null, 5, 5]);
  await runGrid(page, [1, 1, 2, 2, 1, 2, 3, 3, 1]);
  await page.reload();
  await expect(section(page, "grid-h")).toContainText("Top 3 at 9 of 9 points (was 1)");
  await expect(section(page, "grid-h")).toContainText("In the top 20 at 9 of 9 points (was 8)");

  // Dashboard: health from the measures that exist, Claude recommendations made once from this data.
  await mockAI("named");
  await page.goto("/app");
  await expect(section(page, "health-h")).toContainText("Based on 3 of 4 measures");
  await expect(page.getByRole("list", { name: "Measures" })).toContainText("Not measured yet: run an AI visibility check");
  await expect(page.getByText("Written by Claude from your data")).toBeVisible();
  const recs = page.getByRole("list", { name: "Recommended actions" });
  await expect(recs.locator(":scope > li")).toHaveCount(3);
  await expect(recs.locator("li").first()).toContainText("Claude plan 1 for run_visibility");
  await expect(recs.locator("li").first()).toContainText("No AI visibility check has been run yet."); // evidence from our data
  await expect(section(page, "cmp-h")).toContainText("#3 of 10 Google results for “multi-speciality hospitals in Bhubaneswar”.");
  await expect(section(page, "chg-h")).toContainText("Top 3 for “hospital” at 9 of 9 points, up from 1");
  await expect(section(page, "ptrend-h")).toContainText("First measurement");

  // Claude saw our derived facts only: no Google names, types or competitor data.
  const calls = await growthCalls();
  expect(calls).toHaveLength(1);
  for (const googleOnly of ["Sunrise Multi-speciality Hospital", "General Hospital", "competitor 1", "sunrise-hospital.example", PLACE.hospital]) expect(calls[0].user).not.toContain(googleOnly);

  // Same data, second visit: the cached set is used, Claude is not asked again.
  await page.reload();
  await expect(page.getByText("Written by Claude from your data")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await growthCalls()).toHaveLength(1);

  // Action plan with a Claude draft; marking it done ticks the checklist item.
  await page.goto("/app/actions/description");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Claude plan 3 for description");
  await expect(page.locator("main")).toContainText("Not confirmed in your profile checklist.");
  await expect(page.getByRole("list", { name: "Steps" }).locator("li")).toHaveCount(2);
  await submit(page, page.getByRole("button", { name: /Draft a business description with Claude/ }));
  await expect(page.locator("#action-draft")).toHaveValue(/Draft from mock Claude/);
  await submit(page, "Mark as done");
  // The checklist item is now ticked, so the latest data no longer shows the problem.
  await expect(page.locator("main")).toContainText(/You marked this done on \d+ \w+ \d{4}, and your latest data no longer shows the problem/);
  await expect(page.getByRole("button", { name: "Mark as not done" })).toBeVisible();
  expect(account.data().growth.drafts.description.text).toContain("Draft from mock Claude");
  expect(account.data().business.audit.description).toBe(true);
  await page.goto("/app");
  await expect(section(page, "chg-h")).toContainText("Marked done: Claude plan 3 for description");
});

test("salon: owner-vs-Google conflict, competitor gaps, unusable Claude answer, and audit history", async ({ page, account }) => {
  await setBusiness(page, { local: true, category: "Salon", placeId: PLACE.salon });
  // The owner says the website is listed before any audit.
  await page.goto("/app/google");
  await submit(page, checklistRow(page, "Website is listed").getByRole("button", { pressed: false }));
  await runAudit(page);
  await expect(section(page, "pa-h")).toContainText("30 / 100");

  await page.reload();
  const website = checklistRow(page, "Website is listed");
  await expect(website).toHaveAttribute("data-status", "missing");
  await expect(website).toContainText("Your answer and Google's differ.");
  await expect(website.getByRole("button", { pressed: true })).toBeVisible(); // the owner's tick was not overwritten
  await submit(page, website.getByRole("button", { name: "Use Google's answer" }));
  await expect(checklistRow(page, "Website is listed").getByRole("button", { pressed: false })).toBeVisible();
  await expect(checklistRow(page, "Website is listed")).not.toContainText("differ");

  const cmp = section(page, "cmp-h");
  await submit(page, cmp.getByRole("button", { name: "Compare with competitors" }));
  await expect(cmp).toContainText("You are not in the top 10.");
  await expect(cmp).toContainText("You have fewer reviews than 10 of the 10 businesses compared.");
  await expect(cmp).toContainText("You have fewer photos than 10 of the 10 businesses compared.");
  await expect(cmp).toContainText("7 of the 10 businesses compared show a website on Google; yours does not.");
  await expect(cmp.getByRole("heading", { name: "Recommended actions" })).toBeVisible();

  // Claude answers with something that is not usable: the standard recommendations are shown, with a note.
  await mockAI("growth-bad");
  await page.goto("/app");
  await expect(page.getByText("Claude's answer could not be used")).toBeVisible();
  await expect(page.getByText("Standard recommendations", { exact: true })).toBeVisible();
  const recs = page.getByRole("list", { name: "Recommended actions" });
  await expect(recs).toContainText("Profile audit on");
  await expect(recs.locator(":scope > li")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Ask Claude again" })).toBeVisible();

  // The salon improves on Google; the next audit shows the change and history.
  await placesMode({ improved: true });
  await runAudit(page);
  await expect(section(page, "pa-h")).toContainText("90 / 100");
  await page.reload();
  const audit = section(page, "pa-h");
  await expect(audit).toContainText("▲ +60 vs");
  await expect(audit.getByRole("list", { name: "Changes since the previous audit" })).toContainText("Photos: 5 → 15 of 15 points");
  await expect(audit.getByRole("img", { name: /Profile audit score over time/ })).toHaveAttribute("aria-label", /30.*90/);
  await page.goto("/app");
  await expect(section(page, "chg-h")).toContainText("Profile audit score rose from 30 to 90 / 100");
  await expect(section(page, "ptrend-h")).toContainText("▲ +60");
});

test("missing Google data: nothing is guessed; Claude failing leaves the dashboard usable", async ({ page, account }) => {
  await setBusiness(page, { category: "Doctor / Clinic", placeId: PLACE.sparse });
  await runAudit(page);
  await expect(section(page, "pa-h")).toContainText("0 / 100");
  await expect(section(page, "pa-h")).toContainText("Business status: unknown");
  const cmp = section(page, "cmp-h");
  await submit(page, cmp.getByRole("button", { name: "Compare with competitors" }));
  await expect(cmp).toContainText("No measure where most of them are ahead.");
  await expect(cmp).toContainText("so reviews were not compared");

  await mockAI("500");
  await page.goto("/app");
  await expect(page.getByText("Claude is having problems (500)")).toBeVisible();
  const first = page.getByRole("list", { name: "Recommended actions" }).locator("li").first();
  await expect(first).toContainText("Make Google show your business as open");
  await expect(first).toContainText("Critical");
  await page.getByRole("link", { name: /Open action plan/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make Google show your business as open");
  await expect(page.locator("main")).toContainText("standard steps; evidence from your data");
});

test("a category saved by an older version shows its new name and keeps working", async ({ page, account }) => {
  const d = readData();
  d[account.id].business.category = "Doctor or clinic";
  writeData(d);
  await page.goto("/app/settings");
  await expect(page.locator("#f-category")).toHaveValue("Doctor / Clinic");
  await page.goto("/app");
  await expect(page.locator("header")).toContainText("Doctor / Clinic");
  await page.goto("/app/visibility");
  await expect(page.locator("main")).toContainText("Which are the best clinics in Bhubaneswar");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("dashboard, Google page and action plan fit the screen", async ({ page, account }) => {
    await mockAI("named");
    await setBusiness(page, { category: "Hospital", placeId: PLACE.hospital });
    await runAudit(page);
    await submit(page, section(page, "cmp-h").getByRole("button", { name: "Compare with competitors" }));
    await expect(section(page, "cmp-h")).toContainText("Where you are stronger");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.goto("/app");
    await expect(section(page, "health-h")).toContainText("Based on");
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: /Open action plan/ }).first().click();
    await expect(page.getByRole("heading", { name: "Problem identified" })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});
