# Design Document

## Overview

Este documento describe el diseno tecnico de la infraestructura AWS para publicar OnlySpace en produccion con costo minimo. La estrategia es un unico servidor EC2 en la region mx-central-1 (Mexico Central) que ejecuta todos los servicios mediante Docker Compose: el backend Node/Express, Nginx (sirve el frontend estatico y hace de reverse proxy con HTTPS), MySQL y Redis. La infraestructura se define como codigo con Terraform, el despliegue continuo con GitHub Actions, los backups en S3, el DNS con Route 53 (dominio comprado en HostGator) y el control de gasto con AWS Budgets.

El objetivo de costo es aproximadamente 500 MXN/mes, apoyandose en el Free Tier de la cuenta nueva durante el primer ano.

### Decisiones de diseno y su justificacion

- **EC2 unico en vez de servicios administrados (RDS/ElastiCache/ECS):** minimiza costo. Servicios administrados multiplicarian el gasto por 3-6x. Trade-off aceptado: menor tolerancia a fallos (si el EC2 cae, todo cae hasta reinicio), mitigado con politica de reinicio automatico y backups diarios.
- **Region mx-central-1:** elegida por baja latencia y residencia de datos en Mexico. Riesgo: puede no cubrir Free Tier igual que us-east-1 y ser mas cara; se verifica antes de aplicar (ver seccion Verificacion previa). La region queda parametrizada para poder cambiarla facil.
- **Terraform:** estandar de IaC; su 'plan' permite revisar recursos y costo antes de crear nada.
- **Nginx + Let's Encrypt en el propio host:** HTTPS gratuito sin pagar un balanceador de carga (un ALB costaria ~300-400 MXN/mes extra).
- **MySQL en contenedor con volumen:** conserva la BD del sistema real (Prisma + MySQL) sin costo de RDS.

## Verificacion previa (antes de aplicar)

Estas comprobaciones se ejecutan con el perfil AWS de la cuenta nueva ya configurado, ANTES de crear recursos:

1. Confirmar identidad de la cuenta: `aws sts get-caller-identity --profile onlyspace` (validar que es la cuenta NUEVA, no la empresarial).
2. Confirmar tipos de instancia disponibles en la region: `aws ec2 describe-instance-type-offerings --region mx-central-1 --filters Name=instance-type,Values=t3.micro,t4g.micro`.
3. Confirmar cobertura de Free Tier en mx-central-1. Si t3.micro no aplica a Free Tier o no existe, usar t4g.micro (Graviton/ARM, mas barato). El Dockerfile usa node:20-alpine, compatible con ARM.
4. Confirmar disponibilidad de zonas: `aws ec2 describe-availability-zones --region mx-central-1`.

Si el Free Tier NO cubre la region, se informa al usuario el costo real estimado del ano 1 antes de continuar.

## Architecture

### Diagrama de alto nivel

```
Internet
   |
   v
[Route 53]  (dominio de HostGator -> nameservers de Route 53)
   |
   v
[Elastic IP] --- [EC2 t3.micro/t4g.micro | mx-central-1]
                     |
                     |  Docker Compose (red interna)
                     |
   +-----------------+-----------------+----------------+
   |                 |                 |                |
[nginx:443/80]   [backend:3000]   [mysql:3306]     [redis:6379]
   |  TLS            |  API            |  volumen        |  (solo red interna)
   |  sirve          |                 |  persistente    |
   |  frontend       |                 |                 |
   +--- reverse proxy a backend (/v1, /health)
   +--- sirve estaticos del build de Vite

[S3 bucket privado] <--- backup diario de MySQL (cron en el host)
[AWS Budgets] ---> alertas por email 50/80/100%
```

### Flujo de red

- Nginx escucha 80 (redirige a 443) y 443 (TLS). Es el unico servicio expuesto a Internet junto con SSH.
- Nginx sirve el frontend estatico (build de Vite copiado al host) y hace proxy_pass de `/v1` y `/health` hacia `backend:3000`.
- El webhook de Mercado Pago (`/v1/webhooks/mercadopago`) queda accesible por HTTPS a traves de Nginx.
- MySQL y Redis NO publican puertos al host; solo son accesibles dentro de la red de Docker Compose.

