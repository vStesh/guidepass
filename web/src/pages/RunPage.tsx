import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { appliesTo, looksLikeSecret, needsEvidence, type ResultStatus, type Scenario } from "@guidepass/schema/core";
import type { Attachment, RunDetail, RunResult } from "../api.ts";
import { AddScreenshot, MAX_SCREENSHOTS, ScreenshotList } from "../components/Screenshots.tsx";
import { ErrorBox, Load, ProgressBar, platformLabel } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";
import { Prerequisites, Proof, RunBuild, ScenarioBody, checkedCount } from "./GuidePage.tsx";

/** A tester's run, built for a phone held in one hand. */
export function RunPage() {
  const { runId = "" } = useParams();
  const { t } = useI18n();
  const { api, me } = useSession();
  const [state, reload] = useLoad(
    () => Promise.all([api.run(runId), api.environments(), api.members()]).then(([run, e, m]) => ({ ...run, ...e, ...m })),
    [api, runId],
  );

  return (
    <Load state={state} reload={reload}>
      {(data) => {
        const { run, content, environments, members } = data;
        const envName = (key: string) => environments.find((e) => e.key === key)?.name ?? key;
        const platformName = (key: string) => platformLabel(t, key, data.app.platformNames);
        const mine = run.testerId === me.user.id;
        const editable = mine && !run.finishedAt;
        const scenarios = content.scenarios.filter((s) => appliesTo(s, run.environmentKey, run.platform));
        const tester = members.find((m) => m.id === run.testerId);

        return (
          <>
            <Link to={`/guides/${run.guideId}?v=${run.version}`} className="back">
              ← {content.title}
            </Link>
            <div className="run-head">
              <h1>
                {envName(run.environmentKey)} · {platformName(run.platform)} · {run.device}
              </h1>
              <RunBuild build={run.build} commit={run.commit} account={run.account} />
              <RunProgress run={data} />
            </div>
            {!mine && <p className="notice">{t("run.readOnly", { name: tester?.name ?? tester?.email ?? "?" })}</p>}
            {mine && run.finishedAt && <p className="notice">{t("run.finishedHint")}</p>}

            {content.prerequisites?.length ? (
              <details className="card">
                <summary>
                  <h2>{t("guide.prerequisites")}</h2>
                </summary>
                <Prerequisites content={content} heading={false} />
              </details>
            ) : null}

            <ol className="run-scenarios">
              {scenarios.map((s) => (
                <ScenarioCard
                  key={s.key}
                  runId={run.id}
                  scenario={s}
                  envName={envName}
                  platformName={platformName}
                  editable={editable}
                  result={data.results.find((r) => r.scenarioKey === s.key)}
                  attachments={data.attachments?.[s.key] ?? []}
                  canAttach={!!me.features?.attachments}
                  onSaved={reload}
                />
              ))}
            </ol>

            {mine && (
              <div className="run-footer">
                <button
                  type="button"
                  className={run.finishedAt ? "button" : "button button-primary"}
                  onClick={async () => {
                    await api.setRunFinished(run.id, !run.finishedAt);
                    void reload();
                  }}
                >
                  {run.finishedAt ? t("run.reopen") : t("run.finish")}
                </button>
              </div>
            )}
          </>
        );
      }}
    </Load>
  );
}

function RunProgress({ run }: { run: RunDetail }) {
  const { t } = useI18n();
  const done = checkedCount(run.counts);
  return (
    <div className="run-progress">
      <ProgressBar counts={run.counts} />
      <span className="muted small">{t("run.progress", { done, total: done + run.counts.untested })}</span>
    </div>
  );
}

