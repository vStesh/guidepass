import { useState, type FormEvent } from "react";
import type { AgentToken } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";
import { ConnectAgentGuide } from "./ConnectAgentGuide.tsx";
import { ErrorBox, Load, formatDate } from "./ui.tsx";

/** Owners create and revoke the tokens AI agents use for MCP. */
export function AgentTokens() {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const [state, reload] = useLoad(() => api.agentTokens(), [api]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AgentToken["scope"]>("read");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const { token } = await api.createAgentToken(name, scope);
      setCreated(token.token);
      setName("");
      void reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="card stack section-gap">
      <h2>{t("tokens.title")}</h2>
      <p className="muted">{t("tokens.hint")}</p>
      {error ? <ErrorBox error={error} /> : null}

      {created && (
        <div className="notice notice-ok stack">
          <strong>{t("tokens.created")}</strong>
          <ConnectAgentGuide token={created} />
        </div>
      )}

      <Load state={state} reload={reload}>
        {({ tokens }) =>
          tokens.length ? (
            <ul className="list">
              {tokens.map((token) => (
                <li key={token.id} className="list-item list-item-static">
                  <span className="list-title">{token.name}</span>
                  <span className="list-meta">
                    <span>{t(`tokens.scope.${token.scope}`)}</span>
                    <span>
                      {token.lastUsedAt ? t("tokens.lastUsed", { date: formatDate(token.lastUsedAt, locale) }) : t("tokens.neverUsed")}
                    </span>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      onClick={async () => {
                        if (!window.confirm(t("tokens.revokeConfirm", { name: token.name }))) return;
                        try {
                          await api.revokeAgentToken(token.id);
                          void reload();
                        } catch (err) {
                          setError(err);
                        }
                      }}
                    >
                      {t("tokens.revoke")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("tokens.none")}</p>
          )
        }
      </Load>

      <form className="inline-form" onSubmit={submit}>
        <input required maxLength={100} placeholder={t("tokens.namePlaceholder")} aria-label={t("tokens.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <select value={scope} onChange={(e) => setScope(e.target.value as AgentToken["scope"])} aria-label={t("tokens.title")}>
          <option value="read">{t("tokens.scope.read")}</option>
          <option value="write">{t("tokens.scope.write")}</option>
        </select>
        <button type="submit" className="button button-primary">
          {t("tokens.create")}
        </button>
      </form>
    </section>
  );
}
