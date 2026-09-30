import { useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { guideTypes } from "@guidepass/schema/core";
import type { App, Area, UploadResult } from "../api.ts";
import { PlatformsEditor, type PlatformsValue } from "../components/PlatformsEditor.tsx";
import { Chip, ErrorBox, Load, TypeBadge, formatDate, platformLabel, slugify } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { isOwner, useLoad, useSession } from "../session.tsx";

export function AppPage() {
  const { appId = "" } = useParams();
  const { t, locale } = useI18n();
  const { api, me } = useSession();
  const [params, setParams] = useSearchParams();
  const areaId = params.get("area") ?? "";
  const status = params.get("status") ?? "active";
  const environment = params.get("env") ?? "";
  const type = params.get("type") ?? "";

  const [appState, reloadApp] = useLoad(
    () => Promise.all([api.app(appId), api.environments()]).then(([a, e]) => ({ ...a, ...e })),
    [api, appId],
  );
  const [guidesState, reloadGuides] = useLoad(
    () =>
      api.guides(appId, {
        areaId: areaId || undefined,
        status,
        environment: environment || undefined,
        type: type || undefined,
      }),
    [api, appId, areaId, status, environment, type],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Load state={appState} reload={reloadApp}>
      {({ app, environments }) => {
        const envName = (key: string) => environments.find((e) => e.key === key)?.name ?? key;
        const areaName = (id: string | null) => app.areas.find((a) => a.id === id)?.name;
        return (
          <>
            <Link to="/" className="back">
              ← {t("nav.apps")}
            </Link>
            <div className="page-head">
              <h1>{app.name}</h1>
              <span className="list-meta">
                {app.platforms.map((p) => (
                  <Chip key={p}>{platformLabel(t, p, app.platformNames)}</Chip>
                ))}
              </span>
            </div>

            <div className="filters">
              <select value={areaId} onChange={(e) => setParam("area", e.target.value)} aria-label={t("app.areas")}>
                <option value="">{t("app.allAreas")}</option>
                {app.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select value={environment} onChange={(e) => setParam("env", e.target.value)} aria-label={t("guide.environment")}>
                <option value="">{t("app.allEnvironments")}</option>
                {environments
                  .filter((e) => !e.archived)
                  .map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.name}
                    </option>
                  ))}
              </select>
              <select value={type} onChange={(e) => setParam("type", e.target.value)} aria-label={t("app.allTypes")}>
                <option value="">{t("app.allTypes")}</option>
                {guideTypes.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`type.${ty}`)}
                  </option>
                ))}
              </select>
              <div className="segmented" role="group">
                {(["active", "archived"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={status === s}
                    onClick={() => setParam("status", s === "active" ? "" : s)}
                  >
                    {t(`app.status.${s}`)}
                  </button>
                ))}
              </div>
            </div>

            <h2>{t("app.guides")}</h2>
            <Load state={guidesState} reload={reloadGuides}>
              {({ guides }) =>
                guides.length ? (
                  <ul className="list">
                    {guides.map((g) => (
                      <li key={g.id}>
                        <Link to={`/guides/${g.id}`} className="list-item">
                          <span className="list-title">{g.title}</span>
                          <span className="list-meta">
                            {g.type && <TypeBadge type={g.type} />}
                            {areaName(g.areaId) && <Chip tone="accent">{areaName(g.areaId)}</Chip>}
                            {g.environments.map((e) => (
                              <Chip key={e}>{envName(e)}</Chip>
                            ))}
                            <span>v{g.currentVersion}</span>
                            <span>{t("app.updated", { date: formatDate(g.updatedAt, locale) })}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{t("app.noGuides")}</p>
                )
              }
            </Load>

            {isOwner(me) && (
              <>
                <NewAreaForm appId={app.id} onDone={reloadApp} />
                <AppPlatforms app={app} onSaved={reloadApp} />
                <UploadGuideForm appId={app.id} areas={app.areas} onUploaded={reloadGuides} />
              </>
            )}
          </>
        );
      }}
    </Load>
  );
}

