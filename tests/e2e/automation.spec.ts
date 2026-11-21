import type { Page } from "@playwright/test";
import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, localInput, mockAI, readData, retype, runJobs, setGoogleListing, submit, test } from "./support/fixtures";

// Background automation against the Business Profile stand-in: scheduled publishing (waiting, retry, duplicate
// protection, cancellation), review automation (approval, automatic with opt-in, pause), monthly reports with PDF,
// performance insights, and the profile score. Jobs run only when a test calls the runner endpoint.

test.use({ baseURL: GBP_URL });
test.beforeEach(async () => {
  await gbpMode({ reset: true });
  await mockAI("named");
});

const HOUR = 3600_000;
const postCount = async () => (await gbpCalls()).calls.filter((c) => c.method === "POST" && c.path.endsWith("/localPosts")).length;
const puts = async () => (await gbpCalls()).calls.filter((c) => c.method === "PUT").map((c) => c.path);

async function connect(page: Page) {
  await setGoogleListing(page, "ChIJtestPlace123");
  await connectGoogle(page);
  await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
}

/** Creates and approves a post scheduled for `at`. Returns its card. */
async function scheduledPost(page: Page, text: string, at: Date) {
  await page.goto("/app/posts");
  await page.locator("#p-text").fill(text);
  await page.locator("#f-scheduledFor").fill(localInput(at));
  await submit(page, "Save as draft");
  const card = page.locator("main section[aria-labelledby=drafts] ul > li").filter({ hasText: text });
  await submit(page, card.getByRole("button", { name: "Approve" }));
  await expect(card.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "queued");
  return card;
}

test("scheduled post: waits while Google is not connected, publishes once at its time after connecting, never twice", async ({ page, account }) => {
  const at = new Date(Date.now() + 2 * 24 * HOUR);
  at.setSeconds(0, 0);
  const card = await scheduledPost(page, "Free skin check camp this Saturday, 10 am to 1 pm.", at);
  await expect(card.getByTestId("schedule-status")).toContainText("Scheduled to publish");
  await expect(page.getByTestId("content-calendar")).toBeVisible();

  // Before its time: nothing runs.
  await runJobs(page, new Date(at.getTime() - 60_000));
  await page.reload();
  await expect(card.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "queued");

  // At its time, without Google: waiting, and not marked published.
  await runJobs(page, new Date(at.getTime() + 60_000));
  await page.reload();
  await expect(card.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "waiting");
  await expect(card.getByTestId("schedule-status")).toContainText("Waiting: Publishing turns on after you connect Google");
  expect(account.data().posts[0].status).toBe("approved");

  // Connected later: the next run publishes it, and Google's answer is recorded.
  await connect(page);
  await runJobs(page, new Date(at.getTime() + 2 * HOUR));
  await page.goto("/app/posts");
  await expect(card.locator(".badge")).toContainText(["Posted"]);
  await expect(card.getByTestId("schedule-status")).toContainText("Published by the schedule.");
  expect(await postCount()).toBe(1);
  await card.getByText("Publishing log").click();
  await expect(card).toContainText("Published to Google (LIVE).");

  // Runs later never publish it again.
  await runJobs(page, new Date(at.getTime() + 5 * HOUR));
  expect(await postCount()).toBe(1);
  const log = readData()[account.id].automation_log as { action: string }[];
  expect(log.some((e) => e.action === "Scheduled post published")).toBe(true);
});

