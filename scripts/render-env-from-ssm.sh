#!/usr/bin/env bash
#
# render-env-from-ssm.sh - Genera el archivo .env de produccion de OnlySpace en
# la EC2 leyendo los secretos desde AWS SSM Parameter Store (SecureString) bajo
# el prefijo /onlyspace/.
#
# Que hace:
#   1. Lee TODOS los parametros bajo "$SSM_PREFIX/" con desencriptado:
#        aws ssm get-parameters-by-path --path "$SSM_PREFIX/" --with-decryption \
#            --recursive --region "$AWS_REGION" ...
#      paginando con NextToken hasta agotar los resultados.
#   2. Por cada parametro deriva KEY = lo que va despues de "$SSM_PREFIX/" y
#      escribe una linea KEY=VALUE en OUT_FILE.
#   3. Escribe el archivo con umask 077 + chmod 600 y NO imprime los valores:
#      solo el nombre de las KEYs y un conteo final.
#
# NO usa credenciales estaticas: la EC2 lee SSM mediante su IAM instance profile
# (tarea 7.1), que concede ssm:GetParametersByPath + kms:Decrypt sobre /onlyspace/*.
#
# Uso (en la EC2, dentro del directorio del proyecto, ANTES de docker compose up):
#   chmod +x scripts/render-env-from-ssm.sh
#   SSM_PREFIX=/onlyspace AWS_REGION=mx-central-1 \
#     OUT_FILE=/home/ec2-user/onlyspace/.env \
#     ./scripts/render-env-from-ssm.sh
#   docker compose -f docker-compose.prod.yml up -d --build
#
# Configuracion (variables de entorno con defaults):
#   SSM_PREFIX   prefijo de los parametros SSM    (default: /onlyspace)
#   AWS_REGION   region de AWS de la EC2          (default: mx-central-1)
#   OUT_FILE     ruta del .env a generar          (default: /home/ec2-user/onlyspace/.env)
#
# Requirements cubiertos: 11.3 (el servidor lee SSM y genera el .env local),
#                         11.4/11.5 (los secretos de app viven en SSM, no en
#                         GitHub, y no se imprimen en logs).

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuracion
# ------------------------------------------------------------------------------
SSM_PREFIX="${SSM_PREFIX:-/onlyspace}"
AWS_REGION="${AWS_REGION:-mx-central-1}"
OUT_FILE="${OUT_FILE:-/home/ec2-user/onlyspace/.env}"

# Normaliza el prefijo para que empiece con '/' y NO termine con '/'.
[[ "$SSM_PREFIX" == /* ]] || SSM_PREFIX="/$SSM_PREFIX"
SSM_PREFIX="${SSM_PREFIX%/}"

# ------------------------------------------------------------------------------
# Validaciones
# ------------------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: No se encontro el AWS CLI en el PATH de la EC2." >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# Descarga de parametros desde SSM (con paginacion)
# ------------------------------------------------------------------------------
echo "Generando .env desde SSM Parameter Store"
echo "  Region  : $AWS_REGION"
echo "  Prefijo : $SSM_PREFIX/"
echo "  Salida  : $OUT_FILE"
echo

# Se acumulan las lineas "Name<TAB>Value" en un archivo temporal seguro (umask 077)
# para no pasar los valores por variables/argumentos ni imprimirlos en logs.
umask 077
tmp_params="$(mktemp)"
tmp_env="$(mktemp)"
trap 'rm -f "$tmp_params" "$tmp_env"' EXIT

# Paginacion: la AWS CLI pagina automaticamente get-parameters-by-path y sigue el
# NextToken internamente cuando NO se fija --page-size/--max-items, de modo que una
# sola invocacion ya devuelve TODOS los parametros del path. --query
# 'Parameters[].[Name,Value]' con --output text emite una fila por parametro con
# Name y Value separados por TAB (aplanados a traves de todas las paginas).
aws ssm get-parameters-by-path \
  --path "$SSM_PREFIX/" \
  --with-decryption \
  --recursive \
  --region "$AWS_REGION" \
  --query 'Parameters[].[Name,Value]' \
  --output text > "$tmp_params"

# ------------------------------------------------------------------------------
# Genera el .env (KEY=VALUE por linea), sin imprimir valores
# ------------------------------------------------------------------------------
prefix_slash="$SSM_PREFIX/"
count=0

# IFS=TAB para separar Name y Value; read -r no interpreta backslashes.
while IFS=$'\t' read -r name value; do
  [[ -z "$name" ]] && continue

  # KEY = lo que va despues del prefijo. Si por alguna razon el Name no lleva el
  # prefijo esperado, se usa el basename como salvaguarda.
  if [[ "$name" == "$prefix_slash"* ]]; then
    key="${name#"$prefix_slash"}"
  else
    key="${name##*/}"
  fi

  # Con --recursive podrian venir sub-rutas (a/b). El .env necesita una KEY plana,
  # asi que nos quedamos con el ultimo segmento.
  key="${key##*/}"

  [[ -z "$key" ]] && continue

  # Escribe KEY=VALUE con printf %s para no interpretar caracteres especiales.
  printf '%s=%s\n' "$key" "$value" >> "$tmp_env"
  count=$((count + 1))

  # Solo el nombre de la KEY en el log, nunca el valor.
  echo "  + $key"
done < "$tmp_params"

if [[ "$count" -eq 0 ]]; then
  echo "ERROR: No se encontraron parametros bajo $SSM_PREFIX/ en la region $AWS_REGION." >&2
  echo "       Verifica que la tarea de carga (load-secrets-to-ssm.sh) haya corrido y" >&2
  echo "       que el IAM role de la EC2 permita ssm:GetParametersByPath + kms:Decrypt." >&2
  exit 1
fi

# Mueve el .env generado a su destino con permisos 600.
mkdir -p "$(dirname "$OUT_FILE")"
mv "$tmp_env" "$OUT_FILE"
chmod 600 "$OUT_FILE"

echo
echo "Listo. Se escribieron $count variable(s) en $OUT_FILE (valores no mostrados)."
