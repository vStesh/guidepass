import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run the real web app against the local API with a fresh database
// (PGlite in a temporary folder), on their own ports so a dev server can keep running.
const apiPort = 8797;
const webPort = 5180;
const dataDir = process.env.GUIDEPASS_DATA_DIR ?? mkdtempSync(join(tmpdir(), "guidepass-e2e-"));
process.env.GUIDEPASS_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "e2e",
  // One instance, one team: the tests share it and run in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${webPort}`,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Testers mostly run guides on a phone.
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: [
    {
      command: "npx tsx api/src/local.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { PORT: String(apiPort), GUIDEPASS_DATA_DIR: dataDir, PUBLIC_URL: `http://localhost:${webPort}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -w web -- --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      env: { GUIDEPASS_API: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
