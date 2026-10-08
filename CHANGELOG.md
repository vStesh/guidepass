# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-08

**Updating from 0.2.0:** update by hand this time (`./tf.sh <instance> apply`). The deploy policy changed: first update your deploy credentials to the new `infra/deploy-policy.json` (CodeBuild, SSM, passing a role to CodeBuild). To get the Update button, set `self_update = true` in the instance's `.tfvars` before applying; from then on, later versions can be installed with the button.

### Added
- The **Update** button (opt-in, `self_update = true`): owners update the instance to the newest release from the web app. A CodeBuild project in the instance's account downloads the release tag, snapshots the database, builds it and runs `terraform apply` with the instance's own settings (saved to SSM by every apply) and state; the page shows the step and the log. One update at a time, only to the newest release, owners only. `tf.sh` now passes the state location; the deploy policy adds CodeBuild and SSM. Locally, `GUIDEPASS_DEMO_UPDATER=1` shows the button with a pretend update.
- Browser tests (Playwright) in CI: the web app against the local API with a fresh database, on a desktop and a phone screen — team setup, naming yourself, uploading a guide with the dry-run check, a tester's run with a screenshot as proof of a fail, the owner reading the result. `npm run test:e2e`. The local API takes `GUIDEPASS_DATA_DIR` and the web dev server `GUIDEPASS_API`.

## [0.2.0] - 2026-10-05

**Updating from 0.1.0:** check out `v0.2.0` and run `./tf.sh <instance> apply` as usual. Terraform adds a private S3 bucket for screenshots and lets the API Lambda use it; the deploy policy already covers it (`gp-*` buckets). Reload Guidepass in open browser tabs afterwards.

### Added
- Screenshots as proof: testers attach up to 5 images to a result from the phone's camera or gallery. They are scaled down in the browser (longest side 1600 px, JPEG), uploaded straight to a private S3 bucket with a signed form valid for 2 minutes (key, type and size checked by S3, then by the API), and shown to the team and to agents (`get_results`) through links that expire in an hour. A screenshot counts as proof for a fail or for a pass that needs proof; the last proof of such a result can't be removed. Locally, screenshots are kept in `api/.data/evidence`. Migration `0010`; Terraform adds the bucket, its CORS rule, the Lambda permission and the bucket in the Content-Security-Policy.

## [0.1.0] - 2026-10-03

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
- `npm audit` is clean: drizzle-kit's old loader (`@esbuild-kit/core-utils`) now uses the current esbuild through an npm override instead of esbuild 0.18 with GHSA-67mh-4wv8-2f99 (dev-server only; it never reached the Lambda or web builds). CI also fails when the database schema changed without a committed migration.
- CI on GitHub Actions for every pull request and push to `main`: typecheck, oxlint, tests and build, plus `terraform fmt` and `validate` (no AWS access needed).
- API tests share one migrated PGlite database per test file and empty it between tests: the suite runs about four times faster and no longer times out on a busy machine.
- Terraform state in S3: one private, versioned, encrypted bucket per AWS account and one key per instance, with S3 locking. `infra/tf.sh <instance> …` selects the instance's state and variables (`bootstrap` creates the bucket); workspaces and local state are no longer used.
- How to connect an AI agent: step-by-step guide on the Team page for every member (English and Ukrainian), shown with the real command right after an owner creates a token, and `docs/connect-agent.md`. The connect command now uses `--scope user`.
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
- Names and authorship: owners can give a name when inviting (it fills the person's name if they have none), people without a name are asked for one, members are sorted by name. Guide pages show who created and last updated a guide, with a version history (author, date, note); uploads through MCP show as "<person> via agent “<token>”". The home list shows the author of the current version; `get_guide` and `list_guides` return it too.
- Footer with links to the source code, agent connection guide, guide-writing instructions, documentation and issues, the version and the MIT License.
- Agent tokens are held by a team member: owners pick whose agent a token is for when creating it and can hand it to another member later. Uploads record the holder at upload time; when handing a token over, the owner can move its earlier uploads to the new holder too (for a token given under the wrong name). Agents whose holder left the team are refused, and removing a member revokes their tokens. Migration `0007`: existing tokens and their uploads stay with the owner who created them; tokens of people no longer in the team are revoked.
- `infra/tf.sh` builds the API and the web app before `plan` and `apply` (`GP_SKIP_BUILD=1` skips it), so a deploy can't silently use an old build.
- Runs record the build and/or commit actually tested (one is required) and the app account and role used; they show on the run, the guide's runs, every result and in MCP `get_results`.
- A `blocked` result for scenarios that couldn't be checked (environment down, no test data); one person's pass outweighs it.
- Proof and issue links on results: every fail needs proof, and so does a pass on scenarios marked `evidence: true` (auth, privacy, security). Proof that looks like a token or key is refused. Scenarios can name an `automated` test that also covers them; it is shown apart and never counts as a pass. Migration `0008`.
- Guide instructions: separate guides per area for the dev build, production checks in their own guide, proof and automated tests, account names testers record.
- Status buttons on a run sit in two rows on phones.
- A `writer` role between owner and tester: writers upload and archive guides, add areas and create agent tokens for themselves only, and see only their own tokens; testers see and can revoke the tokens an owner gave them. Owners keep apps, environments, members, Slack and everyone's tokens.
- Ready for open source: CONTRIBUTING, SECURITY (private vulnerability reports), issue and pull request templates, Dependabot, package metadata; README with an overview and links to deployment and agent docs; neutral examples instead of project names.
- Security before going public: Markdown in guides and proof keeps only text formatting and web links (no forms, styles or images); CloudFront sends a Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff` and a referrer policy; the deploy policy only passes roles to Lambda, attaches only the Lambda logging policy and lets KMS grants go only to AWS services, and the docs say plainly that deploy credentials are administrator-level; malformed agent tokens are refused without a database call; request bodies are limited to 256 KB; two owners can't demote each other at once; the local dev API listens on 127.0.0.1 only; agent-token docs match the per-member tokens.
- `@types/node` follows the Lambda runtime (Node 22); Dependabot skips its major updates.
- Password rules are an install setting (`password_policy` in Terraform): by default at least 8 characters and no required character types (was 10 with upper, lower case and a number). The sign-in screen lists the rules when people choose a password and ticks them off as they type; a password that doesn't meet them isn't sent.
- Versions and updates: one Guidepass version (root `package.json`), shown in the footer and at `GET /api/version`; owners see a banner and *Settings → Version* when a newer GitHub release exists (checked at most daily, cached in the database, nothing about the instance sent; `update_repository` in Terraform, empty turns it off). A *Release* workflow publishes `vX.Y.Z` tags with their changelog section. How to update and roll back: `docs/updating.md`. Migration `0009`.
