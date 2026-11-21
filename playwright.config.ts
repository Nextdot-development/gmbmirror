import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Browser tests. Uses the Chrome already installed on this machine (channel "chrome"); Playwright downloads no browser.
 * tests/e2e/support/server.mjs builds and runs a copy of the app in a temporary folder with its own empty data,
 * so the project's .env and .data are never used. See tests/README.md.
 */
const E2E_DIR = process.env.E2E_DIR || path.join(os.tmpdir(), "gmb-growth-engine-e2e");
const ports = { E2E_PORT: "3111", E2E_PARTIAL_PORT: "3112", E2E_DIRECT_PORT: "3113", E2E_NOPLACES_PORT: "3114", E2E_GBP_PORT: "3115", E2E_MOCK_PORT: "4999" };
// Workers re-read this file, so the tests see the same values.
process.env.E2E_DIR = E2E_DIR;
for (const [k, v] of Object.entries(ports)) process.env[k] ||= v;

const desktop = { width: 1360, height: 900 };
const tablet = { width: 820, height: 1100 };
const mobile = { width: 390, height: 844 };

export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the mock AI server holds one answer at a time, and the demo store is a set of JSON files.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${process.env.E2E_PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: desktop } },
    { name: "tablet", use: { viewport: tablet }, testMatch: ["layout.spec.ts", "review-share.spec.ts"] },
    { name: "mobile", use: { viewport: mobile, isMobile: true, hasTouch: true }, testMatch: ["layout.spec.ts", "review-share.spec.ts", "posts.spec.ts", "onboarding.spec.ts", "auth.spec.ts", "discovery.spec.ts", "gbp.spec.ts", "gbp-onboarding.spec.ts", "settings.spec.ts", "locations.spec.ts", "automation.spec.ts", "completion.spec.ts", "branding.spec.ts", "password-reset.spec.ts"] },
  ],
  webServer: {
    command: "node tests/e2e/support/server.mjs",
    url: `http://127.0.0.1:${process.env.E2E_MOCK_PORT}/ready`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_DIR, ...Object.fromEntries(Object.keys(ports).map((k) => [k, process.env[k]!])) },
  },
});
