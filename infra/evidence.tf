# Screenshots testers attach to results as proof. Private: the browser uploads
# with a one-time form signed by the API and views files through links that
# expire in an hour. Nothing in the bucket is ever public.

resource "aws_s3_bucket" "evidence" {
  bucket = "${var.name_prefix}-evidence-${data.aws_caller_identity.current.account_id}"
  # Proof is part of the test history: keep it unless deletion protection is off.
  force_destroy = !var.deletion_protection
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The web app posts files straight to the bucket and shows them from it.
resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  cors_rule {
    allowed_methods = ["POST", "GET"]
    allowed_origins = [local.public_url]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

locals {
  evidence_origin = "https://${aws_s3_bucket.evidence.bucket_regional_domain_name}"
}
