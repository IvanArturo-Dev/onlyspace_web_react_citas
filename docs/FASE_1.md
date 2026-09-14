# Fase 1: Backend Base

## Objetivo
Establecer infraestructura backend funcional con PostgreSQL, Redis, autenticación y CRUD básico.

## Requisitos Previos
- Node.js 20+ LTS
- PostgreSQL 15+ (local o remoto)
- Redis 7+ (local o remoto)

## Paso 1: Instalar Dependencias

```bash
cd backend
npm install
```

## Paso 2: Configurar Base de Datos

### Opción A: Usando Docker (Recomendado)

```bash
# Crear archivo .env
cp .env.example .env

# Editar .env con tus configuraciones
# Levantar contenedores
docker compose up -d
```

### Opción B: Base de datos local

1. Instalar PostgreSQL 15+
2. Crear base de datos:

```sql
CREATE DATABASE citas;
CREATE USER postgres WITH PASSWORD 'postgres';
GRANT ALL PRIVILEGES ON DATABASE citas TO postgres;
```

3. Actualizar `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/citas?schema=public"
```

## Paso 3: Instalar Prisma CLI

```bash
npm install prisma --save-dev
```

## Paso 4: Generar Migraciones Iniciales

```bash
# Generar cliente de Prisma
npx prisma generate

# Crear migración inicial
npx prisma migrate dev --name init
```

## Paso 5: Ejecutar Migraciones

```bash
npx prisma migrate deploy
```

## Paso 6: Seed Data Inicial

```bash
npx prisma db seed
```

## Paso 7: Iniciar Servidor

```bash
npm run dev
```

El servidor estará disponible en `http://localhost:3000`

## Endpoints Disponibles

### Health Check
```
GET /health
```

### API Versioned
```
GET /v1/health
```

## Configuración de Variables de Entorno

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
LOG_LEVEL=info
```

## Estructura del Proyecto

```
backend/
├── src/
│   ├── config/      # Configuración
│   ├── database/    # Prisma client
│   ├── models/      # Modelos de dominio
│   ├── routes/      # Endpoints API
│   ├── services/    # Lógica de negocio
│   ├── controllers/ # Handlers HTTP
│   ├── middleware/  # Middleware Express
│   ├── utils/       # Utilidades
│   └── types/       # Types TypeScript
├── prisma/
│   └── schema.prisma
├── tests/           # Tests
└── docker-compose.yml
```

## Pruebas

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Coverage
npm run test:coverage
```

## Validación de Build

```bash
# Build
npm run build

# Start production
npm start
```

## Linting

```bash
# Lint
npm run lint

# Lint fix
npm run lint:fix
```

## Troubleshooting

### Error: PRISMA_SCHEMA_NOT_FOUND
Asegúrate de que `prisma/schema.prisma` existe y está en la ruta correcta.

### Error: DATABASE_CONNECTION_REFUSED
Verifica que PostgreSQL esté corriendo y la `DATABASE_URL` sea correcta.

### Error: REDIS_CONNECTION_REFUSED
Verifica que Redis esté corriendo y la `REDIS_URL` sea correcta.

### Error: JWT_SECRET_NOT_FOUND
Verifica que `JWT_SECRET` esté definido en `.env`.

## Siguientes Pasos

- FASE 2: Autenticación Completa
- FASE 3: Gestión de Clientes
- FASE 4: Gestión de Servicios

---

**Nota:** Esta guía es para desarrollo local. Para producción, sigue las instrucciones en `docs/deployment.md`.
