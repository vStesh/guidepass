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
