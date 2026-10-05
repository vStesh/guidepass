import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { UpdateStatus } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { isOwner, useSession } from "../session.tsx";
import { Markdown, formatDate } from "./ui.tsx";

const DISMISSED_KEY = "guidepass.dismissedUpdate";
export const UPDATING_DOCS = "https://github.com/vStesh/guidepass/blob/main/docs/updating.md";

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Tells owners that a newer Guidepass release exists, until they hide it for that version. */
export function UpdateBanner() {
  const { t, locale } = useI18n();
  const { api, me } = useSession();
  const owner = isOwner(me);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [hidden, setHidden] = useState(dismissedVersion);

  useEffect(() => {
    if (!owner) return;
    // Best effort: a failed check shows nothing rather than an error on every page.
    api.updates().then(setStatus, () => undefined);
  }, [api, owner]);

  if (!status?.updateAvailable || !status.latest || hidden === status.latest.version) return null;
  const { latest } = status;

  function hide() {
    try {
      localStorage.setItem(DISMISSED_KEY, latest.version);
    } catch {
      // Hidden for this visit only.
    }
    setHidden(latest.version);
  }

  return (
    <aside className="card stack section-gap-sm update-banner">
      <strong>{t("update.available", { version: latest.version, current: status.current })}</strong>
      <details>
        <summary>{t("update.whatsNew", { date: formatDate(latest.publishedAt, locale) })}</summary>
        <Markdown text={latest.notes || t("update.noNotes")} />
      </details>
      <div className="row">
        {status.canUpdate ? (
          <Link className="button button-primary button-small" to="/settings#version">
            {t("update.button", { version: latest.version })}
          </Link>
        ) : (
          <a className="button button-primary button-small" href={UPDATING_DOCS} target="_blank" rel="noopener noreferrer">
            {t("update.how")}
          </a>
        )}
        {latest.url.startsWith("https://github.com/") && (
          <a className="button button-small" href={latest.url} target="_blank" rel="noopener noreferrer">
            {t("update.release")}
          </a>
        )}
        <button type="button" className="button button-small button-ghost" onClick={hide}>
          {t("update.hide")}
        </button>
      </div>
    </aside>
  );
}
