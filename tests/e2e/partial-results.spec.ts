import { expect, mockAI, PARTIAL_URL, submit, test } from "./support/fixtures";

// Phase 1 feature: partial results. This suite runs on the second test server, where ChatGPT is set up with a
// deliberately invalid key. OpenAI really answers 401 (needs internet), while Claude is the local mock.
test.use({ baseURL: PARTIAL_URL });

test("one provider fails: the other's answers are saved, scored and the failure is shown", async ({ page, account }) => {
  await mockAI("answer", "Try Zentrix Skin Clinic.");
  await page.goto("/app/ai-visibility");
  const main = page.locator("main");
  await expect(main).toContainText("ChatGPT (OpenAI API): on");
  await expect(main).toContainText("Claude: on");

  await submit(page, "Run a new check");
  await expect(main).toContainText("Check saved with partial results. Not included: ChatGPT (OpenAI API).");
  const text = await main.innerText();
  expect(text).toContain("Partial results");
  expect(text).toMatch(/ChatGPT \(OpenAI API\) could not be checked: OpenAI rejected the API key \(401\)/);
  expect(text).toMatch(/Visibility score\s+100\s*\/ 100/);
  expect(text).not.toMatch(/ChatGPT \(OpenAI API\)\n(Named|Not named)/);

  const [check] = account.data().checks;
  expect(check.failedProviders.map((f: { label: string }) => f.label)).toEqual(["ChatGPT (OpenAI API)"]);
  expect(new Set(check.results.map((r: { provider: string }) => r.provider))).toEqual(new Set(["claude"]));
});

test("every provider fails: errors shown, nothing saved; partial checks count toward the limit", async ({ page, account }) => {
  await mockAI("500");
  await page.goto("/app/ai-visibility");
  await submit(page, "Run a new check");
  const main = page.locator("main");
  await expect(main).toContainText("Claude is having problems (500)");
  await expect(main).toContainText("OpenAI rejected the API key");
  expect(account.data().checks ?? []).toHaveLength(0);

  await mockAI("answer", "Try Zentrix Skin Clinic.");
  for (let i = 0; i < 6; i++) {
    await page.goto("/app/ai-visibility");
    await submit(page, "Run a new check");
    await expect(main).toContainText("Check saved with partial results");
  }
  await page.goto("/app/ai-visibility");
  await submit(page, "Run a new check");
  await expect(main).toContainText("Too many visibility checks");
  expect(account.data().checks).toHaveLength(6);
});
