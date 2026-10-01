import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GuideContent, GuideType, Platform, ResultStatus } from "@guidepass/schema";

// Arrays are stored as jsonb: the Aurora Data API does not accept array parameters.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/**
 * People, keyed by the Cognito `sub`. Email is not unique: an account recreated
 * in Cognito keeps its email but gets a new `sub`.
 */
export type Locale = "en" | "uk";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  /** Interface language; guides keep the language they were written in. */
  locale: text("locale").$type<Locale>().notNull().default("en"),
  createdAt: createdAt(),
});

export type Role = "owner" | "tester";

export const memberships = pgTable(
  "memberships",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export type InvitationStatus = "pending" | "accepted" | "revoked";

/**
 * Invitations are matched by verified email on sign-in: nobody needs a link,
 * signing in with the invited email is enough.
 */
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  /** Stored lowercased. */
  email: text("email").notNull(),
  /** Name the owner typed when inviting; becomes the person's name if they have none. */
  name: text("name"),
  role: text("role").$type<Role>().notNull(),
  status: text("status").$type<InvitationStatus>().notNull().default("pending"),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export type TokenScope = "read" | "write";

/** Tokens AI agents use for MCP. Only a SHA-256 hash is stored; the token is shown once. */
export const agentTokens = pgTable("agent_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  scope: text("scope").$type<TokenScope>().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Instance-wide list of environments, seeded at deploy and edited by owners. */
export const environments = pgTable("environments", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  archived: boolean("archived").notNull().default(false),
});

export type SlackEvent = "guide_created" | "guide_updated" | "run_problems";
export const slackEvents: SlackEvent[] = ["guide_created", "guide_updated", "run_problems"];

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    platforms: jsonb("platforms").$type<Platform[]>().notNull(),
    /** Display names of the app's own platforms (built-in ones are translated in the UI). */
    platformNames: jsonb("platform_names").$type<Record<string, string>>().notNull().default({}),
    /** Slack Incoming Webhook for this app's notifications. A secret: never returned by the API. */
    slackWebhookUrl: text("slack_webhook_url"),
    slackEvents: jsonb("slack_events").$type<SlackEvent[]>().notNull().default(["guide_created", "guide_updated"]),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.teamId, t.slug)],
);

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id").notNull().references(() => apps.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.appId, t.slug)],
);

export type GuideStatus = "active" | "archived";

export const guides = pgTable(
  "guides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id").notNull().references(() => apps.id),
    areaId: uuid("area_id").references(() => areas.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    type: text("type").$type<GuideType>(),
    build: text("build"),
    branch: text("branch"),
    pr: text("pr"),
    environments: jsonb("environments").$type<string[]>().notNull(),
    status: text("status").$type<GuideStatus>().notNull().default("active"),
    currentVersion: integer("current_version").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.appId, t.slug)],
);

export const guideVersions = pgTable(
  "guide_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guideId: uuid("guide_id").notNull().references(() => guides.id),
    version: integer("version").notNull(),
    content: jsonb("content").$type<GuideContent>().notNull(),
    changeNote: text("change_note"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdByTokenId: uuid("created_by_token_id").references(() => agentTokens.id),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.guideId, t.version)],
);

/** One tester × one guide version × one environment × one platform × one device. */
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  guideVersionId: uuid("guide_version_id").notNull().references(() => guideVersions.id),
  testerId: text("tester_id").notNull().references(() => users.id),
  environmentKey: text("environment_key").notNull().references(() => environments.key),
  platform: text("platform").$type<Platform>().notNull(),
  device: text("device").notNull(),
  startedAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type { ResultStatus };

export const results = pgTable(
  "results",
  {
    runId: uuid("run_id").notNull().references(() => runs.id),
    scenarioKey: text("scenario_key").notNull(),
    status: text("status").$type<ResultStatus>().notNull(),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.scenarioKey] })],
);
