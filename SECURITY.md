# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it and what an attacker could do with it.

You'll get a reply within a few days. Once a fix is released, we'll credit you in the changelog if you want.

## Supported versions

Guidepass is self-hosted. Fixes land on `main` and in the next release; update your instance by deploying the latest release (see [infra/README.md](infra/README.md)).

## Scope

In scope: the API and MCP server (`api/`), the web app (`web/`), the guide schema (`packages/schema/`) and the Terraform in `infra/`.

Out of scope: your AWS account's own configuration, Cognito user pools Guidepass didn't create, and denial of service by volume.

## For people running an instance

- **Agent tokens** grant access to your instance's guides and results. Each token belongs to one member: owners issue them (the "Whose agent" field) and send them privately, writers create their own. Removing a member revokes their tokens; revoke unused ones on the Team page.
- **Proof on results** is visible to the whole team and to agents. Guidepass refuses text that looks like a token or key, but it can't catch everything: share sanitized requests only, and crop screenshots that show other people's data. Screenshots live in a private bucket and are only reachable through links that expire in an hour.
- **Slack webhooks** are visible to owners only; treat them as secrets.
- Deploy with the least-privilege policy in `infra/deploy-policy.json` rather than administrator credentials.
- **The Update button** (`self_update`) gives a CodeBuild project the same permissions as the deploy policy. Only owners can start it, and only for the newest `vX.Y.Z` release of `update_repository`; point that at a repository you trust (a fork you control, or the upstream one).
