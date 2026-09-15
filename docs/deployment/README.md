# Despliegue de OnlySpace en AWS — Guía operativa

Guía paso a paso para desplegar y operar OnlySpace en AWS: un único servidor EC2
en la región **mx-central-1** que corre todo el stack con Docker Compose.
Infraestructura como código con Terraform (`infra/`), CI/CD con GitHub Actions
(`.github/workflows/cd.yml`), backups a S3, DNS con Route 53 y control de costos
con AWS Budgets.

> Objetivo de costo: ~500 MXN/mes apoyándose en el Free Tier durante el primer año.

---

## 1. Resumen de la arquitectura

Un solo EC2 (`t3.micro`) ejecuta cuatro contenedores con
`docker-compose.prod.yml`. Solo Nginx expone puertos a Internet (80/443); MySQL,
Redis y el backend viven en la red interna de Docker y no publican puertos al
host. El backend aplica migraciones (`prisma migrate deploy`) antes de arrancar.
Los backups diarios de MySQL se suben a un bucket S3 privado. Route 53 gestiona
el DNS del dominio (delegado desde HostGator) y AWS Budgets vigila el gasto.

```
                        Internet
                           |
                    (DNS: Route 53)
                           |
                     Elastic IP (fija)
                           |
        +------------------------------------------+
        |            EC2  t3.micro                  |
        |            (mx-central-1)                 |
        |                                           |
        |   [Nginx :80/:443]  <-- único expuesto    |
        |      |  sirve estáticos (build Vite)      |
        |      |  proxy /v1 y /health -> backend    |
        |      v                                    |
        |   [backend :3000] (Node/Express/Prisma)   |
        |      |            |                        |
        |      v            v                        |
        |   [MySQL 8]    [Redis 7]   (red interna)   |
        +------------------------------------------+
                           |
                    backup diario (cron)
                           v
                 [S3 bucket privado]  (retención 14 días)

        [AWS Budgets] --> alertas email 50 / 80 / 100 %
```

---

## 2. Prerrequisitos

- **AWS CLI** instalado y configurado con el perfil `onlyspace`
  (cuenta `484888470897`).
- **Terraform** instalado. En Windows:
  ```powershell
  winget install HashiCorp.Terraform
  ```
- Un **key pair de EC2** ya creado en la región `mx-central-1` (para el acceso
  SSH). Anota su nombre; se usará en la variable `key_name`.
- El **dominio** comprado en HostGator (para delegar el DNS a Route 53).
- Acceso al repositorio de GitHub para cargar los secrets del pipeline.

---

## 3. Despliegue inicial paso a paso

### a. Configurar el perfil AWS

```bash
aws configure --profile onlyspace
```

Introduce Access Key, Secret Key, región (`mx-central-1`) y formato (`json`).
Verifica que apuntas a la cuenta correcta:

```bash
aws sts get-caller-identity --profile onlyspace
```

Debe devolver la cuenta `484888470897`. Si muestra otra cuenta, revisa las
credenciales antes de continuar.

### b. Rellenar `infra/terraform.tfvars`

Edita `infra/terraform.tfvars` con tus valores concretos (nunca secretos):

```hcl
domain      = "tudominio.mx"
admin_ip    = "TU_IP_PUBLICA/32"
alert_email = "tucorreo@ejemplo.com"
key_name    = "nombre-de-tu-key-pair"
```

- `admin_ip`: tu IP pública en formato CIDR `/32`. Obtén tu IP con:
  ```bash
  curl https://checkip.amazonaws.com
  ```
  Si tu IP cambia (conexión doméstica dinámica), tendrás que actualizar este
  valor y reaplicar para conservar el acceso SSH.
- `domain`, `alert_email` y `key_name`: tu dominio, el correo que recibirá las
  alertas de costo y el nombre del key pair de EC2.

Valores con default razonable que puedes ajustar si lo necesitas: `region`
(`mx-central-1`), `instance_type` (`t3.micro`), `budget_amount` (30 USD).

### c. Inicializar, planear y aplicar Terraform

```bash
cd infra
terraform init
terraform plan
```

Revisa en el `plan` los recursos que se crearán (VPC, subnet, IGW, security
group, EC2, Elastic IP, bucket S3, hosted zone de Route 53, AWS Budgets) y el
costo estimado. Cuando estés conforme:

