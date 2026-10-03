# infra

Terraform for a self-hosted Guidepass deployment on AWS: Cognito (new pool or an existing one), Aurora Serverless v2 Postgres with the Data API, API Gateway, Lambda functions with a configurable name prefix, S3 + CloudFront for the web app.

## Deploy

Requirements: Node.js 22+, Terraform 1.9+, AWS credentials for the target account.

The credentials need the permissions in [`deploy-policy.json`](deploy-policy.json): everything Terraform creates, with IAM roles, Lambda functions, log groups and S3 buckets limited to names starting with `gp-` (keep `name_prefix` starting with `gp-`).

> **Treat these credentials as administrator credentials.** The policy lets them create IAM roles with inline policies, manage any RDS cluster, Cognito user pool, CloudFront distribution, certificate and Route 53 record in the account. Name prefixes keep Guidepass's own resources apart; they don't stop someone holding the keys from reaching the rest of the account.
>
> - Best: deploy Guidepass into **its own AWS account** (for example a member account in AWS Organizations) and delegate a subdomain to it.
> - In a shared account: keep the keys only on the machine that deploys, never in CI or chats; use short-lived credentials (IAM Identity Center or `aws sts assume-role`) rather than long-lived access keys; rotate them, and remove them when you're done.
> - A tighter policy with a permissions boundary for the Lambda role is planned.

```bash
# 1. Install dependencies. tf.sh builds the Lambda bundles (api/dist) and the
#    web app (web/dist) before every plan and apply, so the deploy matches the code.
npm ci

# 2. Per instance, two small files next to this README (both ignored by git):
cd infra
cp terraform.tfvars.example acme.tfvars                                   # the instance's settings
cp backends/example.s3.tfbackend.example backends/acme.s3.tfbackend       # where its state lives

# 3. First time in an AWS account: create the private, versioned state bucket
AWS_PROFILE=<profile> ./tf.sh acme bootstrap

# 4. Review, then apply
AWS_PROFILE=<profile> ./tf.sh acme plan
AWS_PROFILE=<profile> ./tf.sh acme apply
```

`apply` also runs the migration Lambda, so the database schema is always in step with the code. Re-run steps 1 and 3 to deploy a new version.

After the first apply:
- **New user pool:** Cognito emails `owner_email` a temporary password. Sign in at the `url` output, choose a password, name the team.
- **Existing user pool:** sign in with your existing account. The pool must let people sign in with their email (email as username, or an email alias).
- Cognito's built-in email sending is limited to a few dozen messages a day; for larger teams configure SES in the user pool.
- A temporary password is valid for 7 days. Inviting someone again resends it; for the owner of a new pool, run
  `aws cognito-idp admin-create-user --user-pool-id <pool> --username <owner_email> --message-action RESEND`.
- An existing user pool must be in the same region as the instance.
- Worth checking once after the first apply: the Data API is on (`aws rds describe-db-clusters --query "DBClusters[].HttpEndpointEnabled"`), and the database scales to 0 ACU when idle (CloudWatch metric `ServerlessDatabaseCapacity`).

### State

Terraform state is kept in S3: one bucket per AWS account (`gp-tfstate-<account id>`, private, versioned, encrypted), one key per instance (`guidepass/<instance>.tfstate`), with S3 locking so two people can't apply at once. `./tf.sh <instance> …` switches to that instance's state before every command, so several instances can be managed from one checkout, and from any machine that has the backend file and credentials. The deploy policy already covers the state bucket (its name starts with `gp-`).

Moving an existing local state into S3: `terraform state pull > old.tfstate` in the old setup, then `./tf.sh <instance> bootstrap` and `./tf.sh <instance> state push old.tfstate`, and check that `./tf.sh <instance> plan` shows no unexpected changes.

## Variables

One deployment per project, in the project's own AWS account. Full list with defaults in `variables.tf`; the main ones:

