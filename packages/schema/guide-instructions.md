# How to write a Guidepass test guide

These are the default instructions an AI agent receives (through the MCP tool `get_guide_instructions`) before it writes or updates a guide. A team can replace them with its own.

A guide is read by a person holding a phone, often in a hurry, sometimes without the context of the change. It has to tell them what changed, what to prepare and what to check, and nothing else. The output is JSON that validates against `guide.schema.json`.

## 1. Gather the sources first

Before writing, read what describes the change:

- the changelog entry for the build, if the repository keeps one;
- the pull or merge request: title, description, linked issues;
- the diff, to find behavior the description does not mention (edge cases, error handling, permissions, migrations, anything that touches other screens);
- the previous guide for the same area, if one exists, to reuse its wording and find scenarios that this change makes obsolete.

If the sources contradict each other, trust the diff and mention the discrepancy in `context`.

## 2. Language

Write in the language the team uses for guides (the MCP tool returns it with these instructions). Scenario `key` values are always lowercase English kebab-case.

## 3. Fields

**`title`** — `Build <n> — <what changed>`, or `<branch or PR> — <what changed>` when there is no build number. Short enough to fit on one line on a phone.

**`type`** — what the build changes, from the changelog: `feature` (new behaviour — mostly "Added"), `bugfix` (something broken now works — mostly "Fixed"), `improvement` (existing behaviour changed or made better — mostly "Changed"), `mixed` when a build has more than one of these in similar measure.

**`build`, `branch`, `pr`** — fill in whatever identifies the build under test.

**`meta`** — one line of technical context for people who need it: backend versions, migrations, environment, commit. Testers may skip it.

**`environments`** — where the guide must be run, using the environment keys configured for this instance (the MCP tool returns them). Pick the environments where the change is actually deployed or about to be: usually the development environment first; add staging or production when the guide should be repeated there after a deploy. If a scenario only makes sense in some of them (for example, checking that an older backend still works), set `environments` on that scenario.

**`context`** — 3–6 sentences for the tester, not for a developer:
- what the user will notice now, described as behavior on screen;
- why it changed, if that helps to test it (for example, the bug that was reported);
- known limitations and what is deliberately out of scope;
- what has already been checked, and where (for example, "passed on the iOS simulator, not on a device").

Use **bold** for the one or two things that matter most. Put code names (functions, components) in the changelog, not here.

**`changelog`** — sections `Added`, `Changed`, `Fixed`, `Removed` (in the guide's language). One item per user-visible change; implementation details are fine here, in `code` formatting.

**`prerequisites`** — everything the tester must have before starting, as a checklist:
- minimum build and platforms;
- anything environment-specific: which backend version must be deployed there, which test accounts exist there;
- accounts and roles, and how many devices (for example, two accounts on two devices for anything involving another user); name them the way testers will record them in a run (for example "A — author", "B — moderator");
- conditions to reproduce (airplane mode, a location, a specific kind of data).

**`related`** — PR, issue, commit, changelog and design-doc references, with URLs where there are any.

## 4. Scenarios

Aim for 5–12 scenarios. More than that usually means the guide covers two changes and should be split. Separate areas (for example auth, a mobile smoke test, replies) get separate guides, each for the build under test in development; checks after a production release go in a guide of their own.

Order them like this:
1. the main happy path of the change;
2. the other behaviors the change introduced;
3. edge cases: no network, retries, empty states, limits, permissions, another role;
4. regression checks for nearby features the diff touched;
5. platform-specific checks.

For each scenario:

- **`key`** — a short English kebab-case id that describes the check (`reply-to-comment`, `retry-after-network-error`). It must stay the same when the scenario is edited later, because results are matched by key across guide versions. Never reuse a key for a different check.
- **`title`** — what is being checked, in a few words.
- **`important: true`** — for the one to three checks that must pass before the build can go further. Usually the main happy path and the riskiest edge case.
- **`platforms`** — set only when the scenario applies to some of the app's platforms (`["android"]`). Leave it out when it applies to all. Use the app's platform keys from `list_apps`: built-in `ios`, `android`, `web`, `api`, and the app's own (for example `admin`). **Backend-only changes** (a Lambda, an API endpoint, a migration) get `platforms: ["api"]` — only if the app has the `api` platform in `list_apps`; if it doesn't, ask the user to add it on the app page first: the tester checks them with an HTTP client, logs or the database, and the steps say exactly what to call or look at. If a backend change is also visible in the apps, add a separate scenario for that on the app platforms.
- **`environments`** — set only when the scenario applies to some of the guide's environments. Leave it out when it applies to all.
- **`evidence: true`** — for auth, privacy and security checks, where a pass must be proven: the tester attaches a sanitized request and response, a CI link, a screenshot or a video. Every fail needs proof anyway. Say in `expected` what the proof should show (for example "403 for another user's report").
- **`automated`** — if an automated test also covers the scenario, name it (CI job, test file). It is shown apart from people's results and never counts as a pass: the scenario is still checked on a device.
- **`steps`** — 1–4 imperative steps. Name who does what when there is more than one account ("A writes a comment", "B taps Reply"). Use the exact labels the user sees on screen, in quotes.
- **`expected`** — what the tester must see, concretely enough to decide pass or fail without asking anyone. Include what must *not* happen when that is the risk ("the drawer does not open", "only one reply appears, not two"). If the result persists, say to reopen the screen and check again.

One scenario checks one thing. If `expected` needs "and also" for an unrelated behavior, split it.

## 5. Updating a guide

Every upload creates a new version; runs keep pointing at the version they were made against.

- Keep the `key` of every scenario that still checks the same thing, even if its wording changes.
- When a later build changes a behavior, do not delete the old scenario if people have results for it. Set `deprecated.reason` to what changed and where to look instead ("Changed in build 172: a Retry button was added — see the build 172 guide").
- Add a new scenario with a new key for new behavior.
- After a fix, update `context` with what was fixed and add a scenario that reproduces the original failure.
- Describe the update in one sentence in the version's change note.

## 6. Before uploading

Check that:
- the JSON validates against the schema, and every environment key is one the instance has;
- every `key` is unique in the guide;
- every scenario can be passed or failed from its `expected` alone;
- prerequisites cover every account, device and condition the steps mention;
- nothing in the guide asks the tester to handle real secrets or real payment details — use test accounts and test cards, and say where to get them;
- the guide doesn't claim anything was tested: writing a scenario is not a pass. Only testers mark results, with the build or commit and the account they used.
