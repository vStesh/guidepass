import { useState, type FormEvent } from "react";
import type { Locale } from "../api.ts";
import { ErrorBox } from "../components/ui.tsx";
import { locales, useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";

export function ProfilePage() {
  const { t } = useI18n();
  const { api, me, setMe, signOut } = useSession();
  const [name, setName] = useState(me.user.name ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function update(body: { name?: string; locale?: Locale }) {
    setError(null);
    setSaved(false);
    try {
      const { user } = await api.updateMe(body);
      setMe({ ...me, user });
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void update({ name: name.trim() });
  }

  return (
    <>
      <h1>{t("profile.title")}</h1>
      <form className="card stack" onSubmit={submit}>
        <p className="muted">{me.user.email}</p>
        <label className="field">
          <span>{t("profile.name")}</span>
          <div className="inline-form">
            <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="button">
              {t("app.save")}
            </button>
          </div>
        </label>
        <label className="field">
          <span>{t("profile.language")}</span>
          <select value={me.user.locale} onChange={(e) => void update({ locale: e.target.value as Locale })}>
            {locales.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {saved && <p className="notice notice-ok">{t("profile.saved")}</p>}
        {error ? <ErrorBox error={error} /> : null}
      </form>
      <button type="button" className="button section-gap" onClick={signOut}>
        {t("profile.signOut")}
      </button>
    </>
  );
}
