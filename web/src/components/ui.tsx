import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type ReactNode } from "react";
import type { Verdict } from "@guidepass/schema/core";
import { errorMessage, useI18n } from "../i18n/index.tsx";
import type { Loaded } from "../session.tsx";

/**
 * Guide text is written by AI agents and people, so it is sanitized before it
 * reaches the page.
 */
export function Markdown({ text, inline = false }: { text: string; inline?: boolean }) {
  const html = useMemo(() => {
    const raw = inline ? marked.parseInline(text, { async: false }) : marked.parse(text, { async: false });
    return DOMPurify.sanitize(raw);
  }, [text, inline]);
  const Tag = inline ? "span" : "div";
  return <Tag className={inline ? undefined : "markdown"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="notice notice-error" role="alert">
      <p className="pre-line">{errorMessage(t, error)}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {t("app.retry")}
        </button>
      )}
    </div>
  );
}

/** Renders a loaded page, or its loading and error states. */
export function Load<T>({
  state,
  reload,
  children,
}: {
  state: Loaded<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (state.status === "loading") return <p className="muted">{t("app.loading")}</p>;
  if (state.status === "error") return <ErrorBox error={state.error} onRetry={reload} />;
  return <>{children(state.data)}</>;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useI18n();
  return <span className={`badge badge-${verdict}`}>{t(`verdict.${verdict}`)}</span>;
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

/** Stacked bar of verdict counts. */
export function ProgressBar({ counts }: { counts: Partial<Record<Verdict, number>> }) {
  const order: Verdict[] = ["pass", "conflict", "fail", "skip", "untested"];
  const total = order.reduce((sum, v) => sum + (counts[v] ?? 0), 0);
  if (!total) return null;
  return (
    <div className="bar" aria-hidden="true">
      {order.map((v) =>
        counts[v] ? <span key={v} className={`bar-${v}`} style={{ width: `${(counts[v]! / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

export function formatDate(value: string | Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
