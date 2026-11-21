import { expect, readData, retype, sideways, submit, test, writeData } from "./support/fixtures";

// Phase 1 features: editing saved posts, and Draft / Approved / Posted status labels. Runs on desktop and phone sizes.

test("post editing: validation, approved posts go back to draft, warnings re-run, posted posts are locked", async ({ page, account }) => {
  await page.goto("/app/posts");
  const cards = page.locator("main li.card");
  const badges = () => page.locator("main li .badge").allTextContents();
  const openEdit = () => page.locator("main details summary", { hasText: /^Edit$/ }).first().click();
  const editor = page.locator("textarea[id^='e-']");

  await retype(page.locator("#p-text"), "Clinic timings change next week for the festival.");
  await submit(page, "Save as draft");
  await expect(cards.filter({ hasText: "Clinic timings change next week for the festival." })).toHaveCount(1);
  expect(await badges()).toContain("Draft");

  await openEdit();
  await expect(editor).toHaveValue("Clinic timings change next week for the festival.");
  await retype(editor, "short");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Write at least 10 characters.");
  await expect(page.locator("main")).toContainText("Clinic timings change next week for the festival.");
  await expect(editor).toHaveValue("short");

  await retype(editor, "Clinic timings change next week. Open 9 to 5 on Sunday.");
  await submit(page, "Save changes");
  await expect(page.locator("main")).toContainText("Changes saved. The post is a draft again.");
  await expect(page.locator("main")).toContainText("Clinic timings change next week. Open 9 to 5 on Sunday.");

  await page.goto("/app/posts");
  await submit(page, "Approve");
  await expect.poll(badges).toContain("Approved");

  await openEdit();
  await expect(page.locator("main")).toContainText("Saving changes moves this post back to draft");
  await retype(editor, "We guarantee a permanent cure. Open Sunday.");
  await submit(page, "Save changes");
  await page.goto("/app/posts");
  expect(await badges()).toContain("Draft");
  await expect(page.locator("main")).toContainText("Avoids guarantees");
  const [stored] = account.data().posts;
  expect(stored.status).toBe("draft");
  expect(stored.warnings.some((w: string) => w.includes("guarantees"))).toBe(true);

  // Only Google publishing can make a post "posted", so the test writes one into the test server's own data.
  const d = readData();
  d[account.id].posts.push({ id: "posted-1", text: "An already published post.", kind: "STANDARD", status: "posted", warnings: [], createdAt: new Date().toISOString() });
  writeData(d);
  await page.goto("/app/posts");
  const posted = cards.filter({ hasText: "An already published post." });
  await expect(posted.locator(".badge")).toContainText(["Posted"]);
  await expect(posted.locator("details")).toHaveCount(0);

  // Editor open: no sideways scroll at this viewport.
  await openEdit();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("review reply labels read Draft, then Approved", async ({ page, account }) => {
  await page.goto("/app/reviews");
  const reply = page.locator("main textarea").first();
  await retype(reply, "Thank you for visiting us, Rohit.");
  await submit(page, page.getByRole("button", { name: "Save draft" }).first());
  await expect(page.locator("main form .badge").first()).toHaveText("Draft");
  await submit(page, page.getByRole("button", { name: "Approve" }).first());
  await page.goto("/app/reviews");
  await expect(page.locator("main form .badge").first()).toHaveText("Approved");
  expect(Object.values(account.data().replies ?? {}).some((r: any) => r.status === "approved")).toBe(true);
});
