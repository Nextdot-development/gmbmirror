import { connectGoogle, expect, GBP_URL, gbpMode, localInput, mockAI, runJobs, sentEmails, setGoogleListing, submit, test } from "./support/fixtures";

// Email (Resend). The main test server has no email set up: nothing may claim to be sent. The Business Profile test
// server sends to a Resend stand-in, so what the app sends can be checked. Nothing reaches Resend.

test.describe("email not set up (main server)", () => {
  test("contact page offers the support address only, and the footer links to it", async ({ page }) => {
    await page.goto("/");
    await page.locator("footer").getByRole("link", { name: "Contact us" }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByTestId("contact-unavailable")).toContainText("gmbmirror@gmail.com");
    await expect(page.getByTestId("contact-email")).toHaveAttribute("href", "mailto:gmbmirror@gmail.com");
    await expect(page.getByTestId("contact-form")).toHaveCount(0);
  });

  test("settings say email is not set up; choices still save; reports have no email button", async ({ page, account }) => {
    await page.goto("/app/settings");
    await expect(page.getByTestId("email-status")).toContainText("Email is not set up on this server yet, so nothing is sent.");
    const prefs = page.getByTestId("notification-prefs");
    await expect(prefs.getByLabel(/Monthly report/)).toBeChecked();
    await expect(prefs.getByLabel(/Published posts/)).not.toBeChecked();
    await prefs.getByLabel(/Monthly report/).uncheck();
    await prefs.getByLabel(/Published posts/).check();
    await submit(page, "Save email choices");
    await expect(prefs).toContainText("Email choices saved.");
    await page.reload();
    await expect(page.getByTestId("notification-prefs").getByLabel(/Monthly report/)).not.toBeChecked();
    await expect(page.getByTestId("notification-prefs").getByLabel(/Published posts/)).toBeChecked();
    expect(account.email).toContain("@");

    await page.goto("/app/reports");
    await submit(page, "Create this month's report now");
    await expect(page.locator("main")).toContainText("Report created.");
    await expect(page.getByRole("link", { name: "Download PDF" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me this report" })).toHaveCount(0);
  });
});

test.describe("email set up (Resend stand-in)", () => {
  test.use({ baseURL: GBP_URL });
  test.beforeEach(async () => {
    await gbpMode({ reset: true });
    await mockAI("named");
  });

  test("contact form: checks the fields, then sends to the support address with the visitor as reply-to", async ({ page }) => {
    await page.goto("/contact");
    const form = page.getByTestId("contact-form");
    await form.getByLabel("Your name").fill("Asha Verma");
    await form.getByLabel("Your email").fill("asha@example.test");
    await form.getByLabel("Topic").selectOption("Problem or bug");
    await form.getByLabel("Message").fill("Too short");
    await submit(page, "Send message");
    await expect(form).toContainText("Write at least a sentence.");
    await expect(form.getByLabel("Your name")).toHaveValue("Asha Verma");

    const tag = `contact-${Date.now()}`;
    await form.getByLabel("Message").fill(`The posts page does not load on my phone. Reference ${tag}.`);
    await submit(page, "Send message");
    await expect(page.getByTestId("contact-sent")).toContainText("Your message was sent.");
    const mail = (await sentEmails()).find((m) => m.text.includes(tag))!;
    expect(mail.to).toEqual(["gmbmirror@gmail.com"]);
    expect(mail.reply_to).toBe("asha@example.test");
    expect(mail.subject).toBe("[GMBmirror contact] Problem or bug: Asha Verma");
    expect(mail.from).toBe("GMBmirror <notifications@e2e.example.test>");
    expect(mail.auth).toBe("Bearer re_e2e_fake_key_0123456789");
  });

  test("report: 'Email me this report' sends the PDF to the account's own address and the log shows it", async ({ page, account }) => {
    await page.goto("/app/reports");
    await submit(page, "Create this month's report now");
    await expect(page.locator("main")).toContainText("Report created.");
    const report = page.locator("main ul[aria-label='Report history'] > li").first();
    await submit(page, report.getByRole("button", { name: "Email me this report" }));
    await expect(report.getByTestId("email-report")).toContainText(`Sent to ${account.email}. Resend accepted it for delivery`);
    const mail = (await sentEmails()).filter((m) => m.to[0] === account.email).at(-1)!;
    expect(mail.subject).toMatch(/^GMBmirror monthly report: Zentrix Skin Clinic, \d{4}-\d{2}$/);
    expect(mail.attachments).toEqual([{ filename: expect.stringMatching(/^report-\d{4}-\d{2}\.pdf$/), head: "%PDF-" }]);
    expect(mail.reply_to).toBe("gmbmirror@gmail.com");

    await page.goto("/app/settings");
    await expect(page.getByTestId("email-status")).toContainText(`Sent to ${account.email}`);
    await expect(page.getByTestId("email-log")).toContainText("Accepted");
  });

  test("security notice: connecting Google emails the owner", async ({ page, account }) => {
    await setGoogleListing(page, "ChIJtestPlace123");
    await connectGoogle(page);
    await expect(page.getByTestId("gbp-status")).toHaveText("Connected");
    await expect.poll(async () => (await sentEmails()).filter((m) => m.to[0] === account.email && m.subject === "GMBmirror: Google Business Profile connected").length).toBe(1);
  });

  test("background jobs: the monthly report is emailed by itself; a scheduled post that fails for good alerts the owner", async ({ page, account }) => {
    await setGoogleListing(page, "ChIJtestPlace123");
    await connectGoogle(page);
    await expect(page.getByTestId("gbp-status")).toHaveText("Connected");

    // A post that Google refuses (no permission): failed for good, never retried into a duplicate.
    const at = new Date(Date.now() + 2 * 24 * 3600_000);
    at.setSeconds(0, 0);
    await page.goto("/app/posts");
    await page.locator("#p-text").fill("Free dental check-up camp on Sunday morning.");
    await page.locator("#f-scheduledFor").fill(localInput(at));
    await submit(page, "Save as draft");
    const card = page.locator("main section[aria-labelledby=drafts] ul > li").filter({ hasText: "Free dental check-up camp" });
    await submit(page, card.getByRole("button", { name: "Approve" }));
    await gbpMode({ fail: "permission", failPath: "/localPosts", failMethod: "POST" });
    await runJobs(page, new Date(at.getTime() + 60_000));
    const alert = (await sentEmails()).filter((m) => m.to[0] === account.email && m.subject === "GMBmirror: A scheduled Google post failed");
    expect(alert).toHaveLength(1);
    expect(alert[0].text).toContain("Nothing was published.");
    await gbpMode({ fail: "" });

    // The 1st of next month, 04:00 UTC: this month's report is made and emailed with its PDF.
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 4)); // reports run from 03:00 UTC on the 1st
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    // Each pass runs at most 60 due jobs across all accounts, reports last. The test server holds many accounts whose
    // reports fall due at the same moment, so run passes the way the per-minute scheduler would until this one is done.
    const mine = async () => (await sentEmails()).filter((m) => m.to[0] === account.email && m.subject.endsWith(`, ${month}`));
    for (let i = 0; i < 15 && !(await mine()).length; i++) await runJobs(page, new Date(first.getTime() + i * 60_000));
    const report = await mine();
    expect(report).toHaveLength(1);
    expect(report[0].attachments).toEqual([{ filename: `report-${month}.pdf`, head: "%PDF-" }]);
    // Running again sends nothing more.
    await runJobs(page, new Date(first.getTime() + 16 * 60_000));
    expect((await sentEmails()).filter((m) => m.to[0] === account.email && m.subject.endsWith(`, ${month}`))).toHaveLength(1);
  });
});
