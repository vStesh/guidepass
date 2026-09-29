# MCP server design

The MCP server lets an AI agent take part in the testing loop: read how to write a guide, upload guides for a build, read what people found, and upload an updated guide after a fix.

```
agent writes guide ──► people run it on devices ──► agent reads results
        ▲                                                   │
        └──────────── agent fixes and updates guide ◄───────┘
```

## Principles

1. **People test, the agent does not.** The agent never creates runs or sets a scenario's status. Results are only what a person observed on a device.
2. **Nothing is deleted through MCP.** The agent can add guides and versions and archive a guide, but it cannot delete guides, versions, runs or results.
3. **Few tools, each with a clear job.** Every extra tool is something the model has to choose between. Reads are merged where the agent always needs the data together.
4. **Errors tell the agent what to do next.** Validation errors come back as a list of JSON paths and messages, so the agent can fix the guide and try again.
5. **Every write is attributable.** Each guide version records which agent token created it.

## Transport and hosting

- Streamable HTTP, stateless (no MCP session state between requests) with JSON responses, served by the API Lambda at `/mcp`, next to `/api` on the same domain.
- Built with the official TypeScript SDK (`@modelcontextprotocol/sdk`).
- The Lambda reads and writes Postgres through the Aurora Data API, like the rest of the API.

## Authentication

- **Agent tokens**, created by a team owner in the web app and shown once. Stored as a SHA-256 hash in `agent_tokens`. Format `gp_<random>`, so they are easy to spot in logs and secret scanners.
- Sent as `Authorization: Bearer gp_…`. A token belongs to one team; every tool call is limited to that team's data.
- **Scopes:** `read` (read tools only) and `write` (read tools plus write tools). A token used only for analysis gets `read`.
- Owners can revoke a token; `last_used_at` is updated on use.
- A token belongs to the team, not to the person who created it: it keeps working if that person leaves the team or stops being an owner. Revoke it on the Team page when it's no longer needed.
- Connecting from Claude Code:

  ```bash
  claude mcp add --transport http guidepass https://<api-domain>/mcp --header "Authorization: Bearer gp_..."
  ```

- **Later:** OAuth 2.1 with Cognito as the authorization server, so the server can be added as a connector in claude.ai and other clients that require OAuth.

## Tools

### Read (`read` scope)

#### `list_apps`
Apps in the team, with their platforms and areas. The agent calls this first to find the ids it needs.

- Input: none.
- Output: `apps[]` with `id`, `slug`, `name`, `platforms`, and `areas[]` (`id`, `slug`, `name`, `activeGuides`).

#### `get_guide_instructions`
How to write a guide for this team: the instructions (Markdown), the language guides are written in, the environments configured for this instance, and the guide JSON Schema. The agent must call this before writing or updating a guide.

- Input: none.
- Output: `language`, `environments[]` (`key`, `name`, in display order), `instructions`, `schema`.

#### `list_guides`
Guides of an app, newest first, with progress per platform.

