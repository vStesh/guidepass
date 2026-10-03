# Updating an instance

Guidepass is released as versions on GitHub (`vX.Y.Z`). Each instance knows its own version and, once a day, reads the public list of releases (nothing about the instance is sent). When a newer version exists, **owners** see a banner with what's new; the same is under **Settings → Version**, with *Check now*.

To turn the check off, or to follow a fork, set `update_repository` in the instance's `.tfvars` (empty turns it off).

## Update

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

An *Update* button that runs this for the owner in their own AWS account (with a database snapshot first), and optional automatic patch updates, off by default.
