import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on :8787 (`npm run dev -w api`); in AWS both are
// served from one domain, the API under /api.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