| Variable | Meaning |
| --- | --- |
| `name_prefix` | Prefix for every resource name, e.g. `gp-acme`; lets several instances share an account |
| `domain_name` | Full domain of the instance, e.g. `gp.example.com`; leave empty to use the CloudFront domain |
| `hosted_zone_id` | Existing Route 53 zone in this account to add records to; leave empty to create a zone for `domain_name` and delegate it (its name servers are an output) |
| `owner_email` | The only person allowed to set up the instance on first sign-in; everyone else joins by invitation |
| `update_repository` | GitHub repository whose releases owners are told about (default `vStesh/guidepass`; a fork can point to itself). Only the public releases list is read; empty turns the check off |
| `password_policy` | Password rules: `minimum_length` (default 8), `require_lowercase`, `require_uppercase`, `require_numbers`, `require_symbols` (all `false` by default), `temporary_password_validity_days` (7). Enforced in a pool Guidepass creates; with an existing pool set it to match the pool, since it's only shown to people choosing a password. Can be changed later with another `apply` |
| `cognito_user_pool_id` | Existing user pool to add a Guidepass app client to; leave empty to create a pool (see Cognito options) |
| `environments` | Initial environments, `[{ key, name }]`, default dev / stg / prod; applied on first deploy only, edited in the app afterwards |
| `guide_language` | Language guides are written in, returned to AI agents |

## DNS options

1. **Parent zone in the same account** — set `hosted_zone_id`; Terraform adds the certificate validation and alias records.
2. **Parent zone in another account** (for example, the domain lives in the production account and Guidepass in the development account) — leave `hosted_zone_id` empty. Create the zone first, delegate it, then apply the rest:
   ```bash
   ./tf.sh acme apply -target=aws_route53_zone.this
   ./tf.sh acme output delegate_name_servers   # add these as an NS record for domain_name in the parent zone
   ./tf.sh acme apply
   ```
   Certificate validation waits (up to two hours) until the delegation is visible.
3. **No custom domain** — leave `domain_name` empty; the instance is reachable at the AWS default domains, and a domain can be added later.

## Cognito options

1. **Existing user pool** (for example, a project's admin pool) — set `cognito_user_pool_id`. Terraform adds a separate app client for Guidepass to that pool and changes nothing else in it: other clients, groups, attributes, password and MFA policies stay as they are. Guidepass only accepts ID tokens issued to its own client. Having an account in the pool does not give access to Guidepass: the owner is set by `owner_email`, everyone else is invited. Guidepass never creates users in an existing pool — invitations only go to people who already have an account there — so testers do not end up with accounts in, say, an admin pool.
2. **New user pool** — leave `cognito_user_pool_id` empty. Terraform creates a pool just for Guidepass, and invitations create the account and email a temporary password.

In both cases the person's email must be verified in the pool (`email_verified`), because invitations are matched by email.

The API Lambda gets `cognito-idp:ListUsers` on the pool in both cases (to check that an invited person has an account), and `cognito-idp:AdminCreateUser` only for a pool Guidepass created (`COGNITO_MANAGE_USERS=true`).

## What gets created

| Resource | Notes |
| --- | --- |
| Aurora Serverless v2 PostgreSQL 16 | Data API only, no network ingress; pauses after 15 idle minutes by default (`db_min_capacity = 0`); password managed by RDS in Secrets Manager; deletion protection on |
| Lambda `<prefix>-api`, `<prefix>-migrate` | Node.js 22 on arm64; the migration Lambda runs on every apply that changes migrations |
| API Gateway (HTTP API) | `ANY /api/{proxy+}`, throttled (`api_throttle_rate`, `api_throttle_burst`) |
| S3 + CloudFront | Private bucket with origin access control; `/api/*` forwarded to API Gateway with caching off; app routes served by a CloudFront Function; security headers |
| Cognito | A web app client in the chosen pool, or a new pool without self sign-up plus the owner's account |
| Route 53 + ACM | Only with `domain_name`: certificate in us-east-1, DNS validation, A/AAAA aliases |

## Removing an instance

The database and a new user pool are protected from deletion. To remove an instance:

```bash
./tf.sh <instance> apply   -var deletion_protection=false
./tf.sh <instance> destroy -var deletion_protection=false
```

A final database snapshot is kept (`<prefix>-db-final-<timestamp>`); delete it in the RDS console when it's no longer needed.
