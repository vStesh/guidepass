import { useState, type FormEvent } from "react";
import { ApiError } from "../api.ts";
import { ErrorBox } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";

/**
 * Shown to a signed-in person without a team: the first owner sets the instance
 * up; anyone else waits for an invitation.
 */
export function SetupPage({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { api, me, signOut } = useSession();
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notAllowed, setNotAllowed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup(teamName);
      onDone();
    } catch (err) {
      // Someone else owns this instance, or it is already set up: wait for an invitation.
      if (err instanceof ApiError && (err.code === "forbidden" || err.code === "conflict")) setNotAllowed(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      {notAllowed ? (
        <div className="card auth-card">
          <h1>{t("setup.waitingTitle")}</h1>
          <p>{t("setup.waitingHint", { email: me.user.email })}</p>
          <div className="row">
            <button type="button" className="button button-primary" onClick={onDone}>
              {t("app.retry")}
            </button>
            <button type="button" className="button" onClick={signOut}>
              {t("setup.signOut")}
            </button>
          </div>
        </div>
      ) : (
        <form className="card auth-card" onSubmit={submit}>
          <h1>{t("setup.title")}</h1>
          <p className="muted">{t("setup.hint")}</p>
          <label className="field">
            <span>{t("setup.teamName")}</span>
            <input required maxLength={100} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </label>
          {error ? <ErrorBox error={error} /> : null}
          <div className="row">
            <button type="submit" className="button button-primary" disabled={busy}>
              {t("setup.submit")}
            </button>
            <button type="button" className="button" onClick={signOut}>
              {t("setup.signOut")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
