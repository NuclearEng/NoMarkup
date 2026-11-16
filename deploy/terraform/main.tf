# NoMarkup AWS foundation skeleton — VPC, EKS, RDS (Postgres; PostGIS post-boot),
# Redis, S3.
#
# HONESTY (OPS-02 Partial / Founder-Action):
#   - Draft modules only. Nothing here is applied to a real cloud account.
#   - No AWS account IDs, no live credentials, no remote state in this repo.
#   - `terraform plan` is meaningful only after a founder supplies a real account
#     and (recommended) a remote backend — see README.md.
#   - PostGIS is NOT created by Terraform; enable on the Postgres instance after
#     boot. Meilisearch is in-cluster k8s, not this stack.
#
# Usage (after installing Terraform CLI ≥ 1.5):
#   cd deploy/terraform
#   terraform init -backend=false
#   terraform validate
#   terraform plan -var='environment=staging'   # needs real AWS creds; review cost

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "vpc" {
  source = "./modules/vpc"

  name_prefix        = local.name_prefix
  cidr_block         = var.vpc_cidr
  availability_zones = var.availability_zones
  enable_nat_gateway = var.enable_nat_gateway
  tags               = local.common_tags
}

module "eks" {
  source = "./modules/eks"

  name_prefix         = local.name_prefix
  cluster_version     = var.eks_cluster_version
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = var.eks_node_instance_types
  desired_capacity    = var.eks_desired_capacity
  tags                = local.common_tags
}

module "rds" {
  source = "./modules/rds"

  name_prefix          = local.name_prefix
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  allowed_cidr_blocks  = [var.vpc_cidr]
  instance_class       = var.db_instance_class
  allocated_storage_gb = var.db_allocated_storage_gb
  tags                 = local.common_tags
}

module "redis" {
  source = "./modules/redis"

  name_prefix         = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [var.vpc_cidr]
  node_type           = var.redis_node_type
  tags                = local.common_tags
}

module "s3" {
  source = "./modules/s3"

  name_prefix = local.name_prefix
  bucket_name = var.s3_assets_bucket_name
  tags        = local.common_tags
}
