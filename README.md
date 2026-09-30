# Guidepass

A small web app for manual testing. An AI agent writes test guides for a build, people run them on their devices and mark each scenario, and the agent reads the results back through MCP to fix bugs and update the guide.

## Concepts

- **Team** — people with a role: `owner` or `tester`. New members join by email invitation.
- **App** — something the team tests, e.g. a mobile app with iOS and Android builds.
- **Area** — a feature or module inside an app (MFA, wallet, chat…). Guides are grouped by area.
- **Environment** — where a build is tested, e.g. `dev`, `stg`, `prod`. The list is set when Guidepass is deployed and can be edited later by an owner: add, rename, reorder, archive. Each environment has a stable `key` and a display name.
- **Guide** — the test plan for a build, branch or PR: context, changelog, prerequisites, scenarios, and the environments it must be run on. Every upload creates a new **version**; runs stay attached to the version they were made against.
- **Scenario** — steps plus the expected result. Each scenario has a stable `key`, so results can be compared across guide versions. A scenario can be limited to some platforms or environments.
- **Run** — one tester × one guide version × one environment × one platform × one device. Each scenario gets a status (`untested`, `pass`, `fail`, `skip`) and an optional note. Several people can run the same guide; results are combined per environment and platform.

## Languages

- **Interface:** English by default, Ukrainian available. Each person picks their language in their profile (`locale`). The API returns error codes with English messages; the web app shows its own translation for each code.
- **Guides:** written in the language set for the instance (`guide_language`), independent of anyone's interface language.

## Repository layout

| Path | What |
| --- | --- |
| `infra/` | Terraform for AWS |
| `api/` | Lambda handlers behind API Gateway |
| `web/` | Responsive web app (React, Vite), English and Ukrainian |
| `mcp/` | Design and usage of the remote MCP server for AI agents (code in `api/src/mcp/`) |
| `docs/` | Guides for people using Guidepass, e.g. [connecting an AI agent](docs/connect-agent.md) |
| `packages/schema/` | JSON Schema for guides, with examples |

## Development

Requires Node.js 22+.

```bash
npm install
npm test            # all workspaces
npm run typecheck
npx oxlint .
npm run dev -w api  # API on http://localhost:8787/api, data in api/.data
npm run dev -w web  # web app on http://localhost:5173, proxies /api to the API
```

Locally the API uses PGlite (Postgres in Node) and trusts an `x-local-user: you@example.com` header instead of Cognito; the Lambda handler always verifies Cognito tokens. Without a `/config.json` the web app runs in the same local mode: sign in with any email, no password. Deployed instances get `/config.json` from Terraform (see `web/public/config.example.json`). After changing `api/src/db/schema.ts`, run `npm run db:generate -w api` and commit the new migration.

## Self-hosting

Guidepass is deployed once per project, into the AWS account where that project already lives, on a subdomain of the project's domain (for example `gp.example.com`). Several instances can share one AWS account.

Each instance sits next to existing infrastructure without touching it:
- its own database, API Gateway and Lambda name prefix;
- an existing Cognito user pool, or a new one;
- DNS in one of three ways: records in an existing Route 53 hosted zone in the same account; a new hosted zone for the subdomain, delegated from wherever the parent domain is managed; or no custom domain at first, using the AWS default domains;
- the initial list of environments (default `dev`, `stg`, `prod`), which an owner can change later in the app.

Setup instructions will follow with the first release.

## What it costs to run

Monthly estimate for one instance in `eu-central-1` (Frankfurt), on-demand prices from the AWS Price List (September 2026). Prices in other regions differ by roughly ±20%.

Almost everything is pay-per-use. The only fixed cost is the database password secret; the database itself pauses after 15 idle minutes and then costs only its storage.

| Usage | Database time | Estimate |
| --- | --- | --- |
| Idle: installed, nobody signs in | paused | **≈ $0.60** |
| Light: a small team tests ~2 hours a day on workdays | ~50 h | **≈ $4** |
| Busy: testing through the whole working day | ~180 h | **≈ $14** |
| Never pauses (`db_min_capacity = 0.5`) | 730 h | **≈ $52** |

Guidepass's load is small (a few people marking scenarios), so the database stays at its 0.5 ACU minimum while awake; the estimates assume that. Sustained heavier load at 1 ACU doubles the database part (busy month ≈ $26). Nights and weekends cost nothing, because the database is asleep.

Where the money goes:

| Service | Price (Frankfurt) | Typical share |
| --- | --- | --- |
| Aurora Serverless v2 capacity | $0.14 per ACU-hour; nothing while paused | almost all of it when in use |
| Aurora storage and I/O | $0.119 per GB-month, $0.22 per million I/O | cents; the database stays well under 1 GB for a long time |
| Secrets Manager (RDS-managed password) | $0.40 per secret per month | fixed $0.40 |
| RDS Data API | $0.42 per million calls | cents |
| API Gateway (HTTP API) | $1.20 per million requests | cents |
| Lambda (arm64) | $0.20 per million requests, $0.0000133 per GB-second; always-free tier of 1 M requests and 400,000 GB-seconds a month | usually $0 |
| CloudFront | always-free tier of 1 TB out and 10 M requests a month | usually $0 |
| Cognito user pool | free up to 10,000 monthly active users | $0 |
| S3, CloudWatch Logs, ACM certificate, VPC (no NAT) | a few MB of files and logs; certificates and the VPC are free | cents |
| Route 53 | $0.50 per hosted zone per month, only if Terraform creates a zone (the delegated-subdomain option) | $0 or $0.50 |

Keeping costs down:
- Leave `db_min_capacity = 0` (the default). The first request after a pause waits up to ~15 seconds while the database wakes up; everything after that is fast.
- `db_max_capacity` caps the database: 2 ACU by default ($0.28 an hour at most); 1 ACU is enough for this workload and halves the worst case.
- Set an AWS Budgets alert on the account; Guidepass tags every resource with `Project = guidepass` and `Instance = <name_prefix>`, so cost reports can filter by instance.

Why Aurora Serverless v2 and not a regular RDS instance: the smallest RDS for PostgreSQL (`db.t4g.micro`, $0.019 an hour, plus 20 GB of gp3 storage) is about $16.60 a month and never pauses. RDS has no Data API either, so the Lambdas would have to run inside the VPC and need a VPC endpoint for Cognito (about $8.76 a month per availability zone) or a NAT gateway (about $38 a month plus traffic). That makes it about $26–35 a month whether anyone tests or not, against about $14 for a busy month and $0.60 for an idle one on Aurora.


## License

[MIT](LICENSE)