function NewAreaForm({ appId, onDone }: { appId: string; onDone: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.createArea(appId, { name, slug: slugify(name) });
      setName("");
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input required placeholder={t("app.newArea")} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("app.newArea")} />
      <button type="submit" className="button">
        {t("app.create")}
      </button>
      {error ? <ErrorBox error={error} /> : null}
    </form>
  );
}

/** Paste a guide as JSON; checked with a dry run before anything is saved. */
function UploadGuideForm({ appId, areas, onUploaded }: { appId: string; areas: Area[]; onUploaded: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [areaId, setAreaId] = useState("");
  const [json, setJson] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [baseVersion, setBaseVersion] = useState<number | undefined>();
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    setError(null);
    setResult(null);
    let content: unknown;
    try {
      content = JSON.parse(json);
    } catch {
      setError(new Error(t("app.invalidJson")));
      return;
    }
    setBusy(true);
    try {
      const body = { slug, areaId: areaId || null, content, changeNote: changeNote || undefined, baseVersion, dryRun };
      const res = await api.uploadGuide(appId, body);
      setResult(res);
      if (!dryRun) onUploaded();
    } catch (err) {
      // Adding a version needs the current version number; take it from the answer and let the person confirm.
      const current = (err as { details?: { currentVersion?: number } }).details?.currentVersion;
      if (current) setBaseVersion(current);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="button section-gap" onClick={() => setOpen(true)}>
        {t("app.uploadTitle")}
      </button>
    );
  }

  return (
    <form className="card stack section-gap" onSubmit={(e) => (e.preventDefault(), void send(false))}>
      <h2>{t("app.uploadTitle")}</h2>
      <p className="muted">{t("app.uploadHint")}</p>
      <div className="grid-2">
        <label className="field">
          <span>{t("app.guideSlug")}</span>
          <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder={t("app.guideSlugHint")} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("app.area")}</span>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">{t("app.noArea")}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t("app.content")}</span>
        <textarea className="code" rows={10} required value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </label>
      {baseVersion !== undefined && (
        <label className="field">
          <span>{t("app.changeNote")}</span>
          <input required value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
        </label>
      )}
      {error ? <ErrorBox error={error} /> : null}
      {result && (
        <div className="notice notice-ok">
          <p>{result.dryRun ? t("app.checkOk", { version: result.version }) : t("app.uploaded", { version: result.version })}</p>
          <DiffSummary diff={result.diff} />
        </div>
      )}
      <div className="row">
        <button type="button" className="button" disabled={busy} onClick={() => void send(true)}>
          {t("app.check")}
        </button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {t("app.upload")}
        </button>
        <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>
          {t("app.cancel")}
        </button>
      </div>
    </form>
  );
}

function DiffSummary({ diff }: { diff: UploadResult["diff"] }) {
  const { t } = useI18n();
  const groups = (["added", "changed", "deprecated", "removed", "unchanged"] as const).filter((k) => diff[k].length);
  return (
    <ul className="diff">
      {groups.map((k) => (
        <li key={k}>
          <strong>{t(`diff.${k}`)}:</strong> {diff[k].join(", ")}
        </li>
      ))}
    </ul>
  );
}

/** Owners change the app's platforms; ones that already have runs can't be removed (the API says which). */
function AppPlatforms({ app, onSaved }: { app: App; onSaved: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PlatformsValue>({ platforms: app.platforms, platformNames: app.platformNames });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!open) {
    return (
      <button type="button" className="button section-gap" onClick={() => setOpen(true)}>
        {t("app.editPlatforms")}
      </button>
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await api.updateApp(app.id, value);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card stack section-gap">
      <PlatformsEditor value={value} onChange={setValue} />
      {saved && <p className="notice notice-ok">{t("app.platformsSaved")}</p>}
      {error ? <ErrorBox error={error} /> : null}
      <div className="row">
        <button type="button" className="button button-primary" disabled={!value.platforms.length} onClick={() => void save()}>
          {t("app.save")}
        </button>
        <button
          type="button"
          className="button button-ghost"
          onClick={() => {
            // Drop unsaved changes so the editor reopens with what is actually saved.
            setValue({ platforms: app.platforms, platformNames: app.platformNames });
            setError(null);
            setSaved(false);
            setOpen(false);
          }}
        >
          {t("app.cancel")}
        </button>
      </div>
    </div>
  );
}
