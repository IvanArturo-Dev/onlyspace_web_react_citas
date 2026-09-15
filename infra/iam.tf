# iam.tf
# IAM role + instance profile para que la EC2 de la aplicacion pueda leer los
# secretos de la app desde AWS SSM Parameter Store SIN claves estaticas.
#
# Los secretos viven bajo el prefijo /onlyspace/ como SecureString. La EC2 asume
# este role (via instance profile) y obtiene credenciales temporales para llamar a
# ssm:GetParameter(s)/GetParametersByPath y kms:Decrypt.

# Datos de la cuenta/region actuales, usados para construir el ARN de los parametros.
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Rol que asume el servicio EC2 (ec2.amazonaws.com) via sts:AssumeRole.
resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Project = var.project_name
  }
}

# Politica inline de solo lectura de SSM para los parametros de /onlyspace/*.
resource "aws_iam_role_policy" "ssm_read" {
  name = "${var.project_name}-ssm-read"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMReadOnlySpaceParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        # El path del ARN es "parameter/onlyspace/*" (sin duplicar el slash inicial):
        # el prefijo logico /onlyspace/ se traduce a parameter/onlyspace/* en el ARN.
        Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/onlyspace/*"
      },
      {
        # Los SecureString estandar se cifran con la clave gestionada por AWS
        # (alias/aws/ssm). Restringir kms:Decrypt al ARN de esa key es complejo
        # (el ARN varia por cuenta/region y no se resuelve facilmente), por lo que
        # se permite kms:Decrypt sobre "*". El alcance real queda acotado por la
        # accion (solo Decrypt) y por que la app solo lee los parametros de arriba.
        Sid      = "KMSDecryptForSecureString"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
      }
    ]
  })
}

# Instance profile que envuelve el role para poder asignarlo a la instancia EC2.
resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name

  tags = {
    Project = var.project_name
  }
}
