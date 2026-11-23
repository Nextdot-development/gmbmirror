import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, mockAI, setGoogleListing, sideways, submit, test } from "./support/fixtures";

// Google Business Profile integration, end to end in the browser, against the local stand-in for Google's OAuth and
// Business Profile APIs (tests/e2e/support/server.mjs). This server has GBP_API_APPROVED=true. No real Google
// account is used and nothing reaches Google: these tests prove the app's side of every flow, not Google's.

test.use({ baseURL: GBP_URL });
test.beforeEach(async () => gbpMode({ reset: true }));

const status = (page: import("@playwright/test").Page) => page.getByTestId("gbp-status");
const card = (page: import("@playwright/test").Page, review: string) => page.locator(`li[data-review$="/reviews/${review}"]`);

/** Connects and lets the app choose the location whose Place ID is the Settings listing (Saheed Nagar, locations/1001). */
async function connectedToSaheedNagar(page: import("@playwright/test").Page) {
  await setGoogleListing(page, "ChIJtestPlace123");
  await connectGoogle(page);
  await expect(page).toHaveURL(/\/app\/google-profile\?connected=1$/);
  await expect(status(page)).toHaveText("Connected");
}

test("account and location discovery: every account and page, shared locations once, the owner chooses", async ({ page, account }) => {
  await connectGoogle(page);
  await expect(page.getByRole("status").first()).toHaveText("Google account connected.");
  await expect(status(page)).toHaveText("Choose a location");
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(4); // 1001 is under both accounts and listed once
  await expect(page.locator("fieldset")).toContainText("Business locations on your Google account (4)");
  await expect(page.locator("fieldset")).toContainText("Plot 12, Saheed Nagar, Bhubaneswar, 751007");
  const { calls } = await gbpCalls();
  expect(calls.some((c) => c.path === "/accounts/v1/accounts" && c.query.includes("pageToken=acc-p2"))).toBe(true);
  expect(calls.some((c) => c.path === "/info/v1/accounts/100/locations" && c.query.includes("pageToken=loc-p2"))).toBe(true);
  expect(calls.some((c) => c.path === "/info/v1/accounts/200/locations")).toBe(true);

  await page.getByRole("radio", { name: /Zentrix Skin Clinic, Patia/ }).check();
  await submit(page, "Use this location");
  await page.reload();
  await expect(status(page)).toHaveText("Connected");
  await expect(page.locator("main")).toContainText("Managing: Zentrix Skin Clinic, Patia, KIIT Road, Patia, 751024.");
  const g = account.data().google;
  expect([g.accountName, g.locationName, g.locationPlaceId]).toEqual(["accounts/100", "locations/1002", "ChIJe2eZentrixPatia1"]);
  expect(g.tokens).not.toMatch(/at-\d|rt-e2e/); // stored encrypted

  // The profile as Google has it, with its gaps in plain words.
  const profile = page.locator("section", { has: page.locator("#bp-h") });
  await expect(profile).toContainText("Not verified on Google");
  await expect(profile).toContainText("No phone number. Customers cannot call from Google.");
  await expect(profile).toContainText("No opening hours.");

  // Changing location lists them again; the list is not fetched on every visit.
  await page.getByRole("link", { name: "Change location" }).click();
  await expect(page.getByRole("radio", { name: /Patia/ })).toBeChecked();
});

test("the location matching the Settings listing is chosen automatically; switching location moves the listing with it", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  await expect(page.locator("main")).toContainText("This location is the same Google listing as in Settings.");
  await expect(page.locator("section", { has: page.locator("#bp-h") })).toContainText("Verified on Google");
  await page.goto("/app/google-profile?change=1");
  await page.getByRole("radio", { name: /Glow Salon/ }).check();
  await submit(page, "Use this location");
  // The managed location is the owner's listing: the public listing follows it, and old history stays with the old one.
  await expect.poll(() => account.data().business.placeId).toBe("ChIJe2eSalon0000001");
  await page.goto("/app/google-profile");
  await expect(page.getByTestId("listing-mismatch")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("This location is the same Google listing as in Settings.");
  await page.goto("/app");
  await expect(page.locator("header .badge")).toHaveText("Google connected");
});

