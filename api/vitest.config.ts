import { defineConfig } from "vitest/config";

// Every test file starts its own PGlite and runs all migrations; a cold start can
// take several seconds on a busy machine.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
