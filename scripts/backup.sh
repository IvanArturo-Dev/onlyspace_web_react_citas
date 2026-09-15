#!/usr/bin/env bash
#
# backup.sh - Respaldo diario de la base de datos MySQL de OnlySpace a S3.
#
# Que hace:
#   1. Ejecuta mysqldump DENTRO del contenedor MySQL (Docker Compose).
#   2. Comprime el volcado con gzip a un archivo temporal con fecha UTC.
#   3. Sube el archivo a s3://$S3_BUCKET/backups/<fecha>.sql.gz con el AWS CLI.
#   4. Registra exito o fallo en un log (con timestamp) y sale con codigo != 0 si algo falla.
#   5. Borra el archivo temporal local tras subirlo.
#
# La RETENCION la maneja S3: el bucket tiene una regla de ciclo de vida que borra
# los objetos con prefijo "backups/" a los 14 dias. Este script SOLO sube.
#
# NO imprime secretos en stdout ni en el log.
#
# Uso (manual):
#   S3_BUCKET=<nombre-del-bucket> ./backup.sh
#
# Agendado (cron) y restauracion: ver scripts/README-backup.md
#
# Requirements cubiertos: 5.1 (respaldo diario), 5.4 (registro consultable de exito/fallo).

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuracion (variables de entorno con defaults sensatos)
# ------------------------------------------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-/home/ec2-user/onlyspace}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
# S3_BUCKET es OBLIGATORIA (no tiene default).
S3_BUCKET="${S3_BUCKET:-}"

# Log: usa el de sistema si es escribible; si no, cae al del proyecto.
DEFAULT_LOG="/var/log/onlyspace-backup.log"
LOG_FILE="${LOG_FILE:-$DEFAULT_LOG}"

# ------------------------------------------------------------------------------
# Utilidades
# ------------------------------------------------------------------------------

# Escribe una linea con timestamp UTC en el log y (para info/errores) en stderr.
# NUNCA se le deben pasar secretos.
log() {
  local level="$1"; shift
  local ts
  ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local line="[$ts] [$level] $*"
  # Intenta escribir al log; si no se puede (permisos), no aborta el script por eso.
  if ! printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null; then
    # Fallback al log del proyecto si el log de sistema no es escribible.
    printf '%s\n' "$line" >> "$PROJECT_DIR/backup.log" 2>/dev/null || true
  fi
  # Eco a stderr para visibilidad en ejecucion manual (sin secretos).
  printf '%s\n' "$line" >&2
}

# Se ejecuta al fallar cualquier comando (por set -e) o al terminar.
TMP_FILE=""
cleanup() {
  # Borra el archivo temporal si existe.
  if [[ -n "$TMP_FILE" && -f "$TMP_FILE" ]]; then
    rm -f "$TMP_FILE" || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------------------
# Validaciones
# ------------------------------------------------------------------------------
if [[ -z "$S3_BUCKET" ]]; then
  log "ERROR" "La variable S3_BUCKET es obligatoria y no esta definida."
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  log "ERROR" "PROJECT_DIR no existe: $PROJECT_DIR"
  exit 1
fi

ENV_FILE="$PROJECT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR" "No se encontro el archivo .env en $PROJECT_DIR"
  exit 1
fi

# ------------------------------------------------------------------------------
# Cargar credenciales de MySQL desde el .env (sin imprimirlas)
# ------------------------------------------------------------------------------
# Se parsean SOLO las variables MYSQL_* necesarias, en lugar de hacer "source" del
# .env completo (que podria contener valores con caracteres problematicos y muchos
# otros secretos). Se ignoran comentarios y se recorta el espacio alrededor del '='.
read_env_var() {
  local key="$1"
  # Toma la ULTIMA definicion no comentada de la clave. Quita comillas envolventes.
  local val
  val="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1 | sed -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//")"
  # Quita comillas dobles o simples envolventes si las hay.
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

MYSQL_ROOT_PASSWORD="$(read_env_var MYSQL_ROOT_PASSWORD)"
MYSQL_DATABASE="$(read_env_var MYSQL_DATABASE)"

if [[ -z "$MYSQL_ROOT_PASSWORD" ]]; then
  log "ERROR" "No se pudo leer MYSQL_ROOT_PASSWORD desde el .env."
  exit 1
fi
if [[ -z "$MYSQL_DATABASE" ]]; then
  log "ERROR" "No se pudo leer MYSQL_DATABASE desde el .env."
  exit 1
fi

# ------------------------------------------------------------------------------
# Generar el respaldo
# ------------------------------------------------------------------------------
STAMP="$(date -u '+%Y-%m-%d_%H%M%S')"
OBJECT_KEY="backups/${STAMP}.sql.gz"
TMP_FILE="$(mktemp "/tmp/onlyspace-backup-${STAMP}.sql.gz.XXXXXX")"

log "INFO" "Iniciando respaldo de la base '$MYSQL_DATABASE' -> s3://$S3_BUCKET/$OBJECT_KEY"

cd "$PROJECT_DIR"

# mysqldump se ejecuta dentro del contenedor mysql. La contrasena se pasa via la
# variable de entorno MYSQL_PWD del contenedor (con -e) para que NO aparezca en la
# lista de procesos ni en el log. -T desactiva el pseudo-TTY (necesario en cron).
# El pipe a gzip corre en el host; si mysqldump falla, pipefail hace fallar el pipe.
if docker compose -f "$COMPOSE_FILE" exec -T \
      -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
      "$MYSQL_SERVICE" \
      mysqldump --user=root --single-transaction --quick --routines --triggers --events "$MYSQL_DATABASE" \
      | gzip -c > "$TMP_FILE"; then
  log "INFO" "mysqldump completado. Tamano del archivo: $(du -h "$TMP_FILE" 2>/dev/null | cut -f1)"
else
  log "ERROR" "Fallo el mysqldump de la base '$MYSQL_DATABASE'. No se subira nada a S3."
  exit 1
fi

# Validacion basica: el archivo no debe estar vacio.
if [[ ! -s "$TMP_FILE" ]]; then
  log "ERROR" "El archivo de respaldo esta vacio; se aborta la subida."
  exit 1
fi

# ------------------------------------------------------------------------------
# Subir a S3
# ------------------------------------------------------------------------------
if aws s3 cp "$TMP_FILE" "s3://$S3_BUCKET/$OBJECT_KEY" --only-show-errors; then
  log "INFO" "Respaldo subido correctamente a s3://$S3_BUCKET/$OBJECT_KEY"
else
  log "ERROR" "Fallo la subida a s3://$S3_BUCKET/$OBJECT_KEY"
  exit 1
fi

# El archivo temporal se borra en el trap EXIT (cleanup).
log "INFO" "Respaldo finalizado con exito."
exit 0
