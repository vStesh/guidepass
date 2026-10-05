import type { GuideContent, GuideType, Platform, ResultStatus, ScenarioDiff, Verdict } from "@guidepass/schema/core";
import type { Auth } from "./auth.ts";

export type Role = "owner" | "writer" | "tester";
export type Locale = "en" | "uk";

export interface User {
  id: string;
  email: string;
  name: string | null;
  locale: Locale;
}

export type SlackEvent = "guide_created" | "guide_updated" | "run_problems";

export interface Me {
  user: User;
  team: { id: string; name: string; role: Role } | null;
  /** Optional parts this instance has set up. */
  features?: { attachments: boolean };
}

/** A screenshot attached as proof; `url` works for an hour. */
export interface Attachment {
  id: string;
  contentType: string;
  size: number;
  url: string;
}

export interface Environment {
  key: string;
  name: string;
  archived: boolean;
}

export interface Area {
  id: string;
  slug: string;
  name: string;
}

export interface App {
  id: string;
  slug: string;
  name: string;
  platforms: Platform[];
  platformNames: Record<string, string>;
  slack: { configured: boolean; events: SlackEvent[] };
  areas?: Area[];
}

export interface GuideSummary {
  id: string;
  slug: string;
  title: string;
  type: GuideType | null;
  appId: string;
  appName: string;
  areaId: string | null;
  build: string | null;
  branch: string | null;
  pr: string | null;
  environments: string[];
  status: "active" | "archived";
  currentVersion: number;
  updatedAt: string;
  /** Who uploaded the current version. */
  updatedBy?: VersionAuthor;
}

/** A person in the web UI, or an agent acting for the person who issued its token. */
export type VersionAuthor =
  | { kind: "user"; userId: string; name: string }
  | { kind: "agent"; userId: string; name: string; agent: string }
  | null;

