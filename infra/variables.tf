variable "region" {
  description = "AWS region for everything except the CloudFront certificate."
  type        = string
  default     = "eu-central-1"
}

variable "name_prefix" {
  description = "Prefix for every resource name, e.g. gp-acme. Lets several instances share one account."
  type        = string

  validation {
    condition     = can(regex("^[a-z](?:[a-z0-9]|-[a-z0-9]){1,30}$", var.name_prefix))
    error_message = "Use 2–31 lowercase letters and digits, starting with a letter; single dashes only between them."
  }
}

variable "owner_email" {
  description = "The only person allowed to set up the instance on first sign-in; everyone else is invited."
  type        = string
}

variable "domain_name" {
  description = "Full domain of the instance, e.g. gp.example.com. Empty: use the CloudFront domain."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Existing Route 53 zone in this account to add records to. Empty with a domain: create a zone for the domain and delegate it."
  type        = string
  default     = ""
}

variable "cognito_user_pool_id" {
  description = "Existing user pool to add a Guidepass app client to. Empty: create a pool just for Guidepass."
  type        = string
  default     = ""
}

variable "environments" {
  description = "Initial environments, applied on the first deploy only; edited in the app afterwards."
  type = list(object({
    key  = string
    name = string
  }))
  default = [
    { key = "dev", name = "Development" },
    { key = "stg", name = "Staging" },
    { key = "prod", name = "Production" },
  ]
}

variable "guide_language" {
  description = "Language guides are written in, returned to AI agents (e.g. en, uk)."
  type        = string
  default     = "en"
}

variable "db_min_capacity" {
  description = "Aurora Serverless v2 minimum ACUs. 0 lets the database pause when idle."
  type        = number
  default     = 0
}

variable "db_max_capacity" {
  description = "Aurora Serverless v2 maximum ACUs."
  type        = number
  default     = 2
}

variable "db_auto_pause_seconds" {
  description = "Idle time before the database pauses (only with db_min_capacity = 0)."
  type        = number
  default     = 900
}

variable "password_policy" {
  description = <<-EOT
    Password rules. In a pool Guidepass creates they are enforced by Cognito; with an
    existing pool (cognito_user_pool_id) the pool keeps its own rules, so set this to
    match them: the web app shows these rules when people choose a password.
  EOT
  type = object({
    minimum_length                   = optional(number, 8)
    require_lowercase                = optional(bool, false)
    require_uppercase                = optional(bool, false)
    require_numbers                  = optional(bool, false)
    require_symbols                  = optional(bool, false)
    temporary_password_validity_days = optional(number, 7)
  })
  default = {}

  validation {
    condition     = var.password_policy.minimum_length >= 6 && var.password_policy.minimum_length <= 99
    error_message = "password_policy.minimum_length must be between 6 and 99 (Cognito's limits)."
  }
  validation {
    condition     = var.password_policy.temporary_password_validity_days >= 1 && var.password_policy.temporary_password_validity_days <= 365
    error_message = "password_policy.temporary_password_validity_days must be between 1 and 365."
  }
}

variable "update_repository" {
  description = "GitHub repository (owner/repo) whose releases owners are told about. The API only reads its public releases list; nothing about the instance is sent. Empty turns the check off."
  type        = string
  default     = "vStesh/guidepass"

  validation {
    condition     = var.update_repository == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.update_repository))
    error_message = "update_repository must look like owner/repo, or be empty."
  }
}

variable "self_update" {
  description = "Add the Update button: owners can deploy a newer release from the web app (a CodeBuild project in this account snapshots the database and runs terraform apply). Needs the Terraform state in S3 (tf.sh passes it)."
  type        = bool
  default     = false
}

variable "state_bucket" {
  description = "S3 bucket of this instance's Terraform state. Set by tf.sh from the backend file; the updater uses the same state."
  type        = string
  default     = ""
}

variable "state_key" {
  description = "Key of this instance's Terraform state in state_bucket. Set by tf.sh."
  type        = string
  default     = ""
}

variable "state_region" {
  description = "Region of state_bucket. Set by tf.sh."
  type        = string
  default     = ""
}

variable "updater_terraform_version" {
  description = "Terraform version the updater installs (checked against HashiCorp's SHA256SUMS)."
  type        = string
  default     = "1.16.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.updater_terraform_version))
    error_message = "updater_terraform_version must look like 1.16.0."
  }
}

variable "deletion_protection" {
  description = "Protect the database from deletion. Turn off only to tear an instance down."
  type        = bool
  default     = true
}

variable "api_throttle_rate" {
  description = "Steady-state API requests per second."
  type        = number
  default     = 20
}

variable "api_throttle_burst" {
  description = "API request burst."
  type        = number
  default     = 40
}

variable "db_subnet_ids" {
  description = "Existing subnets for the database (at least two AZs). Empty: a small dedicated VPC is created."
  type        = list(string)
  default     = []
}

variable "db_engine_version" {
  description = "Aurora PostgreSQL version at creation (16.3+ can pause at 0 ACU). Check what the region offers: aws rds describe-db-engine-versions --engine aurora-postgresql."
  type        = string
  default     = "16.15"
}
