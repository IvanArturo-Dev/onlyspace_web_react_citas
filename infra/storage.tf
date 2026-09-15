# storage.tf
# Almacenamiento S3 para los backups diarios de MySQL (Tarea 2.3).
# El bucket es privado (todo acceso publico bloqueado), cifrado en reposo con SSE-S3
# y con una regla de ciclo de vida que expira los backups tras 14 dias para acotar costo.

# Sufijo aleatorio: los nombres de bucket S3 son globales, por lo que se agrega un
# identificador aleatorio para garantizar unicidad del nombre.
resource "random_id" "suffix" {
  byte_length = 4
}

# Bucket privado donde el script de backup sube los dumps comprimidos de MySQL.
resource "aws_s3_bucket" "backups" {
  bucket = "${var.project_name}-backups-${random_id.suffix.hex}"

  tags = {
    Project = var.project_name
  }
}

# Bloquear TODO acceso publico al bucket (las 4 opciones en true).
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cifrado en reposo con SSE-S3 (AES256), sin costo adicional de KMS.
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Retencion: eliminar objetos bajo el prefijo "backups/" despues de 14 dias.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-backups-after-14-days"
    status = "Enabled"

    filter {
      prefix = "backups/"
    }

    expiration {
      days = 14
    }
  }
}