test("reviews: Google's totals, waiting and replied filters, and paging through older reviews", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  await page.goto("/app/reviews");
  await expect(page.locator("main")).not.toContainText("Sample data");
  const summary = page.locator("section", { has: page.locator("#rv-sum") });
  await expect(summary).toContainText("Google rating4.2");
  await expect(summary).toContainText("Total reviews60");
  await expect(page.getByTestId("waiting-count")).toHaveText("34");
  await expect(page.getByTestId("replied-count")).toHaveText("16");
  await expect(page.locator('ul[aria-label="Reviews"] > li')).toHaveCount(34);
  await page.getByRole("link", { name: "Replied (16)" }).click();
  await expect(page.locator('ul[aria-label="Reviews"] > li')).toHaveCount(16);
  await expect(card(page, "r03")).toContainText("Your reply on Google");
  await expect(card(page, "r03")).toContainText("Thank you, Sunita.");

  await page.getByRole("link", { name: "Older reviews" }).click();
  await expect(page).toHaveURL(/show=replied&page=rev-p2/);
  await expect(page.getByTestId("waiting-count")).toHaveText("6");
  await expect(page.locator('ul[aria-label="Reviews"] > li')).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Older reviews" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to newest" }).click();
  await expect(page.getByTestId("waiting-count")).toHaveText("34");
  await expect(page.locator("main")).toContainText("Google Business Profile, last synced");
});

test("reply workflow: draft with Claude, approve, edits need approving again, publish sends exactly the approved text", async ({ page, account }) => {
  await mockAI("named");
  await connectedToSaheedNagar(page);
  await page.goto("/app/reviews");
  const r = card(page, "r01");
  const box = r.locator("textarea");
  await expect(r.getByRole("button", { name: "Publish reply to Google" })).toHaveCount(0);

  await submit(page, r.getByRole("button", { name: "Draft with Claude" }));
  await expect(box).not.toHaveValue("");
  await box.fill("Thank you, Asha. We are glad the care was good.");
  await submit(page, r.getByRole("button", { name: "Approve" }));
  await expect(r).toContainText("Approved. Check it once more, then publish it to Google.");
  const publish = r.getByRole("button", { name: "Publish reply to Google" });
  await expect(publish).toBeVisible();

  await box.fill("Thank you, Asha. We are glad the care was good!");
  await expect(publish).toHaveCount(0);
  await expect(r).toContainText("Approve it again before publishing.");
  await submit(page, r.getByRole("button", { name: "Approve" }));
  expect((await gbpCalls()).calls.filter((c) => c.method === "PUT")).toHaveLength(0); // approving never publishes

  await submit(page, publish);
  await expect(r).toContainText("Published to Google.");
  const puts = (await gbpCalls()).calls.filter((c) => c.method === "PUT");
  expect(puts).toHaveLength(1);
  expect(puts[0].path).toBe("/v4/v4/accounts/100/locations/1001/reviews/r01/reply");
  expect(JSON.parse(puts[0].body)).toEqual({ comment: "Thank you, Asha. We are glad the care was good!" });
  expect(account.data().replies["accounts/100/locations/1001/reviews/r01"].status).toBe("posted");

  await page.goto("/app/reviews?show=replied");
  await expect(card(page, "r01")).toContainText("Thank you, Asha. We are glad the care was good!");
  await expect(page.getByTestId("waiting-count")).toHaveText("33");
});

test("an existing reply can be edited and republished; Google's moderation state is shown", async ({ page, account }) => {
  await gbpMode({ replyState: "PENDING" });
  await connectedToSaheedNagar(page);
  await page.goto("/app/reviews?show=replied");
  const r = card(page, "r03");
  await r.getByText("Edit reply").click();
  await r.locator("textarea").fill("Thank you, Sunita. We have added parking help at the front desk.");
  // A 2-star review: the owner confirms they have read the reply before approving it.
  await r.getByLabel("I have read this reply and it is right for this review.").check();
  await submit(page, r.getByRole("button", { name: "Approve" }));
  await submit(page, r.getByRole("button", { name: "Publish reply to Google" }));
  await expect(r).toContainText("Google is checking it before it appears.");
  await page.reload();
  await expect(card(page, "r03")).toContainText("We have added parking help");
  await expect(card(page, "r03")).toContainText("Google is checking the reply");
});

