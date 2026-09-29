output "url" {
  description = "Where the instance lives."
  value       = local.has_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "delegate_name_servers" {
  description = "With a new zone: add an NS record for domain_name with these servers in the parent zone."
  value       = local.create_zone ? aws_route53_zone.this[0].name_servers : null
}

output "cognito_user_pool_id" {
  value = local.user_pool_id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
