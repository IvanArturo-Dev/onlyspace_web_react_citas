#!/usr/bin/env bash
#
# load-secrets-to-ssm.sh - Carga los secretos de produccion de OnlySpace en
# AWS SSM Parameter Store como parametros cifrados (SecureString) bajo /onlyspace/.
#
# Que hace:
#   1. Lee un archivo local NO versionado (por defecto ./secrets/prod.env) con
#      pares KEY=VALUE (uno por linea; comentarios con '#' y lineas vacias se ignoran).
#   2. Por cada par sube el secreto a SSM:
#        aws ssm put-parameter --name /onlyspace/<KEY> --value <VALUE> \
#            --type SecureString --overwrite --profile <perfil> --region <region>
#   3. Informa cuantos parametros se subieron.
#
# NO imprime los VALUE en stdout ni en logs: solo el NOMBRE del parametro.
# NO hardcodea secretos: todos los valores vienen del archivo local.
#
# Uso:
#   1. cp scripts/secrets/prod.env.example scripts/secrets/prod.env
#   2. Edita scripts/secrets/prod.env con los secretos REALES de produccion.
#   3. ./scripts/load-secrets-to-ssm.sh
#
# Configuracion (variables de entorno con defaults):
#   AWS_PROFILE  perfil de AWS CLI            (default: onlyspace)
#   AWS_REGION   region de AWS                (default: mx-central-1)
#   SSM_PREFIX   prefijo de los parametros    (default: /onlyspace)
#   ENV_FILE     archivo local con KEY=VALUE  (default: ./secrets/prod.env)
#
# Ejemplo apuntando a otro archivo:
#   ENV_FILE=./secrets/prod.env AWS_PROFILE=onlyspace ./scripts/load-secrets-to-ssm.sh
#
# Requirements cubiertos: 11.1 (secretos en SSM como SecureString bajo /onlyspace/),
#                         11.5 (los secretos no transitan por GitHub ni quedan en logs).

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuracion
# ------------------------------------------------------------------------------
AWS_PROFILE="${AWS_PROFILE:-onlyspace}"
AWS_REGION="${AWS_REGION:-mx-central-1}"
SSM_PREFIX="${SSM_PREFIX:-/onlyspace}"
ENV_FILE="${ENV_FILE:-./secrets/prod.env}"

# Normaliza el prefijo para que empiece con '/' y NO termine con '/'.
[[ "$SSM_PREFIX" == /* ]] || SSM_PREFIX="/$SSM_PREFIX"
SSM_PREFIX="${SSM_PREFIX%/}"

# ------------------------------------------------------------------------------
# Validaciones
# ------------------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: No se encontro el AWS CLI en el PATH. Instala 'aws' y vuelve a intentar." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
ERROR: No existe el archivo de secretos: $ENV_FILE

Debes crearlo (NO se versiona) a partir de la plantilla:

  cp scripts/secrets/prod.env.example scripts/secrets/prod.env

Formato: una linea por secreto con KEY=VALUE (sin comillas).
Las lineas vacias y los comentarios (que empiezan con '#') se ignoran.
Luego vuelve a ejecutar este script (opcionalmente con ENV_FILE=<ruta>).
EOF
  exit 1
fi

# ------------------------------------------------------------------------------
# Carga de secretos
# ------------------------------------------------------------------------------
echo "Cargando secretos en SSM Parameter Store"
echo "  Perfil AWS : $AWS_PROFILE"
echo "  Region     : $AWS_REGION"
echo "  Prefijo    : $SSM_PREFIX"
echo "  Archivo    : $ENV_FILE"
echo

count=0
line_no=0

# Se lee linea por linea preservando espacios. IFS vacio + read -r evita recortes
# y no interpreta backslashes. '|| [[ -n "$line" ]]' captura la ultima linea sin
# salto de linea final.
while IFS= read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))

  # Recorta espacios/tabs iniciales para detectar comentarios y lineas vacias.
  trimmed="${line#"${line%%[![:space:]]*}"}"

  # Ignora lineas vacias y comentarios.
  [[ -z "$trimmed" ]] && continue
  [[ "$trimmed" == \#* ]] && continue

  # Debe existir al menos un '='.
  if [[ "$trimmed" != *=* ]]; then
    echo "ADVERTENCIA: linea $line_no ignorada (sin '='): no es un par KEY=VALUE." >&2
    continue
  fi

  # Separa SOLO en el primer '=' (el VALUE puede contener mas '=').
  key="${trimmed%%=*}"
  value="${trimmed#*=}"

  # Recorta espacios alrededor de la KEY (el VALUE se deja tal cual).
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  if [[ -z "$key" ]]; then
    echo "ADVERTENCIA: linea $line_no ignorada (KEY vacia)." >&2
    continue
  fi

  param_name="$SSM_PREFIX/$key"
  # NO imprimimos el value; solo el nombre del parametro.
  echo "Subiendo $param_name ..."

  aws ssm put-parameter \
    --name "$param_name" \
    --value "$value" \
    --type SecureString \
    --overwrite \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    >/dev/null

  count=$((count + 1))
done < "$ENV_FILE"

echo
echo "Listo. Se subieron $count parametro(s) a SSM bajo $SSM_PREFIX."
