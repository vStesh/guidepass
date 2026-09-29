import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { appliesTo, type ResultStatus, type Scenario } from "@guidepass/schema/core";
import type { RunDetail } from "../api.ts";
import { ErrorBox, Load, ProgressBar } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";
import { Prerequisites, ScenarioBody } from "./GuidePage.tsx";

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
                {envName(run.environmentKey)} · {t(`platform.${run.platform}`)} · {run.device}
              </h1>
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
                  editable={editable}
                  result={data.results.find((r) => r.scenarioKey === s.key)}
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
  const { pass, fail, skip, untested } = run.counts;
  return (
    <div className="run-progress">
      <ProgressBar counts={{ pass, fail, skip, untested }} />
      <span className="muted small">{t("run.progress", { done: pass + fail + skip, total: pass + fail + skip + untested })}</span>
    </div>
  );
}

function ScenarioCard({
  runId,
  scenario,
  envName,
  editable,
  result,
  onSaved,
}: {
  runId: string;
  scenario: Scenario;
  envName: (k: string) => string;
  editable: boolean;
  result?: { status: ResultStatus; note: string | null };
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { api } = useSession();
  const [note, setNote] = useState(result?.note ?? "");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setNote(result?.note ?? ""), [result?.note]);

  async function save(status: ResultStatus | "untested", nextNote?: string) {
    setError(null);
    try {
      await api.mark(runId, scenario.key, { status, note: nextNote });
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
      <ScenarioBody scenario={scenario} envName={envName} />
      <div className="segmented segmented-status" role="group" aria-label={scenario.title}>
        {(["pass", "fail", "skip"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`status-${s}`}
            aria-pressed={status === s}
            disabled={!editable}
            // Tapping the current status again clears it.
            onClick={() => void save(status === s ? "untested" : s, note)}
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
            onBlur={() => editable && status && note !== (result?.note ?? "") && void save(status, note)}
          />
        </label>
      )}
      {saved && <span className="muted small">{t("run.saved")}</span>}
      {error ? <ErrorBox error={error} /> : null}
    </li>
  );
}
