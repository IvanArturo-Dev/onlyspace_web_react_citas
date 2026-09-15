# Implementation Plan

## Overview

Plan de implementacion de la infraestructura AWS para OnlySpace: EC2 unico en mx-central-1 con Docker Compose (backend, Nginx+HTTPS, MySQL, Redis), IaC con Terraform, CI/CD con GitHub Actions, backups a S3, DNS con Route 53 y control de costos con AWS Budgets.

Las tareas 1-5 son codigo y documentacion que se pueden hacer sin acceso a AWS. Las tareas del grupo 6 requieren el perfil AWS del usuario configurado (cuenta nueva) y crean recursos reales con costo; se ejecutan tras aprobar el terraform plan.

## Task Dependency Graph

```
1.1 (Dockerfile) ---> 1.2 (compose) ---> 4.1 (CD)
1.3 (Nginx) --------> 1.2
2.1 (tf base) ---> 2.2 (ec2/sg) ---> 2.3 (s3)
                                 \--> 2.4 (dns)
                                 \--> 2.5 (budget)
3.1 (backup) depende de 2.3
5.1 (docs) depende de 2.4, 4.1

6.1 (verif cuenta) ---> 6.2 (plan) ---> 6.3 (apply/deploy) ---> 6.4 (MP e2e)
                                                          \--> 6.5 (restore)
6.2 depende de: 2.1-2.5, 3.1, 1.1-1.3
6.3 depende de: 4.1, 5.1
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "1.3", "2.1"] },
    { "wave": 2, "tasks": ["1.2", "2.2"] },
    { "wave": 3, "tasks": ["2.3", "2.4", "2.5", "4.1"] },
    { "wave": 4, "tasks": ["3.1", "5.1"] },
    { "wave": 5, "tasks": ["6.1"] },
    { "wave": 6, "tasks": ["6.2"] },
    { "wave": 7, "tasks": ["6.3"] },
    { "wave": 8, "tasks": ["6.4", "6.5"] },
    { "wave": 9, "tasks": ["7.1", "7.2", "7.3"] }
  ],
  "dependencies": {
    "1.2": ["1.1", "1.3"],
    "2.2": ["2.1"],
    "2.3": ["2.2"],
    "2.4": ["2.2"],
    "2.5": ["2.2"],
    "3.1": ["2.3"],
    "4.1": ["1.2"],
    "5.1": ["2.4", "4.1"],
    "6.1": [],
    "6.2": ["2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "1.1", "1.2", "1.3", "6.1"],
    "6.3": ["6.2", "4.1", "5.1"],
    "6.4": ["6.3"],
    "6.5": ["6.3"],
    "7.1": ["2.2"],
    "7.2": [],
    "7.3": ["7.1", "4.1"]
  }
}
```

## Tasks

- [x] 1. Preparar el repositorio para produccion (codigo, sin AWS)
- [x] 1.1 Corregir el Dockerfile del backend con build multi-stage
  - Reescribir backend/Dockerfile: stage builder con todas las deps + tsc; stage runtime con solo deps de produccion + dist compilado + prisma
  - Asegurar que prisma generate corre en el build y que las migraciones estan disponibles en runtime
  - Verificar localmente: docker build -f backend/Dockerfile backend
  - _Requirements: 2.1, 4.1_

- [x] 1.2 Crear docker-compose.prod.yml (MySQL + Redis + backend + Nginx)
  - Nuevo archivo con los 4 servicios, red interna, volumen mysql_data, restart unless-stopped, mem_limit en mysql/redis, sin publicar puertos de mysql/redis
  - backend: env desde variables, comando que ejecuta prisma migrate deploy y luego node dist/index.js
  - Marcar el docker-compose.yml actual (PostgreSQL/pgAdmin) como obsoleto o eliminarlo
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 10.2_

- [x] 1.3 Crear configuracion de Nginx (reverse proxy + SPA + HTTPS)
  - Config con server block 80 (redirige a 443 + ruta ACME) y 443 (TLS)
  - proxy_pass de /v1/ y /health a backend:3000; fallback a index.html para el SPA
  - Preparar integracion con certbot/companion para Let's Encrypt
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Escribir el modulo Terraform (infra/)
- [x] 2.1 Provider, variables y red base
  - main.tf (provider AWS con region y profile parametrizados), variables.tf (region, instance_type, domain, admin_ip, budget_amount, alert_email, key_name)
  - network.tf: VPC minima o default, subnet publica, internet gateway, route table
  - terraform.tfvars con valores concretos (NO secretos)
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 2.2 Security group y EC2 + Elastic IP + swap
  - security.tf: reglas 443/80 abiertas, 22 restringido a admin_ip; mysql/redis sin reglas de entrada
  - compute.tf: instancia EC2, Elastic IP asociada, user_data que instala Docker + Compose y crea swap 2 GB
  - _Requirements: 1.1, 1.3, 1.5, 10.1, 10.3_

- [x] 2.3 Almacenamiento S3 para backups
  - storage.tf: bucket privado con acceso publico bloqueado + regla de ciclo de vida (retencion N dias)
  - _Requirements: 5.2, 5.3_

- [x] 2.4 DNS con Route 53
  - dns.tf: hosted zone para el dominio + registro A hacia la Elastic IP; outputs con los nameservers
  - _Requirements: 7.1, 7.2_

