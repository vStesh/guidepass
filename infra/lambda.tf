# Build first: `npm run build` in the repository root fills api/dist and web/dist.

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../api/dist/api"
  output_path = "${path.module}/.build/api.zip"
}

data "archive_file" "migrate" {
  type        = "zip"
  source_dir  = "${path.module}/../api/dist/migrate"
  output_path = "${path.module}/.build/migrate.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid = "DataApi"
    actions = [
      "rds-data:ExecuteStatement",
      "rds-data:BatchExecuteStatement",
      "rds-data:BeginTransaction",
      "rds-data:CommitTransaction",
      "rds-data:RollbackTransaction",
    ]
    resources = [aws_rds_cluster.this.arn]
  }

  statement {
    sid       = "DatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.db_secret_arn]
  }

  statement {
    sid       = "FindInvitedUsers"
    actions   = ["cognito-idp:ListUsers"]
    resources = ["arn:aws:cognito-idp:${var.region}:${data.aws_caller_identity.current.account_id}:userpool/${local.user_pool_id}"]
  }

  # Screenshots attached as proof: the API signs uploads and views, checks and removes files.
  statement {
    sid       = "Evidence"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/evidence/*"]
  }

  # The Update button: start the updater and show its progress.
  dynamic "statement" {
    for_each = local.self_update ? [1] : []
    content {
      sid       = "StartUpdate"
      actions   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
      resources = [aws_codebuild_project.update[0].arn]
    }
  }

  # A run may only set the release and its commit: no other buildspec, source,
  # image, role or environment variable, even if this function were misused.
  dynamic "statement" {
    for_each = local.self_update ? [1] : []
    content {
      sid       = "OnlyReleaseOverrides"
      effect    = "Deny"
      actions   = ["codebuild:StartBuild"]
      resources = [aws_codebuild_project.update[0].arn]
      condition {
        test     = "ForAnyValue:StringNotEquals"
        variable = "codebuild:environment.environmentVariables.name"
        values   = ["TARGET_VERSION", "TARGET_COMMIT"]
      }
    }
  }

  dynamic "statement" {
    for_each = local.self_update ? toset([
      "codebuild:source.buildspec",
      "codebuild:source.location",
      "codebuild:source.type",
      "codebuild:environment.image",
      "codebuild:environment.type",
      "codebuild:environment.computeType",
      "codebuild:serviceRole",
    ]) : toset([])
    content {
      sid       = "NoOverride${replace(title(replace(replace(statement.value, "codebuild:", ""), ".", " ")), " ", "")}"
      effect    = "Deny"
      actions   = ["codebuild:StartBuild"]
      resources = [aws_codebuild_project.update[0].arn]
      condition {
        test     = "Null"
        variable = statement.value
        values   = ["false"]
      }
    }
  }

  dynamic "statement" {
    for_each = local.self_update ? [1] : []
    content {
      sid       = "UpdateLog"
      actions   = ["logs:GetLogEvents"]
      resources = ["${aws_cloudwatch_log_group.update[0].arn}:*"]
    }
  }

  # Only for a pool Guidepass owns: invitations create accounts there.
  dynamic "statement" {
    for_each = local.create_pool ? [1] : []
    content {
      sid       = "CreateInvitedUsers"
      actions   = ["cognito-idp:AdminCreateUser"]
      resources = ["arn:aws:cognito-idp:${var.region}:${data.aws_caller_identity.current.account_id}:userpool/${local.user_pool_id}"]
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda" {
  name   = "guidepass"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

locals {
  db_env = {
    DB_CLUSTER_ARN = aws_rds_cluster.this.arn
    DB_SECRET_ARN  = local.db_secret_arn
    DB_NAME        = aws_rds_cluster.this.database_name
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name_prefix}-api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/aws/lambda/${var.name_prefix}-migrate"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.name_prefix}-api"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 512
  # The API retries while a paused Aurora resumes (up to ~22 s), within API Gateway's 29 s limit.
  timeout = 30

  environment {
    variables = merge(local.db_env, {
      COGNITO_USER_POOL_ID = local.user_pool_id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
      COGNITO_MANAGE_USERS = local.create_pool ? "true" : "false"
      OWNER_EMAIL          = var.owner_email
      GUIDE_LANGUAGE       = var.guide_language
      PUBLIC_URL           = local.public_url
      UPDATE_REPOSITORY    = var.update_repository
      EVIDENCE_BUCKET      = aws_s3_bucket.evidence.id
      UPDATE_PROJECT       = local.self_update ? local.update_project : ""
    })
  }

  # New API code goes live only after its migrations have run.
  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.lambda, aws_lambda_invocation.migrate]
}

resource "aws_lambda_function" "migrate" {
  function_name    = "${var.name_prefix}-migrate"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.migrate.output_path
  source_code_hash = data.archive_file.migrate.output_base64sha256
  memory_size      = 256
  timeout          = 300

  environment {
    variables = local.db_env
  }

  depends_on = [aws_cloudwatch_log_group.migrate, aws_iam_role_policy.lambda]
}

# Applies migrations (and seeds environments on the first deploy) whenever the
# migration bundle changes, before the new API code serves traffic.
resource "aws_lambda_invocation" "migrate" {
  function_name = aws_lambda_function.migrate.function_name
  input         = jsonencode({ environments = var.environments })

  triggers = {
    code = data.archive_file.migrate.output_base64sha256
  }

  depends_on = [aws_rds_cluster_instance.this]
}
