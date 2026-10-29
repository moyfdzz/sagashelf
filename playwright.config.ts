import { defineConfig, devices } from "@playwright/test";

// CI tests the production build; locally the dev server is used.
const port = process.env.CI ? 4173 : 5173;
const baseURL = `http://localhost:${port}`;

// Cloudflare sets `CF-Connecting-IP` at the edge, and the rate limiters count per caller. Without
// it every test is the same caller, "unknown", and two runs within a minute share one budget of
// 60 searches, so the second can fail with a 429 that is not a bug (SAG-72). Each run is its own
// caller. It is kept in the environment, which the workers inherit, so the whole run has one; a
// run that was given one (to repeat a caller on purpose) keeps it.
const caller =
  process.env.E2E_CALLER ??
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
process.env.E2E_CALLER = caller;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // A header written by the test itself wins over this one (the test of the burst does so).
    extraHTTPHeaders: { "CF-Connecting-IP": caller },
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.CI ? "npm run preview" : "npm run dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
