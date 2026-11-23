import type { Browser, Page } from "@playwright/test";
import { expect, fakeAddress, newEmail, PASSWORD, submit, test, users } from "./support/fixtures";

// Signup and login validation, and session handling (demo mode: server-side sessions in the test server's .data).

const errorText = (page: Page) => page.locator('p[role="alert"], .field-error').allInnerTexts();

/** Turns off the browser's own form checks, so the server's validation is what gets tested. */
const serverValidationOnly = (page: Page) => page.locator("form").first().evaluate((f) => ((f as HTMLFormElement).noValidate = true));

async function fillAuth(page: Page, email: string, password: string) {
  await page.locator("#f-email").fill(email);
  await page.locator("#f-password").fill(password);
}

async function signUpNew(page: Page, email = newEmail("auth")) {
  await page.goto("/signup");
  await fillAuth(page, email, PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding$/);
  return email;
}

async function freshPage(browser: Browser, baseURL: string, address = fakeAddress()) {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": address } });
  return { ctx, page: await ctx.newPage() };
}

test.describe("signup", () => {
  test("the browser blocks an empty or malformed form before it is sent", async ({ page }) => {
    await page.goto("/signup");
    let sent = false;
    page.on("request", (r) => r.method() === "POST" && (sent = true));
    await page.getByRole("button", { name: "Create account" }).click();
    expect(await page.locator("#f-email").evaluate((e) => (e as HTMLInputElement).validity.valueMissing)).toBe(true);
    await fillAuth(page, "not-an-email", PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    expect(await page.locator("#f-email").evaluate((e) => (e as HTMLInputElement).validity.typeMismatch)).toBe(true);
    expect(sent).toBe(false);
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("server validation: email format, short and long passwords; the email is kept, the password is not", async ({ page }) => {
    await page.goto("/signup");
    await serverValidationOnly(page);
    await fillAuth(page, "not-an-email", "short");
    await submit(page, "Create account");
    expect(await errorText(page)).toEqual(expect.arrayContaining(["Enter a valid email address.", "Use at least 8 characters."]));
    await expect(page.locator("#f-email")).toHaveValue("not-an-email");
    await expect(page.locator("#f-password")).toHaveValue("");

    await serverValidationOnly(page);
    await fillAuth(page, newEmail("long"), "x".repeat(129));
    await submit(page, "Create account");
    await expect(page.locator("#f-password-e")).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("email is trimmed and lower-cased; the same address in other letters is a duplicate", async ({ page, browser, baseURL }) => {
    const email = newEmail("case");
    await page.goto("/signup");
    await serverValidationOnly(page);
    await fillAuth(page, `  ${email.toUpperCase()}  `, PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/onboarding$/);
    expect(users()[email]).toBeTruthy();

    const other = await freshPage(browser, baseURL!);
    await other.page.goto("/signup");
    await fillAuth(other.page, email.replace(/^e2e/, "E2E"), PASSWORD);
    await submit(other.page, "Create account");
    await expect(other.page.locator('p[role="alert"]')).toHaveText("An account with this email already exists. Log in instead.");
    await expect(other.page).toHaveURL(/\/signup$/);
    await other.ctx.close();
  });

  test("a signed-in user is sent away from the signup and login pages", async ({ page }) => {
    await signUpNew(page);
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/app(\/onboarding)?$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app(\/onboarding)?$/);
  });
});

test.describe("login", () => {
  test("wrong password and unknown email give the same message", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    const { ctx, page: p } = await freshPage(browser, baseURL!);
    await p.goto("/login");
    await fillAuth(p, email, "wrong-password");
    await submit(p, "Log in");
    await expect(p.locator('p[role="alert"]')).toHaveText("Email or password is incorrect.");
    await expect(p.locator("#f-email")).toHaveValue(email);
    await expect(p.locator("#f-password")).toHaveValue("");
    await fillAuth(p, newEmail("nobody"), "wrong-password");
    await submit(p, "Log in");
    await expect(p.locator('p[role="alert"]')).toHaveText("Email or password is incorrect.");

    await p.locator("form").first().evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await fillAuth(p, email, "");
    await submit(p, "Log in");
    await expect(p.locator("#f-password-e")).toHaveText("Enter your password.");
    await ctx.close();
  });

  test("login works with the email in other letters, then lands on the app", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    const { ctx, page: p } = await freshPage(browser, baseURL!);
    await p.goto("/login");
    await fillAuth(p, `  ${email.toUpperCase()} `, PASSWORD);
    await p.getByRole("button", { name: "Log in" }).click();
    await p.waitForURL(/\/app\/onboarding$/);
    await ctx.close();
  });

  test("5 failures from one address block that address for the account; the owner elsewhere still logs in", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    const attacker = await freshPage(browser, baseURL!);
    await attacker.page.goto("/login");
    for (let i = 1; i <= 5; i++) {
      await fillAuth(attacker.page, email, `wrong-${i}`);
      await submit(attacker.page, "Log in");
      await expect(attacker.page.locator('p[role="alert"]'), `attempt ${i}`).toHaveText("Email or password is incorrect.");
    }
    // Even the right password is refused from that address now: it stops guessing from there.
    await fillAuth(attacker.page, email, PASSWORD);
    await submit(attacker.page, "Log in");
    await expect(attacker.page.locator('p[role="alert"]')).toContainText("Too many login attempts");
    await attacker.ctx.close();

    // The owner, at another address in a browser that has never logged in, is not locked out.
    const owner = await freshPage(browser, baseURL!);
    await owner.page.goto("/login");
    await fillAuth(owner.page, email, PASSWORD);
    await owner.page.getByRole("button", { name: "Log in" }).click();
    await owner.page.waitForURL(/\/app\/onboarding$/);
    await owner.ctx.close();
  });

  test("failures spread over many addresses block new browsers, but not a browser that logged in before", async ({ page, context, browser, baseURL }) => {
    const email = await signUpNew(page); // this browser is now recognised for the account
    const device = (await context.cookies()).find((c) => c.name === "ge_device");
    expect(device?.httpOnly).toBe(true);
    expect(device?.value).not.toContain(email.split("@")[0]);

    for (let a = 0; a < 4; a++) {
      const attacker = await freshPage(browser, baseURL!);
      await attacker.page.goto("/login");
      for (let i = 1; i <= 5; i++) {
        await fillAuth(attacker.page, email, `wrong-${a}-${i}`);
        await submit(attacker.page, "Log in");
        await expect(attacker.page.locator('p[role="alert"]'), `address ${a}, attempt ${i}`).toHaveText("Email or password is incorrect.");
      }
      await attacker.ctx.close();
    }
    // 20 failures for the account: a new browser at a fresh address now waits, even with the right password.
    const stranger = await freshPage(browser, baseURL!);
    await stranger.page.goto("/login");
    await fillAuth(stranger.page, email, PASSWORD);
    await submit(stranger.page, "Log in");
    await expect(stranger.page.locator('p[role="alert"]')).toContainText("Too many login attempts");
    await stranger.ctx.close();

    // The owner's own browser is recognised, so it still logs in.
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto("/login");
    await fillAuth(page, email, PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/app\/onboarding$/);
  });

  test("a recognised browser still has its own limit of 5 failures", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto("/login");
    for (let i = 1; i <= 5; i++) {
      await fillAuth(page, email, `wrong-${i}`);
      await submit(page, "Log in");
      await expect(page.locator('p[role="alert"]'), `attempt ${i}`).toHaveText("Email or password is incorrect.");
    }
    await fillAuth(page, email, PASSWORD);
    await submit(page, "Log in");
    await expect(page.locator('p[role="alert"]')).toContainText("Too many login attempts");
  });

  test("only failures count: many successful logins in a row are never blocked", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    const { ctx, page: p } = await freshPage(browser, baseURL!);
    for (let i = 1; i <= 7; i++) {
      await p.goto("/login");
      await fillAuth(p, email, PASSWORD);
      await p.getByRole("button", { name: "Log in" }).click();
      await p.waitForURL(/\/app\/onboarding$/);
      await p.getByRole("button", { name: "Log out" }).click();
      await p.waitForURL((u) => u.pathname === "/");
    }
    await ctx.close();
  });

  test("a successful login resets the wrong-password count", async ({ page, browser, baseURL }) => {
    const email = await signUpNew(page);
    const { ctx, page: p } = await freshPage(browser, baseURL!);
    await p.goto("/login");
    for (let i = 1; i <= 4; i++) {
      await fillAuth(p, email, `wrong-${i}`);
      await submit(p, "Log in");
    }
    await fillAuth(p, email, PASSWORD);
    await p.getByRole("button", { name: "Log in" }).click();
    await p.waitForURL(/\/app\/onboarding$/);
    await p.getByRole("button", { name: "Log out" }).click();
    await p.waitForURL((u) => u.pathname === "/");
    await p.goto("/login");
    for (let i = 1; i <= 4; i++) {
      await fillAuth(p, email, `wrong-again-${i}`);
      await submit(p, "Log in");
      await expect(p.locator('p[role="alert"]'), `attempt ${i}`).toHaveText("Email or password is incorrect.");
    }
    await ctx.close();
  });
});