### Security Group (firewall)

| Puerto | Protocolo | Origen | Uso |
|--------|-----------|--------|-----|
| 443 | TCP | 0.0.0.0/0 | HTTPS publico |
| 80 | TCP | 0.0.0.0/0 | HTTP (redirige a HTTPS) + retos ACME de Let's Encrypt |
| 22 | TCP | IP del admin (restringido) | SSH administracion |

MySQL (3306) y Redis (6379) no tienen reglas de entrada: inaccesibles desde Internet.

## Components and Interfaces

### 1. Modulo Terraform

Estructura propuesta (nueva carpeta `infra/` en la raiz del repo):

```
infra/
  main.tf            # provider AWS (region parametrizada, profile onlyspace)
  variables.tf       # region, instance_type, domain, admin_ip, budget_amount, key_name
  network.tf         # VPC minima (o default), subnet publica, IGW, route table
  security.tf        # security group (443/80/22)
  compute.tf         # EC2 + Elastic IP + user_data (bootstrap docker + swap)
  storage.tf         # bucket S3 privado para backups + lifecycle de retencion
  dns.tf             # Route 53 hosted zone + registro A -> Elastic IP
  budget.tf          # AWS Budgets con alertas SNS/email
  outputs.tf         # IP publica, nameservers de Route 53, nombre del bucket
  terraform.tfvars   # valores concretos (NO secretos)
```

Variables clave (con defaults):
- `region` = "mx-central-1"
- `instance_type` = "t3.micro" (fallback "t4g.micro")
- `domain` = dominio de HostGator del usuario
- `admin_ip` = IP publica del usuario para SSH
- `budget_amount` = 30 (USD, ~500 MXN)
- `alert_email` = correo del usuario

El estado de Terraform (`terraform.tfstate`) se guarda local al inicio (mas simple). Se documenta como mejora futura moverlo a un backend S3 con bloqueo.

### 2. EC2 user_data (bootstrap)

Script que corre al primer arranque de la instancia:
1. Actualiza el sistema e instala Docker + plugin de Docker Compose.
2. Crea un archivo swap de 2 GB (mitiga la RAM de 1 GB del t3.micro).
3. Habilita Docker al inicio.
4. Deja el host listo; el codigo y el arranque de contenedores los hace el pipeline de despliegue.

### 3. docker-compose.prod.yml (nuevo)

Reemplaza al docker-compose.yml actual (que esta obsoleto: usa PostgreSQL y pgAdmin, no aplica al sistema real MySQL). Servicios:

- **mysql**: imagen mysql:8, volumen `mysql_data`, variables desde entorno seguro, `restart: unless-stopped`, `mem_limit` acotado, sin puertos publicados.
- **redis**: imagen redis:7-alpine, `restart: unless-stopped`, `mem_limit` acotado, sin puertos publicados.
- **backend**: imagen construida desde backend/Dockerfile, depende de mysql y redis, `restart: unless-stopped`, variables de entorno inyectadas (DATABASE_URL apuntando a mysql, REDIS_URL a redis, secretos de JWT/MP/Google). Ejecuta `prisma migrate deploy` en el arranque antes de `node dist/index.js`.
- **nginx**: imagen nginx + certbot (o companion acme), monta el build del frontend y la config, publica 80 y 443, hace proxy al backend.

Ajuste necesario al backend/Dockerfile: hoy hace `npm ci --only=production` y luego `npm run build` (que necesita typescript, un devDependency). El diseno corrige esto usando un build multi-stage (stage build con todas las deps + tsc; stage runtime solo con deps de produccion y el dist compilado). Esto reduce imagen y corrige el fallo de build.

### 4. Nginx + HTTPS

- Config con dos server blocks: 80 (redirige a 443 y expone la ruta ACME) y 443 (TLS, sirve estaticos + proxy).
- Certificado emitido por Let's Encrypt via certbot. Primera emision tras el DNS resolver al servidor. Renovacion automatica por cron/timer.
- `proxy_pass` de `/v1/` y `/health` a `http://backend:3000`. Todo lo demas sirve `index.html` (SPA fallback para React Router).

