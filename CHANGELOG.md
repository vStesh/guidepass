# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added
- Repository skeleton: `infra/`, `api/`, `web/`, `mcp/` and `packages/schema/`.
- JSON Schema for test guides (`packages/schema/guide.schema.json`) with an example guide.
- Default instructions for AI agents on writing and updating guides (`packages/schema/guide-instructions.md`).
- MCP server design (`mcp/DESIGN.md`): tools, agent tokens, per-tester results with combined verdicts.
- Environments: configurable per instance (set at deploy, editable by owners); guides list the environments they must be run on, scenarios can be limited to some of them, runs and verdicts are per environment.
- Deployment model: one instance per project in the project's AWS account, on a subdomain; draft Terraform variables and three DNS options in `infra/README.md`.
- npm workspaces monorepo with TypeScript, Vitest and oxlint.
- `@guidepass/schema` package: guide types, validation (schema, unique keys, known environments) and scenario diff between versions.
- API skeleton (Hono on Lambda, Drizzle over the Aurora Data API, PGlite locally): instance setup, environments, apps, areas, guides with versioned uploads (`dryRun`, `baseVersion`, protection for scenarios that have results), guide list filters and archiving. Cognito ID-token auth (verified email required); first-time setup limited to the owner email set at deploy.
- Initial database migration and a migration Lambda that seeds environments on first deploy.
- Runs and results: start a run on one environment, platform and device; mark scenarios (`pass`, `fail`, `skip`, clear to `untested`) with notes in your own run; finish and reopen runs; per-run counts.
- Guide results: every tester's result per environment and platform, combined verdicts (`conflict` when a pass and a fail meet), progress counts, a `problems` filter, and carry-over of results from older versions for unchanged scenarios.
- Interface language per person (`en`, `uk`) in the profile; `PATCH /me`.
- Team members and invitations: owners invite by email (as owner or tester), list and revoke pending invitations, change roles and remove members; a team always keeps an owner. Invited people join on their first sign-in with that email. In a user pool Guidepass created, an invitation creates the Cognito account and emails a temporary password; in a shared pool only people who already have an account can be invited.
- Web app (React, Vite, React Router), responsive and built for phones, English and Ukrainian, light and dark: Cognito sign-in with new-password and one-time-code challenges (Amplify loaded only when needed), first-time setup, apps and areas, guide list with filters, guide upload from JSON with a dry-run check and scenario diff, guide page with versions, runs and a results matrix per environment and platform (every tester's result behind each verdict), run page for marking scenarios with notes, team and invitations, profile with interface language. Guide text is rendered as sanitized Markdown. Runtime `/config.json` so one build serves every instance.
- API served under `/api`; a new profile starts in the browser's language.
- `@guidepass/schema/core`: browser-safe types and helpers without the validator.
- Terraform for one instance per project: Aurora Serverless v2 PostgreSQL with the Data API (pauses when idle), API and migration Lambdas (arm64) with a migration run on every apply, HTTP API Gateway with throttling, private S3 + CloudFront serving the app and forwarding `/api/*`, Cognito client in an existing pool or a new pool with the owner's account, optional custom domain (existing zone, delegated zone or none) with an ACM certificate. New API code goes live only after its migrations ran; an apply without a web build fails instead of emptying the site. `npm run build` bundles the Lambdas with esbuild. Deployment steps in `infra/README.md`.
- Remote MCP server at `/mcp` (Streamable HTTP, stateless, in the API Lambda) with the eight tools from the design: `list_apps`, `get_guide_instructions`, `list_guides`, `get_guide`, `get_results`, `create_area`, `upload_guide`, `set_guide_status`. Agent tokens (`read` / `write`, stored as SHA-256 hashes, revocable, last use tracked) managed by owners on the Team page, which also shows the `claude mcp add` command. Web API and MCP share the same services. Internal errors are logged and never shown to agents; `GET`/`DELETE` on `/mcp` answer 405 (stateless JSON server).
- Data API calls wait for a paused Aurora to resume (up to ~22 s in the API, 2 min in migrations) instead of failing the first request after idle time.
- Inviting a pending person again resends their temporary password if it was never used, instead of failing.
- README with core concepts, MIT license.
