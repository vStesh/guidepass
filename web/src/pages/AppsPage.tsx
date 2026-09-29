import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Platform } from "@guidepass/schema/core";
import { Chip, ErrorBox, Load, slugify } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { isOwner, useLoad, useSession } from "../session.tsx";

const allPlatforms: Platform[] = ["ios", "android", "web"];

export function AppsPage() {
  const { t } = useI18n();
  const { api, me } = useSession();
  const [state, reload] = useLoad(() => api.apps(), [api]);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="page-head">
        <h1>{t("apps.title")}</h1>
        {isOwner(me) && !creating && (
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            {t("apps.new")}
          </button>
        )}
      </div>
      {creating && (
        <NewAppForm
          onDone={() => {
            setCreating(false);
            void reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      <Load state={state} reload={reload}>
        {({ apps }) =>
          apps.length ? (
            <ul className="list">
              {apps.map((app) => (
                <li key={app.id}>
                  <Link to={`/apps/${app.id}`} className="list-item">
                    <span className="list-title">{app.name}</span>
                    <span className="list-meta">
                      <code>{app.slug}</code>
                      {app.platforms.map((p) => (
                        <Chip key={p}>{t(`platform.${p}`)}</Chip>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{isOwner(me) ? t("apps.emptyOwner") : t("apps.empty")}</p>
          )
        }
      </Load>
    </>
  );
}

function NewAppForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [platforms, setPlatforms] = useState<Platform[]>(["ios", "android"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createApp({ name, slug, platforms });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field">
        <span>{t("apps.name")}</span>
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </label>
      <label className="field">
        <span>{t("apps.slug")}</span>
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        <small className="muted">{t("apps.slugHint")}</small>
      </label>
      <fieldset className="field">
        <legend>{t("apps.platforms")}</legend>
        <div className="row">
          {allPlatforms.map((p) => (
            <label key={p} className="check">
              <input
                type="checkbox"
                checked={platforms.includes(p)}
                onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))}
              />
              {t(`platform.${p}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <ErrorBox error={error} /> : null}
      <div className="row">
        <button type="submit" className="button button-primary" disabled={busy || !platforms.length}>
          {t("app.create")}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          {t("app.cancel")}
        </button>
      </div>
    </form>
  );
}
