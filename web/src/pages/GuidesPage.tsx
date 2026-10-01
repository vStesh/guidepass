import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { guideTypes } from "@guidepass/schema/core";
import type { GuideSummary } from "../api.ts";
import { Chip, ErrorBox, Load, TypeBadge, authorLabel, formatDate } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";

const PAGE = 30;

/** Home: every guide the team has, across apps, with filters kept in the URL. */
export function GuidesPage() {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const [params, setParams] = useSearchParams();
  const filters = {
    appId: params.get("app") ?? "",
    areaId: params.get("area") ?? "",
    environment: params.get("env") ?? "",
    type: params.get("type") ?? "",
    status: params.get("status") ?? "active",
    q: params.get("q") ?? "",
  };

  // Search waits for a pause in typing before it hits the API.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== filters.q) setParam("q", search.trim());
    }, 350);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only the typed text should restart the timer
  }, [search]);

  const [meta, reloadMeta] = useLoad(
    () => Promise.all([api.apps(), api.environments()]).then(([a, e]) => ({ ...a, ...e })),
    [api],
  );
  const [areas, reloadAreas] = useLoad(
    () => (filters.appId ? api.app(filters.appId).then((r) => r.app.areas) : Promise.resolve([])),
    [api, filters.appId],
  );

  const key = JSON.stringify(filters);
  const [first, reloadFirst] = useLoad(
    () =>
      api.allGuides({
        appId: filters.appId || undefined,
        areaId: filters.areaId || undefined,
        environment: filters.environment || undefined,
        type: filters.type || undefined,
        status: filters.status,
        q: filters.q || undefined,
        limit: PAGE,
      }),
    [api, key],
  );
  const [more, setMore] = useState<GuideSummary[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [moreError, setMoreError] = useState<unknown>(null);
  useEffect(() => {
    setMore([]);
    setMoreError(null);
    setHasMore(first.status === "ready" && first.data.guides.length === PAGE);
  }, [first]);

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "app") next.delete("area");
    setParams(next, { replace: true });
  }

  async function loadMore(loaded: number) {
    setMoreError(null);
    try {
      const { guides } = await api.allGuides({
        appId: filters.appId || undefined,
        areaId: filters.areaId || undefined,
        environment: filters.environment || undefined,
        type: filters.type || undefined,
        status: filters.status,
        q: filters.q || undefined,
        limit: PAGE,
        offset: loaded,
      });
      setMore((m) => [...m, ...guides]);
      setHasMore(guides.length === PAGE);
    } catch (err) {
      setMoreError(err);
    }
  }

  return (
    <Load state={meta} reload={reloadMeta}>
      {({ apps, environments }) => {
        const envName = (k: string) => environments.find((e) => e.key === k)?.name ?? k;
        return (
          <>
            <h1>{t("home.title")}</h1>
            <div className="filters">
              <input
                type="search"
                className="filter-search"
                placeholder={t("home.search")}
                aria-label={t("home.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={filters.appId} onChange={(e) => setParam("app", e.target.value)} aria-label={t("home.allApps")}>
                <option value="">{t("home.allApps")}</option>
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {filters.appId && areas.status === "ready" && areas.data.length > 0 && (
                <select value={filters.areaId} onChange={(e) => setParam("area", e.target.value)} aria-label={t("app.areas")}>
                  <option value="">{t("app.allAreas")}</option>
                  {areas.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <select value={filters.environment} onChange={(e) => setParam("env", e.target.value)} aria-label={t("guide.environment")}>
                <option value="">{t("app.allEnvironments")}</option>
                {environments
                  .filter((e) => !e.archived)
                  .map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.name}
                    </option>
                  ))}
              </select>
              <select value={filters.type} onChange={(e) => setParam("type", e.target.value)} aria-label={t("app.allTypes")}>
                <option value="">{t("app.allTypes")}</option>
                {guideTypes.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`type.${ty}`)}
                  </option>
                ))}
              </select>
              <div className="segmented" role="group">
                {(["active", "archived"] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={filters.status === s} onClick={() => setParam("status", s === "active" ? "" : s)}>
                    {t(`app.status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            {areas.status === "error" ? <ErrorBox error={areas.error} onRetry={reloadAreas} /> : null}

            {apps.length === 0 ? (
              <p className="muted">{t("home.noApps")}</p>
            ) : (
              <Load state={first} reload={reloadFirst}>
                {({ guides }) => {
                  const all = [...guides, ...more];
                  if (!all.length) return <p className="muted">{t("home.empty")}</p>;
                  return (
                    <>
                      <ul className="list">
                        {all.map((g) => (
                          <li key={g.id}>
                            <Link to={`/guides/${g.id}`} className="list-item">
                              <span className="list-title">{g.title}</span>
                              <span className="list-meta">
                                <Chip tone="accent">{g.appName}</Chip>
                                {g.type && <TypeBadge type={g.type} />}
                                {g.environments.map((e) => (
                                  <Chip key={e}>{envName(e)}</Chip>
                                ))}
                                <span>v{g.currentVersion}</span>
                                <span>{t("app.updated", { date: formatDate(g.updatedAt, locale) })}</span>
                                {g.updatedBy && <span>{authorLabel(t, g.updatedBy)}</span>}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {moreError ? <ErrorBox error={moreError} /> : null}
                      {hasMore && (
                        <button type="button" className="button" onClick={() => void loadMore(all.length)}>
                          {t("home.loadMore")}
                        </button>
                      )}
                    </>
                  );
                }}
              </Load>
            )}
          </>
        );
      }}
    </Load>
  );
}