function ScenarioCard({
  runId,
  scenario,
  envName,
  platformName,
  editable,
  result,
  attachments,
  canAttach,
  onSaved,
}: {
  runId: string;
  scenario: Scenario;
  envName: (k: string) => string;
  platformName: (k: string) => string;
  editable: boolean;
  result?: RunResult;
  /** Screenshots already attached to this scenario. */
  attachments: Attachment[];
  /** Whether this instance stores screenshots. */
  canAttach: boolean;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { api } = useSession();
  const [note, setNote] = useState(result?.note ?? "");
  const [evidence, setEvidence] = useState(result?.evidence ?? "");
  const [issueUrl, setIssueUrl] = useState(result?.issueUrl ?? "");
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Saves from one card go one after another: a blur and a tap right after it
  // must land in that order, or the earlier status could win.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => setNote(result?.note ?? ""), [result?.note]);
  useEffect(() => setEvidence(result?.evidence ?? ""), [result?.evidence]);
  useEffect(() => setIssueUrl(result?.issueUrl ?? ""), [result?.issueUrl]);

  async function save(status: ResultStatus | "untested") {
    setError(null);
    setHint(null);
    // Checked here too, so the tester learns what's missing before anything is sent.
    // A screenshot is proof as well as text.
    if (status !== "untested" && needsEvidence(scenario, status) && !evidence.trim() && !attachments.length) {
      setHint(t(status === "fail" ? "run.proofForFail" : "run.proofForPass"));
      return;
    }
    if ([evidence, note, issueUrl].some(looksLikeSecret)) {
      setHint(t("run.proofSecret"));
      return;
    }
    const issue = issueUrl.trim();
    if (issue && !/^https?:\/\/\S+$/i.test(issue)) {
      setHint(t("run.issueInvalid"));
      return;
    }
    const body = { status, note, evidence, issueUrl: issue };
    const request = queue.current.catch(() => undefined).then(() => api.mark(runId, scenario.key, body));
    queue.current = request;
    try {
      await request;
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  const status = result?.status;
  return (
    <li className={`run-card${status ? ` run-card-${status}` : ""}`}>
      <ScenarioBody scenario={scenario} envName={envName} platformName={platformName} />
      <div className="segmented segmented-status" role="group" aria-label={scenario.title}>
        {(["pass", "fail", "blocked", "skip"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`status-${s}`}
            aria-pressed={status === s}
            disabled={!editable}
            // Tapping the current status again clears it.
            onClick={() => void save(status === s ? "untested" : s)}
          >
            {t(`run.${s}`)}
          </button>
        ))}
      </div>
      {(editable || note) && (
        <label className="field">
          <span>{t("run.note")}</span>
          <textarea
            rows={2}
            maxLength={2000}
            placeholder={t("run.notePlaceholder")}
            value={note}
            readOnly={!editable}
            onChange={(e) => setNote(e.target.value)}
            // A note is saved with a status; before one is chosen it waits and goes with the first tap.
            onBlur={() => editable && status && note !== (result?.note ?? "") && void save(status)}
          />
        </label>
      )}
      {editable ? (
        <details className="proof-edit" open={!!(evidence || issueUrl || attachments.length || scenario.evidence || status === "fail" || hint)}>
          <summary>{t("run.proofTitle")}</summary>
          {(canAttach || attachments.length > 0) && (
            <div className="field">
              <span>{t("shots.title")}</span>
              <ScreenshotList
                items={attachments}
                onRemove={async (id) => {
                  setError(null);
                  try {
                    await api.removeAttachment(id);
                    onSaved();
                  } catch (err) {
                    setError(err);
                  }
                }}
              />
              {canAttach && attachments.length < MAX_SCREENSHOTS && (
                <AddScreenshot
                  runId={runId}
                  scenarioKey={scenario.key}
                  remaining={MAX_SCREENSHOTS - attachments.length}
                  onAdded={() => {
                    setHint(null);
                    onSaved();
                  }}
                  onError={setError}
                />
              )}
            </div>
          )}
          <label className="field">
            <span>{t("run.evidence")}</span>
            <textarea
              rows={3}
              maxLength={4000}
              placeholder={t("run.evidencePlaceholder")}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              onBlur={() => status && evidence !== (result?.evidence ?? "") && void save(status)}
            />
          </label>
          <label className="field">
            <span>{t("run.issueUrl")}</span>
            <input
              type="url"
              maxLength={500}
              placeholder="https://github.com/…/issues/215"
              value={issueUrl}
              onChange={(e) => setIssueUrl(e.target.value)}
              onBlur={() => status && issueUrl !== (result?.issueUrl ?? "") && void save(status)}
            />
          </label>
        </details>
      ) : (
        <Proof evidence={result?.evidence ?? null} issueUrl={result?.issueUrl ?? null} attachments={attachments} />
      )}
      {hint && <p className="notice notice-error">{hint}</p>}
      {saved && <span className="muted small">{t("run.saved")}</span>}
      {error ? <ErrorBox error={error} /> : null}
    </li>
  );
}
