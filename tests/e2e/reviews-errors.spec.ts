import { expect, mockAI, retype, submit, test } from "./support/fixtures";

// Review reply drafting: what the owner sees when Claude fails, and the checks on saving and approving.
// Claude is the local mock; the reviews are the labelled samples (Google access is not approved on the test server).

const replyForm = (page: import("@playwright/test").Page) => page.locator("main form").filter({ has: page.locator("textarea") }).first();

test.beforeEach(async ({ page, account }) => {
  await page.goto("/app/reviews");
  await expect(page.locator("main")).toContainText("Sample data");
});

const failures: [mode: string, message: string][] = [
  ["500", "Claude is having problems (500). Try again in a few minutes."],
  ["429", "Claude is rate limiting this account (429). Wait a minute and try again."],
  ["refusal", "Claude declined to write this. Rephrase the request and try again."],
  ["max_tokens", "Claude's answer was cut off before it finished. Try again."],
  ["html", "Claude sent a response that could not be read. Try again."],
];

test("each Claude failure shows its own message, keeps the owner's text and saves nothing", async ({ page, account }) => {
  const form = replyForm(page);
  const box = form.locator("textarea");
  await retype(box, "My own words so far.");
  for (const [mode, message] of failures) {
    await mockAI(mode);
    await submit(page, form.getByRole("button", { name: "Draft with Claude" }));
    await expect(form.locator('p[role="alert"]'), mode).toHaveText(message);
    await expect(box, mode).toHaveValue("My own words so far.");
  }
  expect(account.data().replies ?? {}).toEqual({});

  // After the failures, a working Claude fills the box and the draft is stored.
  await mockAI("named");
  await submit(page, form.getByRole("button", { name: "Draft with Claude" }));
  await expect(box).toHaveValue("Thank you for the feedback, Rohit. We are glad the visit went smoothly.");
  await expect(form.locator(".badge")).toHaveText("Draft");
  expect(Object.values(account.data().replies)).toHaveLength(1);
});

test("saving or approving needs some text, and at most Google's 4096 bytes", async ({ page, account }) => {
  const form = replyForm(page);
  const box = form.locator("textarea");
  for (const button of ["Save draft", "Approve"]) {
    await retype(box, "   ");
    await submit(page, form.getByRole("button", { name: button }));
    await expect(form.locator('p[role="alert"]'), button).toHaveText("Write or draft a reply first.");
  }
  // Google's limit is 4096 bytes: English letters are 1 byte each, Hindi letters 3.
  const tooLong = "This reply is too long for Google. Shorten it (Google allows about 4000 English characters, fewer in Hindi).";
  for (const text of ["a".repeat(4097), "धन्यवाद ".repeat(200)]) {
    await box.fill(text);
    await submit(page, form.getByRole("button", { name: "Save draft" }));
    await expect(form.locator('p[role="alert"]')).toHaveText(tooLong);
  }
  expect(account.data().replies ?? {}).toEqual({});
  await box.fill("a".repeat(4096));
  await submit(page, form.getByRole("button", { name: "Save draft" }));
  await expect(form).toContainText("Draft saved.");
});

test("healthcare wording is flagged when a reply is saved and when it is approved", async ({ page }) => {
  const form = replyForm(page);
  await retype(form.locator("textarea"), "Thank you! We guarantee a 100% cure for every patient.");
  await submit(page, form.getByRole("button", { name: "Save draft" }));
  await expect(form).toContainText("Draft saved.");
  const warnings = form.getByRole("list", { name: "Wording to reread before posting" });
  await expect(warnings.locator("li").first()).toBeVisible();
  await submit(page, form.getByRole("button", { name: "Approve" }));
  await expect(form).toContainText("Approved and saved.");
  await expect(warnings.locator("li").first()).toBeVisible();
});

test("a reply for a review the owner cannot see is refused", async ({ page, account }) => {
  const form = replyForm(page);
  await retype(form.locator("textarea"), "A reply to someone else's review.");
  // Changed just before sending (React would reset it on the next render), as a hand-made request would.
  await form.locator('input[name="reviewId"]').evaluate((e) => ((e as HTMLInputElement).value = "accounts/1/locations/2/reviews/not-yours"));
  await submit(page, form.getByRole("button", { name: "Save draft" }));
  await expect(form.locator('p[role="alert"]')).toHaveText("That review could not be found. Reload the page and try again.");
  expect(account.data().replies ?? {}).toEqual({});
});

test("drafts are limited to 30 per hour per account", async ({ page }) => {
  await mockAI("named");
  const form = replyForm(page);
  for (let i = 1; i <= 30; i++) {
    await submit(page, form.getByRole("button", { name: "Draft with Claude" }));
    await expect(form.locator('p[role="alert"]'), `draft ${i}`).toHaveCount(0);
  }
  await submit(page, form.getByRole("button", { name: "Draft with Claude" }));
  await expect(form.locator('p[role="alert"]')).toContainText("Too many drafts");
});
