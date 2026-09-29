import { useState, type FormEvent } from "react";
import type { Role } from "../api.ts";
import { ErrorBox, Load, formatDate } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { isOwner, useLoad, useSession } from "../session.tsx";

export function TeamPage() {
  const { t, locale } = useI18n();
  const { api, me } = useSession();
  const owner = isOwner(me);
  const [state, reload] = useLoad(
    () => Promise.all([api.members(), owner ? api.invitations() : Promise.resolve({ invitations: [] })]).then(([m, i]) => ({ ...m, ...i })),
    [api, owner],
  );
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
      <h1>{t("team.title")}</h1>
      {error ? <ErrorBox error={error} /> : null}
      <Load state={state} reload={reload}>
        {({ members, invitations }) => (
          <>
            <h2>{t("team.members")}</h2>
            <ul className="list">
              {members.map((m) => (
                <li key={m.id} className="list-item list-item-static">
                  <span className="list-title">
                    {m.name ?? m.email}
                    {m.id === me.user.id && <span className="muted"> ({t("team.you")})</span>}
                  </span>
                  <span className="list-meta">
                    {m.name && <span>{m.email}</span>}
                    {owner ? (
                      <select value={m.role} onChange={(e) => void act(() => api.setMemberRole(m.id, e.target.value as Role))()}>
                        <option value="owner">{t("team.role.owner")}</option>
                        <option value="tester">{t("team.role.tester")}</option>
                      </select>
                    ) : (
                      <span>{t(`team.role.${m.role}`)}</span>
                    )}
                    {owner && m.id !== me.user.id && (
                      <button
                        type="button"
                        className="button button-small button-ghost"
                        onClick={() => window.confirm(t("team.removeConfirm", { email: m.email })) && void act(() => api.removeMember(m.id))()}
                      >
                        {t("team.remove")}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {owner && (
              <>
                <InviteForm onInvited={reload} />
                <h2 className="section-gap">{t("team.pending")}</h2>
                {invitations.length ? (
                  <ul className="list">
                    {invitations.map((i) => (
                      <li key={i.id} className="list-item list-item-static">
                        <span className="list-title">{i.email}</span>
                        <span className="list-meta">
                          <span>{t(`team.role.${i.role}`)}</span>
                          <span>{formatDate(i.createdAt, locale)}</span>
                          <button type="button" className="button button-small button-ghost" onClick={act(() => api.revokeInvitation(i.id))}>
                            {t("team.revoke")}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{t("team.noPending")}</p>
                )}
              </>
            )}
          </>
        )}
      </Load>
    </>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("tester");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api.invite(email, role);
      setMessage(t(res.accountCreated ? "team.inviteCreated" : "team.inviteExisting", { email: res.invitation.email }));
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="card stack section-gap" onSubmit={submit}>
      <h2>{t("team.invite")}</h2>
      <p className="muted">{t("team.inviteHint")}</p>
      <div className="inline-form">
        <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t("team.members")}>
          <option value="tester">{t("team.role.tester")}</option>
          <option value="owner">{t("team.role.owner")}</option>
        </select>
        <button type="submit" className="button button-primary">
          {t("team.invite")}
        </button>
      </div>
      {message && <p className="notice notice-ok">{message}</p>}
      {error ? <ErrorBox error={error} /> : null}
    </form>
  );
}