- [x] 2.5 AWS Budgets con alertas
  - budget.tf: presupuesto mensual con notificaciones al 50/80/100% por email (SNS)
  - outputs.tf: IP publica, nameservers, nombre del bucket
  - _Requirements: 8.1, 8.2_

- [x] 3. Script de backups
- [x] 3.1 Crear backup.sh y su agendado
  - Script que hace mysqldump del contenedor, comprime y sube a S3 con fecha; log de exito/fallo con codigo de salida
  - Documentar el cron diario en el host (via user_data o paso manual)
  - _Requirements: 5.1, 5.4_

- [x] 4. Pipeline de despliegue (CI/CD)
- [x] 4.1 Reescribir .github/workflows/cd.yml para el modelo EC2
  - Ejecutar CI (tests+build) antes de desplegar; abortar si falla
  - Build del frontend con VITE_ desde secretos; deploy por SSH a la EC2 (docker compose up -d --build)
  - Health check post-deploy (curl https://dominio/health); marcar error si falla
  - Documentar los secretos requeridos del repo (EC2_SSH_KEY, EC2_HOST, DATABASE_URL, JWT_SECRET, MERCADOPAGO_ACCESS_TOKEN, GOOGLE_*, VITE_*)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 5. Documentacion operativa
- [x] 5.1 Escribir docs/deployment/README.md
  - Pasos manuales del usuario: aws configure --profile onlyspace, cambio de nameservers en HostGator, carga de secretos en GitHub, revocacion de credenciales expuestas (PAT y MP)
  - Config de produccion de Mercado Pago: back_url real, webhook en panel MP, quitar MERCADOPAGO_TEST_PAYER_EMAIL, token de produccion como secreto
  - Procedimiento de recuperacion (restaurar backup) y de escalado a t3.small
  - _Requirements: 7.1, 7.3, 9.1, 9.2, 9.3, 9.4_

- [ ] 6. Verificacion previa y aplicacion (requiere perfil AWS del usuario)
- [x] 6.1 Verificar cuenta, region y Free Tier
  - aws sts get-caller-identity --profile onlyspace (confirmar cuenta NUEVA)
  - describe-instance-type-offerings y disponibilidad de Free Tier en mx-central-1; elegir t3.micro o t4g.micro
  - Informar al usuario si el Free Tier no cubre la region antes de continuar
  - _Requirements: 1.1, 1.2_

- [x] 6.2 terraform plan y revision de costos
  - terraform init + validate + plan; presentar al usuario los recursos y el costo estimado para aprobacion
  - _Requirements: 8.3_

- [x] 6.3 terraform apply y primer despliegue
  - Aplicar la infra tras aprobacion; entregar nameservers al usuario para HostGator
  - Tras propagacion DNS: emitir certificado HTTPS y ejecutar el primer deploy
  - Prueba de humo: curl https://dominio/health
  - _Requirements: 3.2, 4.1, 6.3_

- [~] 6.4 Prueba end-to-end de Mercado Pago en produccion
  - Configurar webhook en el panel de MP; ejecutar una suscripcion de prueba y confirmar que el webhook extiende el premium (cierra el ciclo que en local no se pudo)
  - _Requirements: 9.1, 9.2_

- [~] 6.5 Prueba de restauracion de backup
  - Verificar que un dump de S3 se restaura en un MySQL limpio (disaster recovery)
  - _Requirements: 5.1_

- [x] 7. Gestion de secretos con AWS SSM Parameter Store
- [x] 7.1 IAM role + instance profile para leer SSM (Terraform)
  - Crear en infra/ un iam.tf: aws_iam_role para EC2 (assume role ec2), policy de solo lectura ssm:GetParameter/GetParameters/GetParametersByPath sobre arn de /onlyspace/*, y kms:Decrypt para SecureString (alias/aws/ssm), instance profile.
  - Asociar el instance profile a aws_instance.app (iam_instance_profile) en compute.tf.
  - _Requirements: 11.2_
- [x] 7.2 Script para cargar secretos en SSM
  - Crear scripts/load-secrets-to-ssm.sh (o .ps1) que suba cada secreto como SecureString bajo /onlyspace/<KEY> con aws ssm put-parameter --type SecureString --overwrite, leyendo de un archivo local NO versionado. Documentar uso. No hardcodear valores.
  - _Requirements: 11.1, 11.5_
- [x] 7.3 Deploy lee secretos desde SSM y ajustar pipeline
  - Crear scripts/render-env-from-ssm.sh que corra en la EC2: aws ssm get-parameters-by-path --path /onlyspace/ --with-decryption y genere el .env de produccion (chmod 600).
  - Ajustar .github/workflows/cd.yml: quitar los secretos de app de GitHub; el deploy solo hace SSH + git/rsync + ejecutar render-env-from-ssm.sh + docker compose up. GitHub conserva solo EC2_SSH_KEY, EC2_HOST, PROD_DOMAIN y VITE_*.
  - _Requirements: 11.3, 11.4, 11.5_

## Notes

- Las tareas 1-5 no crean recursos AWS ni generan costo; son codigo y documentacion.
- El grupo 6 requiere el perfil AWS onlyspace configurado y crea recursos reales; nada se aplica sin el terraform plan aprobado por el usuario.
- Pasos manuales del usuario (no automatizables desde aqui): aws configure, cambio de nameservers en HostGator, carga de secretos en GitHub, revocacion del PAT y regeneracion de credenciales de Mercado Pago expuestas.
- El tfstate de Terraform sera local al inicio; mover a backend S3 con bloqueo es una mejora futura documentada.
