# Updating an instance

Guidepass is released as versions on GitHub (`vX.Y.Z`). Each instance knows its own version and, once a day, reads the public list of releases (nothing about the instance is sent). When a newer version exists, **owners** see a banner with what's new; the same is under **Settings → Version**, with *Check now*.

To turn the check off, or to follow a fork, set `update_repository` in the instance's `.tfvars` (empty turns it off).

## Update with the button

Instances deployed with `self_update = true` have an **Update to X** button for owners (in the banner and under **Settings → Version**). After a confirmation, a CodeBuild project in your AWS account:

1. downloads the release from GitHub (only a `vX.Y.Z` tag of `update_repository`, and only the newest release, newer than the running version) and installs a pinned Terraform version, checked against HashiCorp's checksums;
2. takes a snapshot of the database (`<name_prefix>-db-before-vX-Y-Z-<time>`, kept until you delete it);
3. builds the release and runs `terraform apply` with this instance's settings (saved by every apply in SSM, `/<name_prefix>/terraform-variables`) and its state in S3.

The page shows the step and the log, and offers to reload when the new version is live (about 5–10 minutes). One update runs at a time. If it fails, nothing is lost: the instance keeps running where the apply stopped, the snapshot is there, and you can finish by hand as below.

A release that changes `infra/deploy-policy.json` may need one update by hand (below): the updater runs with the permissions it had before the update, so new kinds of resources can be refused. Release notes say when.

To turn the button on, set `self_update = true` in the instance's `.tfvars` and apply once by hand; your deploy credentials need the current [`infra/deploy-policy.json`](../infra/deploy-policy.json) (it includes CodeBuild and SSM). The updater gets the same permissions as the deploy policy, so it is as powerful as your deploy credentials: only owners can start it, and only for the newest release of the repository you chose.

## Update by hand

From the machine you deploy from, in the Guidepass checkout:

```bash
git fetch --tags
git checkout v0.2.0          # the version from the banner
cd infra
AWS_PROFILE=<profile> ./tf.sh <instance> plan    # read what will change
AWS_PROFILE=<profile> ./tf.sh <instance> apply
```

`tf.sh` builds the API and the web app first. On `apply`, database migrations run before the new API goes live. People with Guidepass open in a browser should reload the page afterwards.

Read the release notes before updating: they say when a version needs something from you, for example a new Terraform variable or an IAM permission added to [`infra/deploy-policy.json`](../infra/deploy-policy.json).

Skipping versions is fine: migrations of every version in between run in order.

## Roll back

Check out the previous tag and `apply` again. Migrations only add to the database (new tables and columns, never removing or renaming what an older version uses), so an older version keeps working with a newer database.

```bash
git checkout v0.1.0
cd infra && AWS_PROFILE=<profile> ./tf.sh <instance> apply
```

## Coming later

Optional automatic patch updates (`0.3.1 → 0.3.2`) with the same updater, off by default.
