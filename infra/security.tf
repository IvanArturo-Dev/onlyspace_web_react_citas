# security.tf
# Security group de la instancia EC2 unica que corre Docker Compose
# (backend + nginx + mysql + redis).
#
# Politica de exposicion:
#   - 443 (HTTPS) y 80 (HTTP + retos ACME de Let's Encrypt) abiertos a Internet.
#   - 22 (SSH) restringido a la IP del administrador (var.admin_ip).
#   - MySQL (3306) y Redis (6379) NO tienen reglas de ingress: solo son
#     accesibles dentro de la red interna de Docker Compose, nunca desde Internet.
#   - Egress: todo permitido (necesario para dnf update, pull de imagenes, ACME, S3).

resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg"
  description = "SG de la EC2 de OnlySpace: HTTPS/HTTP abiertos, SSH restringido, DB/cache internos."
  vpc_id      = aws_vpc.main.id

  # HTTPS: trafico web de produccion.
  ingress {
    description = "HTTPS desde Internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP: redireccion a HTTPS y retos ACME (http-01) para emitir/renovar certificados.
  ingress {
    description = "HTTP desde Internet (redireccion + retos ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH: solo desde la IP del administrador (formato CIDR, ej. 1.2.3.4/32).
  ingress {
    description = "SSH restringido al administrador"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_ip]
  }

  # Sin reglas de ingress para 3306 (MySQL) ni 6379 (Redis): quedan inaccesibles
  # desde Internet por diseno; solo se comunican por la red interna de Docker.

  # Egress: salida sin restricciones.
  egress {
    description = "Todo el trafico de salida permitido"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}
