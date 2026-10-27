import { builtInPlatforms, type Platform } from "@guidepass/schema/core";
import { useState, type FormEvent } from "react";
import type { DeviceFields, SavedDevice } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";
import { ErrorBox, Load, platformLabel } from "./ui.tsx";

/** What a run records about the device: model, OS and the rest, not the member's own label. */
export function deviceDescription(device: Pick<SavedDevice, "model" | "os" | "details">): string {
  return [device.model, device.os, device.details].filter(Boolean).join(" · ");
}

/** The member's saved devices on the profile page: add, edit, delete. */
export function MyDevices() {
  const { t } = useI18n();
  const { api } = useSession();
  const [state, reload] = useLoad(async () => {
    const [{ devices }, { apps }] = await Promise.all([api.devices(), api.apps()]);
    // Built-in platforms plus every app's own ones, with their display names.
    const names: Record<string, string> = {};
    const platforms = new Set<Platform>(builtInPlatforms);
    for (const app of apps) {
      for (const p of app.platforms) platforms.add(p);
      Object.assign(names, app.platformNames);
    }
    return { devices, platforms: [...platforms], names };
  }, [api]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setEditing(null);
      await reload();
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  }

  return (
    <section id="devices" className="card stack section-gap">
      <h2>{t("devices.title")}</h2>
      <p className="muted">{t("devices.hint")}</p>
      {error ? <ErrorBox error={error} /> : null}
      <Load state={state} reload={reload}>
        {({ devices, platforms, names }) => (
          <>
            {devices.length ? (
              <ul className="list">
                {devices.map((device) =>
                  editing === device.id ? (
                    <li key={device.id} className="list-item">
                      <DeviceForm
                        initial={device}
                        platforms={platforms}
                        names={names}
                        submitLabel={t("app.save")}
                        onSubmit={(fields) => act(() => api.updateDevice(device.id, fields))}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <li key={device.id} className="list-item">
                      <span className="list-title">{device.name}</span>
                      <span className="list-meta">
                        <span>{platformLabel(t, device.platform, names)}</span>
                        <span>{deviceDescription(device)}</span>
                      </span>
                      <div className="row">
                        <button type="button" className="button button-small" onClick={() => setEditing(device.id)}>
                          {t("devices.edit")}
                        </button>
                        <button
                          type="button"
                          className="button button-small button-ghost"
                          onClick={() => {
                            if (window.confirm(t("devices.deleteConfirm", { name: device.name }))) {
                              void act(() => api.deleteDevice(device.id));
                            }
                          }}
                        >
                          {t("devices.delete")}
                        </button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="muted">{t("devices.none")}</p>
            )}
            <h3>{t("devices.add")}</h3>
            <DeviceForm
              platforms={platforms}
              names={names}
              submitLabel={t("devices.add")}
              onSubmit={(fields) => act(() => api.createDevice(fields))}
            />
          </>
        )}
      </Load>
    </section>
  );
}

function DeviceForm({
  initial,
  platforms,
  names,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: SavedDevice;
  platforms: Platform[];
  names: Record<string, string>;
  submitLabel: string;
  /** Resolves to whether it was saved; the add form is cleared only then. */
  onSubmit: (fields: DeviceFields) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? platforms[0] ?? "ios");
  const [model, setModel] = useState(initial?.model ?? "");
  const [os, setOs] = useState(initial?.os ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const saved = await onSubmit({ name: name.trim(), platform, model: model.trim(), os: os.trim(), details: details.trim() });
    setSaving(false);
    if (saved && !initial) {
      setName("");
      setModel("");
      setOs("");
      setDetails("");
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-3">
        <label className="field">
          <span>{t("devices.name")}</span>
          <input required maxLength={60} placeholder={t("devices.nameHint")} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("guide.platform")}</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(t, p, names)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("devices.model")}</span>
          <input required maxLength={60} placeholder={t("devices.modelHint")} value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("devices.os")}</span>
          <input maxLength={40} placeholder={t("devices.osHint")} value={os} onChange={(e) => setOs(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("devices.details")}</span>
          <input
            maxLength={80}
            placeholder={t("devices.detailsHint")}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button type="submit" className="button button-primary button-small" disabled={saving} aria-busy={saving}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button button-small button-ghost" onClick={onCancel}>
            {t("app.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