```bash
terraform apply
```

Confirma con `yes`. La creación tarda unos minutos.

### d. Tomar los outputs

Al terminar, Terraform imprime los outputs (o consúltalos con
`terraform output`):

- `public_ip` — la Elastic IP fija del servidor (SSH y destino del DNS).
- `route53_nameservers` — los 4 nameservers de Route 53 para HostGator.
- `s3_backup_bucket` — el nombre del bucket S3 de backups.

### e. Cambiar los nameservers en HostGator

El dominio hoy usa los nameservers de HostGator
(`cosmos.dns-parking.com` y `nova.dns-parking.com`). Para delegar el DNS a AWS:

1. Entra al panel de HostGator, a la administración del dominio (sección de
   **nameservers** / servidores DNS).
2. Elimina `cosmos.dns-parking.com` y `nova.dns-parking.com`.
3. Añade los **4 nameservers** de `route53_nameservers` (uno por campo, sin el
   punto final si el panel no lo admite).
4. Guarda.

> **Propagación DNS:** el cambio puede tardar desde unos minutos hasta 48 horas.
> Verifica con `nslookup tudominio.mx` o `dig tudominio.mx NS` hasta que
> aparezcan los nameservers de AWS y el dominio resuelva a la Elastic IP.

### f. Emitir el certificado HTTPS

Una vez que el DNS resuelva al servidor, emite el certificado de Let's Encrypt
(certbot en modo webroot). El procedimiento detallado está en
[`nginx/README.md`](../../nginx/README.md): reemplazar el placeholder `DOMAIN`
en la config, levantar Nginx en HTTP, ejecutar `certbot certonly --webroot` y
recargar Nginx con el bloque 443 activo.

Mientras el DNS no propague, el servicio queda disponible solo por HTTP (80); el
certificado se emite **después** de que el dominio resuelva.

### g. Cargar los secrets en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New
repository secret**. Da de alta los siguientes ~31 secrets (lista tomada de la
cabecera de `.github/workflows/cd.yml`):

**Acceso a la EC2 / dominio**
- `EC2_SSH_KEY` — clave privada SSH (PEM) del usuario `ec2-user`.
- `EC2_HOST` — IP pública / Elastic IP de la EC2.
- `PROD_DOMAIN` — dominio de producción, ej. `onlyspace.mx` (sin `https://`).

**Backend (.env de producción)**
- `DATABASE_URL` — `mysql://<MYSQL_USER>:<MYSQL_PASSWORD>@mysql:3306/<MYSQL_DATABASE>`
- `JWT_SECRET`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_PUBLIC_KEY`
- `SUBSCRIPTION_PRICE_MXN`
- `SUBSCRIPTION_BACK_URL`
- `TRIAL_DAYS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CONNECT_REDIRECT_URI`
- `GOOGLE_TOKEN_ENC_KEY`
- `FIREBASE_PROJECT_ID`
- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORD`
- `FRONTEND_URL`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `REDIS_URL` — `redis://redis:6379`

**Frontend (build de Vite en el runner)**
- `VITE_API_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_ADSENSE_CLIENT` — client id de Google AdSense (ej. `ca-pub-XXXXXXXXXXXXXXXX`). Opcional: si no se define, no se muestran anuncios de AdSense. No es secreto (se incrusta en el bundle publico).

Con los secrets cargados, **cada push a `main`** dispara el pipeline: corre los
tests, construye el frontend, sincroniza el código a la EC2, escribe el `.env` de
producción de forma segura, levanta el stack con
`docker compose -f docker-compose.prod.yml up -d --build` (aplica migraciones) y
hace un health check contra `https://<PROD_DOMAIN>/health`. Si los tests o el
health check fallan, el deploy no se completa.

---

## 4. Configuración de producción de Mercado Pago

Antes de aceptar pagos reales, ajusta la integración de Mercado Pago:

1. **`back_url` real:** `SUBSCRIPTION_BACK_URL` debe apuntar al dominio real por
   HTTPS (ej. `https://tudominio.mx/...`), no a localhost ni a una URL de prueba.
2. **Webhook en el panel de MP:** en el panel de Mercado Pago, configura la
   notificación (webhook) apuntando a:
   ```
   https://<dominio>/v1/webhooks/mercadopago
   ```
   Es la ruta que extiende el premium al confirmarse un pago.
