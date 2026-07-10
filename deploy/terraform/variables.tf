variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Deployment environment name (production | staging)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "dev"], var.environment)
    error_message = "environment must be production, staging, or dev."
  }
}

variable "project" {
  description = "Project name used for resource naming."
  type        = string
  default     = "nomarkup"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZs to use for subnets / multi-AZ services."
  type        = list(string)
  default     = ["us-west-2a", "us-west-2b", "us-west-2c"]
}

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL + PostGIS."
  type        = string
  default     = "db.r6g.large"
}

variable "db_allocated_storage_gb" {
  description = "Initial RDS allocated storage (GB)."
  type        = number
  default     = 100
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.r6g.large"
}

variable "eks_cluster_version" {
  description = "Kubernetes version for the EKS control plane."
  type        = string
  default     = "1.31"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for the default EKS node group."
  type        = list(string)
  default     = ["m6i.xlarge"]
}

variable "eks_desired_capacity" {
  description = "Desired node count for the default EKS node group."
  type        = number
  default     = 3
}

variable "s3_assets_bucket_name" {
  description = "Globally unique S3 bucket name for public/private assets. Leave empty to auto-name."
  type        = string
  default     = ""
}

variable "enable_nat_gateway" {
  description = "Create a NAT gateway for private subnet egress (costly; disable for stub validates)."
  type        = bool
  default     = true
}
