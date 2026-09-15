# dns.tf
# DNS con Route 53 (Tarea 2.4).
# Se crea una hosted zone publica para el dominio del usuario y los registros A que
# apuntan a la Elastic IP fija de la instancia EC2 (aws_eip.app, definida en compute.tf).
#
# Flujo para el usuario: el dominio esta en HostGator. Tras aplicar Terraform, el output
# route53_nameservers (ver outputs.tf) entrega los 4 nameservers de esta zona; el usuario
# debe reemplazar los nameservers actuales en el panel de HostGator por esos. Una vez que
# el DNS propaga, el dominio (raiz y www) resuelve a la Elastic IP.

# Hosted zone publica para el dominio del usuario.
resource "aws_route53_zone" "main" {
  name = var.domain

  tags = {
    Project = var.project_name
  }
}

# Registro A del dominio raiz -> Elastic IP de la instancia.
resource "aws_route53_record" "root" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

# Registro A de www.<dominio> -> misma Elastic IP.
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
