import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useI18n } from "../i18n/index.tsx";
import { isOwner, useSession } from "../session.tsx";
import { ErrorBox } from "./ui.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";

const repo = "https://github.com/vStesh/guidepass";

export function Layout() {
  const { t } = useI18n();
  const { me } = useSession();
  // The profile page has its own name field.
  const onProfile = useLocation().pathname === "/profile";
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>{t("app.name")}</span>
          {me.team && <span className="brand-team">{me.team.name}</span>}
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            {t("nav.guides")}
          </NavLink>
          <NavLink to="/apps">{t("nav.apps")}</NavLink>
          <NavLink to="/team">{t("nav.team")}</NavLink>
          {isOwner(me) && <NavLink to="/settings">{t("nav.settings")}</NavLink>}
          <NavLink to="/profile">{t("nav.profile")}</NavLink>
        </nav>
      </header>
      <main className="page">
        {!me.user.name && !onProfile && <AskName />}
        <UpdateBanner />
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

/** Teammates see names next to runs and guide versions, so ask for one until it is set. */
function AskName() {
  const { t } = useI18n();
  const { api, me, setMe } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const { user } = await api.updateMe({ name: name.trim() });
      setMe({ ...me, user });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="card stack section-gap-sm ask-name" onSubmit={submit}>
      <strong>{t("profile.askName")}</strong>
      <span className="muted">{t("profile.askNameHint")}</span>
      <div className="inline-form">
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("profile.name")} />
        <button type="submit" className="button button-primary">
          {t("app.save")}
        </button>
      </div>
      {error ? <ErrorBox error={error} /> : null}
    </form>
  );
}

function Footer() {
  const { t } = useI18n();
  const links = [
    { href: repo, label: t("footer.source") },
    { href: `${repo}/blob/main/docs/connect-agent.md`, label: t("footer.connectAgent") },
    { href: `${repo}/blob/main/packages/schema/guide-instructions.md`, label: t("footer.guideInstructions") },
    { href: `${repo}/blob/main/README.md`, label: t("footer.docs") },
    { href: `${repo}/issues`, label: t("footer.issues") },
  ];
  return (
    <footer className="footer">
      <nav className="footer-links">
        {links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
            {l.label}
          </a>
        ))}
      </nav>
      <p>
        {t("footer.about", { version: __APP_VERSION__ })}{" "}
        <a href={`${repo}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
          {t("footer.license")}
        </a>
        . © 2026 Volodymyr Steshenko {t("footer.contributors")}.
      </p>
    </footer>
  );
}
