import "./e2e/load-env"; // first: it fills process.env before ./e2e/test-database reads it
import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./e2e/test-database";

const PORT = 3100; // not 3000: a running `pnpm dev` keeps working
export const BASE_URL = `http://localhost:${PORT}`;

// The app under test runs against the TEST database only. e2e/test-database.ts refuses any database
// whose name does not end with _test, and it runs here, before the web server is started.

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The scenarios share one seeded database and change it, so they run one after the other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The first request to `next dev` compiles the page, which can take several seconds on a cold start.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      // Non-secret stand-in, like vitest.config.mts. The test server never uses the real secret.
      SESSION_SECRET: "e2e-only-session-secret-0123456789abcdef",
    },
  },
});
