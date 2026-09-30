import { useState, type FormEvent } from "react";
import type { Environment } from "../api.ts";
import { ErrorBox, Load, slugify } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";

/** Owner settings for the instance: environments. */
export function SettingsPage() {
  const { t } = useI18n();
  const { api } = useSession();
  const [state, reload] = useLoad(() => api.environments(), [api]);
  const [error, setError] = useState<unknown>(null);

  const act = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <h1>{t("settings.title")}</h1>
      <section className="card stack">
        <h2>{t("settings.environments")}</h2>
        <p className="muted">{t("settings.environmentsHint")}</p>
        {error ? <ErrorBox error={error} /> : null}
        <Load state={state} reload={reload}>
          {({ environments }) => {
            const move = (index: number, by: number) => {
              const keys = environments.map((e) => e.key);
              const [key] = keys.splice(index, 1);
              keys.splice(index + by, 0, key!);
              return act(() => api.orderEnvironments(keys));
            };
            return (
              <ul className="list">
                {environments.map((env, i) => (
                  <EnvironmentRow
                    key={env.key}
                    env={env}
                    first={i === 0}
                    last={i === environments.length - 1}
                    onUp={move(i, -1)}
                    onDown={move(i, 1)}
                    onRename={(name) => act(() => api.updateEnvironment(env.key, { name }))()}
                    onArchive={act(() => api.updateEnvironment(env.key, { archived: !env.archived }))}
                  />
                ))}
              </ul>
            );
          }}
        </Load>
        <NewEnvironment onAdded={reload} onError={setError} />
      </section>
    </>
  );
}

function EnvironmentRow({
  env,
  first,
  last,
  onUp,
  onDown,
  onRename,
  onArchive,
}: {
  env: Environment;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRename: (name: string) => void;
  onArchive: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(env.name);
  return (
    <li className={`list-item list-item-static${env.archived ? " muted" : ""}`}>
      <span className="list-title">
        <code>{env.key}</code> {env.archived && <span className="muted">({t("settings.archived")})</span>}
      </span>
      <span className="list-meta">
        <input
          aria-label={t("settings.name")}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== env.name && onRename(name.trim())}
        />
        <button type="button" className="button button-small" disabled={first} aria-label={t("settings.moveUp")} onClick={onUp}>
          ↑
        </button>
        <button type="button" className="button button-small" disabled={last} aria-label={t("settings.moveDown")} onClick={onDown}>
          ↓
        </button>
        <button type="button" className="button button-small button-ghost" onClick={onArchive}>
          {env.archived ? t("settings.restore") : t("settings.archive")}
        </button>
      </span>
    </li>
  );
}

function NewEnvironment({ onAdded, onError }: { onAdded: () => void; onError: (err: unknown) => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError(null);
    try {
      await api.createEnvironment(key, name);
      setName("");
      setKey("");
      setKeyTouched(false);
      onAdded();
    } catch (err) {
      onError(err);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        required
        maxLength={60}
        placeholder={t("settings.name")}
        aria-label={t("settings.name")}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!keyTouched) setKey(slugify(e.target.value, 40));
        }}
      />
      <input
        required
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        maxLength={40}
        placeholder={t("settings.keyHint")}
        aria-label={t("settings.key")}
        value={key}
        onChange={(e) => {
          setKeyTouched(true);
          setKey(e.target.value);
        }}
      />
      <button type="submit" className="button button-primary">
        {t("settings.add")}
      </button>
    </form>
  );
}
