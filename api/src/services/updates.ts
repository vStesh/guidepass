import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { instanceState } from "../db/schema.ts";
import { compareVersions, VERSION } from "../version.ts";

/** The newest Guidepass release, as the owner sees it. */
export interface Release {
  version: string;
  name: string;
  /** Release notes in Markdown (the changelog section of that version). */
  notes: string;
  url: string;
  publishedAt: string;
}

export interface UpdateStatus {
  current: string;
  /** False when the instance was deployed with update checks turned off. */
  enabled: boolean;
  latest: Release | null;
  updateAvailable: boolean;
  checkedAt: string | null;
}

export interface UpdateCheckOptions {
  /** `owner/repo` on GitHub whose releases to check; null turns checks off. */
  repository: string | null;
  fetch?: typeof fetch;
  /** Ask GitHub now instead of using the result from the last day. */
  refresh?: boolean;
}

const KEY = "latest_release";
const DAY = 24 * 60 * 60 * 1000;

interface Cached {
  release: Release | null;
  checkedAt: string;
}

/**
 * What's the newest release, checked at most once a day and cached in the database.
 * Only the public releases list is read: nothing about the instance is sent. A failed
 * check keeps the last known answer.
 */
export async function getUpdateStatus(db: Db, options: UpdateCheckOptions): Promise<UpdateStatus> {
  if (!options.repository) {
    return { current: VERSION, enabled: false, latest: null, updateAvailable: false, checkedAt: null };
  }
  const [row] = await db.select().from(instanceState).where(eq(instanceState.key, KEY));
  let cached = row?.value as Cached | undefined;

  const stale = !cached || Date.now() - Date.parse(cached.checkedAt) > DAY;
  if (options.refresh || stale) {
    const release = await fetchLatestRelease(options.repository, options.fetch ?? fetch);
    if (release !== undefined) {
      cached = { release, checkedAt: new Date().toISOString() };
      await db
        .insert(instanceState)
        .values({ key: KEY, value: cached })
        .onConflictDoUpdate({ target: instanceState.key, set: { value: cached, updatedAt: new Date() } });
    }
  }

  const latest = cached?.release ?? null;
  return {
    current: VERSION,
    enabled: true,
    latest,
    updateAvailable: !!latest && compareVersions(latest.version, VERSION) > 0,
    checkedAt: cached?.checkedAt ?? null,
  };
}

/**
 * The repository's latest published release (GitHub leaves out drafts and
 * pre-releases), null when it has none yet, undefined when GitHub couldn't be asked.
 */
async function fetchLatestRelease(repository: string, fetchImpl: typeof fetch): Promise<Release | null | undefined> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "guidepass-update-check" },
      // A renamed or moved repository answers with a redirect; only GitHub's API may be followed.
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
    });
    if (response.url && !response.url.startsWith("https://api.github.com/")) throw new Error(`Redirected to ${response.url}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const body = (await response.json()) as {
      tag_name?: string;
      name?: string | null;
      body?: string | null;
      html_url?: string;
      published_at?: string | null;
    };
    if (!body.tag_name || !body.html_url) return null;
    return {
      version: body.tag_name.replace(/^v/, ""),
      name: body.name || body.tag_name,
      // A very long release body would bloat every owner's page; the link has the rest.
      notes: (body.body ?? "").slice(0, 20_000),
      url: body.html_url,
      publishedAt: body.published_at ?? new Date().toISOString(),
    };
  } catch (err) {
    console.warn("Update check failed:", err);
    return undefined;
  }
}