3. **Quitar `MERCADOPAGO_TEST_PAYER_EMAIL`:** en producción esta variable debe
   estar **ausente** (no definirla como secret). Existe solo para forzar un
   `test_user` en el sandbox; si está presente, se usaría ese email en lugar del
   email real del emprendedor. En `backend/.env` local aparece con un valor de
   prueba: no la copies a producción.
4. **Access Token de producción:** usa el token de producción (`APP_USR-...`) en
   el secret `MERCADOPAGO_ACCESS_TOKEN`. Nunca lo commitees al repositorio.

---

## 5. Backups y restauración

**Cómo funciona el backup.** El script `scripts/backup.sh` corre en el host,
agendado por **cron diario**. Hace `mysqldump` del contenedor MySQL, comprime el
volcado y lo sube al bucket S3 con la fecha:

```
s3://<s3_backup_bucket>/backups/YYYY-MM-DD.sql.gz
```

Registra éxito o fallo en un log del host y sale con código distinto de cero si
algo falla (revisable en el log). El bucket tiene una **regla de ciclo de vida**
que borra los objetos con más de **14 días**, para acotar el costo.

**Verificar los backups en S3:**

```bash
aws s3 ls s3://<s3_backup_bucket>/backups/ --profile onlyspace
```

**Restaurar un dump en un MySQL limpio.** Procedimiento de recuperación ante
desastre:

```bash
# 1. Descargar el dump deseado desde S3
aws s3 cp s3://<s3_backup_bucket>/backups/YYYY-MM-DD.sql.gz . --profile onlyspace

# 2. Descomprimir
gunzip YYYY-MM-DD.sql.gz          # produce YYYY-MM-DD.sql

# 3. Copiar el .sql al contenedor MySQL
docker compose -f docker-compose.prod.yml cp YYYY-MM-DD.sql mysql:/tmp/dump.sql

# 4. Restaurar dentro del contenedor (usa las credenciales del .env)
docker compose -f docker-compose.prod.yml exec mysql \
  sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < /tmp/dump.sql'
```

Para una máquina totalmente nueva, primero levanta el stack
(`docker compose -f docker-compose.prod.yml up -d`) para que se cree la base con
su esquema, y luego restaura el dump. Confirma la restauración revisando datos
clave o corriendo la app contra la base restaurada.

---

## 6. Operación

**Ver logs:**

```bash
# En la EC2, dentro del directorio del proyecto (ej. /home/ec2-user/onlyspace)
docker compose -f docker-compose.prod.yml logs -f            # todos los servicios
docker compose -f docker-compose.prod.yml logs -f backend    # solo backend
docker compose -f docker-compose.prod.yml logs -f nginx      # solo nginx
```

**Reiniciar servicios:**

```bash
docker compose -f docker-compose.prod.yml restart            # todo el stack
docker compose -f docker-compose.prod.yml restart backend    # un servicio
```

**Escalar a `t3.small`.** Cuando 1 GB de RAM se quede corto, cambia el tipo de
instancia sin tocar el resto:

1. En `infra/terraform.tfvars` añade o edita:
   ```hcl
   instance_type = "t3.small"
   ```
2. Aplica el cambio:
   ```bash
   cd infra
   terraform plan     # revisa que solo cambie la instancia
   terraform apply
   ```

> Cambiar el tipo de instancia normalmente implica un reinicio (o recreación) de
> la EC2. La Elastic IP se mantiene, así que el DNS no cambia. Como los datos de
> MySQL viven en el volumen del host, sobreviven al reinicio; aun así, asegúrate
> de tener un backup reciente antes de reaplicar.

**Recuperación ante fallo del EC2.** El stack usa `restart: unless-stopped`, así
que Docker reintenta levantar los contenedores tras un reinicio del host. Ante un
fallo total de la instancia:

1. Recrea la infraestructura con `terraform apply` (la Elastic IP y el bucket S3
   se conservan si el estado de Terraform está intacto).
2. Deja que el pipeline (push a `main`) o un deploy manual levante el stack.
3. Restaura el último backup desde S3 siguiendo la sección 5.
4. Verifica con `curl https://<dominio>/health`.

