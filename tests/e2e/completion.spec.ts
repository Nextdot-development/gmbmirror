import { inflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, localInput, mockAI, PLACE, placesMode, readData, retype, runJobs, setGoogleListing, sideways, submit, test, writeData } from "./support/fixtures";

// Pre-OAuth completion: 5x5 rank grid with cost controls and competitor movement, removing one location, Hindi
// report PDFs, and recovery of a scheduled post whose answer from Google was lost. Google is the test stand-in.

const section = (page: Page, headingId: string) => page.locator("section", { has: page.locator(`#${headingId}`) });
const HOUR = 3600_000;

/** The decompressed page content of a Unicode PDF: every glyph drawn, as hex glyph IDs. */
function drawnGlyphs(pdf: Buffer): string[] {
  const out: string[] = [];
  const bin = pdf.toString("latin1");
  for (const m of bin.matchAll(/stream\n/g)) {
    const start = m.index! + m[0].length;
    const end = bin.indexOf("\nendstream", start);
    try {
      const text = inflateSync(pdf.subarray(start, end)).toString("latin1");
      for (const g of text.matchAll(/<([0-9A-F]{4})> Tj/g)) out.push(g[1]);
    } catch {
      // Not a deflated stream.
    }
  }
  return out;
}


async function gridScan(page: Page, size: "3" | "5", keyword = "hospital") {
  await page.goto("/app/google-profile");
  await page.locator("#g-keyword").fill(keyword);
  await page.locator("#g-size").selectOption(size);
  await page.locator("#g-radius").selectOption("1");
  await submit(page, section(page, "grid-h").getByRole("button", { name: "Run grid scan" }));
}