test("scheduled post: a Google outage is retried with back-off; editing a scheduled post cancels its publication", async ({ page, account }) => {
  await connect(page);
  const at = new Date(Date.now() + 3 * 24 * HOUR);
  at.setSeconds(0, 0);
  const card = await scheduledPost(page, "Our clinic is open on Sunday this week.", at);
  await gbpMode({ fail: "unavailable", failPath: "/localPosts", failMethod: "POST" });
  await runJobs(page, new Date(at.getTime() + 60_000));
  await page.reload();
  await expect(card.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "queued");
  await expect(card.getByTestId("schedule-status")).toContainText("(attempt 2)");
  await expect(card.getByRole("alert")).toContainText("Google is not responding right now.");
  expect(account.data().posts[0].status).toBe("approved"); // not marked published
  // Not before the back-off: 5 minutes.
  await gbpMode({ fail: "" });
  await runJobs(page, new Date(at.getTime() + 2 * 60_000));
  expect(await postCount()).toBe(1); // only the failed attempt
  await runJobs(page, new Date(at.getTime() + 7 * 60_000));
  await page.reload();
  await expect(card.locator(".badge")).toContainText(["Posted"]);
  expect(await postCount()).toBe(2);

  // A second post, edited after it was scheduled: its queued publication is cancelled and nothing is sent.
  const later = new Date(at.getTime() + 24 * HOUR);
  const second = await scheduledPost(page, "Monsoon skin care talk on Friday evening", later);
  await second.getByText("Edit", { exact: true }).click();
  await second.locator("textarea").fill("Monsoon skin care talk on Friday evening, 6 pm.");
  await submit(page, second.getByRole("button", { name: "Save changes" }));
  await page.reload();
  await expect(second.getByTestId("schedule-status")).toHaveAttribute("data-job-status", "cancelled");
  await runJobs(page, new Date(later.getTime() + 60_000));
  expect(await postCount()).toBe(2);
});

test("a schedule in the past is refused, and the time zone decides the moment", async ({ page, account }) => {
  await page.goto("/app/posts");
  await page.locator("#p-text").fill("A post with an old time on it.");
  await page.locator("#f-scheduledFor").fill(localInput(new Date(Date.now() - HOUR)));
  await submit(page, "Save as draft");
  await expect(page.locator("main")).toContainText("Choose a time in the future for the schedule.");
  const at = new Date(Date.now() + 26 * HOUR);
  at.setSeconds(0, 0);
  await page.locator("#f-scheduledFor").fill(localInput(at));
  await submit(page, "Save as draft");
  expect(account.data().posts[0].scheduledAt).toBe(at.toISOString());
});

test("review automation, approval mode: drafts for new reviews, nothing published, every action logged", async ({ page, account }) => {
  await connect(page);
  await page.goto("/app/settings#automation");
  await page.getByLabel(/Approval required/).check();
  await submit(page, "Save automation");
  await expect(page.locator("main")).toContainText("New reviews get a draft reply for you to approve.");
  await runJobs(page);
  const replies = account.data().replies as Record<string, { status: string; byAutomation?: boolean }>;
  const drafted = Object.entries(replies).filter(([, r]) => r.byAutomation);
  expect(drafted).toHaveLength(5);
  expect(drafted.every(([, r]) => r.status === "draft")).toBe(true);
  expect(await puts()).toEqual([]);
  await page.goto("/app/reviews");
  await expect(page.getByTestId("automation-panel")).toContainText("Reply automation: drafts for approval");
  await expect(page.locator("li[data-review$='/reviews/r01']")).toContainText("Drafted automatically. Nothing is published until you approve it.");
  await page.getByText(/^Automation log/).click();
  await expect(page.getByTestId("automation-panel")).toContainText("Reply drafted for approval");
});

test("review automation, automatic: needs opt-in; only safe 5-star replies are published; others held; pause stops it", async ({ page, account }) => {
  await connect(page);
  await page.goto("/app/settings#automation");
  await page.getByLabel(/^Automatic/).check();
  await submit(page, "Save automation");
  await expect(page.locator("main")).toContainText("Tick the box to confirm");
  expect(account.data().business.automation?.replies ?? "manual").toBe("manual");
  await page.getByLabel(/^Automatic/).check();
  await page.getByLabel(/may be published to Google without me reading them first/).check();
  await submit(page, "Save automation");
  await expect(page.locator("main")).toContainText("Eligible replies will be published automatically");

  await runJobs(page);
  // The five newest unreplied reviews: r01 (5), r02 (4), r04 (5), r05 (3), r07 (4). 5-star only: r01 and r04.
  expect((await puts()).sort()).toEqual(["/v4/v4/accounts/100/locations/1001/reviews/r01/reply", "/v4/v4/accounts/100/locations/1001/reviews/r04/reply"]);
  const r = account.data().replies;
  expect(r["accounts/100/locations/1001/reviews/r01"].status).toBe("posted");
  expect(r["accounts/100/locations/1001/reviews/r01"].history[0].action).toBe("auto_published");
  expect(r["accounts/100/locations/1001/reviews/r02"].status).toBe("draft"); // 4 stars: held
  expect(r["accounts/100/locations/1001/reviews/r05"].holdReasons.length).toBeGreaterThan(0);
  const log = account.data().automation_log as { action: string; result: string }[];
  expect(log.filter((e) => e.action === "Reply published automatically")).toHaveLength(2);
  expect(log.filter((e) => e.action === "Reply held for approval")).toHaveLength(3);

  // Pause from the Reviews page: the next run does nothing.
  await page.goto("/app/reviews");
  await submit(page, page.getByRole("button", { name: "Pause automation" }));
  await expect(page.getByTestId("automation-panel")).toContainText("paused");
  await runJobs(page, new Date(Date.now() + 2 * HOUR));
  expect(await puts()).toHaveLength(2);
  expect(Object.keys(account.data().replies)).toHaveLength(5);
});