> **Punto único de fallo:** al ser un solo EC2, un fallo tumba el servicio hasta
> reiniciar/recuperar. Se mitiga con reinicio automático y backups diarios. El
> estado de Terraform es local al inicio; respáldalo (mover a un backend S3 con
> bloqueo es una mejora futura recomendada).

---

## 7. Seguridad — acciones pendientes del usuario

Acciones que **debes** completar tú (no automatizables desde aquí):

- **Revocar el PAT de GitHub expuesto.** Se compartió un Personal Access Token
  (`ghp_...`) en el chat. Ve a GitHub → **Settings → Developer settings →
  Personal access tokens**, revócalo y, si sigues necesitando uno, genera uno
  nuevo con el mínimo alcance necesario.
- **Regenerar las credenciales de Mercado Pago expuestas.** Las credenciales de
  MP (`APP_USR-...`) se mostraron en el chat. En el panel de Mercado Pago,
  renueva/regenera el Access Token y la Public Key, y actualiza los secrets
  `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_PUBLIC_KEY` en GitHub.
- **No commitear `.env`.** Los archivos `.env` (backend y producción) contienen
  secretos y están en `.gitignore`. Nunca los subas al repositorio; los secretos
  van solo en GitHub Secrets y en el entorno del host.

> Regla general: cualquier credencial que haya aparecido en un chat, log o
> captura debe considerarse comprometida y rotarse.


## 8. AdSense (anuncios de Google)

Los anuncios de AdSense se controlan con la variable de build `VITE_ADSENSE_CLIENT`
(client id `ca-pub-...`). Comportamiento:

- Si `VITE_ADSENSE_CLIENT` NO esta definida, no se muestra ningun anuncio de AdSense.
- La landing publica muestra AdSense cuando la variable esta definida.
- El portal de reserva de cada negocio muestra AdSense SOLO si el negocio NO es
  premium. Los negocios premium nunca ven anuncios de AdSense.
- `frontend-web/index.html` incluye la meta `google-adsense-account` para la
  verificacion de la cuenta en el panel de AdSense.

IMPORTANTE: Google solo servira anuncios reales cuando tu cuenta de AdSense este
aprobada y el dominio `onlyspace.site` verificado en el panel de AdSense. Hasta
entonces el espacio puede quedar vacio. Esto depende de Google, no del codigo.

No confundir con los "anuncios/promociones del emprendedor" (PromoCard, gestionados
en Marketing): esos son promociones que crea el propio negocio premium y son
independientes de AdSense.


## 9. Ver logs por SSH (operacion diaria)

Los logs de la app viven dentro de los contenedores Docker en la EC2 (no en la
consola de AWS). Para consultarlos, conectate por SSH y usa `sudo docker logs`.

Conexion:

    ssh -i infra/secrets/onlyspace-key.pem ec2-user@78.13.235.197

Comandos utiles (en la EC2):

    sudo docker ps                                    # estado de contenedores
    sudo docker logs onlyspace-backend-1 --tail 50    # backend (errores de app)
    sudo docker logs -f onlyspace-backend-1           # seguir en vivo
    sudo docker logs onlyspace-nginx-1 --tail 50      # nginx (HTTP/HTTPS)
    sudo docker logs onlyspace-mysql-1 --tail 30      # mysql
    sudo docker logs onlyspace-redis-1 --tail 30      # redis
    sudo docker logs onlyspace-backend-1 2>&1 | grep -i error | tail -20

Datos de la instancia:
- Region: mx-central-1 (Mexico). La consola AWS solo muestra el EC2 al
  seleccionar esa region en el selector superior derecho.
- Instance ID: i-0e0d74ce58901dbfc
- IP publica (Elastic IP): 78.13.235.197
- Name: onlyspace-ec2

Ejecutar el seed del superadmin (crea el tenant 'default' + superadmin) en una
base nueva:

    sudo docker exec onlyspace-backend-1 node dist/database/seed-superadmin.js

Reiniciar el backend (p.ej. tras cambiar secretos en SSM):

    cd /home/ec2-user/onlyspace
    SSM_PREFIX=/onlyspace AWS_REGION=mx-central-1 OUT_FILE="$PWD/.env" bash scripts/render-env-from-ssm.sh
    sudo docker compose -f docker-compose.prod.yml up -d backend
