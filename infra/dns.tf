# Three options: no domain (CloudFront's own), records in an existing zone in this
# account, or a new zone for the subdomain that you delegate from the parent zone.

locals {
  has_domain  = var.domain_name != ""
  create_zone = local.has_domain && var.hosted_zone_id == ""
  zone_id     = local.create_zone ? aws_route53_zone.this[0].zone_id : var.hosted_zone_id
  public_url  = local.has_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.this.domain_name}"
}

resource "aws_route53_zone" "this" {
  count = local.create_zone ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "this" {
  count             = local.has_domain ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = local.has_domain ? {
    for o in aws_acm_certificate.this[0].domain_validation_options : o.domain_name => o
  } : {}

  zone_id         = local.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# With a new zone this waits until the parent zone delegates to it (see infra/README.md).
resource "aws_acm_certificate_validation" "this" {
  count                   = local.has_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]

  timeouts {
    create = "2h"
  }
}

resource "aws_route53_record" "site" {
  for_each = local.has_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = local.zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