test.describe("rank grid 5x5", () => {
  test.beforeEach(async () => placesMode({ reset: true }));

  test("25 points, exact cost shown, competitors recorded at no extra cost, names on request, movement between scans", async ({ page, account }) => {
    await setGoogleListing(page, PLACE.hospital);
    await page.goto("/app/google-profile");
    await page.locator("#g-size").selectOption("5");
    await expect(page.getByTestId("grid-cost")).toContainText("This scan makes 26 Google Places requests (1 to find your business on the map, then 25 searches) and uses 25 of your daily grid points.");
    await expect(page.getByTestId("grid-cost")).toContainText("75 of 75 points left");

    // Outer ring 11th or worse, inner ring 2nd, centre 1st.
    const ring = (r: number, c: number) => Math.max(Math.abs(r - 2), Math.abs(c - 2));
    const grid = Array.from({ length: 25 }, (_, i) => [1, 2, 11][ring(Math.floor(i / 5), i % 5)]);
    await placesMode({ grid });
    await gridScan(page, "5");
    const box = section(page, "grid-h");
    await expect(box).toContainText("Scan saved: 25 points, 26 Google Places requests. 50 of 75 grid points left for today.");
    await expect(page.getByTestId("rank-grid")).toHaveAttribute("data-points", "25");
    await expect(page.getByTestId("rank-grid").locator("> div")).toHaveCount(25);
    await expect(page.getByTestId("rank-grid").locator("> div").nth(12)).toContainText("you");
    await expect(page.getByTestId("rank-grid").locator("> div").nth(12)).toContainText("1");
    await expect(page.getByTestId("rank-grid").locator("> div").nth(0)).toContainText("11");
    expect(await sideways(page)).toBe(0);

    // Competitors from the same results: IDs and counts stored, never names.
    const comp = page.getByTestId("grid-competitors");
    await expect(comp.locator("tbody tr")).toHaveCount(5);
    await expect(comp).toContainText("Competitor A");
    const saved = account.data().places.scans[0];
    expect(saved.size).toBe(5);
    expect(saved.ranks).toHaveLength(25);
    expect(saved.leaders).toHaveLength(5);
    expect(JSON.stringify(saved)).not.toContain("Nearby business");
    await comp.getByRole("button", { name: "Show names (5 Google requests)" }).click();
    await expect(comp).toContainText("Nearby business");
    expect(JSON.stringify(account.data().places)).not.toContain("Nearby business");

    // A second scan of the same series, with other businesses leading: movement is shown.
    await placesMode({ grid, shift: 3 });
    await gridScan(page, "5");
    await expect(box).toContainText("Compared with");
    await expect(box).toContainText("(same phrase, spacing and grid)");
    await expect(comp).toContainText("New in this list");
    await expect(comp).toContainText("No longer in this list");
    // Only the new leaders' names are missing; asking for them now exceeds the hourly Google Places budget
    // (2 scans x 26 requests + 5 names), which is refused with a message, not run.
    // Names already loaded stay for competitors in both scans; the button counts only the missing ones.
    const known = await comp.locator("tbody tr td:first-child").filter({ hasText: "Nearby business" }).count();
    const ask = comp.getByRole("button", { name: `Show names (${5 - known} Google request${5 - known === 1 ? "" : "s"})` });
    await ask.click();
    await expect(comp.getByRole("alert")).toContainText("Too many Google Places requests.");
    await expect(box.getByRole("list", { name: "Earlier scans" })).toContainText("5 x 5, in the top 20 at 25 of 25 points");
  });

  test("the daily allowance counts every location's scans; a scan that does not fit is refused before any Google request", async ({ page, account }) => {
    await setGoogleListing(page, PLACE.hospital);
    // 59 points already used today by another location of the same account.
    const d = readData();
    const now = new Date().toISOString();
    d[account.id].locations = { active: "main", ids: ["main", "branch2"] };
    d[account.id]["loc:branch2:business"] = { name: "Branch", website: "", location: "Pune", category: "Hospital", type: "healthcare", audit: {}, createdAt: now };
    d[account.id]["loc:branch2:places"] = { profileScores: [], scans: [25, 25, 9].map((n, i) => ({ id: `x${i}`, keyword: "x", radiusKm: 1, size: n === 25 ? 5 : 3, ranks: Array(n).fill(null), at: now })) };
    writeData(d);
    await page.goto("/app/google-profile");
    await expect(page.getByTestId("grid-cost")).toContainText("16 of 75 points left");
    await gridScan(page, "5");
    await expect(section(page, "grid-h").getByRole("alert")).toContainText("This scan needs 25 grid points, and 16 of your 75 daily points are left (all locations together). A 3 x 3 scan still fits.");
    expect(account.data().places?.scans ?? []).toHaveLength(0);
    // A 3x3 scan fits.
    await gridScan(page, "3");
    await expect(section(page, "grid-h")).toContainText("Scan saved: 9 points, 10 Google Places requests. 7 of 75 grid points left for today.");
  });
});

test("removing a location: name must be typed, only that location's data goes, the other stays; the last one cannot be removed", async ({ page, account }) => {
  // A second location, set up by hand.
  await page.goto("/app/locations");
  await submit(page, "Add a location by hand");
  await page.waitForURL(/\/app\/onboarding$/);
  await page.locator("#f-name").fill("Zentrix Patia Branch");
  await page.locator("#f-location").fill("Bhubaneswar");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/app\/onboarding\/connect$/);
  await page.getByRole("link", { name: /^(Skip for now|Continue to your dashboard)$/ }).click();
  await page.waitForURL(/\/app$/);
  const ids = () => (readData()[account.id].locations as { ids: string[] }).ids;
  const branch = ids().find((x) => x !== "main")!;
  // Some data in both locations.
  const d = readData();
  d[account.id].posts = [{ id: "pm", text: "Main post", kind: "STANDARD", status: "draft", warnings: [], createdAt: "" }];
  d[account.id][`loc:${branch}:posts`] = [{ id: "pb", text: "Branch post", kind: "STANDARD", status: "draft", warnings: [], createdAt: "" }];
  d[account.id][`loc:${branch}:reports`] = [];
  writeData(d);

  await page.goto("/app/locations");
  const card = page.locator(`[data-location="${branch}"]`);
  await card.getByText("Remove this location").click();
  await expect(card.getByTestId("remove-location")).toContainText("Nothing changes on Google");
  await card.locator(`#rm-${branch}`).fill("Zentrix Skin Clinic");
  await submit(page, card.getByRole("button", { name: "Remove Zentrix Patia Branch" }));
  await expect(card.getByRole("alert")).toContainText("Type the location name exactly as shown (Zentrix Patia Branch) to confirm.");
  expect(ids()).toContain(branch);

  await retype(card.locator(`#rm-${branch}`), "  zentrix patia   branch ");
  await submit(page, card.getByRole("button", { name: "Remove Zentrix Patia Branch" }));
  await page.waitForURL(/\/app\/locations\?removed=1$/);
  await expect(page.getByTestId("location-removed")).toBeVisible();
  await expect(page.locator("[data-location]")).toHaveCount(1);
  const after = readData()[account.id];
  expect(Object.keys(after).filter((k) => k.startsWith(`loc:${branch}:`))).toEqual([]);
  expect(after.business.name).toBe("Zentrix Skin Clinic");
  expect(after.posts[0].text).toBe("Main post");
  expect((after.locations as { active: string }).active).toBe("main");
  // One location left: no remove option.
  await expect(page.getByTestId("remove-location")).toHaveCount(0);
  await page.goto("/app");
  await expect(page.locator("main h1")).toHaveText("Zentrix Skin Clinic");
});

