import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type ReactNode } from "react";
import type { GuideType, Verdict } from "@guidepass/schema/core";
import { errorMessage, useI18n, type Translate } from "../i18n/index.tsx";
import { en, type MessageKey } from "../i18n/en.ts";
import type { Loaded } from "../session.tsx";
import type { VersionAuthor } from "../api.ts";

// Guide text and proof are written by AI agents and people, so they are untrusted:
// only text formatting and web links survive. No forms (a fake sign-in form on a
// trusted page), no styles (overlays), no images (a remote image tracks readers).
const markdownConfig = {
  ALLOWED_TAGS: [
    "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "li",
    "ol", "p", "pre", "s", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

// Outside a browser (unit tests) DOMPurify has no DOM to work with and no hooks.
DOMPurify.addHook?.("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Renders untrusted Markdown as sanitized HTML. */
export function Markdown({ text, inline = false }: { text: string; inline?: boolean }) {
  const html = useMemo(() => {
    const raw = inline ? marked.parseInline(text, { async: false }) : marked.parse(text, { async: false });
    return DOMPurify.sanitize(raw, markdownConfig);
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
  const order: Verdict[] = ["pass", "conflict", "fail", "blocked", "skip", "untested"];
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

// Ukrainian to Latin (the official 2010 transliteration, simplified), so keys made
// from Ukrainian names stay readable: «Адмінка» → adminka.
const ukrainian: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "ʼ": "", "’": "",
};

/** Lowercase kebab-case key of at most `max` characters, never ending in a dash. */
export const slugify = (text: string, max = 80) =>
  [...text.toLowerCase()]
    .map((ch) => ukrainian[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");

/** "Anna", or "Anna via agent “Claude on my laptop”" for uploads through MCP. */
export function authorLabel(t: Translate, author: VersionAuthor | undefined): string {
  if (!author) return t("guide.authorUnknown");
  return author.kind === "agent" ? t("guide.viaAgent", { name: author.name, agent: author.agent }) : author.name;
}

/** Built-in platforms are translated; an app's own platforms use the name the owner gave them. */
export function platformLabel(t: Translate, key: string, names?: Record<string, string>): string {
  const messageKey = `platform.${key}`;
  return messageKey in en ? t(messageKey as MessageKey) : (names?.[key] ?? key);
}

export function TypeBadge({ type }: { type: GuideType }) {
  const { t } = useI18n();
  return <span className={`badge badge-type-${type}`}>{t(`type.${type}`)}</span>;
}
