#!/usr/bin/env bash
# Shows the last run of an instance's updater (the Update button in the web app):
# its status, phases and the end of its log, for when an update fails.
#
#   AWS_PROFILE=<profile> ./update-log.sh <instance> [lines]
#
# Needs <instance>.tfvars next to this script, and the deploy credentials' read
# access to the updater (UpdaterBuildsRead / UpdaterLogsRead in deploy-policy.json).
set -euo pipefail
cd "$(dirname "$0")"

instance="${1:?usage: ./update-log.sh <instance> [lines]}"
lines="${2:-80}"
vars="${instance}.tfvars"
[[ -f "$vars" ]] || { echo "Missing $vars" >&2; exit 1; }

setting() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"([^\"]*)\".*/\1/p" "$vars"; }
prefix="$(setting name_prefix)"
region="$(setting region)"
[[ -n "$prefix" ]] || { echo "No name_prefix in $vars" >&2; exit 1; }
export AWS_REGION="${region:-${AWS_REGION:-eu-central-1}}"
project="${prefix}-update"

id="$(aws codebuild list-builds-for-project --project-name "$project" --sort-order DESCENDING --query 'ids[0]' --output text)"
if [[ -z "$id" || "$id" == "None" ]]; then
  echo "The updater $project has not run yet."
  exit 0
fi

aws codebuild batch-get-builds --ids "$id" --output table --query \
  'builds[0].{Started: startTime, Ended: endTime, Status: buildStatus, Version: environment.environmentVariables[?name==`TARGET_VERSION`] | [0].value}'
aws codebuild batch-get-builds --ids "$id" --output table --query \
  'builds[0].phases[].{Phase: phaseType, Status: phaseStatus, Seconds: durationInSeconds}'

group="$(aws codebuild batch-get-builds --ids "$id" --query 'builds[0].logs.groupName' --output text)"
stream="$(aws codebuild batch-get-builds --ids "$id" --query 'builds[0].logs.streamName' --output text)"
if [[ "$stream" == "None" || -z "$stream" ]]; then
  echo "No log yet (the build may still be starting)."
  exit 0
fi
echo "Last $lines lines of $group / $stream:"
aws logs get-log-events --log-group-name "$group" --log-stream-name "$stream" --limit "$lines" \
  --query 'events[].message' --output text | tr '\t' '\n'
