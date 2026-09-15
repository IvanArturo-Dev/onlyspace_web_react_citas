# Respaldos de la base de datos (backup.sh)

`backup.sh` genera un respaldo diario de la base MySQL de OnlySpace y lo sube a S3.
Corre en la EC2 (Linux), junto al `docker-compose.prod.yml`, en `/home/ec2-user/onlyspace`.

- El script **solo sube**. La **retención** la maneja S3: el bucket tiene una regla de
  ciclo de vida que borra objetos con prefijo `backups/` a los **14 días** (Terraform, tarea 2.3).
- Requisitos en el host: Docker + Docker Compose, AWS CLI configurado (rol de instancia o
  credenciales) con permiso de `s3:PutObject` sobre el bucket, y el `.env` de producción en
  `PROJECT_DIR` con `MYSQL_ROOT_PASSWORD` y `MYSQL_DATABASE`.

## Variables de entorno

| Variable        | Obligatoria | Default                       | Descripción                                        |
|-----------------|-------------|-------------------------------|----------------------------------------------------|
| `S3_BUCKET`     | Sí          | —                             | Nombre del bucket S3 (output `s3_backup_bucket`).  |
| `PROJECT_DIR`   | No          | `/home/ec2-user/onlyspace`    | Carpeta con `docker-compose.prod.yml` y `.env`.    |
| `COMPOSE_FILE`  | No          | `docker-compose.prod.yml`     | Archivo compose a usar.                            |
| `MYSQL_SERVICE` | No          | `mysql`                       | Nombre del servicio MySQL en el compose.           |
| `LOG_FILE`      | No          | `/var/log/onlyspace-backup.log` | Ruta del log (si no es escribible, cae a `PROJECT_DIR/backup.log`). |

Las credenciales de MySQL se leen del `.env` de `PROJECT_DIR`; **no** se pasan por CLI ni se imprimen.

## Prueba manual

```bash
# Dar permiso de ejecución (una sola vez)
chmod +x /home/ec2-user/onlyspace/scripts/backup.sh

# Ejecutar
S3_BUCKET=<nombre-del-bucket> /home/ec2-user/onlyspace/scripts/backup.sh
```

El código de salida es `0` en éxito y `!= 0` en fallo (mysqldump o upload). Revisa el log:

```bash
tail -n 20 /var/log/onlyspace-backup.log
```

## Agendado diario con cron

Editar el crontab del usuario que tiene acceso a Docker (por ejemplo `ec2-user`):

```bash
crontab -e
```

Agregar una línea para correr todos los días a las 03:00 (hora del servidor). Sustituye
`<nombre-del-bucket>` por el valor real:

```cron
0 3 * * * S3_BUCKET=<nombre-del-bucket> /home/ec2-user/onlyspace/scripts/backup.sh >> /var/log/onlyspace-backup.log 2>&1
```

Verificar que quedó agendado:

```bash
crontab -l
```

> Nota: el script ya escribe su propio log con timestamps; el `>> ... 2>&1` de la línea de
> cron captura además cualquier salida inesperada para diagnóstico.

## Restauración (disaster recovery)

Los objetos quedan en `s3://<bucket>/backups/<YYYY-MM-DD_HHMMSS>.sql.gz`.

1. Listar y descargar el dump deseado:

   ```bash
   aws s3 ls s3://<nombre-del-bucket>/backups/
   aws s3 cp s3://<nombre-del-bucket>/backups/<archivo>.sql.gz /tmp/restore.sql.gz
   ```

2. Restaurar dentro del contenedor MySQL (descomprime y canaliza el SQL a `mysql`).
   `MYSQL_DATABASE` y `MYSQL_ROOT_PASSWORD` deben coincidir con los del `.env`:

   ```bash
   cd /home/ec2-user/onlyspace

   # Cargar solo las variables necesarias del .env
   source <(grep -E '^[[:space:]]*(MYSQL_ROOT_PASSWORD|MYSQL_DATABASE)=' .env)

   gunzip -c /tmp/restore.sql.gz \
     | docker compose -f docker-compose.prod.yml exec -T \
         -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
         mysql \
         mysql --user=root "$MYSQL_DATABASE"
   ```

3. Verificar que los datos volvieron (por ejemplo, contar filas de una tabla conocida) y
   borrar el archivo temporal:

   ```bash
   rm -f /tmp/restore.sql.gz
   ```

> Para una prueba de recuperación completa (tarea 6.5), restaurar sobre una base MySQL limpia
> y confirmar que la aplicación arranca contra los datos restaurados.
