terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Optional remote state — uncomment and fill when a real backend exists.
  # backend "s3" {
  #   bucket         = "nomarkup-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-west-2"
  #   dynamodb_table = "nomarkup-terraform-locks"
  #   encrypt        = true
  # }
}
