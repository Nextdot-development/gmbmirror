import { aiCalls, expect, mockAI, readData, retype, setGoogleListing, submit, test } from "./support/fixtures";

// Reply and post intelligence on the main test server (sample reviews, mock Claude).

const card = (page: import("@playwright/test").Page, reviewer: string) => page.locator("main ul[aria-label=Reviews] > li").filter({ hasText: reviewer });

test("replies: rewrite shorter, more professional or again; each step in the reply history", async ({ page, account }) => {
  await mockAI("named");
  await page.goto("/app/reviews");
  const r = card(page, "Rohit Nayak");
  await submit(page, r.getByRole("button", { name: "Draft with Claude" }));
  await expect(r.locator("textarea")).not.toHaveValue("");
  await submit(page, r.getByRole("button", { name: "Shorter" }));
  let last = (await aiCalls()).at(-1)!;
  expect(last.system).toContain("Rewrite the current reply shorter");
  expect(last.user).toContain("Current reply:");
  await submit(page, r.getByRole("button", { name: "More professional" }));
  expect((await aiCalls()).at(-1)!.system).toContain("more formal, professional tone");
  await page.reload();
  await r.getByText(/^Reply history/).click();
  await expect(r.getByRole("list", { name: "Reply history" }).locator("li")).toHaveCount(3);
  await expect(r.getByRole("list", { name: "Reply history" })).toContainText("Rewritten by Claude (professional)");
  last = (await aiCalls()).at(-1)!;
  expect(last.user).toContain("Rating: 5 of 5");
});

test("a negative review needs the owner's confirmation before approval", async ({ page, account }) => {
  await page.goto("/app/reviews");
  const r = card(page, "Sunita Das");
  await expect(r.getByRole("list", { name: "Needs care" })).toContainText("Negative review");
  await retype(r.locator("textarea"), "Thank you, Sunita. Please call the clinic so we can look into the delay.");
  await submit(page, r.getByRole("button", { name: "Approve" }));
  await expect(r.getByRole("alert")).toContainText("tick the box to confirm");
  expect(account.data().replies?.["sample-2"]?.status ?? "none").not.toBe("approved");
  await r.getByLabel("I have read this reply and it is right for this review.").check();
  await submit(page, r.getByRole("button", { name: "Approve" }));
  await expect(r).toContainText("Approved and saved.");
});

test("posts: three versions to choose from, a call-to-action button, and previous posts sent to avoid repeats", async ({ page, account }) => {
  await mockAI("named");
  await page.goto("/app/posts");
  await page.locator("#f-topic").fill("Monsoon skin care");
  await page.locator("#f-ctaType").selectOption("BOOK");
  await submit(page, page.getByRole("button", { name: "Draft with Claude" }));
  const versions = page.getByRole("group", { name: "Versions from Claude" });
  await expect(versions.locator(".inset")).toHaveCount(3);
  await versions.getByRole("button", { name: "Use version 2" }).click();
  await expect(page.locator("#p-text")).toHaveValue(/^Version two from mock Claude/);
  const system = (await aiCalls()).at(-1)!.system;
  expect(system).toContain('"Book" button');
  // The button needs a link.
  await submit(page, "Save as draft");
  await expect(page.locator("main")).toContainText("The button needs a link");
  await page.locator("#f-ctaUrl").fill("https://zentrix.example/book");
  await submit(page, "Save as draft");
  await expect(page.locator("main")).toContainText("Saved as a draft.");
  expect(account.data().posts[0]).toMatchObject({ callToAction: { actionType: "BOOK", url: "https://zentrix.example/book" } });
  // The next draft tells Claude about the saved post.
  await page.locator("#f-topic").fill("Weekend timings");
  await submit(page, page.getByRole("button", { name: "Draft with Claude" }));
  expect((await aiCalls()).at(-1)!.system).toContain("Recent posts (do not repeat");
});

test("review link: custom message, copy actions counted honestly", async ({ page, account, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setGoogleListing(page, "ChIJtestPlace123");
  await page.goto("/app/settings");
  await page.locator("#f-reviewMessage").fill("Hi! Thanks for choosing {name}. A review helps others: {link}");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("AI preferences saved.");
  await page.goto("/app/google");
  await expect(page.locator("p", { hasText: /^Message:/ })).toContainText("Thanks for choosing Zentrix Skin Clinic. A review helps others: https://search.google.com/local/writereview?placeid=ChIJtestPlace123");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review link copied." })).toBeVisible();
  await expect.poll(() => (Object.values(readData()[account.id].share_events ?? {})[0] as { link_copied?: number } | undefined)?.link_copied ?? 0).toBe(1);
  await page.reload();
  await expect(page.getByTestId("share-counts")).toContainText("1 link copies");
  await expect(page.getByTestId("share-counts")).toContainText("whether a customer then wrote a review is not known");
  // A message without the link is refused.
  await page.goto("/app/settings");
  await page.locator("#f-reviewMessage").fill("Please review us.");
  await submit(page, "Save AI preferences");
  await expect(page.locator("#f-reviewMessage-e")).toHaveText("Include {link} where the review link goes.");
});

test("AI visibility: a service question when services are listed; answers labelled as estimates", async ({ page, account }) => {
  await page.goto("/app/settings");
  await page.locator("#f-services").fill("Acne treatment\nHair fall consultation");
  await submit(page, "Save AI preferences");
  await page.goto("/app/visibility");
  await expect(page.locator("main")).toContainText("an estimate of how");
  const qs = await page.locator("details ul li").allTextContents();
  expect(qs.some((q) => q.startsWith("Where can I get acne treatment in Bhubaneswar?"))).toBe(true);
});
