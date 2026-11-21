import { aiCalls, expect, mockAI, retype, submit, test } from "./support/fixtures";

// Phase 1 features: business aliases, custom AI visibility questions, visibility score and trend, possible match.

test("aliases and custom questions: limits enforced, values persist", async ({ page, account }) => {
  await page.goto("/app/settings");
  const aliases = page.locator("#f-aliases");
  const questions = page.locator("#f-customQuestions");

  await retype(aliases, "a\nb\nc\nd\ne\nf");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("Add at most 5 other names");

  await retype(aliases, "Dr Rao Skin Care\nZentrix Clinic");
  await retype(questions, "Where can I get a skin allergy test in Bhubaneswar?\nWho treats hair fall in Bhubaneswar?");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("AI preferences saved");

  await page.reload();
  await expect(aliases).toHaveValue("Dr Rao Skin Care\nZentrix Clinic");
  await expect(questions).toHaveValue("Where can I get a skin allergy test in Bhubaneswar?\nWho treats hair fall in Bhubaneswar?");

  await retype(questions, "q1 long enough\nq2 long enough\nq3 long enough\nq4 long enough");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("Add at most 3 questions");
  await page.reload();
  await expect(questions).toHaveValue("Where can I get a skin allergy test in Bhubaneswar?\nWho treats hair fall in Bhubaneswar?");
  expect(account.data().business.aliases).toEqual(["Dr Rao Skin Care", "Zentrix Clinic"]);
});

test("visibility: custom questions asked, alias counts, possible match not counted, score and trend", async ({ page, account }) => {
  await page.goto("/app/settings");
  await retype(page.locator("#f-aliases"), "Dr Rao Skin Care\nZentrix Clinic");
  await retype(page.locator("#f-customQuestions"), "Where can I get a skin allergy test in Bhubaneswar?\nWho treats hair fall in Bhubaneswar?");
  await submit(page, "Save AI preferences");
  await expect(page.locator("main")).toContainText("AI preferences saved");

  await page.goto("/app/visibility");
  const main = page.locator("main");
  const questions = await page.locator("details ul li").allTextContents();
  expect(questions).toHaveLength(4);
  expect(questions.some((q) => q.startsWith("Which are the best clinics in Bhubaneswar"))).toBe(true);
  expect(questions.some((q) => q.includes("skin allergy test"))).toBe(true);
  await expect(main).toContainText("(also: Dr Rao Skin Care, Zentrix Clinic)");

  // Check 1: not named.
  await mockAI("answer", "Most people go to Alpha Clinic or Beta Skin Centre.");
  await submit(page, "Run a new check");
  await expect(main).toContainText("First check");
  const asked = (await aiCalls()).filter((c) => c.system.startsWith("Answer like")).map((c) => c.user);
  expect(asked).toHaveLength(4);
  expect(asked).toContain("Who treats hair fall in Bhubaneswar?");
  let text = await main.innerText();
  expect(text).toMatch(/Visibility score\s+0\s*\/ 100/);
  expect(text.match(/Not named/g)).toHaveLength(4);
  expect(text).toContain("Businesses named instead: Alpha Clinic, Beta Dental");

  // Check 2: an alias in the answer counts as named.
  await mockAI("answer", "Many patients choose Dr Rao Skin Care near Saheed Nagar.");
  await page.goto("/app/visibility");
  await submit(page, "Run a new check");
  await expect(main).toContainText("+100 vs previous check");
  text = await main.innerText();
  expect(text).toMatch(/Visibility score\s+100\s*\/ 100/);
  expect(text).toContain("Answer excerpt: Many patients choose Dr Rao Skin Care");
  await expect(page.locator("p", { hasText: "vs previous check" }).first()).toHaveClass(/text-ok/);

  // Check 3: a close variant is a possible match, shown as written and not counted.
  await mockAI("answer", "Zentrix Skin & Hair Clinic in Patia is popular.");
  await page.goto("/app/visibility");
  await submit(page, "Run a new check");
  await expect(main).toContainText("-100 vs previous check");
  text = await main.innerText();
  expect(text.match(/Possible match/g)).toHaveLength(4);
  expect(text).toMatch(/Visibility score\s+0\s*\/ 100/);
  expect(text).toContain("plus 4 possible matches not counted");
  expect(text.match(/The answer mentions “([^”]+)”/)?.[1]).toBe("Zentrix Skin & Hair Clinic");
  expect(text).toContain("Answer excerpt: Zentrix Skin & Hair Clinic in Patia");
  expect(text).toContain("If it is you, add it under Other names in Settings");

  // AI fix list: the healthcare wording filter drops the "guaranteed results" item.
  const fixes = await page.locator("ol li").allTextContents();
  expect(fixes).toHaveLength(3);
  expect(fixes.some((f) => /guaranteed/i.test(f))).toBe(false);
  await expect(main).toContainText("AI suggestions based on this check");
  await expect(page.locator('[aria-label="Bar chart of the visibility score in each saved check"] > div')).toHaveCount(3);

  // Dashboard shows the latest score, the change since the previous check, the named count, and a matching action.
  await page.goto("/app");
  const trendCard = page.locator("section", { has: page.getByRole("heading", { name: "AI visibility score" }) });
  await expect(trendCard).toContainText("0 / 100");
  await expect(trendCard).toContainText("▼ -100 vs");
  await expect(page.getByRole("list", { name: "Measures" })).toContainText("Named in 0 of 4 AI answers");
  await expect(page.getByRole("list", { name: "Recommended actions" })).toContainText("named in 0 of 4 answers (score 0 / 100)");
  await expect(page.getByRole("list", { name: "Recent changes" })).toContainText("AI visibility score fell from 100 to 0 / 100");

  // Check 4: exact name again; the AI fix list fails, so the fixed list is shown.
  await mockAI("nofix", "Try Zentrix Skin Clinic.");
  await page.goto("/app/visibility");
  await submit(page, "Run a new check");
  await expect(main).toContainText("+100 vs previous check");
  await expect(main).toContainText("Put your business name, city, services and phone number in plain text");
  await expect(main).not.toContainText("AI suggestions based on this check");
  expect(account.data().checks).toHaveLength(4);
});

test("a check where every provider fails saves nothing and does not use up the hourly limit", async ({ page, account }) => {
  await mockAI("500");
  await page.goto("/app/visibility");
  await submit(page, "Run a new check");
  await expect(page.locator("main")).toContainText("Claude is having problems (500)");
  expect(account.data().checks ?? []).toHaveLength(0);

  await mockAI("answer", "Try Zentrix Skin Clinic.");
  for (let i = 0; i < 6; i++) {
    await page.goto("/app/visibility");
    await submit(page, "Run a new check");
    await expect(page.locator("main")).not.toContainText("Too many visibility checks");
  }
  await page.goto("/app/visibility");
  await submit(page, "Run a new check");
  await expect(page.locator("main")).toContainText("Too many visibility checks");
  expect(account.data().checks).toHaveLength(6);
});
