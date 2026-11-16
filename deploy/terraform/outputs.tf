output "vpc_id" {
  description = "ID of the VPC."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (workloads, RDS, Redis)."
  value       = module.vpc.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs (load balancers, NAT)."
  value       = module.vpc.public_subnet_ids
}

output "eks_cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API server endpoint."
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_certificate_authority_data" {
  description = "Base64 CA data for kubectl."
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "rds_endpoint" {
  description = "PostgreSQL endpoint host:port (no credentials)."
  value       = module.rds.endpoint
}

output "rds_port" {
  description = "PostgreSQL port."
  value       = module.rds.port
}

output "rds_db_name" {
  description = "Initial database name."
  value       = module.rds.db_name
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint."
  value       = module.redis.primary_endpoint
}

output "s3_assets_bucket" {
  description = "S3 bucket for assets / uploads."
  value       = module.s3.bucket_id
}

output "s3_assets_bucket_arn" {
  description = "ARN of the assets bucket."
  value       = module.s3.bucket_arn
}
