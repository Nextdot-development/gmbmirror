import type { Page } from "@playwright/test";
import { expect, readData, test, writeData } from "./support/fixtures";

// Page speed on desktop and mobile (local production build, so these guard against regressions; they are not the
// production numbers), paging of long lists, instant navigation feedback, and the page-speed reporting endpoint.

/** Largest Contentful Paint and Cumulative Layout Shift of the current page, from the browser's own observers. */
async function vitals(page: Page): Promise<{ lcp: number; cls: number }> {
  return page.evaluate(() => new Promise<{ lcp: number; cls: number }>((resolve) => {
    let lcp = 0, cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    setTimeout(() => resolve({ lcp, cls }), 800);
  }));
}

test("dashboard pages: LCP under 2.5 s, CLS under 0.1, in-app navigation under 1 s", async ({ page, account }) => {
  expect(account.email).toContain("@");
  await page.goto("/app");
  const first = await vitals(page);
  expect(first.lcp).toBeLessThan(2500);
  expect(first.cls).toBeLessThan(0.1);
  const nav = page.getByRole("navigation", { name: "App" });
  for (const label of ["Reviews", "Posts", "Reports", "Settings", "Dashboard"]) {
    const t0 = Date.now();
    await nav.getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    const ms = Date.now() - t0;
    expect(ms, `${label} took ${ms} ms`).toBeLessThan(1000);
    expect((await vitals(page)).cls, `${label} layout shift`).toBeLessThan(0.1);
  }
});

test("posts: 15 editors at a time with 'Show more'; reports: 6 at a time", async ({ page, account }) => {
  const d = readData();
  const u = d[account.id] as Record<string, unknown>;
  u.posts = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, text: `Seeded post number ${i} about clinic hours.`, kind: "STANDARD", status: "draft", warnings: [], createdAt: new Date(Date.now() - i * 60_000).toISOString() }));
  u.reports = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, month: `2026-${String(11 - i).padStart(2, "0")}`, generatedAt: new Date().toISOString(), trigger: "owner", partial: false, business: "Zentrix", location: "Pune", sections: [] }));
  writeData(d);
  await page.goto("/app/posts");
  const posts = page.locator("main section[aria-labelledby=drafts] > ul > li");
  await expect(posts).toHaveCount(15);
  await expect(page.getByTestId("show-more")).toContainText("Showing 15 of 20.");
  await page.getByRole("link", { name: "Show 5 more" }).click();
  await expect(posts).toHaveCount(20);
  await expect(page.getByTestId("show-more")).toHaveCount(0);
  await expect(posts.last()).toContainText("Seeded post number 19 about clinic hours.");

  await page.goto("/app/reports");
  const reports = page.locator("main ul[aria-label='Report history'] > li");
  await expect(reports).toHaveCount(6);
  await page.getByRole("link", { name: "Show 2 more" }).click();
  await expect(reports).toHaveCount(8);
});

test("page-speed reports: only known metrics and clean route names are accepted (always 204, nothing stored)", async ({ request }) => {
  for (const body of [
    { name: "LCP", value: 1234.5, rating: "good", route: "/app/posts" },
    { name: "NAV", value: 320, route: "/app/[id]" },
    { name: "EVIL", value: 1, route: "/app" },
    { name: "LCP", value: "x", route: "/app" },
    { name: "LCP", value: 1, route: "/app?email=a@b.c" },
  ]) {
    const r = await request.post("/api/vitals", { data: body });
    expect(r.status()).toBe(204);
  }
  expect((await request.post("/api/vitals", { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(204);
});
