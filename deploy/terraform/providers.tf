provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "nomarkup"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
