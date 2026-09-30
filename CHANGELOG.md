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
- Home page lists every guide of the team across apps, newest first, with filters kept in the URL: app, area, environment, type, active or archived, and search by title, id or build; loads more on demand. `GET /guides` (team-wide, paged); the apps list moved to `/apps`.
- Scenario diff between versions: a scenario brought back from deprecation counts as changed (retested), and every scenario deprecated in the new version is listed as deprecated, so "to retest" and "unchanged" only count active scenarios.
- Slack notifications per app (Incoming Webhook, set by owners on the app page): new guide, new guide version with the number of scenarios to retest, and optionally a run finished with failures or skips. Messages in the instance's guide language with links; the webhook URL is a secret the API never returns; a Slack failure never fails an upload; owners can send a test message.
- Platforms are chosen per app: built-in `ios`, `android`, `web` and `api` (backend checked with an HTTP client, logs or the database), plus the app's own named platforms (e.g. an admin panel). Owners change them later; platforms with test runs can't be removed. Guide scenarios may only use the app's platforms.
- Environments management for owners (new Settings page): add, rename, reorder, archive and restore; archived environments can't be used by new guides, and one always stays active.
- Guide type (`feature`, `bugfix`, `improvement`, `mixed`): optional in the guide, shown as a badge, filter in the guide list and in `list_guides`; the AI instructions explain how to choose it and when to use the `api` platform.
- README: monthly AWS cost estimate per instance, where the money goes, and why Aurora Serverless v2 rather than regular RDS.
- Deployment fixes from the first real deploy: the database gets its own small VPC (no default VPC needed, no cost), AWS-managed CloudFront policies referenced by id (planning needs no CloudFront read access), Aurora PostgreSQL 16.15 by default (16.6 was withdrawn), `infra/deploy-policy.json` with the IAM permissions a deploy user needs.
- Data API calls wait for a paused Aurora to resume (up to ~22 s in the API, 2 min in migrations) instead of failing the first request after idle time.
- Inviting a pending person again resends their temporary password if it was never used, instead of failing.
- README with core concepts, MIT license.
