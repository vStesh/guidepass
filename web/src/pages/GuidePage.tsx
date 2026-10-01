import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { GuideContent, Platform, Scenario } from "@guidepass/schema/core";
import type { App, Counts, Environment, GuideDetail, GuideResults } from "../api.ts";
import { Chip, ErrorBox, Load, Markdown, ProgressBar, TypeBadge, VerdictBadge, authorLabel, formatDate, platformLabel } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { canWrite, useLoad, useSession } from "../session.tsx";

const ACCOUNT_KEY = "guidepass.account";
const DEVICE_KEY = "guidepass.lastDevice";

export function GuidePage() {
  const { guideId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const version = params.get("v") ? Number(params.get("v")) : undefined;
  const onlyProblems = params.get("all") !== "1";
  const { t } = useI18n();
  const { api, me } = useSession();

  const [state, reload] = useLoad(async () => {
    const detail = await api.guide(guideId, version);
    const [{ app }, { environments }, results] = await Promise.all([
      api.app(detail.guide.appId),
      api.environments(),
      api.results(guideId, { version: detail.version, filter: onlyProblems ? "problems" : "all" }),
    ]);
    return { detail, app, environments, results };
  }, [api, guideId, version, onlyProblems]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Load state={state} reload={reload}>
      {({ detail, app, environments, results }) => {
        const { guide, content } = detail;
        const latest = guide.currentVersion;
        const envName = (key: string) => environments.find((e) => e.key === key)?.name ?? key;
        const platformName = (key: string) => platformLabel(t, key, app.platformNames);
        const isLatest = detail.version === latest;

        return (
          <>
            <Link to={`/apps/${app.id}`} className="back">
              ← {app.name}
            </Link>
            <div className="page-head">
              <h1>{content.title}</h1>
            </div>
            <div className="list-meta section-gap-sm">
              {content.environments.map((e) => (
                <Chip key={e} tone="accent">
                  {envName(e)}
                </Chip>
              ))}
              {content.type && <TypeBadge type={content.type} />}
              {content.build && <Chip>build {content.build}</Chip>}
              {content.pr && <Chip>{content.pr}</Chip>}
              {content.branch && <Chip>{content.branch}</Chip>}
              {detail.versions.length > 1 ? (
                <select value={detail.version} onChange={(e) => setParam("v", e.target.value === String(latest) ? null : e.target.value)}>
                  {detail.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {t("guide.versionOf", { version: v.version, latest })}
                      {v.changeNote ? ` — ${v.changeNote}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">{t("guide.version", { version: detail.version })}</span>
              )}
              {canWrite(me) && (
                <button
                  type="button"
                  className="button button-small"
                  onClick={async () => {
                    await api.setGuideStatus(guide.id, guide.status === "active" ? "archived" : "active");
                    void reload();
                  }}
                >
                  {guide.status === "active" ? t("guide.archive") : t("guide.restore")}
                </button>
              )}
            </div>
            <VersionHistory versions={detail.versions} shown={detail.version} />
            {content.meta && <p className="muted small">{content.meta}</p>}
            {guide.status === "archived" && <p className="notice">{t("guide.archived")}</p>}

            {guide.status === "active" && isLatest && (
              <StartRun guideId={guide.id} content={content} app={app} environments={environments} />
            )}

            <RunsList results={results} envName={envName} platformName={platformName} myId={me.user.id} />

            <section className="section-gap">
              <div className="section-head">
                <h2>{t("guide.results")}</h2>
                <label className="check">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setParam("all", e.target.checked ? null : "1")} />
                  {t("guide.onlyProblems")}
                </label>
              </div>
              <ResultsMatrix results={results} envName={envName} platformName={platformName} />
            </section>

            <details className="card section-gap" open={!results.runs.length}>
              <summary>
                <h2>{t("guide.content")}</h2>
              </summary>
              <GuideContentView content={content} envName={envName} platformName={platformName} />
            </details>
          </>
        );
      }}
    </Load>
  );
}

function StartRun({
  guideId,
  content,
  app,
  environments,
}: {
  guideId: string;
  content: GuideContent;
  app: App;
  environments: Environment[];
}) {
  const { t } = useI18n();
  const { api } = useSession();
  const navigate = useNavigate();
  const [environment, setEnvironment] = useState(content.environments[0] ?? "");
  const [platform, setPlatform] = useState<Platform>(app.platforms[0] ?? "ios");
  const [device, setDevice] = useState(() => {
    try {
      return localStorage.getItem(DEVICE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [build, setBuild] = useState("");
  const [commit, setCommit] = useState("");
  const [account, setAccount] = useState(() => {
    try {
      return localStorage.getItem(ACCOUNT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!build.trim() && !commit.trim()) {
        setError(new Error(t("run.buildOrCommit")));
        return;
      }
      const { run } = await api.startRun(guideId, { environment, platform, device, build, commit, account });
      try {
        localStorage.setItem(DEVICE_KEY, device);
        localStorage.setItem(ACCOUNT_KEY, account);
      } catch {
        // Only a convenience.
      }
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="card start-run" onSubmit={submit}>
      <h2>{t("guide.startRun")}</h2>
      <div className="grid-3">
        <label className="field">
          <span>{t("guide.environment")}</span>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            {content.environments.map((e) => (
              <option key={e} value={e}>
                {environments.find((x) => x.key === e)?.name ?? e}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("guide.platform")}</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {app.platforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(t, p, app.platformNames)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("guide.device")}</span>
          <input required maxLength={100} placeholder={t("guide.deviceHint")} value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("run.build")}</span>
          <input
            maxLength={60}
            inputMode="text"
            // Required unless a commit is given: the build actually installed, which may be newer than the guide's.
            required={!commit.trim()}
            placeholder={content.build ? t("run.buildHint", { build: content.build }) : ""}
            value={build}
            onChange={(e) => setBuild(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("run.commit")}</span>
          <input maxLength={60} placeholder="a1b2c3d" value={commit} onChange={(e) => setCommit(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("run.account")}</span>
          <input maxLength={100} placeholder={t("run.accountHint")} value={account} onChange={(e) => setAccount(e.target.value)} />
        </label>
      </div>
      <p className="muted small">{t("run.buildOrCommit")}</p>
      {error ? <ErrorBox error={error} /> : null}
      <button type="submit" className="button button-primary">
        {t("guide.start")}
      </button>
    </form>
  );
}

function RunsList({
  results,
  envName,
  platformName,
  myId,
}: {
  results: GuideResults;
  envName: (k: string) => string;
  platformName: (k: string) => string;
  myId: string;
}) {
  const { t, locale } = useI18n();
  if (!results.runs.length) return null;
  const mine = results.runs.filter((r) => r.tester.id === myId);
  const others = results.runs.filter((r) => r.tester.id !== myId);
  const row = (run: GuideResults["runs"][number]) => (
    <li key={run.id}>
      <Link to={`/runs/${run.id}`} className="list-item">
        <span className="list-title">
          {run.tester.id === myId ? "" : `${run.tester.name ?? run.tester.email} · `}
          {envName(run.environment)} · {platformName(run.platform)} · {run.device}
        </span>
        <span className="list-meta">
          <ProgressBar counts={run.counts} />
          <span>
            {t("run.progress", { done: checkedCount(run.counts), total: Object.values(run.counts).reduce((a, b) => a + b, 0) })}
          </span>
          <RunBuild build={run.build} commit={run.commit} account={run.account} />
          {run.finishedAt ? <Chip>{t("guide.finished")}</Chip> : <span>{formatDate(run.startedAt, locale)}</span>}
        </span>
      </Link>
    </li>
  );
  return (
    <section className="section-gap">
      {mine.length > 0 && (
        <>
          <h2>{t("guide.myRuns")}</h2>
          <ul className="list">{mine.map(row)}</ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h2>{t("guide.allRuns")}</h2>
          <ul className="list">{others.map(row)}</ul>
        </>
      )}
    </section>
  );
}

/** Scenarios × (environment, platform), each cell a verdict with everyone's results behind it. */
function ResultsMatrix({
  results,
  envName,
  platformName,
}: {
  results: GuideResults;
  envName: (k: string) => string;
  platformName: (k: string) => string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const columns = results.progress.map((p) => ({ environment: p.environment, platform: p.platform, counts: p.counts }));

  return (
    <>
      <div className="matrix-progress">
        {columns.map((c) => (
          <div key={`${c.environment}/${c.platform}`} className="matrix-progress-item">
            <span>
              {envName(c.environment)} · {platformName(c.platform)}
            </span>
            <ProgressBar counts={c.counts} />
          </div>
        ))}
      </div>
      {results.scenarios.length === 0 ? (
        <p className="muted">{t("guide.noProblems")}</p>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th />
                {columns.map((c) => (
                  <th key={`${c.environment}/${c.platform}`}>
                    {envName(c.environment)}
                    <br />
                    <span className="muted">{platformName(c.platform)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.scenarios.map((s) => (
                <tr key={s.key}>
                  <th scope="row">
                    {s.important && <span className="star" title={t("guide.important")}>★ </span>}
                    {s.title}
                    {s.automated && <span className="muted small" title={s.automated}> · {t("guide.automated")}</span>}
                  </th>
                  {columns.map((c) => {
                    const cell = s.cells.find((x) => x.environment === c.environment && x.platform === c.platform);
                    const id = `${s.key}/${c.environment}/${c.platform}`;
                    if (!cell) return <td key={id} className="na">—</td>;
                    return (
                      <td key={id}>
                        <button type="button" className="cell" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                          <VerdictBadge verdict={cell.verdict} />
                          {cell.results.length > 1 && <span className="muted small"> ×{cell.results.length}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <CellDetails results={results} id={open} envName={envName} platformName={platformName} />}
    </>
  );
}

function CellDetails({
  results,
  id,
  envName,
  platformName,
}: {
  results: GuideResults;
  id: string;
  envName: (k: string) => string;
  platformName: (k: string) => string;
}) {
  const { t, locale } = useI18n();
  const [key, environment, platform] = id.split("/");
  const scenario = results.scenarios.find((s) => s.key === key);
  const cell = scenario?.cells.find((c) => c.environment === environment && c.platform === platform);
  if (!scenario || !cell) return null;
  return (
    <div className="card section-gap-sm">
      <h3>
        {scenario.title} · {envName(cell.environment)} · {platformName(cell.platform)}
      </h3>
      {cell.results.length === 0 ? (
        <p className="muted">{t("guide.cellEmpty")}</p>
      ) : (
        <ul className="results">
          {cell.results.map((r) => (
            <li key={r.runId}>
              <VerdictBadge verdict={r.status} />
              <span>
                <strong>{r.tester.name}</strong> · {r.device} · {formatDate(r.updatedAt, locale)}
                {r.fromVersion && <Chip>{t("guide.fromVersion", { version: r.fromVersion })}</Chip>}
              </span>
              <RunBuild build={r.build} commit={r.commit} account={r.account} />
              {r.note && <p className="pre-line">{r.note}</p>}
              <Proof evidence={r.evidence} issueUrl={r.issueUrl} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuideContentView({
  content,
  envName,
  platformName,
}: {
  content: GuideContent;
  envName: (k: string) => string;
  platformName: (k: string) => string;
}) {
  const { t } = useI18n();
  return (
    <div className="stack">
      {content.context && (
        <section>
          <h3>{t("guide.context")}</h3>
          <Markdown text={content.context} />
        </section>
      )}
      {content.changelog?.length ? (
        <section>
          <h3>{t("guide.changelog")}</h3>
          {content.changelog.map((group) => (
            <div key={group.section}>
              <h4>{group.section}</h4>
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>
                    <Markdown text={item} inline />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      <Prerequisites content={content} />
      <section>
        <h3>{t("guide.scenarios")}</h3>
        <ol className="scenarios">
          {content.scenarios.map((s) => (
            <li key={s.key} className={s.deprecated ? "deprecated" : undefined}>
              <ScenarioBody scenario={s} envName={envName} platformName={platformName} />
            </li>
          ))}
        </ol>
      </section>
      {content.related?.length ? (
        <section>
          <h3>{t("guide.related")}</h3>
          <ul>
            {content.related.map((r, i) => (
              // Only web links become clickable: a guide could carry a `javascript:` URL.
              <li key={i}>{r.url && /^https?:\/\//i.test(r.url) ? <a href={r.url} target="_blank" rel="noreferrer">{r.label}</a> : r.label}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function Prerequisites({ content, heading = true }: { content: GuideContent; heading?: boolean }) {
  const { t } = useI18n();
  if (!content.prerequisites?.length) return null;
  return (
    <section>
      {heading && <h3>{t("guide.prerequisites")}</h3>}
      <ul>
        {content.prerequisites.map((p, i) => (
          <li key={i}>
            <Markdown text={p} inline />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ScenarioBody({
  scenario,
  envName,
  platformName,
}: {
  scenario: Scenario;
  envName: (k: string) => string;
  platformName: (k: string) => string;
}) {
  const { t } = useI18n();
  const limits = [
    ...(scenario.platforms ?? []).map(platformName),
    ...(scenario.environments ?? []).map(envName),
  ];
  return (
    <>
      <div className="scenario-title">
        {scenario.important && <span className="star" title={t("guide.important")}>★ </span>}
        <strong>{scenario.title}</strong>
        {limits.length > 0 && <Chip>{t("guide.onlyOn", { list: limits.join(", ") })}</Chip>}
        {scenario.evidence && <Chip tone="accent">{t("guide.needsProof")}</Chip>}
      </div>
      {scenario.automated && (
        <p className="muted small">
          {t("guide.automatedBy", { test: scenario.automated })}
        </p>
      )}
      {scenario.deprecated && <p className="muted">{t("guide.deprecated", { reason: scenario.deprecated.reason })}</p>}
      <ol className="steps">
        {scenario.steps.map((step, i) => (
          <li key={i}>
            <Markdown text={step} inline />
          </li>
        ))}
      </ol>
      <div className="expected">
        <strong>{t("guide.expected")}:</strong> <Markdown text={scenario.expected} inline />
      </div>
    </>
  );
}

/** Who uploaded the shown version, and the full history when there is more than one. */
function VersionHistory({ versions, shown }: { versions: GuideDetail["versions"]; shown: number }) {
  const { t, locale } = useI18n();
  const current = versions.find((v) => v.version === shown);
  const first = versions[versions.length - 1];
  if (!current) return null;
  const line = (v: GuideDetail["versions"][number]) =>
    t(v.version === 1 ? "guide.createdBy" : "guide.updatedBy", {
      author: authorLabel(t, v.author),
      date: formatDate(v.createdAt, locale),
    });
  return (
    <div className="muted small section-gap-sm">
      <p className="author-line">
        {line(current)}
        {current.version > 1 && first && <> · {line(first)}</>}
      </p>
      {versions.length > 1 && (
        <details>
          <summary>{t("guide.history")}</summary>
          <ol className="history">
            {versions.map((v) => (
              <li key={v.version}>
                <strong>{t("guide.version", { version: v.version })}</strong> — {line(v)}
                {v.changeNote && <div>{v.changeNote}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** Scenarios someone has marked, whatever the status. */
export function checkedCount(counts: Counts): number {
  return counts.pass + counts.fail + counts.blocked + counts.skip;
}

/** Which build and account a run was made with. */
export function RunBuild({ build, commit, account }: { build: string | null; commit: string | null; account: string | null }) {
  const { t } = useI18n();
  if (!build && !commit && !account) return null;
  return (
    <span className="list-meta">
      {build && <Chip>{t("run.buildShort", { build })}</Chip>}
      {commit && <Chip>{commit.slice(0, 12)}</Chip>}
      {account && <Chip>{t("run.accountShort", { account })}</Chip>}
    </span>
  );
}

/** Proof and the issue link behind a result. Only web links become clickable. */
export function Proof({ evidence, issueUrl }: { evidence: string | null; issueUrl: string | null }) {
  const { t } = useI18n();
  if (!evidence && !issueUrl) return null;
  return (
    <div className="proof">
      {evidence && (
        <div>
          <strong>{t("run.evidence")}:</strong> <Markdown text={evidence} />
        </div>
      )}
      {issueUrl && /^https?:\/\//i.test(issueUrl) && (
        <a href={issueUrl} target="_blank" rel="noopener noreferrer">
          {t("run.issue")}
        </a>
      )}
    </div>
  );
}
