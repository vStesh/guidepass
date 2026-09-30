import { useState } from "react";
import { builtInPlatforms } from "@guidepass/schema/core";
import { useI18n } from "../i18n/index.tsx";
import { platformLabel, slugify } from "./ui.tsx";

export interface PlatformsValue {
  platforms: string[];
  platformNames: Record<string, string>;
}

/** Built-in platforms as checkboxes, plus the app's own platforms with a name each. */
export function PlatformsEditor({ value, onChange }: { value: PlatformsValue; onChange: (value: PlatformsValue) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const custom = value.platforms.filter((p) => !(builtInPlatforms as readonly string[]).includes(p));

  const toggle = (key: string, on: boolean) =>
    onChange({ ...value, platforms: on ? [...value.platforms, key] : value.platforms.filter((p) => p !== key) });

  function add() {
    // Keys are at most 30 characters; leave room for a "-2" suffix.
    const base = slugify(name, 26) || "platform";
    let key = base;
    for (let i = 2; value.platforms.includes(key) || (builtInPlatforms as readonly string[]).includes(key); i++) key = `${base}-${i}`;
    onChange({ platforms: [...value.platforms, key], platformNames: { ...value.platformNames, [key]: name.trim() } });
    setName("");
  }

  function remove(key: string) {
    const { [key]: _removed, ...rest } = value.platformNames;
    onChange({ platforms: value.platforms.filter((p) => p !== key), platformNames: rest });
  }

  return (
    <fieldset className="field">
      <legend>{t("apps.platforms")}</legend>
      <div className="row">
        {builtInPlatforms.map((p) => (
          <label key={p} className="check">
            <input type="checkbox" checked={value.platforms.includes(p)} onChange={(e) => toggle(p, e.target.checked)} />
            {platformLabel(t, p)}
          </label>
        ))}
      </div>
      <small className="muted">{t("apps.apiHint")}</small>
      {custom.length > 0 && (
        <div className="row">
          {custom.map((p) => (
            <span key={p} className="chip chip-accent">
              {value.platformNames[p] ?? p}{" "}
              <button type="button" className="chip-remove" aria-label={t("apps.removePlatform")} onClick={() => remove(p)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="inline-form">
        <input
          placeholder={t("apps.customPlatform")}
          aria-label={t("apps.customPlatform")}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (name.trim()) add();
            }
          }}
        />
        <button type="button" className="button" disabled={!name.trim()} onClick={add}>
          {t("apps.addPlatform")}
        </button>
      </div>
    </fieldset>
  );
}
