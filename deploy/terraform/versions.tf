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

  # Optional remote state — create bucket + lock table out-of-band first, then
  # uncomment and set names for *your* account. Placeholders below are examples
  # only (not provisioned; no account ID).
  # backend "s3" {
  #   bucket         = "YOUR-ORG-nomarkup-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-west-2"
  #   dynamodb_table = "YOUR-ORG-nomarkup-terraform-locks"
  #   encrypt        = true
  # }
}