test("automatic mode is refused without a Google connection", async ({ page, account }) => {
  await page.goto("/app/settings#automation");
  await expect(page.getByLabel(/^Automatic/)).toBeDisabled();
  await expect(page.locator("#automation")).toContainText("Needs a connected Google Business Profile.");
});

test("monthly report: made on request from stored data, missing data marked, Claude summary, PDF download", async ({ page, account }) => {
  await connect(page);
  await page.goto("/app/reports");
  await submit(page, "Create this month's report now");
  await expect(page.locator("main")).toContainText("Report created.");
  const report = page.locator("main ul[aria-label='Report history'] > li").first();
  await expect(report).toContainText("(month to date)");
  await expect(report).toContainText("Summary written by Claude from the facts below.");
  await expect(report.getByLabel("Competitors")).toContainText("Not available: No competitor comparison was run this month.");
  await expect(report.getByLabel("Reviews and replies")).toContainText("Google reviews: 60.");
  await expect(report.getByLabel("Google performance")).toContainText("Profile views:");
  const href = await report.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  // Another user cannot fetch it.
  const other = await page.context().browser()!.newContext({ baseURL: GBP_URL });
  expect((await other.request.get(href!, { maxRedirects: 0 })).status()).not.toBe(200);
  await other.close();
  // The scheduler plans next month's report.
  await runJobs(page);
  await page.reload();
  await expect(page.getByTestId("report-schedule")).toContainText("Next report:");
  expect(account.data().reports).toHaveLength(1);
});

test("insights: a metric Google does not report is shown as unknown, monthly totals, and an explanation on request", async ({ page, account }) => {
  await connect(page);
  await expect(page.locator("[data-metric=bookings]")).toHaveAttribute("data-reported", "no");
  await expect(page.locator("[data-metric=bookings]")).toContainText("Not reported by Google");
  await expect(page.locator("[data-metric=messages]")).toContainText("0"); // reported, and zero
  await expect(page.getByRole("table", { name: "Monthly totals" }).locator("tbody tr")).toHaveCount(6);
  await submit(page, "Explain these numbers");
  await expect(page.getByTestId("insights-explanation")).toContainText("Written by Claude from the numbers above.");
  const usage = readData()[account.id].ai_usage as Record<string, { calls: number; byFeature: Record<string, number> }>;
  const month = Object.values(usage)[0];
  expect(month.byFeature.insights_explanation).toBe(1);
  expect(month.calls).toBeGreaterThan(0);
});

test("Business Profile score: points per item, what was lost and how to fix it", async ({ page, account }) => {
  await connect(page);
  const score = page.getByTestId("profile-score");
  await expect(score).toContainText("Business Profile score");
  await expect(score.locator("[data-item=description]")).toContainText("3 / 15");
  await expect(score.getByRole("list", { name: "How to raise the score" })).toContainText("Business description: 12 points to gain");
  await expect(score.getByRole("list", { name: "How to raise the score" })).toContainText("Write 250 to 750 characters");
  const hist = readData()[account.id].gbp_scores as { location: string }[];
  expect(hist[0].location).toBe("locations/1001");
});

test("reply automation is per location and the owner's own drafts are never replaced", async ({ page, account }) => {
  await connect(page);
  await page.goto("/app/reviews");
  const own = page.locator("li[data-review$='/reviews/r01']");
  await retype(own.locator("textarea"), "My own words for Asha.");
  await submit(page, own.getByRole("button", { name: "Save draft" }));
  await page.goto("/app/settings#automation");
  await page.getByLabel(/Approval required/).check();
  await submit(page, "Save automation");
  await runJobs(page);
  expect(account.data().replies["accounts/100/locations/1001/reviews/r01"].text).toBe("My own words for Asha.");
});
