# The web app in a private bucket behind CloudFront; /api/* goes to API Gateway.

resource "aws_s3_bucket" "web" {
  bucket        = "${var.name_prefix}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  web_dist = "${path.module}/../web/dist"
  content_types = {
    html  = "text/html; charset=utf-8"
    js    = "text/javascript; charset=utf-8"
    css   = "text/css; charset=utf-8"
    svg   = "image/svg+xml"
    json  = "application/json"
    png   = "image/png"
    ico   = "image/x-icon"
    woff2 = "font/woff2"
    txt   = "text/plain; charset=utf-8"
  }
  # config.example.json is for people, not for the site.
  web_files = [for f in fileset(local.web_dist, "**") : f if f != "config.example.json"]
}

resource "aws_s3_object" "web" {
  for_each = toset(local.web_files)

  bucket       = aws_s3_bucket.web.id
  key          = each.value
  source       = "${local.web_dist}/${each.value}"
  source_hash  = filemd5("${local.web_dist}/${each.value}")
  content_type = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  # Hashed assets never change; everything else is checked on each load.
  cache_control = startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"
}

# Runtime settings for the single web build.
resource "aws_s3_object" "config" {
  lifecycle {
    # Without a build, fileset() is empty and apply would silently delete the site.
    precondition {
      condition     = fileexists("${local.web_dist}/index.html")
      error_message = "web/dist is missing: run `npm run build` in the repository root first."
    }
  }

  bucket        = aws_s3_bucket.web.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-cache"
  content = jsonencode({
    authMode          = "cognito"
    cognitoUserPoolId = local.user_pool_id
    cognitoClientId   = aws_cognito_user_pool_client.web.id
  })
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

# Paths without a file extension are app routes: serve index.html. Doing this in
# a function (not a 404 error page) keeps real API 404s intact.
resource "aws_cloudfront_function" "spa" {
  name    = "${var.name_prefix}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.lastIndexOf(".") <= request.uri.lastIndexOf("/")) request.uri = "/index.html";
      return request;
    }
  JS
}

# AWS-managed policies have the same ids in every account; using them directly
# means planning needs no CloudFront read permissions.
locals {
  cache_policy_optimized         = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  cache_policy_disabled          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  origin_request_all_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
  response_headers_security      = "67f7725c-6f97-4210-82d7-5512b31e9d03" # Managed-SecurityHeadersPolicy
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "Guidepass ${var.name_prefix}"
  default_root_object = "index.html"
  aliases             = local.has_domain ? [var.domain_name] : []
  price_class         = "PriceClass_100"
  http_version        = "http2and3"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = replace(aws_apigatewayv2_api.this.api_endpoint, "https://", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_optimized
    response_headers_policy_id = local.response_headers_security

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_disabled
    origin_request_policy_id   = local.origin_request_all_except_host
    response_headers_policy_id = local.response_headers_security
  }

  ordered_cache_behavior {
    path_pattern               = "/mcp"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_disabled
    origin_request_policy_id   = local.origin_request_all_except_host
    response_headers_policy_id = local.response_headers_security
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.has_domain
    acm_certificate_arn            = local.has_domain ? aws_acm_certificate_validation.this[0].certificate_arn : null
    ssl_support_method             = local.has_domain ? "sni-only" : null
    minimum_protocol_version       = local.has_domain ? "TLSv1.2_2021" : null
  }
}
