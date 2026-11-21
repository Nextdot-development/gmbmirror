import { aiCalls, expect, mockAI, retype, setGoogleListing, submit, test } from "./support/fixtures";

// Phase 1 feature: reply and post language (English, Hindi, Hinglish).

const rule = { en: "Write in English.", hi: "Write in Hindi using Devanagari script", hinglish: "Roman (English) letters" } as const;
const whatsapp = { en: /Thank you for visiting/, hi: /आने के लिए धन्यवाद/, hinglish: /aane ke liye dhanyavaad/ } as const;

test("the language field offers English, Hindi and Hinglish, default English", async ({ page, account }) => {
  await page.goto("/app/settings");
  const options = await page.locator("#f-language option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(options).toEqual(["en", "hi", "hinglish"]);
  await expect(page.locator("#f-language")).toHaveValue("en");
  expect(account.data().business.language ?? "en").toBe("en");
});

for (const lang of ["hi", "hinglish", "en"] as const) {
  test(`language ${lang}: saved, sent to the reply and post prompts, and used for the WhatsApp message`, async ({ page, account }) => {
    await mockAI("named");
    await setGoogleListing(page, "ChIJtestPlace123"); // the review-share box needs a Place ID
    await page.goto("/app/settings");
    await page.locator("#f-language").selectOption(lang);
    await submit(page, "Save AI preferences");
    await expect(page.locator("main")).toContainText("AI preferences saved");
    await page.reload();
    await expect(page.locator("#f-language")).toHaveValue(lang);
    expect(account.data().business.language).toBe(lang);

    await page.goto("/app/reviews");
    await submit(page, page.getByRole("button", { name: "Draft with Claude" }).first());
    await expect.poll(async () => (await aiCalls()).at(-1)?.system ?? "").toContain(rule[lang]);

    await page.goto("/app/posts");
    await retype(page.locator("#f-topic"), "Monsoon skin care");
    await submit(page, page.getByRole("button", { name: "Draft with Claude" }).first());
    await expect.poll(async () => (await aiCalls()).at(-1)?.system ?? "").toContain(rule[lang]);

    await page.goto("/app/google");
    await expect(page.locator("p", { hasText: /^Message:/ })).toHaveText(whatsapp[lang]);
  });
}
