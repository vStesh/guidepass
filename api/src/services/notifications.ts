import { eq, inArray } from "drizzle-orm";
import type { GuideContent, GuideType, ScenarioDiff } from "@guidepass/schema";
import type { Db } from "../db/client.ts";
import { agentTokens, apps, environments, users, type SlackEvent } from "../db/schema.ts";
import type { Author } from "./guides.ts";

/** Posts a Slack message to an Incoming Webhook. Replaced in tests. */
export type Notifier = (webhookUrl: string, message: { text: string }) => Promise<void>;

export const slackNotifier: Notifier = async (webhookUrl, message) => {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(3000),
    // Only hooks.slack.com is allowed; don't follow a redirect anywhere else.
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Slack answered ${response.status}`);
};

export interface NotificationContext {
  db: Db;
  notify: Notifier;
  /** Base URL of the web app, for links. */
  publicUrl: string;
  /** Messages use the instance's guide language, which is the team's. */
  language: string;
}

type AppRow = typeof apps.$inferSelect;

/** An app as the API returns it: the webhook URL is a secret and never leaves the server. */
export function publicApp<T extends Partial<AppRow>>(app: T) {
  const { slackWebhookUrl, slackEvents, ...rest } = app;
  return { ...rest, slack: { configured: !!slackWebhookUrl, events: slackEvents ?? [] } };
}

export const isSlackWebhook = (url: string) => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url);

const texts = {
  en: {
    created: "🆕 New guide to test",
    updated: "🔄 New version",
    retest: (n: number) => `retest ${n} scenario${n === 1 ? "" : "s"}`,
    unchanged: (n: number) => `${n} unchanged`,
    scenarios: (n: number, key: number) => `${n} scenario${n === 1 ? "" : "s"}${key ? ` (${key} key)` : ""}`,
    by: "by",
    agent: "AI agent",
    problems: "🔴 Run finished with problems",
    failed: (n: number) => `❌ ${n} failed`,
    skipped: (n: number) => `⏭ ${n} skipped`,
    blocked: (n: number) => `⛔ ${n} blocked`,
    untested: (n: number) => `${n} not checked`,
    test: "✅ Guidepass notifications are set up for",
    types: { feature: "Feature", bugfix: "Bug fix", improvement: "Improvement", mixed: "Mixed" } as Record<GuideType, string>,
  },
  uk: {
    created: "🆕 Новий гайд для тестування",
    updated: "🔄 Нова версія",
    retest: (n: number) => `перетестувати сценаріїв: ${n}`,
    unchanged: (n: number) => `без змін: ${n}`,
    scenarios: (n: number, key: number) => `сценаріїв: ${n}${key ? ` (ключових: ${key})` : ""}`,
    by: "завантажив(ла)",
    agent: "ШІ-агент",
    problems: "🔴 Прохід завершено з проблемами",
    failed: (n: number) => `❌ помилок: ${n}`,
    skipped: (n: number) => `⏭ пропущено: ${n}`,
    blocked: (n: number) => `⛔ заблоковано: ${n}`,
    untested: (n: number) => `не перевірено: ${n}`,
    test: "✅ Сповіщення Guidepass налаштовано для",
    types: { feature: "Фіча", bugfix: "Виправлення", improvement: "Покращення", mixed: "Змішане" } as Record<GuideType, string>,
  },
};

const messages = (language: string) => (language === "uk" ? texts.uk : texts.en);

/** Slack mrkdwn needs &, < and > escaped in anything that isn't a link. */
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const link = (url: string, label: string) => `<${url}|${escape(label).replace(/\|/g, "¦")}>`;

async function loadApp(db: Db, appId: string) {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  return app;
}

/** Sends if the app has a webhook and the event is on. Failures are logged, never thrown. */
async function send(ctx: NotificationContext, app: AppRow | undefined, event: SlackEvent, text: string) {
  if (!app?.slackWebhookUrl || !app.slackEvents.includes(event)) return;
  try {
    await ctx.notify(app.slackWebhookUrl, { text });
  } catch (err) {
    console.warn(`Slack notification for app ${app.id} failed:`, err);
  }
}

async function authorName(ctx: NotificationContext, author: Author) {
  const m = messages(ctx.language);
  const [user] = await ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, author.userId));
  // The channel may include people outside the team: no full email addresses.
  const person = user?.name ?? user?.email.split("@")[0] ?? "?";
  if (!author.tokenId) return person;
  const [token] = await ctx.db.select({ name: agentTokens.name }).from(agentTokens).where(eq(agentTokens.id, author.tokenId));
  return `${person} — ${m.agent} (${token?.name ?? "?"})`;
}

async function environmentNames(ctx: NotificationContext, keys: string[]) {
  if (!keys.length) return [];
  const rows = await ctx.db.select({ key: environments.key, name: environments.name }).from(environments).where(inArray(environments.key, keys));
  return keys.map((k) => rows.find((r) => r.key === k)?.name ?? k);
}

/** A guide was uploaded: a new one, or a new version with what has to be tested again. */
export async function announceGuideUpload(ctx: NotificationContext, input: GuideUpload) {
  // The upload is already saved: nothing here may turn it into an error.
  try {
    await guideUploadMessage(ctx, input);
  } catch (err) {
    console.warn("Preparing the guide notification failed:", err);
  }
}

interface GuideUpload {
  appId: string;
  guideId: string;
  version: number;
  content: GuideContent;
  changeNote?: string;
  diff: ScenarioDiff;
  author: Author;
}

async function guideUploadMessage(ctx: NotificationContext, input: GuideUpload) {
  const app = await loadApp(ctx.db, input.appId);
  const event: SlackEvent = input.version === 1 ? "guide_created" : "guide_updated";
  if (!app?.slackWebhookUrl || !app.slackEvents.includes(event)) return;

  const m = messages(ctx.language);
  const { content, diff } = input;
  const title = link(`${ctx.publicUrl}/guides/${input.guideId}`, content.title);
  const details = [
    content.type ? m.types[content.type] : null,
    (await environmentNames(ctx, content.environments)).join(", "),
  ];
  let text: string;
  if (event === "guide_created") {
    const active = content.scenarios.filter((s) => !s.deprecated);
    details.push(m.scenarios(active.length, active.filter((s) => s.important).length));
    text = `${m.created}: ${title}`;
  } else {
    const retest = diff.added.length + diff.changed.length;
    details.push(m.retest(retest), m.unchanged(diff.unchanged.length));
    text = `${m.updated} v${input.version}: ${title}${input.changeNote ? ` — ${escape(input.changeNote)}` : ""}`;
  }
  details.push(`${m.by} ${await authorName(ctx, input.author)}`);
  await send(ctx, app, event, `${text}\n${details.filter(Boolean).map((d) => escape(String(d))).join(" · ")}`);
}

interface RunProblems {
  appId: string;
  guideId: string;
  guideTitle: string;
  runId: string;
  tester: string;
  environment: string;
  platform: string;
  device: string;
  counts: { fail: number; blocked: number; skip: number; untested: number };
}

/** Someone finished a run that has failures, blocked or skipped scenarios. Never throws: the run is already saved. */
export async function announceRunProblems(ctx: NotificationContext, input: RunProblems) {
  try {
    await runProblemsMessage(ctx, input);
  } catch (err) {
    console.warn("Preparing the run notification failed:", err);
  }
}

async function runProblemsMessage(ctx: NotificationContext, input: RunProblems) {
  const { counts } = input;
  if (!counts.fail && !counts.blocked && !counts.skip) return;
  const app = await loadApp(ctx.db, input.appId);
  const m = messages(ctx.language);
  const [environment] = await environmentNames(ctx, [input.environment]);
  const platform = app?.platformNames[input.platform] ?? input.platform;
  const parts = [
    counts.fail ? m.failed(counts.fail) : null,
    counts.blocked ? m.blocked(counts.blocked) : null,
    counts.skip ? m.skipped(counts.skip) : null,
    counts.untested ? m.untested(counts.untested) : null,
  ].filter(Boolean);
  const text =
    `${m.problems}: ${link(`${ctx.publicUrl}/runs/${input.runId}`, input.guideTitle)}\n` +
    `${escape(input.tester)} · ${escape(environment ?? input.environment)} · ${escape(platform)} · ${escape(input.device)}: ${parts.join(", ")}`;
  await send(ctx, app, "run_problems", text);
}

/** Owner-triggered check; unlike other notifications it reports failures. */
export async function sendTestNotification(ctx: NotificationContext, app: AppRow) {
  if (!app.slackWebhookUrl) return false;
  const m = messages(ctx.language);
  await ctx.notify(app.slackWebhookUrl, { text: `${m.test} ${link(`${ctx.publicUrl}/apps/${app.id}`, app.name)}` });
  return true;
}
