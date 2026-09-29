import { useState, type FormEvent } from "react";
import type { Auth, SignInStep } from "../auth.ts";
import { useI18n } from "../i18n/index.tsx";

export function SignInPage({ auth, onSignedIn }: { auth: Auth; onSignedIn: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState<SignInStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = step ? await auth.confirm(answer) : await auth.signIn(email, password);
      if (next.kind === "done") onSignedIn();
      else {
        setStep(next);
        setAnswer("");
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("signIn.failed"));
    } finally {
      setBusy(false);
    }
  }

  const local = auth.mode === "local";
  return (
    <div className="centered">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand brand-large">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>{t("app.name")}</span>
        </div>
        <h1>{t("signIn.title")}</h1>
        {local && <p className="muted">{t("signIn.localHint")}</p>}

        {!step && (
          <>
            <label className="field">
              <span>{t("signIn.email")}</span>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {!local && (
              <label className="field">
                <span>{t("signIn.password")}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        {step?.kind === "newPassword" && (
          <label className="field">
            <span>{t("signIn.newPassword")}</span>
            <small className="muted">{t("signIn.newPasswordHint")}</small>
            <input type="password" autoComplete="new-password" required value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
        )}
        {step?.kind === "code" && (
          <label className="field">
            <span>{t("signIn.code")}</span>
            <input inputMode="numeric" autoComplete="one-time-code" required value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
        )}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={busy}>
          {step ? t("signIn.confirm") : t("signIn.submit")}
        </button>
      </form>
    </div>
  );
}
