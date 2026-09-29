# Aurora Serverless v2 (PostgreSQL) reached only through the Data API: the
# Lambdas need no VPC or NAT, and the database has no network ingress at all.

# Accounts without a default VPC (common under AWS Organizations) pass db_subnet_ids.
locals {
  use_default_vpc = length(var.db_subnet_ids) == 0
}

data "aws_vpc" "default" {
  count   = local.use_default_vpc ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = local.use_default_vpc ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
}

data "aws_subnet" "first" {
  id = local.db_subnet_ids[0]
}

locals {
  db_subnet_ids = local.use_default_vpc ? data.aws_subnets.default[0].ids : var.db_subnet_ids
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = local.db_subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "Guidepass database: no ingress, reached through the Data API"
  vpc_id      = data.aws_subnet.first.vpc_id
}

resource "aws_rds_cluster" "this" {
  cluster_identifier = "${var.name_prefix}-db"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.db_engine_version
  database_name      = "guidepass"
  master_username    = "guidepass"

  # RDS keeps the password in Secrets Manager and rotates it; the Data API reads it from there.
  manage_master_user_password = true
  enable_http_endpoint        = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted      = true

  serverlessv2_scaling_configuration {
    min_capacity             = var.db_min_capacity
    max_capacity             = var.db_max_capacity
    seconds_until_auto_pause = var.db_min_capacity == 0 ? var.db_auto_pause_seconds : null
  }

  backup_retention_period = 7
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = false
  # Fixed at creation, so a recreated instance with the same prefix gets its own name.
  final_snapshot_identifier = "${var.name_prefix}-db-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  copy_tags_to_snapshot     = true

  lifecycle {
    # AWS applies minor upgrades on its own; don't try to downgrade afterwards.
    ignore_changes = [engine_version, final_snapshot_identifier]
  }
}

resource "aws_rds_cluster_instance" "this" {
  identifier         = "${var.name_prefix}-db-1"
  cluster_identifier = aws_rds_cluster.this.id
  engine             = aws_rds_cluster.this.engine
  engine_version     = aws_rds_cluster.this.engine_version
  instance_class     = "db.serverless"

  lifecycle {
    ignore_changes = [engine_version]
  }
}

locals {
  db_secret_arn = aws_rds_cluster.this.master_user_secret[0].secret_arn
}
