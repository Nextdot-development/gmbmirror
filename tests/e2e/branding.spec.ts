import { expect, mockAI, sideways, submit, test } from "./support/fixtures";

// Product identity: GMBmirror everywhere customers look, and the public contact address gmbmirror@gmail.com as a
// working mailto link. The old name must not appear on any page.

const EMAIL = "gmbmirror@gmail.com";
const TITLE = "GMBmirror — AI-Powered Google Business Profile Growth Platform";
const noOldName = async (page: import("@playwright/test").Page) => expect(await page.content()).not.toMatch(/Growth Engine/i);

test.describe("public pages", () => {
  test.use({ onboard: false });

  test("home, legal and error pages: name, titles, share metadata, contact links", async ({ page, consoleErrors }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(TITLE);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", TITLE);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "GMBmirror");
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", TITLE);
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "GMBmirror");
    await expect(page.getByRole("link", { name: "GMBmirror home" }).first()).toBeVisible();
    await expect(page.locator("footer").getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
    expect(await sideways(page)).toBe(0);
    await noOldName(page);

    for (const [path, title] of [["/privacy", "Privacy policy | GMBmirror"], ["/terms", "Terms of service | GMBmirror"]]) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      // Several contact links on the longer pages: every one is the support address.
      const links = page.locator("main").getByRole("link", { name: EMAIL });
      expect(await links.count()).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) expect(href).toBe(`mailto:${EMAIL}`);
      await noOldName(page);
    }
    await expect(page.locator("main")).toContainText("GMBmirror helps you manage Google Business Profile locations you are authorised to manage");

    const before = consoleErrors.length;
    const res = await page.goto("/no-such-page");
    expect(res!.status()).toBe(404);
    await expect(page.getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
    await noOldName(page);
    // The browser logs the deliberate 404 response; only that one expected line is removed.
    expect(consoleErrors.slice(before)).toEqual(["Failed to load resource: the server responded with a status of 404 (Not Found)"]);
    consoleErrors.splice(before, 1);

    await page.goto("/login");
    await expect(page).toHaveTitle(/\| GMBmirror$/);
    await expect(page.getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
    await noOldName(page);
  });

  test("web app manifest and share image name the product", async ({ page }) => {
    const m = await (await page.request.get("/manifest.webmanifest")).json();
    expect(m.name).toBe(TITLE);
    expect(m.short_name).toBe("GMBmirror");
    await page.goto("/");
    const og = await page.locator('meta[property="og:image:alt"]').getAttribute("content");
    expect(og).toContain("GMBmirror");
    const img = await page.request.get(new URL((await page.locator('meta[property="og:image"]').getAttribute("content"))!).pathname);
    expect(img.headers()["content-type"]).toBe("image/png");
  });
});

test("signed-in pages: the name in the sidebar and titles, support email in Settings, the report PDF footer", async ({ page, account }) => {
  for (const path of ["/app", "/app/google", "/app/reviews", "/app/posts", "/app/visibility", "/app/chatgpt", "/app/reports", "/app/locations", "/app/settings"]) {
    await page.goto(path);
    await expect(page).toHaveTitle(/\| GMBmirror$/);
    await expect(page.getByRole("link", { name: "GMBmirror home" })).toBeVisible();
    await noOldName(page);
  }
  await expect(page.getByTestId("support-email").getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
  await mockAI("named");
  await page.goto("/app/reports");
  await submit(page, "Create this month's report now");
  const href = await page.locator("main ul[aria-label='Report history'] > li").first().getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = (await (await page.request.get(href!)).body()).toString("latin1");
  expect(pdf).toContain(`(Made with GMBmirror. Questions: ${EMAIL})`);
  expect(pdf).not.toMatch(/Growth Engine/i);
});
