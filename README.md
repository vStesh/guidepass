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

## Repository layout

| Path | What |
| --- | --- |
| `infra/` | Terraform for AWS |
| `api/` | Lambda handlers behind API Gateway |
| `web/` | Responsive web app |
| `mcp/` | Remote MCP server for AI agents |
| `packages/schema/` | JSON Schema for guides, with examples |

## Self-hosting

Guidepass is deployed once per project, into the AWS account where that project already lives, on a subdomain of the project's domain (for example `gp.example.com`). Several instances can share one AWS account.

Each instance sits next to existing infrastructure without touching it:
- its own database, API Gateway and Lambda name prefix;
- an existing Cognito user pool, or a new one;
- DNS in one of three ways: records in an existing Route 53 hosted zone in the same account; a new hosted zone for the subdomain, delegated from wherever the parent domain is managed; or no custom domain at first, using the AWS default domains;
- the initial list of environments (default `dev`, `stg`, `prod`), which an owner can change later in the app.

Setup instructions will follow with the first release.

## License

[MIT](LICENSE)
