import { expect, sideways, test } from "./support/fixtures";

// Phase 1 feature: mobile navigation hint. Plus no sideways scrolling on the app pages.
// Runs in the desktop, tablet and mobile projects (see playwright.config.ts).

const PAGES = ["/app", "/app/google-profile", "/app/reviews", "/app/posts", "/app/ai-visibility", "/app/chatgpt-guide", "/app/settings"];

test("no sideways scroll and no duplicate element ids on the 7 app pages", async ({ page, account }) => {
  const overflow: string[] = [];
  const duplicates: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    const extra = await sideways(page);
    if (extra > 0) overflow.push(`${path} +${extra}px`);
    const ids = await page.locator("[id]").evaluateAll((els) => els.map((e) => e.id));
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) duplicates.push(`${path} #${id}`);
  }
  expect(overflow).toEqual([]);
  expect(duplicates).toEqual([]);
});

test("navigation hint: shown while items are off-screen, fades at the end, hidden on wide screens", async ({ page, account }) => {
  await page.goto("/app");
  const nav = page.locator('nav[aria-label="App"]');
  const hint = () =>
    nav.evaluate((n) => {
      const h = n.nextElementSibling as HTMLElement;
      return { cls: h.className, display: getComputedStyle(h).display, pointer: getComputedStyle(h).pointerEvents, more: n.scrollWidth - n.clientWidth - n.scrollLeft };
    });

  const first = await hint();
  if (page.viewportSize()!.width >= 768) {
    // Tablet and desktop (Tailwind md and up): the sidebar shows every item, so there is no hint.
    expect(first.display).toBe("none");
    return;
  }
  expect(first.display).not.toBe("none");
  expect(first.cls).toContain("opacity-100");
  expect(first.more).toBeGreaterThan(4);
  expect(first.pointer).toBe("none");

  await nav.evaluate((n) => (n.scrollLeft = n.scrollWidth));
  await expect.poll(async () => (await hint()).cls).toContain("opacity-0");
  await nav.evaluate((n) => (n.scrollLeft = 0));
  await expect.poll(async () => (await hint()).cls).toContain("opacity-100");
});