test("a reply for a review outside the selected location is refused", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  await page.goto("/app/reviews");
  const r = card(page, "r01");
  const idField = r.locator('input[name="reviewId"]');
  // Wait for React to hydrate the field, or hydration would put the real id back.
  await expect.poll(() => idField.evaluate((e) => Object.keys(e).some((k) => k.startsWith("__reactFiber")))).toBe(true);
  await r.locator("textarea").fill("Hello");
  // Set last: React puts a controlled field's value back whenever the form re-renders (typing does that).
  await idField.evaluate((e: HTMLInputElement) => (e.value = "accounts/200/locations/2001/reviews/r01"));
  await submit(page, r.getByRole("button", { name: "Approve" }));
  await expect(r.getByRole("alert")).toHaveText("That review does not belong to your selected location.");
  expect((await gbpCalls()).calls.some((c) => c.path.includes("/locations/2001/reviews"))).toBe(false);
});

test("posts: publish an update and an event, see Google's state, edit a published post and publish the change", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  await page.goto("/app/posts");
  await page.locator("#p-text").fill("Free skin check camp this Saturday at Saheed Nagar.");
  await submit(page, "Save as draft");
  const post = page.locator("main ul > li").first();
  await submit(page, post.getByRole("button", { name: "Approve" }));
  await submit(page, post.getByRole("button", { name: "Publish to Google" }));
  await expect(post.locator(".badge")).toContainText(["Update", "Posted", "Live on Google"]);
  await expect(post.getByRole("link", { name: "View on Google" })).toHaveAttribute("href", /^https:\/\/local\.google\.com\/place\?lpsid=1$/);
  let g = await gbpCalls();
  expect(g.posts).toHaveLength(1);
  expect(g.posts[0]).toMatchObject({ topicType: "STANDARD", summary: "Free skin check camp this Saturday at Saheed Nagar.", languageCode: "en" });

  // Edit the published post: it becomes a draft again, needs approval, then Google gets a PATCH with a mask.
  await post.getByText("Edit", { exact: true }).click();
  await post.locator("textarea").fill("Free skin check camp this Saturday, 10 am to 1 pm, at Saheed Nagar.");
  await submit(page, post.getByRole("button", { name: "Save changes" }));
  await expect(post).toContainText("Changes saved. Approve them, then publish the changes to Google.");
  await page.reload();
  await expect(post.locator(".badge")).toContainText(["Draft", "Published; changes not published yet"]);
  await expect(post.getByRole("button", { name: /Publish/ })).toHaveCount(0);
  await submit(page, post.getByRole("button", { name: "Approve" }));
  await submit(page, post.getByRole("button", { name: "Publish changes to Google" }));
  await expect(post.locator(".badge")).toContainText(["Posted", "Google is processing it"]);
  g = await gbpCalls();
  const patch = g.calls.find((c) => c.method === "PATCH")!;
  expect(patch.path).toBe("/v4/v4/accounts/100/locations/1001/localPosts/1");
  expect(new URLSearchParams(patch.query).get("updateMask")).toBe("summary");
  expect(g.posts).toHaveLength(1);
  expect(g.posts[0].summary).toContain("10 am to 1 pm");

  // An event post carries Google's event schedule.
  await page.locator("#f-kind").selectOption("EVENT");
  await page.locator("#p-text").fill("Join our monsoon skin care talk.");
  await page.locator("#f-eventTitle").fill("Monsoon skin care talk");
  await page.locator("#f-eventStart").fill("2026-12-05T10:00");
  await page.locator("#f-eventEnd").fill("2026-12-05T12:30");
  await submit(page, "Save as draft");
  const ev = page.locator("main ul > li").first();
  await submit(page, ev.getByRole("button", { name: "Approve" }));
  await submit(page, ev.getByRole("button", { name: "Publish to Google" }));
  await expect(ev.locator(".badge")).toContainText(["Event", "Posted"]);
  const created = (await gbpCalls()).posts[1];
  expect(created.event).toEqual({ title: "Monsoon skin care talk", schedule: {
    startDate: { year: 2026, month: 12, day: 5 }, startTime: { hours: 10, minutes: 0, seconds: 0, nanos: 0 },
    endDate: { year: 2026, month: 12, day: 5 }, endTime: { hours: 12, minutes: 30, seconds: 0, nanos: 0 } } });
});

