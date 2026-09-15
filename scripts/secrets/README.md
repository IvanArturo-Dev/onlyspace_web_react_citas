# Secretos de produccion (AWS SSM Parameter Store)

Los secretos de produccion de OnlySpace viven en **AWS SSM Parameter Store** como
parametros cifrados (`SecureString`) bajo el prefijo `/onlyspace/<KEY>`, no en GitHub.

Este directorio contiene la plantilla y el archivo local (secreto, NO versionado)
que alimenta al cargador `scripts/load-secrets-to-ssm.sh`.

## Que se versiona y que no

- `prod.env.example` -> SI se versiona (solo placeholders, sin secretos).
- `prod.env` -> **NO** se versiona (lo ignora `scripts/secrets/.gitignore`).

## Como cargar los secretos en SSM

1. Crea tu archivo local a partir de la plantilla:

   ```bash
   cp scripts/secrets/prod.env.example scripts/secrets/prod.env
   ```

2. Edita `scripts/secrets/prod.env` y pon los valores REALES de produccion.
   Formato: `KEY=VALUE` (una por linea, sin comillas). Los comentarios (`#`) y
   las lineas vacias se ignoran. Un `VALUE` puede contener `=` (p. ej. una URL
   de conexion); solo se separa por el primer `=`.

3. Ejecuta el cargador (usa el perfil `onlyspace` y la region `mx-central-1` por
   defecto):

   ```bash
   ./scripts/load-secrets-to-ssm.sh
   ```

   Puedes sobreescribir la configuracion con variables de entorno:

   ```bash
   ENV_FILE=./secrets/prod.env AWS_PROFILE=onlyspace AWS_REGION=mx-central-1 \
     SSM_PREFIX=/onlyspace ./scripts/load-secrets-to-ssm.sh
   ```

El script solo imprime el nombre del parametro que sube (`Subiendo /onlyspace/JWT_SECRET ...`),
nunca el valor.

## Nota

Las variables `VITE_*` del frontend **no** van aqui: son publicas (se incrustan en
el bundle) y se configuran como GitHub Secrets para el build. Ver `docs/deployment/README.md`.
