# infra

Terraform for a self-hosted Guidepass deployment on AWS: Cognito (new pool or an existing one), Aurora Serverless v2 Postgres with the Data API, API Gateway, Lambda functions with a configurable name prefix, S3 + CloudFront for the web app.

One deployment per project, in the project's own AWS account. Main variables (draft):

| Variable | Meaning |
| --- | --- |
| `name_prefix` | Prefix for every resource name, e.g. `gp`; lets several instances share an account |
| `domain_name` | Full domain of the instance, e.g. `gp.example.com`; leave empty to use the AWS default domains (CloudFront for the web app, API Gateway for the API) |
| `hosted_zone_id` | Existing Route 53 zone in this account to add records to; leave empty to create a zone for `domain_name` and delegate it (its name servers are an output) |
| `owner_email` | The only person allowed to set up the instance on first sign-in; everyone else joins by invitation |
| `cognito_user_pool_id` | Existing user pool to add a Guidepass app client to; leave empty to create a pool (see Cognito options) |
| `environments` | Initial environments, `[{ key, name }]`, default dev / stg / prod; applied on first deploy only, edited in the app afterwards |
| `guide_language` | Language guides are written in, returned to AI agents |

## DNS options

1. **Parent zone in the same account** — set `hosted_zone_id`; Terraform adds the certificate validation and alias records.
2. **Parent zone in another account** (for example, the domain lives in the production account and Guidepass in the development account) — leave `hosted_zone_id` empty. Terraform creates a zone for `domain_name` in this account and outputs its name servers; add an `NS` record for `domain_name` with those servers in the parent zone, then run `apply` again to finish certificate validation.
3. **No custom domain** — leave `domain_name` empty; the instance is reachable at the AWS default domains, and a domain can be added later.

## Cognito options

1. **Existing user pool** (for example, a project's admin pool) — set `cognito_user_pool_id`. Terraform adds a separate app client for Guidepass to that pool and changes nothing else in it: other clients, groups, attributes, password and MFA policies stay as they are. Guidepass only accepts ID tokens issued to its own client. Having an account in the pool does not give access to Guidepass: the owner is set by `owner_email`, everyone else is invited. Guidepass never creates users in an existing pool — invitations only go to people who already have an account there — so testers do not end up with accounts in, say, an admin pool.
2. **New user pool** — leave `cognito_user_pool_id` empty. Terraform creates a pool just for Guidepass, and invitations create the account and email a temporary password.

In both cases the person's email must be verified in the pool (`email_verified`), because invitations are matched by email.
