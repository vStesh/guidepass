#!/usr/bin/env bash
# Deletes old database snapshots the updater took before updates, keeping the newest ones.
# Run by the updater after a successful update; only touches manual snapshots of this
# cluster named <cluster>-before-…, never automated backups or snapshots taken by hand.
#
#   prune-snapshots.sh <db-cluster> <how-many-to-keep>
set -euo pipefail

cluster="${1:?usage: prune-snapshots.sh <db-cluster> <keep>}"
keep="${2:?usage: prune-snapshots.sh <db-cluster> <keep>}"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "Keep must be a whole number, at least 1: $keep"; exit 1; }

# Newest first; the timestamp in the name sorts the same way as the creation time.
snapshots=()
while IFS= read -r name; do
  if [[ "$name" == "${cluster}-before-"* ]]; then snapshots+=("$name"); fi
done < <(
  aws rds describe-db-cluster-snapshots --db-cluster-identifier "$cluster" --snapshot-type manual \
    --query "DBClusterSnapshots[].DBClusterSnapshotIdentifier" --output text | tr '\t' '\n' | sort -r
)

if (( ${#snapshots[@]} <= keep )); then
  echo "Snapshots before updates: ${#snapshots[@]}, keeping all (up to $keep)."
  exit 0
fi

for old in "${snapshots[@]:keep}"; do
  aws rds delete-db-cluster-snapshot --db-cluster-snapshot-identifier "$old" >/dev/null
  echo "Deleted old snapshot $old"
done
echo "Kept the newest $keep snapshots taken before updates."
