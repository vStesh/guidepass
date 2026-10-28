import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { ApiError, chooseTeam, chosenTeam, createApi, type Me } from "./api.ts";
import type { Auth } from "./auth.ts";
import { Layout } from "./components/Layout.tsx";
import { ErrorBox } from "./components/ui.tsx";
import { I18nProvider, initialLocale, rememberLocale, useI18n } from "./i18n/index.tsx";
import { AppPage } from "./pages/AppPage.tsx";
import { AppsPage } from "./pages/AppsPage.tsx";
import { GuidePage } from "./pages/GuidePage.tsx";
import { GuidesPage } from "./pages/GuidesPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SetupPage } from "./pages/SetupPage.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";
import { TeamPage } from "./pages/TeamPage.tsx";
import { SessionContext, type Session } from "./session.tsx";

type State = { status: "loading" } | { status: "signedOut" } | { status: "error"; error: unknown } | { status: "ready"; me: Me };

/** `?team=` on a link (Slack, an agent) opens the page in its team; dropped from the address once read. */
function teamFromLink(): string | null {
  const url = new URL(window.location.href);
  const team = url.searchParams.get("team");
  if (!team) return null;
  url.searchParams.delete("team");
  window.history.replaceState(window.history.state, "", url);
  return team;
}

export function App({ auth }: { auth: Auth }) {
  // The team this tab works in, fixed until it reloads: other tabs may switch theirs.
  const [team] = useState(() => ({ current: teamFromLink() ?? chosenTeam() }));
  const api = useMemo(() => createApi(auth, () => team.current), [auth, team]);
  const [state, setState] = useState<State>({ status: "loading" });

  const loadMe = useCallback(async () => {
    try {
      const me = await api.me();
      rememberLocale(me.user.locale);
      // The API falls back to the first team when the chosen one is gone: follow it.
      if (me.team) {
        team.current = me.team.id;
        if (me.team.id !== chosenTeam()) chooseTeam(me.team.id);
      }
      setState({ status: "ready", me });
    } catch (error) {
      setState(error instanceof ApiError && error.status === 401 ? { status: "signedOut" } : { status: "error", error });
    }
  }, [api, team]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setState({ status: "signedOut" });
  }, [auth]);

  const locale = state.status === "ready" ? state.me.user.locale : initialLocale();

  let content;
  if (state.status === "loading") content = <Centered><Loading /></Centered>;
  else if (state.status === "error") content = <Centered><ErrorBox error={state.error} onRetry={loadMe} /></Centered>;
  else if (state.status === "signedOut") content = <SignInPage auth={auth} onSignedIn={loadMe} />;
  else {
    const session: Session = {
      api,
      auth,
      me: state.me,
      setMe: (me) => {
        rememberLocale(me.user.locale);
        setState({ status: "ready", me });
      },
      signOut,
      switchTeam: (teamId) => {
        chooseTeam(teamId);
        // A fresh start: every page and cached list belongs to the old team.
        window.location.assign("/");
      },
    };
    content = (
      <SessionContext.Provider value={session}>
        {state.me.team ? (
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<GuidesPage />} />
                <Route path="apps" element={<AppsPage />} />
                <Route path="apps/:appId" element={<AppPage />} />
                <Route path="guides/:guideId" element={<GuidePage />} />
                <Route path="runs/:runId" element={<RunPage />} />
                <Route path="team" element={<TeamPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<GuidesPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        ) : (
          <SetupPage onDone={loadMe} />
        )}
      </SessionContext.Provider>
    );
  }

  return <I18nProvider locale={locale}>{content}</I18nProvider>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}

function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t("app.loading")}</p>;
}
