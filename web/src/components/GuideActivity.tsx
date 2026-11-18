import type { GuideActivity as Activity } from "../api.ts";
import { useI18n } from "../i18n/index.tsx";
import { ProgressBar, formatDate } from "./ui.tsx";

export type GuideState = "notStarted" | "inProgress" | "failing" | "done";

/** One word for where testing of the current version stands. */
export function guideState(activity: Activity): GuideState {
  const { counts } = activity;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (counts.fail + counts.conflict > 0) return "failing";
  if (total > 0 && counts.untested === 0) return "done";
  if (counts.untested === total && activity.runs === 0) return "notStarted";
  return "inProgress";
}

/** Class for the guide's card, so its state shows at a glance in the list. */
export function guideStateClass(activity: Activity | null | undefined) {
  return activity ? ` guide-${guideState(activity)}` : "";
}

/**
 * A guide card's testing line: state, combined progress of the current version,
 * who is testing, the person's own run and when anything last happened.
 */
export function GuideActivityLine({ activity }: { activity: Activity | null | undefined }) {
  const { t, locale } = useI18n();
  if (!activity) return null;
  const state = guideState(activity);
  const { counts } = activity;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const problems = counts.fail + counts.conflict;
  return (
    <span className="list-meta guide-activity">
      <span className={`state-pill state-${state}`}>{t(`activity.${state}`)}</span>
      {state !== "notStarted" && <ProgressBar counts={counts} />}
      {state !== "notStarted" && (
        <span title={activity.carriedOver ? t("activity.carriedOver") : undefined}>
          {t("run.progress", { done: total - counts.untested, total })}
          {activity.carriedOver ? "*" : ""}
        </span>
      )}
      {problems > 0 && <span className="activity-problems">{t("activity.problems", { count: problems })}</span>}
      {counts.blocked > 0 && <span>{t("activity.blocked", { count: counts.blocked })}</span>}
      {activity.testers > 0 && <span>{t("todo.testers", { count: activity.testers })}</span>}
      {activity.openRuns > 0 && <span>{t("activity.openRuns", { count: activity.openRuns })}</span>}
      {activity.mine !== "none" && <span className="activity-mine">{t(`activity.mine.${activity.mine}`)}</span>}
      {activity.lastActivityAt && <span>{t("activity.last", { date: formatDate(activity.lastActivityAt, locale) })}</span>}
    </span>
  );
}
