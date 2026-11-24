import { expect, PASSWORD, test } from "./support/fixtures";

// Every dashboard feature has its own address: the menu opens it without reloading the page, highlights it, and the
// address works on its own (typed, refreshed, back/forward). Old addresses lead to the new ones. Signed-out visitors
// log in and come back to the page they asked for. The logo leads to the public home page.

const PAGES = [
  { label: "Google profile", path: "/app/google-profile", h1: "Google profile" },
  { label: "Reviews", path: "/app/reviews", h1: "Reviews" },
  { label: "Posts", path: "/app/posts", h1: "Posts" },
  { label: "AI visibility", path: "/app/ai-visibility", h1: "AI visibility" },
  { label: "ChatGPT guide", path: "/app/chatgpt-guide", h1: "ChatGPT Business Hub guide" },
  { label: "Reports", path: "/app/reports", h1: "Monthly reports" },
  { label: "Locations", path: "/app/locations", h1: "Locations" },
  { label: "Settings", path: "/app/settings", h1: "Settings" },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const at = (path: string) => new RegExp(`${escape(path)}$`);

test("the menu opens each feature at its own address, highlights it, and never reloads the page", async ({ page, account }) => {
  expect(account.id).toBeTruthy();
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "App" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  // A marker on the window survives client-side navigation and disappears on a full page load.
  await page.evaluate(() => { (window as unknown as { stay: number }).stay = 1; });
  for (const p of [...PAGES, { label: "Dashboard", path: "/app", h1: "" }]) {
    await nav.getByRole("link", { name: p.label, exact: true }).click();
    await expect(page).toHaveURL(at(p.path));
    if (p.h1) await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
    // Exactly one item highlighted: this one (and "Google profile" is not mistaken for anything else).
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: p.label, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay), `${p.label}: no full reload`).toBe(1);
  }

  // Back and forward walk the same pages, highlight included.
  await page.goBack();
  await expect(page).toHaveURL(at("/app/settings"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await page.goBack();
  await expect(page).toHaveURL(at("/app/locations"));
  await expect(nav.getByRole("link", { name: "Locations" })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(at("/app/settings"));
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

test("every feature address works typed in directly and after a refresh", async ({ page, account }) => {
  expect(account.id).toBeTruthy();
  const nav = page.getByRole("navigation", { name: "App" });
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.getByRole("heading", { level: 1 }), p.path).toHaveText(p.h1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }), `${p.path} after refresh`).toHaveText(p.h1);
    await expect(nav.getByRole("link", { name: p.label, exact: true })).toHaveAttribute("aria-current", "page");
  }
});

test("old addresses lead to the renamed pages, keeping the query", async ({ page, account }) => {
  expect(account.id).toBeTruthy();
  for (const [from, to] of [["/app/google", "/app/google-profile"], ["/app/visibility", "/app/ai-visibility"], ["/app/chatgpt", "/app/chatgpt-guide"]]) {
    await page.goto(from);
    await expect(page).toHaveURL(at(to));
  }
  await page.goto("/app/google?connected=1");
  await expect(page).toHaveURL(at("/app/google-profile?connected=1"));
});

test("the logo leads to the public home page, not the dashboard", async ({ page, account }) => {
  expect(account.id).toBeTruthy();
  await page.goto("/app/reviews");
  const logo = page.locator("aside").getByRole("link", { name: "GMBmirror home" });
  await expect(logo).toHaveAttribute("href", "/");
  await logo.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: "App" })).toHaveCount(0);
});

test("an unknown dashboard address shows the not-found page", async ({ page, account, consoleErrors }) => {
  expect(account.id).toBeTruthy();
  const r = await page.goto("/app/no-such-feature");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist");
  // The browser logs the 404 status itself; that one line is expected here.
  expect(consoleErrors.splice(0)).toEqual(["Failed to load resource: the server responded with a status of 404 (Not Found)"]);
});

test("signed out: a feature address asks to log in, then opens that page", async ({ page, account }) => {
  await page.context().clearCookies();
  await page.goto("/app/reports");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Freports$/);
  await page.locator("#f-email").fill(account.email);
  await page.locator("#f-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(at("/app/reports"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monthly reports");

  // A login address pointing elsewhere is ignored: the dashboard opens instead.
  await page.context().clearCookies();
  await page.goto("/login?next=https://evil.example/app");
  await page.locator("#f-email").fill(account.email);
  await page.locator("#f-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(at("/app"));
});

test("a Supabase email link that fell back to the home page is finished at /auth/confirm", async ({ request }) => {
  const r = await request.get("/?code=not-a-real-code", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(new URL(r.headers().location, "http://x").pathname + new URL(r.headers().location, "http://x").search).toBe("/auth/confirm?code=not-a-real-code");
  // Without a code the home page is served as usual.
  expect((await request.get("/", { maxRedirects: 0 })).status()).toBe(200);
});
