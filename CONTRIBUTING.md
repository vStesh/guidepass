# Contributing to Guidepass

Thanks for helping. Guidepass is small on purpose: a web app, an API with an MCP server, and Terraform for one AWS instance per project. Changes that keep it that way are the easiest to accept.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. Screenshots help; logs and tokens don't belong in public issues.
- **Features:** open an issue first and describe the problem it solves for testers or agents, so we can agree on the shape before you write code.
- **Security issues:** never in public issues. See [SECURITY.md](SECURITY.md).

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev -w api   # API on http://localhost:8787/api, MCP on /mcp, data in api/.data
npm run dev -w web   # web app on http://localhost:5173; sign in with any email, no password
```

Locally the API runs on PGlite (Postgres in Node) and trusts an `x-local-user` header instead of Cognito. The Lambda handler never does: it always verifies Cognito tokens.

Before opening a pull request:

```bash
npm run typecheck
npm test
npx oxlint .
```

CI runs the same checks, plus `terraform fmt -check` and `terraform validate`, and checks that the database migrations match the schema.

## Conventions

- **Database:** after changing `api/src/db/schema.ts`, run `npm run db:generate -w api` and commit the migration. Migrations run in production on deploy, so they must work on existing data (add nullable columns, backfill, then add constraints).
- **One rule, one place:** the web API and the MCP server share services in `api/src/services/`; enforce a rule there, not in a route.
- **Interface text:** every string goes into both `web/src/i18n/en.ts` and `web/src/i18n/uk.ts`; the type check fails if one is missing.
- **Guides:** the guide format is `packages/schema/guide.schema.json`, and agents follow `packages/schema/guide-instructions.md`. Change both together, and keep scenario `key`s stable: results are matched by key across versions.
- **Tests:** API behaviour is tested through HTTP and MCP in `api/src/*.test.ts`; add a test with every change in behaviour.
- **Changelog:** add a line to `CHANGELOG.md` under the unreleased version.
- **Commits:** short imperative subject (`feat: …`, `fix: …`, `docs: …`), one change per pull request.

## Licence

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
