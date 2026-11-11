# The morning Slack digest: a schedule that invokes the API Lambda, which posts, for
# every app that turned "daily_digest" on, the guides nobody has started testing.
# `digest_schedule = ""` turns the schedule off.

resource "aws_cloudwatch_event_rule" "digest" {
  count               = var.digest_schedule == "" ? 0 : 1
  name                = "${var.name_prefix}-digest"
  description         = "Guidepass ${var.name_prefix}: morning Slack digest of guides waiting for testing."
  schedule_expression = var.digest_schedule
  # When the Update button applies this, the updater's own role must get the
  # EventBridge permissions (deploy-policy.json) first.
  depends_on = [aws_iam_role_policy.update_deploy]
}

resource "aws_cloudwatch_event_target" "digest" {
  count = var.digest_schedule == "" ? 0 : 1
  rule  = aws_cloudwatch_event_rule.digest[0].name
  arn   = aws_lambda_function.api.arn
  input = jsonencode({ guidepass = "daily-digest" })
}

resource "aws_lambda_permission" "digest" {
  count         = var.digest_schedule == "" ? 0 : 1
  statement_id  = "AllowDigestSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.digest[0].arn
}

# The schedule invokes the function asynchronously, and Lambda would retry a failed
# or timed-out run twice, posting the same digest again. A missed digest is better
# than a repeated one; HTTP requests from API Gateway are synchronous and unaffected.
resource "aws_lambda_function_event_invoke_config" "api" {
  count                  = var.digest_schedule == "" ? 0 : 1
  function_name          = aws_lambda_function.api.function_name
  maximum_retry_attempts = 0
}