test("monthly report PDF in Hindi: the Unicode fonts are embedded and nothing is replaced by '?'", async ({ page, account }) => {
  await mockAI("named");
  await page.goto("/app/settings");
  await retype(page.locator("#f-name"), "सनराइज़ स्किन क्लिनिक");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Business details saved");
  await page.goto("/app/reports");
  await submit(page, "Create this month's report now");
  const report = page.locator("main ul[aria-label='Report history'] > li").first();
  await expect(report.getByLabel("Review requests")).toContainText("Not available: No review link was shared from this app this month.");
  const href = await report.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = await res.body();
  const pdf = body.toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansDevanagari-Bold/);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
  expect(pdf).toContain("/ToUnicode");
  // Every character was drawn with a real glyph: none is glyph 0 (a missing character), and no Helvetica text is used.
  const glyphs = drawnGlyphs(body);
  expect(glyphs.length).toBeGreaterThan(200);
  expect(glyphs).not.toContain("0000");
  expect(pdf).not.toContain("/Helvetica");
  expect(pdf.length).toBeLessThan(150_000);
});

test.describe("scheduled post recovery", () => {
  test.use({ baseURL: GBP_URL });
  test.beforeEach(async () => {
    await gbpMode({ reset: true });
    await mockAI("named");
  });

  test("Google kept the post but its answer was lost: the retry finds it on Google instead of posting it twice", async ({ page, account }) => {
    await setGoogleListing(page, "ChIJtestPlace123");
    await connectGoogle(page);
    await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
    const at = new Date(Date.now() + 3 * 24 * HOUR);
    at.setSeconds(0, 0);
    const text = "Free skin check camp, Saturday 10 am.";
    await page.goto("/app/posts");
    await page.locator("#p-text").fill(text);
    await page.locator("#f-scheduledFor").fill(localInput(at));
    await submit(page, "Save as draft");
    const card = page.locator("main section[aria-labelledby=drafts] ul > li").filter({ hasText: text });
    await submit(page, card.getByRole("button", { name: "Approve" }));

    await gbpMode({ loseAnswer: "1" });
    await runJobs(page, new Date(at.getTime() + 60_000));
    const posts = async () => (await gbpCalls()).posts.filter((p) => p.summary === text);
    expect(await posts()).toHaveLength(1); // Google has it
    expect(account.data().posts[0].status).toBe("approved"); // but the app was never told, so it is not marked posted
    await page.reload();
    await expect(card.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "queued");

    await runJobs(page, new Date(at.getTime() + 7 * 60_000));
    expect(await posts()).toHaveLength(1); // not posted twice
    const calls = (await gbpCalls()).calls;
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/localPosts"))).toHaveLength(1);
    expect(calls.some((c) => c.method === "GET" && c.path.endsWith("/localPosts"))).toBe(true);
    const saved = account.data().posts[0];
    expect(saved.status).toBe("posted");
    expect(saved.googleName).toBe((await posts())[0].name);
    await page.reload();
    await expect(card.getByTestId("schedule-status")).toContainText("Published by the schedule.");
  });
});
