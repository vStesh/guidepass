# Connect an AI agent

Guidepass has a remote [MCP](https://modelcontextprotocol.io) server, so an AI agent can write test guides, upload them, and read what testers found. This guide sets it up for [Claude Code](https://claude.com/claude-code); any MCP client that supports Streamable HTTP with a custom header works the same way.

The same steps, in English and Ukrainian, are on the **Team** page of every instance (*How to connect an AI agent*).

## 1. Get a token

Agent tokens are created on the **Team** page: **writers** create tokens for themselves (*My agent tokens*), **owners** for anyone in the team (*AI agent tokens*). Two kinds:

- **Read** — list apps and guides, read guides and results. Enough for analysis.
- **Read and write** — also create areas, upload guides and new versions, archive guides.

The token (`gp_…`) is shown once. Owners give it to the person who will use it privately — never in a shared channel. Testers who want an agent ask an owner for a token (or to be made a writer); they can't create one themselves, but they see and can revoke the tokens they hold.

A token belongs to the team, not to a person: it keeps working if the person who created it leaves. Revoke tokens that are no longer needed; the page shows when each was last used.

## 2. Add Guidepass to Claude Code

```bash
claude mcp add --scope user --transport http guidepass https://gp.example.com/mcp --header "Authorization: Bearer gp_..."
```

- Replace `https://gp.example.com` with your instance's address and `gp_...` with the token. Right after creating a token, the Team page shows this command with both filled in.
- `--scope user` makes Guidepass available in every folder. Without it, it's only available in the folder where you ran the command.

## 3. Start a new session and check

MCP servers load when a Claude Code session starts: open a new session.

```bash
claude mcp list
```

`guidepass` should show as connected. Then ask the agent: *"Show the apps in Guidepass."*

## 4. What to ask

- *"Write a test guide for build 181 from its CHANGELOG and upload it to Guidepass. Check it with a dry run first."*
- *"What failed in testing build 179, and on which devices?"*
- *"I fixed the reply threading bug: update the build 179 guide and tell me which scenarios need retesting."*
- *"Which key scenarios of the latest guide are still not checked on Android?"*

Before writing a guide, the agent reads the team's instructions, guide language, environments and JSON Schema through `get_guide_instructions`; the app's platforms come from `list_apps`. Uploads are validated by the server, and updating a guide requires the version the agent read (`baseVersion`), so concurrent changes are never overwritten.

## What agents can't do

- Agents never create runs or mark results: results are what people saw on their devices.
- Nothing can be deleted through MCP.
- App settings, environments, people, tokens and Slack are managed in the web app only.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `guidepass` isn't in the session | Start a new session; check `claude mcp list`. |
| 401 `unauthenticated` | The token is wrong or revoked. Ask an owner for a new one, then `claude mcp remove guidepass --scope user` and add it again. |
| "Token has read scope; upload_guide needs write." | Ask an owner for a *Read and write* token. |
| "… is not one of the app's platforms" | The guide uses a platform the app doesn't have (for example `api`). An owner adds it on the app page (*Platforms*). |
| "unknown environment" | Use the environment keys from `get_guide_instructions`; owners manage them on the Settings page. |
| The first request is slow | The database was asleep and is waking up (up to ~15 seconds). |

## Keep the token safe

Don't commit it, don't paste it into chats or tickets. If it leaks, an owner revokes it on the Team page — access stops immediately — and creates a new one.

The design behind the MCP server is in [`mcp/DESIGN.md`](../mcp/DESIGN.md).