### 5. Backups a S3

- Script `backup.sh` en el host, agendado por cron diario.
- Hace `mysqldump` del contenedor MySQL, comprime y sube a `s3://<bucket>/backups/YYYY-MM-DD.sql.gz` con el AWS CLI.
- El bucket tiene una regla de ciclo de vida que borra objetos con mas de N dias (ej. 14) para acotar costo.
- Registro de exito/fallo en un log en el host y codigo de salida distinto de cero si falla (consultable).

### 6. Pipeline de CD (reemplaza cd.yml actual)

El cd.yml actual asume ECR + S3 + CloudFront (arquitectura administrada que descartamos). Se reescribe para el modelo EC2:

Flujo en push a `main`:
1. Checkout.
2. Job de CI (reusa ci.yml): backend lint+tsc+tests con MySQL de servicio; frontend tsc+build. Si falla, aborta (Requirement 6.2).
3. Build del frontend (`vite build`) con las variables VITE_ de produccion (desde secretos del repo).
4. Empaquetar artefactos (dist del frontend, codigo del backend o imagen Docker).
5. Conexion por SSH a la EC2 (clave privada desde secreto del repo): sincronizar codigo/artefactos, `docker compose -f docker-compose.prod.yml up -d --build`, que aplica migraciones y levanta contenedores.
6. Verificacion post-deploy: `curl https://<dominio>/health`; si falla, el job marca error.

Secretos del repositorio (GitHub Actions): `EC2_SSH_KEY`, `EC2_HOST`, `DATABASE_URL`, `JWT_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `GOOGLE_*`, `VITE_*`, etc. Nunca en el codigo.

Estrategia de rollback: si `migrate deploy` o el health check fallan, se conserva el contenedor anterior (deploy no destructivo: build de nueva imagen y `up -d`; si el arranque falla, la version previa sigue en pie hasta resolver).

### 7. DNS (HostGator -> Route 53)

Pasos documentados para el usuario (accion manual suya en HostGator):
1. Terraform crea la hosted zone en Route 53 y emite 4 nameservers (output).
2. El usuario entra al panel de HostGator y reemplaza los nameservers actuales (`cosmos.dns-parking.com`, `nova.dns-parking.com`) por los 4 de Route 53.
3. La propagacion tarda de minutos a 48h. Cuando el dominio resuelve a la Elastic IP, se emite el certificado HTTPS.

Alternativa sin cambiar nameservers: dejar el DNS en HostGator y crear un registro A hacia la Elastic IP. Se documenta, pero Route 53 es la ruta recomendada por simplicidad de gestion.

### 8. AWS Budgets

- Presupuesto mensual con `budget_amount` (ej. 30 USD).
- Notificaciones al 50%, 80% y 100% del gasto real/proyectado, enviadas por email al usuario via SNS.

## Data Models

No se introducen modelos de datos nuevos. La base de datos MySQL de produccion usa el mismo esquema Prisma del sistema real. En produccion se aplica con `prisma migrate deploy`. Los datos persisten en el volumen Docker `mysql_data`.

## Error Handling

- **Fallo de migracion en deploy:** el pipeline aborta y conserva la version anterior; no se enruta trafico a un backend con esquema inconsistente.
- **Fallo de arranque de contenedor:** politica `restart: unless-stopped` reintenta; el health check del pipeline detecta si no levanta.
- **Fallo de backup:** el script registra el error y sale con codigo != 0; queda en el log del host para revision.
- **Certificado TLS no emitido (DNS aun no propaga):** Nginx sirve por HTTP temporalmente; certbot reintenta hasta que el dominio resuelve.
- **Presupuesto excedido:** alerta por email (no corta el servicio automaticamente para no tirar produccion).

## Testing Strategy

- **Validacion de Terraform:** `terraform validate` y `terraform plan` (revisa recursos y costo) antes de `apply`. El plan es el punto de aprobacion del usuario.
- **CI existente:** ci.yml sigue corriendo lint+tsc+tests del backend (con MySQL de servicio) y build del frontend en cada push/PR.
- **Prueba de humo post-deploy:** `curl https://<dominio>/health` debe responder 200 con `{ status: ok }`.
- **Prueba manual de MP en produccion:** una vez con HTTPS y webhook publico, ejecutar una suscripcion real de bajo monto o con test_user y confirmar que el webhook extiende el premium (cierra el ciclo que en local no se pudo probar).
- **Prueba de restauracion de backup:** verificar al menos una vez que un dump de S3 se puede restaurar en un MySQL limpio (validacion de disaster recovery).


