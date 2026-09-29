# Either a pool just for Guidepass, or a separate app client in an existing pool.
# In an existing pool nothing else changes, and Guidepass never creates users there.

locals {
  create_pool  = var.cognito_user_pool_id == ""
  user_pool_id = local.create_pool ? aws_cognito_user_pool.this[0].id : var.cognito_user_pool_id
}

data "aws_cognito_user_pool" "existing" {
  count        = local.create_pool ? 0 : 1
  user_pool_id = var.cognito_user_pool_id
}

resource "aws_cognito_user_pool" "this" {
  count = local.create_pool ? 1 : 0
  name  = var.name_prefix

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # No self sign-up: people get accounts through invitations.
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Your Guidepass account"
      email_message = "You've been invited to Guidepass${var.domain_name != "" ? " at https://${var.domain_name}" : ""}. Sign in with {username} and the temporary password {####}; you'll choose your own password next."
      sms_message   = "Guidepass: {username} / {####}"
    }
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name_prefix}-web"
  user_pool_id = local.user_pool_id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

# The owner needs an account to set the instance up; in a new pool nobody has one
# yet, so Cognito emails the owner a temporary password. In an existing pool the
# owner signs in with the account they already have.
resource "aws_cognito_user" "owner" {
  count        = local.create_pool ? 1 : 0
  user_pool_id = aws_cognito_user_pool.this[0].id
  username     = var.owner_email

  attributes = {
    email          = var.owner_email
    email_verified = true
  }

  desired_delivery_mediums = ["EMAIL"]
}
