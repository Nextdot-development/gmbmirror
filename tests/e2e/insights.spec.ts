import { expect, retype, submit, test } from "./support/fixtures";

// Phase 1 feature: editing and deleting ChatGPT guide insights.

test("insights: add, invalid edit refused, edit saves, delete, stale edit refused", async ({ page, context, account }) => {
  await page.goto("/app/chatgpt-guide");
  for (const [date, label, value] of [["2026-10-01", "Profile views", "200"], ["2026-11-01", "Profile views", "240"]]) {
    await page.locator("#f-date").fill(date);
    await retype(page.locator("#f-label"), label);
    await retype(page.locator("#f-value"), value);
    await submit(page, "Add entry");
    // The form is reset after each save; wait for the entry before typing the next one.
    await expect(page.locator("main")).toContainText(`${date}: ${label}, ${value}`);
  }
  const main = page.locator("main");
  await expect(main).toContainText("2026-11-01: Profile views, 240");
  await expect(main).toContainText("2026-10-01: Profile views, 200");

  const rows = page.locator("main ul li").filter({ has: page.locator("details") });
  const editForm = (n: number) => rows.nth(n).locator("details form");
  const openEdit = (n: number) => rows.nth(n).locator("details").evaluate((d) => ((d as HTMLDetailsElement).open = true));

  // Each edit form has its own field ids, so its labels point at its own fields (not the "Add entry" form's).
  const ids = await page.locator("[id]").evaluateAll((els) => els.map((e) => e.id));
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);

  await openEdit(0);
  await retype(editForm(0).getByLabel("What the number is"), "x");
  await submit(page, editForm(0).getByRole("button", { name: "Save changes" }));
  await expect(main).toContainText("Say what the number is.");
  await expect(main).toContainText("2026-11-01: Profile views, 240");

  await page.goto("/app/chatgpt-guide");
  await openEdit(0);
  await retype(editForm(0).getByLabel("Value"), "260");
  await submit(page, editForm(0).getByRole("button", { name: "Save changes" }));
  await page.goto("/app/chatgpt-guide");
  await expect(main).toContainText("2026-11-01: Profile views, 260");
  await expect(main).not.toContainText("Profile views, 240");

  // A second tab deletes the first entry; the first tab, still showing it, then tries to edit it.
  const other = await context.newPage();
  await other.goto("/app/chatgpt-guide");
  const otherRows = other.locator("main ul li").filter({ has: other.locator("details") });
  await submit(other, otherRows.first().getByRole("button", { name: "Delete" }));
  await other.goto("/app/chatgpt-guide");
  await expect(other.locator("main")).not.toContainText("Profile views, 260");
  await expect(other.locator("main")).toContainText("Profile views, 200");
  await other.close();

  await openEdit(0);
  await retype(editForm(0).getByLabel("Value"), "999");
  await submit(page, editForm(0).getByRole("button", { name: "Save changes" }));
  await expect(main).toContainText("This entry changed or was removed");
  const insights = account.data().guide.insights;
  expect(insights).toHaveLength(1);
  expect(insights[0].value).toBe("200");
});
