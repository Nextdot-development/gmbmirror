import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, mockAI, PASSWORD, readData, sentEmails, setGoogleListing, sideways, submit, test, users } from "./support/fixtures";

// Public trust pages (no sign-in, desktop and mobile, metadata, working links), the Google permission explainer,
// and account deletion.

const PAGES = [
  { path: "/about", h1: "About GMBmirror", title: "About | GMBmirror" },
  { path: "/privacy", h1: "Privacy policy", title: "Privacy policy | GMBmirror" },
  { path: "/terms", h1: "Terms of service", title: "Terms of service | GMBmirror" },
  { path: "/cookies", h1: "Cookie policy", title: "Cookie policy | GMBmirror" },
  { path: "/data-deletion", h1: "Data deletion", title: "Data deletion | GMBmirror" },
  { path: "/security", h1: "Security", title: "Security | GMBmirror" },
  { path: "/contact", h1: "Contact us", title: "Contact | GMBmirror" },
];

test.describe("public trust pages", () => {
  for (const p of PAGES) {
    test(`${p.path}: public, titled, described, fits the screen, menu marks it`, async ({ page }) => {
      const res = await page.goto(p.path);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${p.path}$`), { timeout: 5000 }); // not sent to the login page
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
      await expect(page).toHaveTitle(p.title);
      expect((await page.locator('meta[name="description"]').getAttribute("content"))?.length).toBeGreaterThan(40);
      await expect(page.getByRole("navigation", { name: "Trust and legal pages" }).getByRole("link", { name: /./ }).and(page.locator('[aria-current="page"]'))).toHaveCount(1);
      expect(await sideways(page)).toBeLessThanOrEqual(1);
      // No unfinished text.
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const bad of ["lorem", "todo", "tbd", "[company", "placeholder", "your company"]) expect(text).not.toContain(bad);
    });
  }

  test("every link on the trust pages and the home footer works", async ({ page, request }) => {
    const hrefs = new Set<string>();
    for (const path of ["/", ...PAGES.map((p) => p.path)]) {
      await page.goto(path);
      for (const h of await page.locator("main a[href], footer a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
        if (h.startsWith("/") && !h.startsWith("/#") && !h.includes("#")) hrefs.add(h);
        if (h.startsWith("/") && h.includes("#") && !h.startsWith("/#")) hrefs.add(h.split("#")[0]);
      }
    }
    for (const p of PAGES) expect([...hrefs]).toContain(p.path);
    for (const h of hrefs) expect((await request.get(h)).status(), h).toBeLessThan(400);
  });

  test("the privacy policy names every Google scope requested, the Limited Use statement and every provider", async ({ page }) => {
    await page.goto("/privacy");
    const google = page.locator("#google");
    for (const s of ["https://www.googleapis.com/auth/business.manage", "email", "openid"]) await expect(google).toContainText(s);
    await expect(google).toContainText("Google API Services User Data Policy, including the Limited Use requirements");
    await expect(google).toContainText("We do not sell Google user data.");
    for (const provider of ["Supabase", "Vercel", "Anthropic", "Google", "Resend"]) await expect(page.locator("#sharing")).toContainText(provider);
  });

  test("sitemap and robots list the public pages and keep the app private", async ({ request }) => {
    const map = await (await request.get("/sitemap.xml")).text();
    for (const p of PAGES) expect(map).toContain(`${p.path}</loc>`);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /app");
    expect(robots).toContain("Disallow: /api");
  });
});

test("Google page: the permission explainer lists exactly the scopes requested, what is read and done, and the policies", async ({ page, account }) => {
  expect(account.email).toContain("@");
  await page.goto("/app/google");
  const box = page.getByTestId("google-permissions");
  await expect(box.getByTestId("google-scopes")).toContainText("business.manage");
  await expect(box.getByTestId("google-scopes").locator("li")).toHaveCount(2);
  await expect(box).toContainText("It never deletes reviews, posts or your profile");
  await expect(box.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy#google");
  await expect(box.getByRole("link", { name: "terms" })).toHaveAttribute("href", "/terms");
  await expect(box.getByRole("link", { name: "Connect Google Business Profile" })).toHaveAttribute("href", "/api/google/start");
  await expect(box).toContainText("not endorsed by Google");
  expect(await sideways(page)).toBeLessThanOrEqual(1);
});

test.describe("account deletion (Business Profile and email stand-ins)", () => {
  test.use({ baseURL: GBP_URL });
  test.beforeEach(async () => {
    await gbpMode({ reset: true });
    await mockAI("named");
  });

  test("needs the typed email and the tick; then revokes Google, deletes data and login, signs out, confirms honestly", async ({ page, account }) => {
    await setGoogleListing(page, "ChIJtestPlace123");
    await connectGoogle(page);
    await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
    const revokedBefore = (await gbpCalls()).revoked;

    await page.goto("/app/settings#delete-account");
    const form = page.getByTestId("delete-account");
    await form.getByLabel(/Type your account email/).fill("someone-else@example.test");
    await form.getByLabel("I understand my account and all its data will be deleted permanently").check();
    await submit(page, "Delete my account permanently");
    await expect(form).toContainText("Type your account email address exactly to confirm.");
    expect(users()[account.email]).toBeTruthy();

    await form.getByLabel(/Type your account email/).fill(account.email.toUpperCase());
    await form.getByLabel("I understand my account and all its data will be deleted permanently").uncheck();
    await submit(page, "Delete my account permanently");
    await expect(form).toContainText("Tick the box to confirm");

    await form.getByLabel("I understand my account and all its data will be deleted permanently").check();
    await submit(page, "Delete my account permanently");
    await expect(page).toHaveURL(/\/account-deleted\?google=revoked$/);
    await expect(page.getByTestId("account-deleted")).toContainText("Google confirmed that GMBmirror's access to your Google account was cancelled.");
    expect((await gbpCalls()).revoked).toBe(revokedBefore + 1);
    expect(users()[account.email]).toBeUndefined();
    expect(readData()[account.id]).toBeUndefined();
    await expect.poll(async () => (await sentEmails()).filter((m) => m.to[0] === account.email && m.subject === "GMBmirror: your account was deleted").length).toBe(1);

    // Signed out, and the login no longer exists.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await page.locator("#f-email").fill(account.email);
    await page.locator("#f-password").fill(PASSWORD);
    await submit(page, "Log in");
    await expect(page.locator('p[role="alert"]')).toHaveText("Email or password is incorrect.");
  });
});
