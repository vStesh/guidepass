# The "Update" button (opt-in, `self_update = true`): a CodeBuild project in this
# account that deploys a newer Guidepass release the same way `./tf.sh apply` does —
# snapshot the database, download the release, build it, `terraform apply` it with
# this instance's own settings and state. Only owners can start it, from the web
# app, and only for a release newer than the running version.

locals {
  self_update    = var.self_update
  update_project = "${var.name_prefix}-update"

  # This instance's settings, so the updater applies a release with exactly what
  # the last apply used. Keep in step with variables.tf (state_* come from tf.sh).
  instance_variables = {
    region                    = var.region
    name_prefix               = var.name_prefix
    owner_email               = var.owner_email
    domain_name               = var.domain_name
    hosted_zone_id            = var.hosted_zone_id
    cognito_user_pool_id      = var.cognito_user_pool_id
    environments              = var.environments
    guide_language            = var.guide_language
    db_min_capacity           = var.db_min_capacity
    db_max_capacity           = var.db_max_capacity
    db_auto_pause_seconds     = var.db_auto_pause_seconds
    password_policy           = var.password_policy
    update_repository         = var.update_repository
    self_update               = var.self_update
    deletion_protection       = var.deletion_protection
    api_throttle_rate         = var.api_throttle_rate
    api_throttle_burst        = var.api_throttle_burst
    db_subnet_ids             = var.db_subnet_ids
    db_engine_version         = var.db_engine_version
    updater_terraform_version = var.updater_terraform_version
  }

  # What the updater needs that isn't a variable. Read from SSM, not from the
  # build's environment, so a StartBuild override can't point it elsewhere.
  updater_settings = {
    repository   = var.update_repository
    state_bucket = var.state_bucket
    state_key    = var.state_key
    state_region = var.state_region
    db_cluster   = aws_rds_cluster.this.cluster_identifier
  }
}

# self_update needs the state's location, which tf.sh passes: fail loudly rather
# than quietly removing the updater when someone applies without it.
resource "terraform_data" "self_update_needs_state" {
  lifecycle {
    precondition {
      condition     = !var.self_update || (var.state_bucket != "" && var.state_key != "" && var.state_region != "")
      error_message = "self_update needs state_bucket, state_key and state_region: run ./tf.sh <instance> apply, which passes them."
    }
  }
}

resource "aws_ssm_parameter" "instance_variables" {
  count       = local.self_update ? 1 : 0
  name        = "/${var.name_prefix}/terraform-variables"
  description = "Guidepass ${var.name_prefix}: Terraform variables of the last apply, read by the updater."
  type        = "SecureString"
  value       = jsonencode(local.instance_variables)
}

resource "aws_ssm_parameter" "updater_settings" {
  count       = local.self_update ? 1 : 0
  name        = "/${var.name_prefix}/updater-settings"
  description = "Guidepass ${var.name_prefix}: repository, state and database the updater works with."
  type        = "SecureString"
  value       = jsonencode(local.updater_settings)
}

resource "aws_cloudwatch_log_group" "update" {
  count             = local.self_update ? 1 : 0
  name              = "/aws/codebuild/${local.update_project}"
  retention_in_days = 90
}

data "aws_iam_policy_document" "update_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "update" {
  count              = local.self_update ? 1 : 0
  name               = "${var.name_prefix}-update"
  assume_role_policy = data.aws_iam_policy_document.update_assume.json
}

# The updater does what a person deploying does, so it gets the same permissions
# as the deploy credentials (deploy-policy.json), plus its own logs and settings.
resource "aws_iam_role_policy" "update_deploy" {
  count  = local.self_update ? 1 : 0
  name   = "deploy"
  role   = aws_iam_role.update[0].id
  policy = file("${path.module}/deploy-policy.json")
}

data "aws_iam_policy_document" "update_own" {
  count = local.self_update ? 1 : 0

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.update[0].arn}:*"]
  }

  statement {
    sid       = "Settings"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.instance_variables[0].arn, aws_ssm_parameter.updater_settings[0].arn]
  }

  statement {
    sid       = "Snapshot"
    actions   = ["rds:CreateDBClusterSnapshot", "rds:DescribeDBClusterSnapshots", "rds:AddTagsToResource"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "update_own" {
  count  = local.self_update ? 1 : 0
  name   = "updater"
  role   = aws_iam_role.update[0].id
  policy = data.aws_iam_policy_document.update_own[0].json
}

resource "aws_codebuild_project" "update" {
  count         = local.self_update ? 1 : 0
  name          = local.update_project
  description   = "Guidepass ${var.name_prefix}: deploys a newer release when an owner presses Update."
  service_role  = aws_iam_role.update[0].arn
  build_timeout = 45
  # One update at a time; Terraform's state lock guards the rest.
  concurrent_build_limit = 1

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    type         = "LINUX_CONTAINER"

    environment_variable {
      name  = "SETTINGS_PARAMETER"
      value = aws_ssm_parameter.instance_variables[0].name
    }
    environment_variable {
      name  = "UPDATER_PARAMETER"
      value = aws_ssm_parameter.updater_settings[0].name
    }
    environment_variable {
      name  = "TERRAFORM_VERSION"
      value = var.updater_terraform_version
    }
    # Set by the API for each run (the only overrides IAM allows): the release and its commit.
    environment_variable {
      name  = "TARGET_VERSION"
      value = ""
    }
    environment_variable {
      name  = "TARGET_COMMIT"
      value = ""
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.update[0].name
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/updater/buildspec.yml")
  }
}
