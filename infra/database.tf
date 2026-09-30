# Aurora Serverless v2 (PostgreSQL) reached only through the Data API: the
# Lambdas need no VPC or NAT, and the database has no network ingress at all.

# The database gets its own small VPC with two private subnets (no internet or NAT
# gateway, so it costs nothing): the Data API needs no network path, and the
# instance doesn't depend on a default VPC or touch other networks. Pass
# db_subnet_ids to use existing subnets instead.
locals {
  create_vpc = length(var.db_subnet_ids) == 0
}

resource "aws_vpc" "db" {
  count      = local.create_vpc ? 1 : 0
  cidr_block = "10.42.0.0/24"
  tags       = { Name = "${var.name_prefix}-db" }
}

resource "aws_subnet" "db" {
  count             = local.create_vpc ? 2 : 0
  vpc_id            = aws_vpc.db[0].id
  cidr_block        = cidrsubnet(aws_vpc.db[0].cidr_block, 2, count.index)
  availability_zone = "${var.region}${["a", "b"][count.index]}"
  tags              = { Name = "${var.name_prefix}-db-${["a", "b"][count.index]}" }
}

data "aws_subnet" "given" {
  count = local.create_vpc ? 0 : 1
  id    = var.db_subnet_ids[0]
}

locals {
  db_subnet_ids = local.create_vpc ? aws_subnet.db[*].id : var.db_subnet_ids
  db_vpc_id     = local.create_vpc ? aws_vpc.db[0].id : data.aws_subnet.given[0].vpc_id
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = local.db_subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "Guidepass database: no ingress, reached through the Data API"
  vpc_id      = local.db_vpc_id
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
