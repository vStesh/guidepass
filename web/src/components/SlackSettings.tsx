import { useState } from "react";
import type { App, SlackEvent } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";
import { ErrorBox } from "./ui.tsx";

const events: SlackEvent[] = ["guide_created", "guide_updated", "run_problems"];

/** Owner settings for an app's Slack channel. The saved URL is never shown back. */
export function SlackSettings({ app, onSaved }: { app: App; onSaved: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<SlackEvent[]>(app.slack.events);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!open) {
    return (
      <button type="button" className="button section-gap" onClick={() => setOpen(true)}>
        {t("slack.title")}
      </button>
    );
  }

  const run = (fn: () => Promise<unknown>, done: string) => async () => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setUrl("");
      onSaved();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="card stack section-gap">
      <h2>{t("slack.title")}</h2>
      <p className="muted">{t("slack.hint")}</p>
      <p>{app.slack.configured ? t("slack.configured") : t("slack.notConfigured")}</p>
      <label className="field">
        <span>{t("slack.url")}</span>
        <input
          type="password"
          autoComplete="off"
          placeholder="https://hooks.slack.com/services/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <fieldset className="field">
        {events.map((ev) => (
          <label key={ev} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(ev)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, ev] : chosen.filter((x) => x !== ev))}
            />
            {t(`slack.event.${ev}`)}
          </label>
        ))}
      </fieldset>
      {notice && <p className="notice notice-ok">{notice}</p>}
      {error ? <ErrorBox error={error} /> : null}
      <div className="row">
        <button
          type="button"
          className="button button-primary"
          onClick={run(
            () => api.updateApp(app.id, { slack: { ...(url.trim() ? { webhookUrl: url.trim() } : {}), events: chosen } }),
            t("slack.saved"),
          )}
        >
          {t("app.save")}
        </button>
        {app.slack.configured && (
          <>
            <button type="button" className="button" onClick={run(() => api.testSlack(app.id), t("slack.testSent"))}>
              {t("slack.test")}
            </button>
            <button type="button" className="button button-ghost" onClick={run(() => api.updateApp(app.id, { slack: { webhookUrl: null } }), t("slack.saved"))}>
              {t("slack.disconnect")}
            </button>
          </>
        )}
        <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>
          {t("app.cancel")}
        </button>
      </div>
    </div>
  );
}
