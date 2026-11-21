import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/** The test server's own data folder (inside the temporary copy, never the project's .data). */
export const DATA_DIR = path.join(process.env.E2E_DIR!, ".data");
const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT}`;
export const PARTIAL_URL = `http://localhost:${process.env.E2E_PARTIAL_PORT}`;
/** Test server set up as if reached directly, with no trusted proxy (TRUSTED_PROXY_HOPS=0). */
export const DIRECT_URL = `http://localhost:${process.env.E2E_DIRECT_PORT}`;
/** Test server with no Google Places key. */
export const NOPLACES_URL = `http://localhost:${process.env.E2E_NOPLACES_PORT}`;

/** Test server with live Google Business Profile against the local stand-in (see server.mjs). */
export const GBP_URL = `http://localhost:${process.env.E2E_GBP_PORT}`;

/** Changes the Business Profile stand-in: a failure mode for paths containing failPath, token lifetime, refresh refusal. */
export async function gbpMode(opts: { reset?: boolean; fail?: string; failPath?: string; failMethod?: string; refresh?: string; expiresIn?: number; replyState?: string; loseAnswer?: string }) {
  const q = new URLSearchParams(Object.entries(opts).filter(([k, v]) => k !== "reset" || v).map(([k, v]) => [k, k === "reset" ? "1" : String(v)]));
  expect((await fetch(`${MOCK}/gbp-mode?${q}`)).ok).toBe(true);
}
/** What the Business Profile stand-in received and holds. */
export async function gbpCalls(): Promise<{ calls: { method: string; path: string; query: string; body: string }[]; refreshes: number; revoked: number; posts: any[]; replies: Record<string, any> }> {
  return (await fetch(`${MOCK}/gbp-calls`)).json();
}
/**
 * Connects Google the way the browser would after Google's consent screen: /api/google/start sets the state and
 * PKCE cookies, then Google redirects back to the callback with a code. The stand-in accepts the codes e2e-good,
 * e2e-good-other (a different Google account) and e2e-noscope (Business Profile permission not granted).
 */
