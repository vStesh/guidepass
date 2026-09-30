terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
  }

  # State lives in S3, one bucket per AWS account and one key per instance.
  # The bucket, key and region come from backends/<instance>.s3.tfbackend;
  # ./tf.sh <instance> <command> picks the right one (see README).
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project  = "guidepass"
      Instance = var.name_prefix
    }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project  = "guidepass"
      Instance = var.name_prefix
    }
  }
}