test.describe("sessions", () => {
  test("app pages need a session", async ({ page }) => {
    // The login page remembers the page asked for (plain /login for the dashboard itself).
    for (const path of ["/app", "/app/settings", "/app/onboarding", "/app/ai-visibility"]) {
      await page.goto(path);
      const expected = path === "/app" ? "/login" : `/login?next=${encodeURIComponent(path)}`;
      await expect(page, path).toHaveURL((u) => u.pathname + u.search === expected);
    }
    const r = await page.request.get("/api/google/start", { maxRedirects: 0 });
    expect(r.status()).toBeGreaterThanOrEqual(300);
    expect(r.headers().location).toMatch(/\/login$/);
  });

  test("the session cookie is httpOnly and SameSite=Lax, and a tampered cookie is refused", async ({ page, context, baseURL }) => {
    await signUpNew(page);
    const cookie = (await context.cookies()).find((c) => c.name === "ge_session")!;
    expect(cookie).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.secure).toBe(false); // http in tests; secure is set when NEXT_PUBLIC_APP_URL is https
    expect(await page.evaluate(() => document.cookie)).not.toContain("ge_session");

    const tampered = cookie.value.slice(0, -2) + (cookie.value.endsWith("aa") ? "bb" : "aa");
    await context.clearCookies();
    await context.addCookies([{ ...cookie, value: tampered, url: baseURL, domain: undefined, path: undefined }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logging out ends the session on the server: a copied cookie stops working", async ({ page, context, browser, baseURL }) => {
    await signUpNew(page);
    const cookie = (await context.cookies()).find((c) => c.name === "ge_session")!;

    const copy = await freshPage(browser, baseURL!);
    await copy.ctx.addCookies([{ name: cookie.name, value: cookie.value, url: baseURL }]);
    await copy.page.goto("/app/onboarding");
    await expect(copy.page).toHaveURL(/\/app\/onboarding$/); // the copy works while the session is live

    await page.goto("/app/onboarding");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    expect((await context.cookies()).some((c) => c.name === "ge_session")).toBe(false);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);

    await copy.page.goto("/app/onboarding");
    await expect(copy.page).toHaveURL(/\/login\?next=%2Fapp%2Fonboarding$/);
    await copy.ctx.close();
  });

  test("the session survives a browser restart (a new context with the same cookie)", async ({ page, context, browser, baseURL }) => {
    await signUpNew(page);
    const state = await context.storageState();
    const again = await browser.newContext({ baseURL, storageState: state, extraHTTPHeaders: { "x-forwarded-for": fakeAddress() } });
    const p = await again.newPage();
    await p.goto("/app/onboarding");
    await expect(p).toHaveURL(/\/app\/onboarding$/);
    await again.close();
  });
});
