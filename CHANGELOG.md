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
- README with core concepts, MIT license.
