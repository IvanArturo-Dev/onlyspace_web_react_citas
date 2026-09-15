# syntax=docker/dockerfile:1

# ---------- Stage 1: builder ----------
# Compila TypeScript y genera el cliente de Prisma con TODAS las dependencias.
FROM node:20-alpine AS builder

# Prisma necesita openssl y libc6-compat en Alpine para su motor nativo.
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Instalar todas las dependencias (incluidas devDependencies como typescript/prisma)
COPY package*.json ./
# --legacy-peer-deps: el proyecto tiene un conflicto de peer deps en devDependencies
# (@babel/core 8 vs ts-jest que pide @babel/core 7). No afecta el runtime.
RUN npm ci --legacy-peer-deps

# Copiar fuentes y configuracion necesarias para el build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generar el cliente de Prisma y compilar TypeScript a ./dist
RUN npx prisma generate
RUN npm run build

# ---------- Stage 2: runtime ----------
# Imagen final ligera con solo dependencias de produccion.
FROM node:20-alpine AS runtime

# Prisma necesita openssl y libc6-compat en Alpine tambien en runtime.
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production

WORKDIR /app

# Instalar solo dependencias de produccion
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copiar artefactos compilados desde el builder
COPY --from=builder /app/dist ./dist

# Copiar el esquema y las migraciones de Prisma (necesarias en runtime para migrate deploy)
COPY --from=builder /app/prisma ./prisma

# Copiar el cliente de Prisma generado (motor + cliente) desde el builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# El backend escucha en el puerto 3000
EXPOSE 3000

# Iniciar la aplicacion. Las migraciones las orquesta docker-compose.prod.yml, no el CMD.
CMD ["node", "dist/index.js"]
