import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { BatchGetBuildsCommand, CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";

export type UpdateRunStatus = "running" | "succeeded" | "failed";

export interface UpdateRunState {
  status: UpdateRunStatus;
  /** CodeBuild's current step, e.g. PRE_BUILD (database snapshot) or BUILD (terraform apply). */
  phase: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** The last lines of the log. */
  log: string[];
}

/**
 * Runs an update of this instance to a release: in AWS, the instance's CodeBuild
 * project (infra/updates.tf), which snapshots the database and runs terraform apply.
 */
export interface Updater {
  /** Deploys release `version` at exactly `commit`. */
  start(version: string, commit: string): Promise<{ id: string }>;
  get(id: string): Promise<UpdateRunState | null>;
}

export function codebuildUpdater(project: string): Updater {
  const codebuild = new CodeBuildClient({});
  const logs = new CloudWatchLogsClient({});
  return {
    async start(version, commit) {
      // Only these two may be set per run (IAM denies any other override, infra/lambda.tf);
      // everything else comes from the project and the instance's SSM parameter.
      const { build } = await codebuild.send(
        new StartBuildCommand({
          projectName: project,
          environmentVariablesOverride: [
            { name: "TARGET_VERSION", value: `v${version}`, type: "PLAINTEXT" },
            { name: "TARGET_COMMIT", value: commit, type: "PLAINTEXT" },
          ],
        }),
      );
      return { id: build!.id! };
    },
    async get(id) {
      const { builds } = await codebuild.send(new BatchGetBuildsCommand({ ids: [id] }));
      const build = builds?.[0];
      if (!build) return null;
      let log: string[] = [];
      if (build.logs?.groupName && build.logs.streamName) {
        try {
          const events = await logs.send(
            new GetLogEventsCommand({
              logGroupName: build.logs.groupName,
              logStreamName: build.logs.streamName,
              startFromHead: false,
              limit: 40,
            }),
          );
          log = (events.events ?? []).map((e) => (e.message ?? "").trimEnd()).filter(Boolean);
        } catch {
          // The stream appears a few seconds after the build starts.
        }
      }
      const status: UpdateRunStatus =
        build.buildStatus === "IN_PROGRESS" ? "running" : build.buildStatus === "SUCCEEDED" ? "succeeded" : "failed";
      return {
        status,
        phase: build.currentPhase ?? null,
        startedAt: build.startTime?.toISOString() ?? null,
        endedAt: build.endTime?.toISOString() ?? null,
        log,
      };
    },
  };
}
