# compute.tf
# Instancia EC2 unica de OnlySpace + Elastic IP + bootstrap (Docker, Compose, swap).
# La instancia corre Docker Compose (backend + nginx + mysql + redis).
# El codigo de la app y el arranque de contenedores lo hace el pipeline de despliegue
# (CD por SSH); aqui solo se deja el host listo.

# AMI mas reciente de Amazon Linux 2023.
# NOTA IMPORTANTE sobre la arquitectura:
#   Por defecto se filtra x86_64, que coincide con instance_type = t3.micro (default).
#   Si se cambia var.instance_type a un tipo ARM (Graviton, ej. t4g.micro), hay que
#   cambiar el filtro "name" a "al2023-ami-*-arm64" (y el sufijo del values de abajo)
#   para obtener la AMI ARM correcta; de lo contrario la instancia no arrancara.
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Instancia EC2 de la aplicacion.
resource "aws_instance" "app" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  key_name                    = var.key_name
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.ec2.name

  # Disco raiz: 30 GB gp3 (dentro del Free Tier de EBS).
  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  # Bootstrap del host: paquetes, Docker, plugin de Compose v2 y swap de 2 GB.
  user_data = <<-EOF
    #!/bin/bash
    set -euxo pipefail

    # 1. Actualizar paquetes del sistema (Amazon Linux 2023 usa dnf).
    dnf update -y

    # 2. Instalar Docker, habilitarlo e iniciarlo.
    dnf install -y docker
    systemctl enable --now docker

    # 3. Instalar el plugin de Docker Compose v2.
    #    En AL2023 el paquete docker-compose-plugin no siempre esta disponible en los
    #    repos, por lo que instalamos el binario del plugin manualmente en el directorio
    #    estandar de plugins del CLI de Docker. Asi queda disponible como "docker compose".
    DOCKER_COMPOSE_VERSION="v2.29.7"
    mkdir -p /usr/libexec/docker/cli-plugins
    curl -SL "https://github.com/docker/compose/releases/download/$${DOCKER_COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      -o /usr/libexec/docker/cli-plugins/docker-compose
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose

    # 4. Permitir al usuario ec2-user usar Docker sin sudo.
    usermod -aG docker ec2-user

    # 5. Crear un archivo swap de 2 GB (t3.micro tiene solo 1 GB de RAM).
    if [ ! -f /swapfile ]; then
      fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      # Persistir el swap para que sobreviva reinicios.
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
  EOF

  tags = {
    Name    = "${var.project_name}-ec2"
    Project = var.project_name
  }
}

# Elastic IP: IP publica fija asociada a la instancia (para DNS estable en Route 53).
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = {
    Name    = "${var.project_name}-eip"
    Project = var.project_name
  }
}
