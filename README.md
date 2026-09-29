# Guidepass

A small web app for manual testing. An AI agent writes test guides for a build, people run them on their devices and mark each scenario, and the agent reads the results back through MCP to fix bugs and update the guide.

## Concepts

- **Team** — people with a role: `owner` or `tester`. New members join by email invitation.
- **App** — something the team tests, e.g. a mobile app with iOS and Android builds.
- **Area** — a feature or module inside an app (MFA, wallet, chat…). Guides are grouped by area.
- **Guide** — the test plan for a build, branch or PR: context, changelog, prerequisites and scenarios. Every upload creates a new **version**; runs stay attached to the version they were made against.
- **Scenario** — steps plus the expected result. Each scenario has a stable `key`, so results can be compared across guide versions.
- **Run** — one tester × one guide version × one platform × one device. Each scenario gets a status (`untested`, `pass`, `fail`, `skip`) and an optional note.

## Repository layout

| Path | What |
| --- | --- |
| `infra/` | Terraform for AWS |
| `api/` | Lambda handlers behind API Gateway |
| `web/` | Responsive web app |
| `mcp/` | Remote MCP server for AI agents |
| `packages/schema/` | JSON Schema for guides, with examples |

## Self-hosting

Guidepass is meant to be deployed into your own AWS account, next to existing infrastructure: it can use an existing Cognito user pool or create a new one, and it gets its own database, API Gateway and Lambda name prefix.

Setup instructions will follow with the first release.

## License

[MIT](LICENSE)
