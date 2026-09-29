// Bundles the Lambda handlers into api/dist, one folder per function, for Terraform to zip.
// The AWS SDK v3 is provided by the Node.js Lambda runtime, so it stays out of the bundle.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

const dist = new URL("./dist/", import.meta.url).pathname;
rmSync(dist, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  sourcemap: false,
  external: ["@aws-sdk/*"],
  // Some dependencies still call require(); give ESM bundles one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/handler.ts"], outfile: `${dist}api/index.mjs` });
// The MCP server hands these to agents; read at runtime next to the bundle.
cpSync(new URL("../packages/schema/guide-instructions.md", import.meta.url).pathname, `${dist}api/guide-instructions.md`);
await build({ ...common, entryPoints: ["src/migrate-handler.ts"], outfile: `${dist}migrate/index.mjs` });
cpSync(new URL("./migrations", import.meta.url).pathname, `${dist}migrate/migrations`, { recursive: true });
