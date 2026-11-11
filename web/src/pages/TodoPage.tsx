import { Link } from "react-router";
import { Chip, Load, ProgressBar, TypeBadge, formatDate, platformLabel } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { useLoad, useSession } from "../session.tsx";
import { checkedCount } from "./GuidePage.tsx";

/** What to test next: your unfinished runs first, then the guides you haven't started. */
export function TodoPage() {
  const { t, locale } = useI18n();
  const { api } = useSession();
  const [state, reload] = useLoad(() => Promise.all([api.todo(), api.environments()]).then(([todo, e]) => ({ ...todo, ...e })), [api]);

  return (
    <>
      <h1>{t("todo.title")}</h1>
      <Load state={state} reload={reload}>
        {({ runs, waiting, environments }) => {
          const envName = (key: string) => environments.find((e) => e.key === key)?.name ?? key;
          if (!runs.length && !waiting.length) return <p className="muted">{t("todo.empty")}</p>;
          return (
            <>
              {runs.length > 0 && (
                <section className="section-gap">
                  <h2>{t("todo.continue")}</h2>
                  <ul className="list">
                    {runs.map((run) => {
                      const total = Object.values(run.counts).reduce((a, b) => a + b, 0);
                      return (
                        <li key={run.id}>
                          <Link to={`/runs/${run.id}`} className="list-item">
                            <span className="list-title">{run.title}</span>
                            <span className="list-meta">
                              <Chip tone="accent">{run.appName}</Chip>
                              <span>
                                {envName(run.environment)} · {platformLabel(t, run.platform)} · {run.device}
                              </span>
                            </span>
                            <span className="list-meta">
                              <ProgressBar counts={run.counts} />
                              <span>{t("run.progress", { done: checkedCount(run.counts), total })}</span>
                              {run.version < run.currentVersion && <Chip>{t("todo.oldVersion", { version: run.version })}</Chip>}
                              <span>{t("todo.started", { date: formatDate(run.startedAt, locale) })}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {waiting.length > 0 && (
                <section className="section-gap">
                  <h2>{t("todo.waiting")}</h2>
                  <p className="muted small">{t("todo.waitingHint")}</p>
                  <ul className="list">
                    {waiting.map((guide) => (
                      <li key={guide.id}>
                        <Link to={`/guides/${guide.id}`} className="list-item">
                          <span className="list-title">{guide.title}</span>
                          <span className="list-meta">
                            <Chip tone="accent">{guide.appName}</Chip>
                            {guide.type && <TypeBadge type={guide.type} />}
                            {guide.environments.map((e) => (
                              <Chip key={e}>{envName(e)}</Chip>
                            ))}
                            <span>{t("app.updated", { date: formatDate(guide.updatedAt, locale) })}</span>
                            <span className={guide.testers ? undefined : "todo-nobody"}>
                              {guide.testers ? t("todo.testers", { count: guide.testers }) : t("todo.nobody")}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        }}
      </Load>
    </>
  );
}
