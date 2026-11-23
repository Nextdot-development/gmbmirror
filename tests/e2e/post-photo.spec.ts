import { connectGoogle, expect, GBP_URL, gbpCalls, gbpMode, mockAI, setGoogleListing, submit, test } from "./support/fixtures";

// Posts with a photo: the link is checked, saved with the post, and sent to Google as the post's media.
test.use({ baseURL: GBP_URL });
test.beforeEach(async () => {
  await gbpMode({ reset: true });
  await mockAI("named");
});

test("a post with a photo link is published with the photo; local or non-https links are refused", async ({ page, account }) => {
  await setGoogleListing(page, "ChIJtestPlace123");
  await connectGoogle(page);
  await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
  expect(account.email).toContain("@");
  await page.goto("/app/posts");
  await page.locator("#p-text").fill("New treatment room opened this week.");
  for (const bad of ["http://example.test/a.jpg", "https://localhost/a.jpg", "https://192.168.1.5/a.jpg"]) {
    await page.getByLabel("Photo link (optional)").fill(bad);
    await submit(page, "Save as draft");
    await expect(page.locator("main")).toContainText(/must start with https:\/\/|public link to the photo/);
  }
  await page.getByLabel("Photo link (optional)").fill("https://images.example.test/room.jpg");
  await submit(page, "Save as draft");
  const card = page.locator("main section[aria-labelledby=drafts] ul > li").filter({ hasText: "New treatment room" });
  await expect(card.getByTestId("post-photo")).toContainText("https://images.example.test/room.jpg");
  await submit(page, card.getByRole("button", { name: "Approve" }));
  await submit(page, page.locator("main ul > li").filter({ hasText: "New treatment room" }).getByRole("button", { name: "Publish to Google" }));
  await expect(page.locator("main ul > li").filter({ hasText: "New treatment room" }).locator(".badge")).toContainText(["Posted"]);
  const sent = (await gbpCalls()).calls.filter((c) => c.method === "POST" && c.path.endsWith("/localPosts")).at(-1)!;
  expect(JSON.parse(sent.body).media).toEqual([{ mediaFormat: "PHOTO", sourceUrl: "https://images.example.test/room.jpg" }]);
});