test("performance insights: 28-day totals, change against the 28 days before, and a manual update", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  const metric = (k: string) => page.locator(`[data-metric="${k}"]`);
  await expect(metric("searchViews")).toContainText("168");
  await expect(metric("searchViews")).toContainText("▲ 100%");
  await expect(metric("mapsViews")).toContainText("112");
  await expect(metric("calls")).toContainText("28");
  await expect(metric("calls")).toContainText("▲ up from 0");
  await expect(metric("messages")).toContainText("0");
  await expect(metric("messages")).toContainText("No change");
  await expect(page.getByTestId("gbp-last-sync")).toContainText("insights");
  // One refresh is two requests: the 28-day comparison and the monthly trend.
  const perfCalls = async () => (await gbpCalls()).calls.filter((c) => c.path.includes(":fetchMultiDailyMetricsTimeSeries")).length;
  const before = await perfCalls();
  expect(before).toBe(2);
  const q = new URLSearchParams((await gbpCalls()).calls.find((c) => c.path.includes(":fetchMultiDailyMetricsTimeSeries"))!.query);
  expect(q.getAll("dailyMetrics")).toEqual(expect.arrayContaining(["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"]));
  await page.reload();
  expect(await perfCalls()).toBe(before); // kept, not refetched on every visit
  await submit(page, "Update from Google");
  await expect(page.locator("main")).toContainText("Insights updated from Google.");
  expect(await perfCalls()).toBe(before + 2);
});

test("token expiry: an expired access token is refreshed without the owner noticing, and the new one is stored", async ({ page, account }) => {
  await gbpMode({ expiresIn: 0 }); // the first access token is already expired
  await connectedToSaheedNagar(page);
  await page.goto("/app/reviews");
  await expect(page.getByTestId("waiting-count")).toHaveText("34");
  expect((await gbpCalls()).refreshes).toBe(1);
  await page.goto("/app/posts");
  await page.goto("/app/reviews");
  expect((await gbpCalls()).refreshes).toBe(1); // the refreshed token is saved and reused
});

test("refresh refused: the app asks to reconnect, shows samples, and reconnecting restores the location", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  const d = account.data().google;
  // Signing in again with the same account keeps the location. Its first access token is already expired and
  // Google now refuses the refresh token (revoked, or the password changed), so the next Google call fails.
  await gbpMode({ refresh: "invalid_grant", expiresIn: 0 });
  await connectGoogle(page);
  await expect(status(page)).toHaveText("Reconnect needed");
  await expect(page.getByRole("alert").filter({ hasText: "expired or was removed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconnect Google" })).toHaveAttribute("href", "/api/google/start");
  expect(account.data().google.needsReconnect).toBe(true);
  expect(account.data().google.locationName).toBe(d.locationName);
  await page.goto("/app/reviews");
  await expect(page.locator("main")).toContainText("Sample data");
  await expect(page.locator("main")).toContainText("Reconnect Google on the Google profile page");
  await page.goto("/app");
  await expect(page.locator("header .badge")).toHaveText("Google: reconnect needed");

  await gbpMode({ refresh: "ok", expiresIn: 3600 });
  await connectGoogle(page);
  await expect(status(page)).toHaveText("Connected");
  expect(account.data().google.needsReconnect).toBeUndefined();
  expect(account.data().google.locationName).toBe("locations/1001");
});

