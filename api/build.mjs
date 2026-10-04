// Bundles the Lambda handlers into api/dist, one folder per function, for Terraform to zip.
// The Lambda runtime provides the AWS SDK v3 clients we use as-is (Cognito, RDS Data);
// everything for S3 (including the presigning helpers) is bundled, so the bundle
// doesn't depend on which helpers a runtime version happens to include.
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
  external: ["@aws-sdk/client-cognito-identity-provider", "@aws-sdk/client-rds-data"],
  // Some dependencies still call require(); give ESM bundles one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/handler.ts"], outfile: `${dist}api/index.mjs` });
// The MCP server hands these to agents; read at runtime next to the bundle.
cpSync(new URL("../packages/schema/guide-instructions.md", import.meta.url).pathname, `${dist}api/guide-instructions.md`);
await build({ ...common, entryPoints: ["src/migrate-handler.ts"], outfile: `${dist}migrate/index.mjs` });
cpSync(new URL("./migrations", import.meta.url).pathname, `${dist}migrate/migrations`, { recursive: true });
