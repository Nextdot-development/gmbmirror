import { expect, PARTIAL_URL, readData, submit, test, writeData } from "./support/fixtures";

// The Google page's connection states. The main test server has fake Google OAuth keys and live Business Profile
// calls switched off (GBP_API_APPROVED unset). No real Google account is used. Live flows are in gbp.spec.ts.

const connection = (page: import("@playwright/test").Page) => page.locator("section", { has: page.getByRole("heading", { name: "Connection" }) });

test("not connected: status, connect button, and the OAuth redirect it starts", async ({ page, account, baseURL }) => {
  await page.goto("/app/google-profile");
  await expect(page.getByTestId("gbp-status")).toHaveText("Not connected");
  const connect = page.getByRole("link", { name: "Connect Google Business Profile" });
  await expect(connect).toHaveAttribute("href", "/api/google/start");
  await expect(connect).toHaveAttribute("aria-disabled", "false");
  await expect(connection(page)).not.toContainText("Add GOOGLE_CLIENT_ID");

  const r = await page.request.get("/api/google/start", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  const to = new URL(r.headers().location);
  expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(to.searchParams.get("client_id")).toBe("e2e-fake-client-id");
  expect(to.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/google/callback`);
  expect(to.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/business.manage");
  expect(to.searchParams.get("state")).toMatch(/^[0-9a-f]{48}$/);
  expect(to.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(to.searchParams.get("code_challenge_method")).toBe("S256");
  expect(to.searchParams.get("access_type")).toBe("offline");
  const stateCookie = (await page.context().cookies()).find((c) => c.name === "g_state");
  expect(stateCookie?.value).toBe(to.searchParams.get("state"));
  expect(stateCookie?.httpOnly).toBe(true);
});

test("callback errors: cancelled, forged or missing state, and a code Google rejects", async ({ page, account }) => {
  await page.goto("/api/google/callback?error=access_denied");
  await expect(page).toHaveURL(/\/app\/google-profile\?error=denied$/);
  await expect(page.locator('p[role="alert"]')).toHaveText("You cancelled the Google sign in. Nothing was connected.");

  const stateMessage = "The sign in could not be verified. Start the connection again.";
  await page.goto("/api/google/callback?code=abc&state=forged");
  await expect(page).toHaveURL(/error=state$/);
  await expect(page.locator('p[role="alert"]')).toHaveText(stateMessage);
  await page.goto("/api/google/callback?code=abc");
  await expect(page.locator('p[role="alert"]')).toHaveText(stateMessage);

  // A real state from /start, but a made-up code: Google's token endpoint really refuses it (needs internet).
  const start = await page.request.get("/api/google/start", { maxRedirects: 0 });
  const state = new URL(start.headers().location).searchParams.get("state");
  await page.goto(`/api/google/callback?code=e2e-made-up-code&state=${state}`);
  await expect(page).toHaveURL(/error=exchange$/);
  await expect(page.locator('p[role="alert"]')).toHaveText("Google did not accept the sign in. Try again.");
  expect(account.data().google).toBeUndefined();

  await page.goto("/app/google-profile?error=something-else");
  await expect(page.locator('p[role="alert"]')).toHaveText("Something went wrong.");
});

test("connected (stored connection): account, location, not-switched-on note, and disconnect deletes the tokens", async ({ page, account }) => {
  // Only a real Google sign-in can create a connection, so the test writes one into the test server's own data.
  const d = readData();
  d[account.id].google = {
    email: "owner@example.test",
    tokens: "not-real-encrypted-tokens",
    accountName: "accounts/123",
    locationName: "locations/456",
    locationTitle: "Zentrix Skin Clinic, Saheed Nagar",
    connectedAt: "2026-11-01T10:00:00.000Z",
  };
  writeData(d);

  await page.goto("/app/google-profile?connected=1");
  await expect(page.getByRole("status")).toHaveText("Google account connected.");
  const section = connection(page);
  await expect(section).toContainText("Connected as owner@example.test on");
  await expect(section).toContainText("Managing: Zentrix Skin Clinic, Saheed Nagar.");
  await expect(page.getByTestId("gbp-status")).toHaveText("Connected, not switched on yet");
  await expect(section).toContainText("Live reviews, replies, posts and insights will be switched on for this app soon.");
  await expect(page.locator("main")).not.toContainText("GBP_API_APPROVED");
  await expect(page.getByRole("link", { name: "Connect Google Business Profile" })).toHaveCount(0);

  await submit(page, "Disconnect and delete stored tokens");
  await expect(page.getByRole("link", { name: "Connect Google Business Profile" })).toBeVisible();
  // The stored tokens here are fake, so Google cannot confirm the revocation; the page says so and links to Google.
  await expect(page.getByRole("status")).toContainText("Google did not confirm it cancelled access");
  await expect(page.getByRole("link", { name: "myaccount.google.com/permissions" })).toHaveAttribute("href", "https://myaccount.google.com/permissions");
  expect(account.data().google).toBeUndefined();

  await page.goto("/app");
  await expect(page.locator("main")).not.toContainText("owner@example.test");
});

test.describe("Google sign-in not set up on the server", () => {
  test.use({ baseURL: PARTIAL_URL });

  test("a clear 'coming soon' status, a disabled button, and no server settings shown to the customer", async ({ page, account }) => {
    await page.goto("/app/google-profile");
    await expect(page.getByTestId("gbp-status")).toHaveText("Coming soon");
    const connect = page.getByRole("link", { name: "Connect Google Business Profile" });
    await expect(connect).toHaveAttribute("aria-disabled", "true");
    expect(await connect.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none"); // a click does nothing
    await expect(connection(page)).toContainText("Connecting your Google Business Profile will be available here soon.");
    await expect(page.locator("main")).not.toContainText(/\.env|GOOGLE_CLIENT|GBP_API_APPROVED/);
    await page.goto("/api/google/start");
    await expect(page).toHaveURL(/\/app\/google-profile\?error=not_configured$/);
    await expect(page.locator('p[role="alert"]')).toHaveText("Connecting Google Business Profile is not available yet. Please try again later.");
    // The callback refuses too, whatever it is sent.
    await page.goto("/api/google/callback?code=x&state=y");
    await expect(page).toHaveURL(/error=not_configured$/);
    // Drafting still works without Google: the reviews show labelled samples.
    await page.goto("/app/reviews");
    await expect(page.locator("main")).toContainText("Sample data");
  });
});
