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

**`build`, `branch`, `pr`** — fill in whatever identifies the build under test.

**`meta`** — one line of technical context for people who need it: backend versions, migrations, environment, commit. Testers may skip it.

**`context`** — 3–6 sentences for the tester, not for a developer:
- what the user will notice now, described as behavior on screen;
- why it changed, if that helps to test it (for example, the bug that was reported);
- known limitations and what is deliberately out of scope;
- what has already been checked, and where (for example, "passed on the iOS simulator, not on a device").

Use **bold** for the one or two things that matter most. Put code names (functions, components) in the changelog, not here.

**`changelog`** — sections `Added`, `Changed`, `Fixed`, `Removed` (in the guide's language). One item per user-visible change; implementation details are fine here, in `code` formatting.

**`prerequisites`** — everything the tester must have before starting, as a checklist:
- minimum build and platforms;
- environment (dev, staging, production);
- accounts and roles, and how many devices (for example, two accounts on two devices for anything involving another user);
- conditions to reproduce (airplane mode, a location, a specific kind of data).

**`related`** — PR, issue, commit, changelog and design-doc references, with URLs where there are any.

## 4. Scenarios

Aim for 5–12 scenarios. More than that usually means the guide covers two changes and should be split.

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
- **`platforms`** — set only when the scenario applies to some platforms (`["android"]`). Leave it out when it applies to all.
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
- the JSON validates against the schema;
- every `key` is unique in the guide;
- every scenario can be passed or failed from its `expected` alone;
- prerequisites cover every account, device and condition the steps mention;
- nothing in the guide asks the tester to handle real secrets or real payment details — use test accounts and test cards, and say where to get them.
