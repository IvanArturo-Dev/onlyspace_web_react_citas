# outputs.tf
# Valores de salida utiles tras el terraform apply.

# IP publica fija (Elastic IP) asociada a la instancia EC2. Es la IP a la que apuntan
# los registros A de Route 53 y la que se usa para el acceso SSH/despliegue.
output "public_ip" {
  description = "IP publica fija (Elastic IP) de la instancia."
  value       = aws_eip.app.public_ip
}

# Los 4 nameservers de la hosted zone de Route 53. El usuario debe configurarlos en el
# panel de HostGator (reemplazando los actuales) para delegar el DNS del dominio a AWS.
output "route53_nameservers" {
  description = "Nameservers de Route 53 a configurar en HostGator para el dominio."
  value       = aws_route53_zone.main.name_servers
}

# Nombre del bucket S3 de backups (definido en storage.tf, recurso aws_s3_bucket.backups
# con sufijo aleatorio). Util para configurar el script de backup y verificar el destino.
output "s3_backup_bucket" {
  description = "Nombre del bucket S3 de backups."
  value       = aws_s3_bucket.backups.bucket
}
