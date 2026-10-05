import { useCallback, useEffect, useState } from "react";
import type { UpdateRun as Run } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";
import { ErrorBox, formatDate } from "./ui.tsx";

/**
 * The Update button and the progress of the last update: starts the instance's
 * updater for the newest release (after a confirmation), then follows its log
 * until it succeeds or fails.
 */
export function UpdateRun({ latest }: { latest: string | null }) {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const [run, setRun] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setRun((await api.updateRun()).run);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // While an update runs, follow it every few seconds. The API itself is replaced
  // during the update, so a failed poll is retried rather than shown.
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = setInterval(() => {
      api.updateRun().then(({ run: next }) => setRun(next), () => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [api, run?.status]);

  async function start() {
    if (!latest || !window.confirm(t("update.confirm", { version: latest }))) return;
    setStarting(true);
    setError(null);
    try {
      await api.startUpdate(latest);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setStarting(false);
    }
  }

  const running = run?.status === "running";
  // Until the page is reloaded it still runs the old code: don't offer the same update again.
  const done = run?.status === "succeeded" && run.version === latest;
  return (
    <div className="stack">
      {latest && !running && !done && (
        <button type="button" className="button button-primary" disabled={starting} onClick={() => void start()}>
          {t("update.button", { version: latest })}
        </button>
      )}
      {run && (
        <div className={`update-run update-run-${run.status ?? "unknown"}`}>
          <strong>
            {run.status === "running"
              ? t("update.running", { version: run.version, phase: t(phaseKey(run.phase)) })
              : run.status === "succeeded"
                ? t("update.succeeded", { version: run.version })
                : run.status === "failed"
                  ? t("update.failed", { version: run.version })
                  : t("update.unknown", { version: run.version })}
          </strong>
          <span className="muted small">
            {t("update.startedBy", { name: run.startedBy, date: formatDate(run.startedAt, locale) })}
          </span>
          {run.status === "succeeded" && (
            <button type="button" className="button button-small" onClick={() => window.location.reload()}>
              {t("update.reload")}
            </button>
          )}
          {run.status === "failed" && <p className="small">{t("update.failedHint")}</p>}
          {run.log?.length ? (
            <details open={run.status !== "succeeded"}>
              <summary>{t("update.log")}</summary>
              <pre className="update-log">{run.log.join("\n")}</pre>
            </details>
          ) : null}
        </div>
      )}
      {error ? <ErrorBox error={error} /> : null}
    </div>
  );
}

function phaseKey(phase: string | null | undefined) {
  switch (phase) {
    case "INSTALL":
      return "update.phase.install" as const;
    case "PRE_BUILD":
      return "update.phase.snapshot" as const;
    case "BUILD":
      return "update.phase.apply" as const;
    default:
      return "update.phase.starting" as const;
  }
}