export interface GuideListParams {
  appId?: string;
  areaId?: string;
  status?: string;
  environment?: string;
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

export interface GuideDetail {
  guide: GuideSummary & { appId: string };
  version: number;
  content: GuideContent;
  versions: { version: number; changeNote: string | null; createdAt: string; author: VersionAuthor }[];
}

export interface Counts {
  pass: number;
  fail: number;
  blocked: number;
  skip: number;
  untested: number;
}

export interface RunSummary {
  id: string;
  version: number;
  tester: { id: string; name: string | null; email: string };
  environment: string;
  platform: Platform;
  device: string;
  build: string | null;
  commit: string | null;
  account: string | null;
  startedAt: string;
  finishedAt: string | null;
  counts: Counts;
}

export interface ScenarioResult {
  runId: string;
  tester: { id: string; name: string | null };
  device: string;
  build: string | null;
  commit: string | null;
  account: string | null;
  status: ResultStatus;
  note: string | null;
  evidence: string | null;
  issueUrl: string | null;
  attachments?: Attachment[];
  updatedAt: string;
  fromVersion: number | null;
}

export interface GuideResults {
  guideId: string;
  version: number;
  runs: RunSummary[];
  scenarios: {
    key: string;
    title: string;
    important: boolean;
    evidence: boolean;
    automated: string | null;
    cells: { environment: string; platform: Platform; verdict: Verdict; results: ScenarioResult[] }[];
  }[];
  progress: { environment: string; platform: Platform; counts: Record<Verdict, number> }[];
}

export interface RunResult {
  scenarioKey: string;
  status: ResultStatus;
  note: string | null;
  evidence: string | null;
  issueUrl: string | null;
}

export interface RunDetail {
  app: Pick<App, "id" | "name" | "platforms" | "platformNames">;
  run: {
    id: string;
    guideId: string;
    version: number;
    testerId: string;
    environmentKey: string;
    platform: Platform;
    device: string;
    build: string | null;
    commit: string | null;
    account: string | null;
    finishedAt: string | null;
  };
  content: GuideContent;
  results: RunResult[];
  /** Screenshots per scenario key. */
  attachments?: Record<string, Attachment[]>;
  counts: Counts;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export interface Invitation {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}

export interface UpdateStatus {
  current: string;
  enabled: boolean;
  latest: { version: string; name: string; notes: string; url: string; publishedAt: string } | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  /** The instance can update itself from the web app (the Update button). */
  canUpdate?: boolean;
}

/** The last update started with the Update button, with its live progress. */
export interface UpdateRun {
  id: string;
  version: string;
  from: string;
  startedBy: string;
  startedAt: string;
  status?: "running" | "succeeded" | "failed" | "unknown";
  phase?: string | null;
  log?: string[];
}

export interface AgentToken {
  id: string;
  name: string;
  scope: "read" | "write";
  /** The member the agent acts for. */
  userId: string;
  userName?: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UploadResult {
  guideId: string | null;
  version: number;
  dryRun: boolean;
  diff: ScenarioDiff;
}

/** An error the API answered with; `code` is stable and translated in the UI. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function createApi(auth: Auth) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = await auth.headers();
    if (!headers) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    const response = await fetch(`/api${path}`, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data?.error ?? {};
      throw new ApiError(response.status, error.code ?? "internal", error.message ?? response.statusText, error.details);
    }
    return data as T;
  }

  const query = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : "";
  };

  return {
    me: () => request<Me>("GET", "/me"),
    updates: (refresh = false) => request<UpdateStatus>("GET", refresh ? "/updates?refresh=1" : "/updates"),
    updateRun: () => request<{ run: UpdateRun | null }>("GET", "/updates/run"),
    startUpdate: (version: string) => request<{ run: UpdateRun }>("POST", "/updates/run", { version }),
    updateMe: (body: { name?: string; locale?: Locale }) => request<{ user: User }>("PATCH", "/me", body),
    setup: (teamName: string) => request<{ team: Me["team"] }>("POST", "/setup", { teamName }),
    environments: () => request<{ environments: Environment[] }>("GET", "/environments"),
    createEnvironment: (key: string, name: string) =>
      request<{ environment: Environment }>("POST", "/environments", { key, name }),
    updateEnvironment: (key: string, body: { name?: string; archived?: boolean }) =>
      request<{ environment: Environment }>("PATCH", `/environments/${key}`, body),
    orderEnvironments: (keys: string[]) => request<{ keys: string[] }>("PUT", "/environments/order", { keys }),

    apps: () => request<{ apps: App[] }>("GET", "/apps"),
    app: (appId: string) => request<{ app: App & { areas: Area[] } }>("GET", `/apps/${appId}`),
    createApp: (body: { slug: string; name: string; platforms: Platform[]; platformNames: Record<string, string> }) =>
      request<{ app: App }>("POST", "/apps", body),
    updateApp: (
      appId: string,
      body: {
        name?: string;
        platforms?: Platform[];
        platformNames?: Record<string, string>;
        slack?: { webhookUrl?: string | null; events?: SlackEvent[] };
      },
    ) => request<{ app: App }>("PATCH", `/apps/${appId}`, body),
    testSlack: (appId: string) => request<{ sent: boolean }>("POST", `/apps/${appId}/slack/test`),
    createArea: (appId: string, body: { slug: string; name: string }) =>
      request<{ area: Area }>("POST", `/apps/${appId}/areas`, body),

    allGuides: (params: GuideListParams = {}) =>
      request<{ guides: GuideSummary[] }>("GET", `/guides${query(params)}`),
    guides: (appId: string, params: { areaId?: string; status?: string; environment?: string; type?: string } = {}) =>
      request<{ guides: GuideSummary[] }>("GET", `/apps/${appId}/guides${query({ ...params, limit: 100 })}`),
    guide: (guideId: string, version?: number) =>
      request<GuideDetail>("GET", `/guides/${guideId}${query({ version })}`),
    uploadGuide: (
      appId: string,
      body: { slug: string; areaId?: string | null; content: unknown; changeNote?: string; baseVersion?: number; dryRun?: boolean },
    ) => request<UploadResult>("POST", `/apps/${appId}/guides`, body),
    setGuideStatus: (guideId: string, status: "active" | "archived") =>
      request<{ guide: GuideSummary }>("PATCH", `/guides/${guideId}`, { status }),

    results: (guideId: string, params: { version?: number; testerId?: string; filter?: "all" | "problems" } = {}) =>
      request<GuideResults>("GET", `/guides/${guideId}/results${query(params)}`),
    startRun: (
      guideId: string,
      body: { environment: string; platform: Platform; device: string; build?: string; commit?: string; account?: string },
    ) =>
      request<{ run: { id: string } }>("POST", `/guides/${guideId}/runs`, body),
    run: (runId: string) => request<RunDetail>("GET", `/runs/${runId}`),
    mark: (
      runId: string,
      scenarioKey: string,
      body: { status: ResultStatus | "untested"; note?: string; evidence?: string; issueUrl?: string },
    ) =>
      request<unknown>("PUT", `/runs/${runId}/results/${encodeURIComponent(scenarioKey)}`, body),
    startAttachment: (runId: string, scenarioKey: string, contentType: string) =>
      request<{ attachment: { id: string }; upload: { url: string; fields: Record<string, string> } }>(
        "POST",
        `/runs/${runId}/results/${encodeURIComponent(scenarioKey)}/attachments`,
        { contentType },
      ),
    completeAttachment: (id: string) => request<{ attachment: Attachment }>("POST", `/attachments/${id}/complete`),
    removeAttachment: (id: string) => request<unknown>("DELETE", `/attachments/${id}`),
    setRunFinished: (runId: string, finished: boolean) =>
      request<unknown>("PATCH", `/runs/${runId}`, { finished }),

    members: () => request<{ members: Member[] }>("GET", "/members"),
    setMemberRole: (userId: string, role: Role) =>
      request<unknown>("PATCH", `/members/${encodeURIComponent(userId)}`, { role }),
    removeMember: (userId: string) => request<unknown>("DELETE", `/members/${encodeURIComponent(userId)}`),
    invitations: () => request<{ invitations: Invitation[] }>("GET", "/invitations"),
    invite: (email: string, name: string, role: Role) =>
      request<{ invitation: Invitation; accountCreated: boolean }>("POST", "/invitations", {
        email,
        name: name.trim() || undefined,
        role,
      }),
    revokeInvitation: (id: string) => request<unknown>("DELETE", `/invitations/${id}`),

    agentTokens: () => request<{ tokens: AgentToken[] }>("GET", "/agent-tokens"),
    createAgentToken: (name: string, scope: AgentToken["scope"], userId: string) =>
      request<{ token: AgentToken & { token: string } }>("POST", "/agent-tokens", { name, scope, userId }),
    setTokenHolder: (id: string, userId: string, includePastUploads: boolean) =>
      request<{ movedUploads: number }>("PATCH", `/agent-tokens/${id}`, { userId, includePastUploads }),
    revokeAgentToken: (id: string) => request<unknown>("DELETE", `/agent-tokens/${id}`),
  };
}

export type Api = ReturnType<typeof createApi>;
