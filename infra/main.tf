# main.tf
# Configuracion base de Terraform y provider AWS para la infraestructura de OnlySpace.
# Esta tarea (2.1) cubre unicamente provider, variables y red base.
# EC2, security group, S3, DNS y budgets se agregan en tareas posteriores (2.2-2.5).

terraform {
  required_version = ">= 1.5"

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
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
}