test("Google errors: permission, quota, API off and outage each get a plain message; nothing is lost", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  await gbpMode({ fail: "permission", failPath: "/reviews" });
  await page.goto("/app/reviews");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Your Google account does not have permission for this business location. Sign in with an account that owns or manages it.");
  await page.goto("/app/google-profile");
  await expect(page.getByTestId("gbp-last-error")).toContainText("Last problem (reviews");

  await gbpMode({ fail: "quota", failPath: "/reviews" });
  await page.goto("/app/reviews");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Google is limiting requests right now. Try again in a minute.");

  // The profile is kept for a few hours, so Google is asked again with "Refresh from Google".
  await gbpMode({ fail: "disabled", failPath: "/info/v1/locations/" });
  await page.goto("/app/settings");
  await submit(page, "Refresh from Google");
  await expect(page.getByTestId("from-google").getByRole("alert")).toHaveText("This Google feature is not available right now. Please try again later.");
  await expect(page.locator("main")).not.toContainText(/\.env|GOOGLE_CLIENT|SERVICE_DISABLED/);

  await gbpMode({ fail: "unavailable", failPath: "/localPosts", failMethod: "POST" });
  await page.goto("/app/posts");
  await page.locator("#p-text").fill("Our clinic is open on Sunday this week.");
  await submit(page, "Save as draft");
  const post = page.locator("main ul > li").first();
  await submit(page, post.getByRole("button", { name: "Approve" }));
  await submit(page, post.getByRole("button", { name: "Publish to Google" }));
  await expect(post.getByRole("alert")).toHaveText("Not published: Google is not responding right now. Try again in a few minutes.");
  await expect(post.locator(".badge")).toContainText(["Approved"]);
  expect((await gbpCalls()).calls.filter((c) => c.method === "POST" && c.path.endsWith("/localPosts"))).toHaveLength(1); // writes are not retried

  await gbpMode({ fail: "scope", failPath: "/reviews", failMethod: "" });
  await page.goto("/app/reviews");
  await page.goto("/app/google-profile");
  await expect(status(page)).toHaveText("Reconnect needed");
});

test("sign-in without the Business Profile permission connects nothing and cancels the partial grant", async ({ page, account }) => {
  await connectGoogle(page, "e2e-noscope");
  await expect(page).toHaveURL(/error=scope$/);
  await expect(page.locator('p[role="alert"]').first()).toContainText("Google did not give permission to manage your Business Profile");
  expect(account.data().google).toBeUndefined();
  expect((await gbpCalls()).revoked).toBe(1);
});

test("the sign-in must be finished by the user who started it, with the PKCE cookie", async ({ page, account }) => {
  const start = await page.request.get("/api/google/start", { maxRedirects: 0 });
  const state = new URL(start.headers().location).searchParams.get("state");
  expect(new URL(start.headers().location).searchParams.get("code_challenge_method")).toBe("S256");
  await page.context().clearCookies({ name: "g_pkce" });
  const back = await page.request.get(`/api/google/callback?code=e2e-good&state=${state}`, { maxRedirects: 0 });
  expect(back.headers().location).toMatch(/\/app\/google-profile\?error=state$/);
  expect((await gbpCalls()).calls.some((c) => c.path === "/oauth/token")).toBe(false);
  expect(account.data().google).toBeUndefined();
});

test("a different Google account does not inherit the location; disconnect revokes and deletes the tokens", async ({ page, account }) => {
  // No Settings listing here, so nothing is chosen automatically: the owner picks Patia by hand.
  await connectGoogle(page);
  await page.getByRole("radio", { name: /Zentrix Skin Clinic, Patia/ }).check();
  await submit(page, "Use this location");
  await expect.poll(() => account.data().google.locationName).toBe("locations/1002");
  const accountCalls = async () => (await gbpCalls()).calls.filter((c) => c.path === "/accounts/v1/accounts").length;
  const before = await accountCalls();
  await connectGoogle(page, "e2e-good-other");
  await expect(page.locator("main")).toContainText("Connected as other-owner@example.test");
  // The old account's location is not carried over: the new account's locations are discovered, and the one with
  // the business's listing (Patia, chosen above) is picked from them.
  expect(await accountCalls()).toBeGreaterThan(before);
  await expect(status(page)).toHaveText("Connected");
  expect(account.data().google).toMatchObject({ email: "other-owner@example.test", locationName: "locations/1002" });
  await submit(page, "Disconnect and delete stored tokens");
  await expect(page.getByRole("status")).toHaveText("Disconnected. Google confirmed this app no longer has access, and the stored tokens were deleted.");
  expect((await gbpCalls()).revoked).toBeGreaterThanOrEqual(1);
  expect(account.data().google).toBeUndefined();
  await expect(status(page)).toHaveText("Not connected");
});

test("live Google pages fit the screen", async ({ page, account }) => {
  await connectedToSaheedNagar(page);
  for (const path of ["/app/google-profile", "/app/google-profile?change=1", "/app/reviews", "/app/reviews?show=replied", "/app/posts"]) {
    await page.goto(path);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});
