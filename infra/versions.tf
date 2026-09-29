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

  # State is local by default. For anything shared, use an S3 backend:
  # copy backend.tf.example to backend.tf and run `terraform init -reconfigure`.
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
