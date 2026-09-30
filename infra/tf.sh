#!/usr/bin/env bash
# Runs Terraform for one Guidepass instance: its state backend and its variables.
#
#   AWS_PROFILE=<profile> ./tf.sh <instance> plan|apply|output|state …
#   AWS_PROFILE=<profile> ./tf.sh <instance> bootstrap   # first time: create the state bucket
#
# Needs backends/<instance>.s3.tfbackend and <instance>.tfvars next to this script.
set -euo pipefail
cd "$(dirname "$0")"

instance="${1:?usage: ./tf.sh <instance> <terraform command…>}"
shift
backend="backends/${instance}.s3.tfbackend"
vars="${instance}.tfvars"
[[ -f "$backend" ]] || { echo "Missing $backend (see backends/example.s3.tfbackend.example)" >&2; exit 1; }
[[ -f "$vars" ]] || { echo "Missing $vars (see terraform.tfvars.example)" >&2; exit 1; }

setting() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"]*)\"?.*/\1/p" "$backend"; }

if [[ "${1:-}" == "bootstrap" ]]; then
  # A private, versioned, encrypted bucket for this account's Guidepass states.
  bucket="$(setting bucket)"
  region="$(setting region)"
  if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    echo "Bucket $bucket already exists."
  else
    aws s3api create-bucket --bucket "$bucket" --region "$region" \
      --create-bucket-configuration "LocationConstraint=$region" >/dev/null
    echo "Created $bucket."
  fi
  aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  echo "State bucket $bucket is private, versioned and encrypted."
  exit 0
fi

# Point Terraform at this instance's state (quietly; -reconfigure switches instances).
terraform init -reconfigure -input=false -backend-config="$backend" >/dev/null

command="${1:-plan}"
shift || true
case "$command" in
  plan | apply | destroy | import | refresh | console)
    terraform "$command" -var-file="$vars" "$@" ;;
  *)
    terraform "$command" "$@" ;;
esac