export async function connectGoogle(page: Page, code = "e2e-good", from?: "onboarding" | "settings") {
  const start = await page.request.get(`/api/google/start${from ? `?from=${from}` : ""}`, { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  const state = new URL(start.headers().location).searchParams.get("state");
  // The callback redirects to NEXT_PUBLIC_APP_URL, which Next.js fixes at build time: the shared test build names
  // the main test server. Follow only the path, on the server under test.
  const back = await page.request.get(`/api/google/callback?code=${code}&state=${state}`, { maxRedirects: 0 });
  expect(back.status()).toBe(307);
  const to = new URL(back.headers().location);
  await page.goto(to.pathname + to.search);
}

/**
 * Runs the background jobs on the server under test, as a scheduler would (POST /api/jobs/run with the secret).
 * `at`: run as if it were that time (test servers only), to test schedules without waiting.
 */
export async function runJobs(page: Page, at?: Date): Promise<{ ran: number; results: { kind: string; status: string }[] }> {
  const r = await page.request.post(`/api/jobs/run${at ? `?at=${encodeURIComponent(at.toISOString())}` : ""}`, { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
  expect(r.status()).toBe(200);
  return r.json();
}

/** "YYYY-MM-DDTHH:mm" in this machine's time zone (the browser's too), for datetime-local fields. */
export const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Place IDs the Google Places stand-in knows (see server.mjs). */
export const PLACE = { hospital: "ChIJe2eHospital00001", salon: "ChIJe2eSalon0000001", sparse: "ChIJe2eSparse000001" };

/** The text searches the business finder sent to the Places stand-in since the last reset. */
export async function placesFinds(): Promise<string[]> {
  return (await fetch(`${MOCK}/places-finds`)).json();
}

/**
 * Sets the Google listing from Settings the way an owner would with a known ID: "Enter Place ID manually",
 * "Use this ID" (checked with Google), and "Save without checking" or "Replace listing" when the app asks.
 */
export async function setGoogleListing(page: Page, placeId: string) {
  await page.goto("/app/settings");
  const finder = page.locator("section", { has: page.locator("#listing-h") });
  const manualLink = finder.getByRole("button", { name: "Enter Place ID manually" });
  if (await manualLink.isVisible()) await manualLink.click();
  await finder.locator("#f-placeId").fill(placeId);
  await finder.getByRole("button", { name: "Use this ID" }).click();
  const done = finder.getByRole("status").filter({ hasText: /saved/i });
  const force = finder.getByRole("button", { name: "Save without checking" });
  const replace = finder.getByRole("button", { name: "Replace listing" });
  await expect(done.or(force).or(replace)).toBeVisible();
  if (await force.isVisible()) await force.click();
  await expect(done.or(replace)).toBeVisible();
  if (await replace.isVisible()) await replace.click();
  await expect(done).toBeVisible();
}

/**
 * Changes what the Places stand-in returns: improved salon data, the rank at each grid point (9 values for 3x3, 25 for
 * 5x5), or `shift`, which changes which neighbouring businesses lead the grid results.
 */
export async function placesMode(opts: { improved?: boolean; grid?: (number | null)[]; reset?: boolean; shift?: number }) {
  const q = new URLSearchParams();
  if (opts.reset) q.set("reset", "1");
  if (opts.shift !== undefined) q.set("shift", String(opts.shift));
  if (opts.improved !== undefined) q.set("improved", opts.improved ? "1" : "0");
  if (opts.grid) q.set("grid", opts.grid.map((g) => (g === null ? "null" : String(g))).join(","));
  const r = await fetch(`${MOCK}/places-mode?${q}`);
  expect(r.ok).toBe(true);
}

/** Set what the mock Claude answers to visibility questions. Also clears its call log. */
export async function mockAI(mode: string, answer = "") {
  const r = await fetch(`${MOCK}/mode?m=${encodeURIComponent(mode)}&a=${encodeURIComponent(answer)}`);
  expect(r.ok).toBe(true);
}
/** The prompts the mock Claude received since the last mockAI() call. */
export async function aiCalls(): Promise<{ system: string; user?: string }[]> {
  return (await fetch(`${MOCK}/calls`)).json();
}

type Store = Record<string, Record<string, any>>;
/** The test server's stored user data. The file appears only after the first save, so a missing file is empty. */
export const readData = (): Store => {
  const file = path.join(DATA_DIR, "user_data.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
};
/**
 * Replaces the test server's data file atomically (a temporary file, then a rename), as the app itself writes it.
 * Writing in place let the server read half a file now and then, which it rightly reports as damaged data.
 */
export const writeData = (d: Store) => {
  const file = path.join(DATA_DIR, "user_data.json");
  const tmp = `${file}.${process.pid}.${Date.now()}.test.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, file);
};
const userId = (email: string): string => JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"))[email].id;

/** Click a button that submits a server action and wait for the server to answer. */
export async function submit(page: Page, target: Locator | string) {
  const button = typeof target === "string" ? page.getByRole("button", { name: target, exact: true }).first() : target;
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined), button.click()]);
}

/** Replace the contents of a text field. */
export async function retype(field: Locator, value: string) {
  await field.fill("");
  await field.fill(value);
}

/**
 * How far the page is wider than the screen (0 or less is fine). On a phone, Chrome widens the layout to fit
 * content that is too wide (the page then zooms out), so the window width alone would hide the problem.
 */
export const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - Math.min(innerWidth, screen.width));

type Account = { email: string; id: string; data: () => Record<string, any> };

/** Password used for every test account. Not a real credential. */
export const PASSWORD = "e2e-pass-X1-not-real";
export const newEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.test`;
/** A made-up client address, as the trusted proxy would report it. */
export const fakeAddress = () => `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
export const users = (): Record<string, { id: string }> => JSON.parse(fs.readFileSync(path.join(DATA_DIR, "users.json"), "utf8"));

export const test = base.extend<{ businessName: string; onboard: boolean; account: Account; consoleErrors: string[] }>({
  businessName: ["Zentrix Skin Clinic", { option: true }],
  onboard: [true, { option: true }],

  // The main test server trusts one proxy (TRUSTED_PROXY_HOPS=1) and the tests play that proxy: the right-most
  // x-forwarded-for entry is the client address. A different address per test keeps the per-address signup and
  // login limits from blocking the suite.
  extraHTTPHeaders: async ({}, use) => {
    await use({ "x-forwarded-for": fakeAddress() });
  },

  // Fails a test that logs a browser console error or an uncaught page error.
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],

  // A brand-new demo account for every test, so no test depends on another one's data.
  account: async ({ page, businessName, onboard }, use, info) => {
    const email = newEmail(info.project.name);
    await page.goto("/signup");
    await page.locator("#f-email").fill(email);
    await page.locator("#f-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/onboarding$/);
    if (onboard) {
      await page.locator("#f-name").fill(businessName);
      await page.locator("#f-website").fill("example.test");
      await page.locator("#f-location").fill("Bhubaneswar");
      await page.getByRole("button", { name: "Continue" }).click();
      // Step 2 (connect Google) is skipped here; tests that connect do it themselves.
      await page.waitForURL(/\/app\/onboarding\/connect$/);
      await page.getByRole("link", { name: /^(Skip for now|Continue to your dashboard)$/ }).click();
      await page.waitForURL(/\/app$/);
      // Onboarding no longer asks for a category (it starts as "Other healthcare" until Google or the owner sets it).
      // The tests were written for a clinic, so set that directly in the test server's data.
      const d = readData();
      d[userId(email)].business.category = "Doctor / Clinic";
      writeData(d);
    }
    const id = userId(email);
    await use({ email, id, data: () => readData()[id] });
  },
});

export { expect };
