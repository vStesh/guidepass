import { useState, type FormEvent } from "react";
import type { AgentToken, Member } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { canWrite, isOwner, useLoad, useSession } from "../session.tsx";
import { ConnectAgentGuide } from "./ConnectAgentGuide.tsx";
import { ErrorBox, Load, formatDate } from "./ui.tsx";

/**
 * Tokens AI agents use for MCP. Each token is held by a member, and what its agent
 * uploads is shown as theirs. Owners see and manage everyone's tokens; writers
 * create their own; testers see the ones an owner gave them.
 */
export function AgentTokens({ members }: { members: Member[] }) {
  const { t, locale } = useI18n();
  const { api, me } = useSession();
  const owner = isOwner(me);
  const writer = canWrite(me);
  const [state, reload] = useLoad(() => api.agentTokens(), [api]);
  const [chosenHolder, setHolder] = useState(me.user.id);
  // Falls back to me if the chosen member has just been removed.
  const holder = members.some((m) => m.id === chosenHolder) ? chosenHolder : me.user.id;
  const [moving, setMoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AgentToken["scope"]>("read");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const { token } = await api.createAgentToken(name, scope, holder);
      setCreated(token.token);
      setName("");
      setHolder(me.user.id);
      void reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section className="card stack section-gap">
      <h2>{owner ? t("tokens.title") : t("tokens.myTitle")}</h2>
      <p className="muted">{t("tokens.hint")}</p>
      {!writer && <p className="muted">{t("tokens.testerHint")}</p>}
      {error ? <ErrorBox error={error} /> : null}
      {notice && <p className="notice notice-ok">{notice}</p>}

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
                    {owner && (
                      <MemberSelect
                        members={members}
                        value={token.userId}
                        label={t("tokens.holder")}
                        disabled={moving === token.id}
                        onChange={async (userId) => {
                          const to = members.find((m) => m.id === userId);
                          const includePastUploads = window.confirm(
                            t("tokens.movePast", { name: token.name, member: to?.name ?? to?.email ?? "" }),
                          );
                          setError(null);
                          setNotice(null);
                          setMoving(token.id);
                          try {
                            const { movedUploads } = await api.setTokenHolder(token.id, userId, includePastUploads);
                            if (movedUploads) setNotice(t("tokens.moved", { count: movedUploads }));
                            await reload();
                          } catch (err) {
                            setError(err);
                          } finally {
                            setMoving(null);
                          }
                        }}
                      />
                    )}
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

      {writer && (
        <>
          <p className="muted small">{owner ? t("tokens.holderHint") : t("tokens.writerHint")}</p>
          <form className="inline-form" onSubmit={submit}>
            <input required maxLength={100} placeholder={t("tokens.namePlaceholder")} aria-label={t("tokens.name")} value={name} onChange={(e) => setName(e.target.value)} />
            {owner && <MemberSelect members={members} value={holder} label={t("tokens.holder")} onChange={setHolder} />}
            <select value={scope} onChange={(e) => setScope(e.target.value as AgentToken["scope"])} aria-label={t("tokens.title")}>
              <option value="read">{t("tokens.scope.read")}</option>
              <option value="write">{t("tokens.scope.write")}</option>
            </select>
            <button type="submit" className="button button-primary">
              {t("tokens.create")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function MemberSelect({
  members,
  value,
  label,
  disabled,
  onChange,
}: {
  members: Member[];
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (userId: string) => void;
}) {
  const known = members.some((m) => m.id === value);
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>
      {!known && (
        <option value={value} disabled>
          —
        </option>
      )}
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name ?? m.email}
        </option>
      ))}
    </select>
  );
}
