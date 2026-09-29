import { NavLink, Outlet } from "react-router";
import { useI18n } from "../i18n/index.tsx";
import { useSession } from "../session.tsx";

export function Layout() {
  const { t } = useI18n();
  const { me } = useSession();
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
            {t("nav.apps")}
          </NavLink>
          <NavLink to="/team">{t("nav.team")}</NavLink>
          <NavLink to="/profile">{t("nav.profile")}</NavLink>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