## Correctness Properties

Invariantes que la infraestructura debe cumplir siempre, independientemente del estado.

### Property 1: No exposicion de datos
MySQL y Redis NUNCA son alcanzables desde Internet; solo por la red interna de Docker Compose.

**Validates: Requirements 10.2**

### Property 2: HTTPS obligatorio
Todo acceso HTTP se redirige a HTTPS; ningun contenido de la app se sirve sin TLS una vez emitido el certificado.

**Validates: Requirements 3.3**

### Property 3: Secretos fuera del repo
Ningun secreto (tokens, contrasenas, llaves) aparece en el codigo versionado; solo en GitHub Secrets o en el entorno del host.

**Validates: Requirements 2.5, 6.4, 9.4**

### Property 4: Persistencia de datos
Los datos de MySQL sobreviven a reinicios y recreaciones de contenedor mientras exista el volumen.

**Validates: Requirements 2.3**

### Property 5: Migraciones antes de servir
El backend nunca atiende trafico con un esquema sin migrar; si la migracion falla, la version anterior sigue activa.

**Validates: Requirements 4.1, 4.2**

### Property 6: Despliegue idempotente
Re-ejecutar el despliegue con el mismo commit no deja el sistema en estado inconsistente.

**Validates: Requirements 6.5**

### Property 7: Backup diario existente
Para cualquier dia de operacion normal existe al menos un respaldo del dia en S3, sujeto a la politica de retencion.

**Validates: Requirements 5.1, 5.2**

### Property 8: Cuenta correcta
Todos los recursos se crean en la cuenta AWS nueva (perfil onlyspace), nunca en la empresarial.

**Validates: Requirements 1.1**

### Property 9: Tope de gasto observable
Siempre existe un presupuesto activo que dispara alerta antes o al alcanzar el 100% del tope.

**Validates: Requirements 8.1, 8.2**

## Estimacion de costos (a confirmar con precios reales de mx-central-1)

Region us-east-1 sirve de referencia; mx-central-1 puede ser algo mayor.

| Recurso | Ano 1 (Free Tier) | Ano 2+ (sin Free Tier) |
|---------|-------------------|------------------------|
| EC2 t3.micro 24/7 | ~0 | ~150-170 MXN |
| EBS 30 GB | ~0 | ~50-60 MXN |
| Elastic IP (en uso) | ~0 | ~0 |
| S3 backups (pocos GB) | ~centavos | ~10-20 MXN |
| Route 53 hosted zone | ~9 MXN | ~9 MXN |
| Transferencia salida | porcion gratis | ~20-60 MXN |
| **Total aprox.** | **casi 0 - ~20 MXN** | **~250-320 MXN** |

Dentro del objetivo de 500 MXN/mes. La cifra exacta de mx-central-1 se confirma en la Verificacion previa.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigacion |
|--------|---------|------------|
| Free Tier no cubre mx-central-1 | Factura ano 1 mayor | Verificar antes de aplicar; ofrecer us-east-1 como alternativa |
| 1 GB de RAM insuficiente | Contenedores caen | Swap 2 GB + mem_limit; escalar a t3.small si persiste |
| EC2 unico = punto unico de fallo | Caida total temporal | restart automatico + backups diarios; documentar recuperacion |
| Perdida de datos | Critico | Backup diario a S3 + prueba de restauracion |
| Secretos expuestos | Critico | Secretos solo en GitHub Secrets y entorno del host; nunca en repo |
| Estado de Terraform local se pierde | Dificil gestionar infra | Documentar respaldo del tfstate; mejora futura a backend S3 |
