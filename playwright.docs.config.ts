import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.ts";

// Screenshots for the README: the same local app and API as the browser tests,
// with demo data. Run with `npm run docs:screenshots`; not part of CI.
export default defineConfig({
  ...base,
  testDir: "docs/screenshots",
  testMatch: "*.shots.ts",
  retries: 0,
  reporter: "list",
  projects: [{ name: "docs", use: { ...devices["Desktop Chrome"], colorScheme: "light" } }],
});
