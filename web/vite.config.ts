import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// One version for the whole of Guidepass: the repository root's package.json.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// In development the API runs on :8787 (`npm run dev -w api`); in AWS both are
// served from one domain: the API under /api, the MCP server at /mcp.
const api = process.env.GUIDEPASS_API ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // GUIDEPASS_API points the proxy at another local API, e.g. the one browser tests start.
  server: { port: 5173, proxy: { "/api": api, "/mcp": api } },
});