- Input: `appId`; optional `areaId`, `status` (`active` default, `archived`, `all`), `build`, `environment`, `limit` (default 20).
- Output: `guides[]` with `id`, `slug`, `title`, `areaId`, `build`, `branch`, `pr`, `environments`, `status`, `currentVersion`, `updatedAt`, `testers` (how many people have runs on the current version), and `progress` per environment and platform: `pass`, `fail`, `conflict`, `skip`, `untested` counts of scenarios, using the combined verdicts described in [Several testers on one guide](#several-testers-on-one-guide).

#### `get_guide`
Full content of one guide version, plus the version history.

- Input: `guideId`; optional `version` (default: current).
- Output: `guide` (metadata), `version`, `content` (guide JSON), `versions[]` (`version`, `changeNote`, `createdBy`, `createdAt`).

#### `get_results`
What people found for a guide: for every scenario and platform, each tester's result with their note and device, plus the combined verdict. This is the tool the agent uses after a test session.

- Input: `guideId`; optional `version` (default: current), `environment`, `platform`, `testerId`, `filter` (`problems` default — scenarios whose verdict is `fail`, `conflict` or `skip`, and important scenarios still `untested`; `all`).
- Output:
  - `runs[]`: `id`, `tester` (`id`, `name`), `environment`, `platform`, `device`, `startedAt`, `finishedAt`, and the run's own `pass`, `fail`, `skip`, `untested` counts — runs on the requested version only (results carried over from older versions name their tester and device inline);
  - `scenarios[]`: `key`, `title`, `important`, and per environment and platform:
    - `verdict` — combined across all runs (see below);
    - `results[]` — one entry per run that has a result for this scenario: `runId`, `tester`, `device`, `status`, `note`, `updatedAt`, `fromVersion`.
- `fromVersion` is set when the result was recorded against an older version and the scenario is unchanged since then (same key, same steps and expected). Results for changed scenarios are not carried over.

### Several testers on one guide

A guide is usually run by several people from the team at once, each on their own devices. Every person has their own runs; nobody's marks overwrite anyone else's.

- A run belongs to one tester, one guide version, one environment (from the guide's list), one platform and one device. One tester can have several runs on the same platform, for example on a Pixel and on a Samsung.
- The agent always sees every tester's result separately, with their notes — a failure on one device next to a pass on another is often the most useful thing in a test session.
- For progress and filtering, the results of one scenario in one environment on one platform are combined into a **verdict** (a pass on dev says nothing about staging, so environments are never mixed):

  | Results from all runs | Verdict |
  | --- | --- |
  | at least one `fail` and at least one `pass` | `conflict` — passed for some, failed for others; the agent should compare devices and notes |
  | at least one `fail`, no `pass` | `fail` |
  | at least one `pass`, no `fail` | `pass` |
  | only `skip` | `skip` |
  | no results | `untested` |

- The web app shows the same verdicts, and who is testing which platform right now, so people can split the work instead of repeating each other.

### Write (`write` scope)

#### `create_area`
Add an area to an app, when a guide covers a feature that has no area yet.

- Input: `appId`, `slug`, `name`.
- Output: `area`.
- Fails if the slug already exists in the app (and returns the existing area).

#### `upload_guide`
Create a guide, or add a new version of an existing one.

- Input:
  - `appId`, `areaId` (optional), `slug` (e.g. `build-179`);
  - `content` — guide JSON;
  - `changeNote` — one sentence on what changed (required for new versions);
  - `baseVersion` — required when the guide exists: the version the agent read. If someone uploaded a newer version meanwhile, the call fails with the current version number, so updates are never silently overwritten;
  - `dryRun` (default `false`) — validate and report, without saving.
- Checks, in order:
  1. JSON Schema validation; errors returned as `{ path, message }[]`.
  2. Unique scenario keys; every environment key exists in the instance, and scenario environments are a subset of the guide's.
  3. When updating: a scenario key that has results in earlier versions must not disappear — it has to stay, or be marked `deprecated`. The error names the keys.
- Output: `guideId`, `version`, `url` (web page of the guide), and a `diff` against the previous version: `added`, `changed`, `deprecated`, `unchanged` keys — so the agent can tell the user which scenarios need to be run again.

#### `set_guide_status`
Archive a guide that no longer matters (the build is released or superseded), or make an archived guide active again.

- Input: `guideId`, `status` (`active` or `archived`).
- Output: `guide`.

## Not in MCP (v1)

- Creating runs or setting results — people only, by principle 1.
- Deleting anything — by principle 2.
- Creating apps, managing members, invitations and tokens — web app only.
- MCP resources and prompts. Everything the agent needs is reachable through tools; a `write_guide` prompt can be added later for clients that surface prompts.

## Errors

Tool errors are returned as tool results with `isError: true` and a short instruction, for example:

- `Guide build-179 already exists at version 3; pass baseVersion: 3 to add a version.`
- `Scenario keys removed but have results: reply-to-comment. Keep them or mark them deprecated.`
- `Token has read scope; upload_guide needs write.`

Authentication failures return HTTP 401 before any tool runs.

## Data model additions

- `agent_tokens.scope` (`read` or `write`).
- `environments` (`key`, `name`, `position`, `archived`) and `runs.environment_key`.
- `guide_versions.created_by_token_id` alongside `created_by_user_id`, exactly one of them set.

## Typical session

1. `list_apps` → find the app and area.
2. `get_guide_instructions`.
3. `list_guides` with `build` → does a guide for this build exist?
4. Write the guide; `upload_guide` with `dryRun: true`, fix errors; upload.
5. People test.
6. `get_results` → read failures, conflicts and notes from every tester, fix the code.
7. `get_guide` → `upload_guide` with `baseVersion` and a `changeNote`; tell the user which scenarios changed.
