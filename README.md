# Sistema Profesional de Gestión de Citas

Sistema SaaS Multi-Tenant para la gestión de citas, clientes, servicios y notificaciones.

---

## 📋 Índice

- [Visión General](#-visión-general)
- [Características](#-características)
- [Arquitectura](#-arquitectura)
- [Stack Tecnológico](#-stack-tecnológico)
- [Requisitos](#-requisitos)
- [Instalación](#-instalación)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Desarrollo](#-desarrollo)
- [Testing](#-testing)
- [CI/CD](#-cicd)
- [Despliegue](#-despliegue)
- [Documentación](#-documentación)
- [Roadmap](#-roadmap)

---

## 🎯 Visión General

Sistema profesional de gestión de citas multiplataforma diseñado para:

- **Negocios:** Gestionar sus citas, clientes y servicios
- **Profesionales:** Administrar su agenda y disponibilidad
- **Recepción:** Crear y gestionar clientes y citas
- **Administradores:** Configurar el sistema y consultar reportes

**Multiplataforma:** Android, iOS, Tablets  
**Modelo:** SaaS Multi-Tenant  
**Estado:** Diseño Arquitectónico (Fase 0)

---

## ✨ Características

### Módulos Principales

| Módulo | Descripción |
|--------|-------------|
| **Autenticación** | Login, OAuth (Google/Apple), Refresh tokens |
| **Clientes** | CRUD, búsqueda, historial de citas |
| **Servicios** | CRUD, categorías, asignación a profesionales |
| **Calendario** | Vista día/semana/mes, gestión de citas |
| **Disponibilidad** | Horarios, bloqueos, validación de conflictos |
| **Notificaciones** | Push, Email, SMS/WhatsApp (futuro) |
| **Dashboard** | KPIs, estadísticas, reportes |
| **Reportes** | Exportación PDF/CSV, KPIs personalizados |

### Características Técnicas

- ✅ Multi-tenant con aislamiento de datos
- ✅ Modelo RBAC (Admin, Profesional, Recepción)
- ✅ Offline-first con sincronización inteligente
- ✅ Diseño responsivo (teléfono, tablet, desktop)
- ✅ Seguridad OWASP Top 10
- ✅ Observabilidad completa (logs, metrics, tracing)
- ✅ CI/CD automatizado
- ✅ Testing > 80% cobertura

---

## 🏗️ Arquitectura

### Arquitectura General

```
┌────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Mobile App  │  │  Mobile App  │  │   Web Admin  │     │
│  │   (iOS/Android)││  (Tablet)    │  │  (Responsive)│     │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘     │
└──────────┼─────────────────┼─────────────────┼─────────────┘
           │                 │                 │
           └─────────────────┴─────────────────┘
                             │
┌────────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                     │
│  Auth | Rate Limit | Request Routing | SSL Termination   │
└────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                      │
│  Auth | Customer | Service | Calendar | Notification     │
└────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────────────────────────────────────┐
│                       DATA LAYER                           │
│  PostgreSQL | Redis Cache | S3/CDN | Elasticsearch       │
└────────────────────────────────────────────────────────────┘
```

### Patrones Arquitectónicos

- **Backend:** Clean Architecture + Hexagonal Architecture
- **Frontend:** Clean Architecture + BLoC Pattern
- **Base de Datos:** Shared Database, Row-Level Security
- **Notificaciones:** Queue-based with BullMQ
- **Caching:** Redis con invalidación inteligente

### Ver más detalles en:
- [Arquitectura Completa](./ARCHITECTURE.md)

---

## 💻 Stack Tecnológico

### Frontend (React Native)
| Componente | Tecnología |
|------------|------------|
| Framework | React Native 0.74+ |
| Lenguaje | TypeScript 5.x |
| UI | Tamagui + Native Base |
| Navegación | React Navigation 7 |
| Estado | Zustand + React Query |
| Animaciones | Reanimated 3 |

### Backend (Node.js)
| Componente | Tecnología |
|------------|------------|
| Framework | Node.js 20+ LTS |
| Lenguaje | TypeScript 5.x |
| API | Express.js + Zod |
| ORM | Prisma 5.x |
| Base de Datos | PostgreSQL 15+ |
| Cache | Redis 7.x |
| Colas | BullMQ + Redis |

### DevOps y Cloud
| Componente | Tecnología |
|------------|------------|
| Cloud | AWS (us-east-1) |
| Container | Docker + ECS Fargate |
| CI/CD | GitHub Actions |
| Monitoring | AWS CloudWatch + Datadog |
| Logging | Elasticsearch + Kibana |

### Notificaciones
| Componente | Tecnología |
|------------|------------|
| Push iOS | Apple Push Notification Service |
| Push Android | Firebase Cloud Messaging |
| Email | AWS SES |
| SMS | Twilio (futuro) |

### Ver más detalles en:
- [Stack Tecnológico](./ARCHITECTURE.md#5-stack-tecnológico)

---

## 📋 Requisitos

### Desarrollo

| Herramienta | Versión |
|-------------|---------|
| Node.js | 20+ LTS |
| npm | 10+ |
| Docker | 24+ |
| Docker Compose | 2.20+ |
| pnpm | 8+ (recomendado) |
| Git | 2.40+ |

### Entorno

| Variable | Descripción |
|----------|-------------|
| `NODE_ENV` | development, production |
| `PORT` | puerto del servidor (default: 3000) |
| `DATABASE_URL` | conexión PostgreSQL |
| `REDIS_URL` | conexión Redis |
| `JWT_SECRET` | secret para JWT |
| `JWT_EXPIRES_IN` | expiración access token |
| `REFRESH_TOKEN_EXPIRES_IN` | expiración refresh token |

### Ver más detalles en:
- [Configuración](./docs/configuration.md)

---

## 🚀 Instalación

### 1. Clonar el Repositorio

```bash
git clone <repository-url>
cd citas
```

### 2. Instalar Dependencias

```bash
# Backend
cd backend
pnpm install

# Frontend
cd ../frontend
pnpm install
```

### 3. Configurar Variables de Entorno

```bash
# Backend
cp .env.example backend/.env
# Editar backend/.env con tus configuraciones

# Frontend
cp .env.example frontend/.env
# Editar frontend/.env con tus configuraciones
```

### 4. Levantar Base de Datos

```bash
cd backend
docker-compose up -d
```

### 5. Ejecutar Migraciones

```bash
cd backend
pnpm db:migrate:deploy
pnpm db:seed
```

### 6. Iniciar Desarrollo

```bash
# Backend
cd backend
pnpm dev

# Frontend
cd frontend
pnpm start
```

### Ver más detalles en:
- [Guía de Instalación](./docs/installation.md)

---

## 📁 Estructura del Proyecto

```
citas/
├── backend/                 # Backend API
│   ├── src/
│   │   ├── config/         # Configuración
│   │   ├── database/       # Base de datos
│   │   ├── models/         # Modelos de dominio
│   │   ├── routes/         # Endpoints API
│   │   ├── services/       # Lógica de negocio
│   │   ├── controllers/    # Handlers HTTP
│   │   ├── middleware/     # Middleware Express
│   │   ├── utils/          # Utilidades
│   │   ├── hooks/          # Prisma hooks
│   │   ├── queues/         # Job queues
│   │   └── types/          # Types TypeScript
│   ├── migrations/         # Migraciones Prisma
│   ├── tests/              # Integration tests
│   └── docker-compose.yml  # Docker services
│
├── frontend/               # App móvil React Native
│   ├── src/
│   │   ├── components/     # Componentes reutilizables
│   │   ├── screens/        # Pantallas de la app
│   │   ├── navigation/     # Navegación
│   │   ├── store/          # Estado global
│   │   ├── services/       # API services
│   │   ├── utils/          # Utilidades
│   │   ├── hooks/          # Custom hooks
│   │   ├── theme/          # Design system
│   │   └── types/          # Types TypeScript
│   ├── __tests__/          # E2E tests
│   ├── android/            # Android build
│   └── ios/                # iOS build
│
├── docs/                   # Documentación
├── ARCHITECTURE.md         # Arquitectura completa
├── ROADMAP.md             # Roadmap de desarrollo
└── README.md              # Este archivo
```

### Ver más detalles en:
- [Estructura de Carpetas](./ARCHITECTURE.md#17-estructura-de-carpetas)

---

## 🧪 Desarrollo

### Backend

```bash
cd backend

# Desarrollo
pnpm dev

# Tests
pnpm test
pnpm test:unit
pnpm test:integration

# Linting
pnpm lint
pnpm lint:fix

# Build
pnpm build
```

### Frontend

```bash
cd frontend

# Desarrollo
pnpm start

# iOS
pnpm ios

# Android
pnpm android

# Tests
pnpm test

# Linting
pnpm lint
pnpm lint:fix
```

### Ver más detalles en:
- [Guía de Desarrollo](./docs/development.md)

---

## 🧪 Testing

### Estrategia de Testing

```
         /\
        /  \      E2E Tests (10%)
       /----\
      /      \    Integration Tests (20%)
     /--------\
    /          \  Unit Tests (70%)
   /------------\
```

### Ejecutar Tests

```bash
# Backend
cd backend
pnpm test:unit          # Unit tests
pnpm test:integration   # Integration tests
pnpm test:coverage      # Coverage report

# Frontend
cd frontend
pnpm test               # Unit tests
pnpm test:e2e          # E2E tests (Detox)
```

### Ver más detalles en:
- [Guía de Testing](./docs/testing.md)

---

## 🔄 CI/CD

### Pipeline de CI

```yaml
on: [push, pull_request]
jobs:
  - lint
  - test
  - build
  - security-scan
```

### Pipeline de CD

```yaml
on: [main]
jobs:
  - build-docker
  - push-ecr
  - deploy-ecs
```

### Ver más detalles en:
- [CI/CD](./docs/cicd.md)

---

## ☁️ Despliegue

### Despliegue en AWS

1. Configurar AWS CLI
2. Ejecutar pipeline de CI/CD
3. Verificar despliegue
4. Actualizar DNS

### Ver más detalles en:
- [Guía de Despliegue](./docs/deployment.md)

---

## 📚 Documentación

| Documento | Descripción |
|-----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arquitectura completa |
| [ROADMAP.md](./ROADMAP.md) | Roadmap de implementación |
| [API.md](./docs/api.md) | Documentación de API |
| [DATABASE.md](./docs/database.md) | Esquema de base de datos |
| [SECURITY.md](./docs/security.md) | Políticas de seguridad |
| [DEPLOYMENT.md](./docs/deployment.md) | Guía de despliegue |

---

## 🗺️ Roadmap

| Fase | Objetivo | Estado |
|------|----------|--------|
| 0 | Análisis | ✅ |
| 1 | Backend Base | 🔄 |
| 2 | Autenticación | ⏳ |
| 3 | Clientes | ⏳ |
| 4 | Servicios | ⏳ |
| 5 | Calendario | ⏳ |
| 6-8 | Frontend | ⏳ |
| 9-10 | Dashboard + Notificaciones | ⏳ |
| 11-12 | QA + Seguridad | ⏳ |
| 13 | Release | ⏳ |

### Ver roadmap completo:
- [ROADMAP.md](./ROADMAP.md)

---

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver [LICENSE](./LICENSE) para más detalles.

---

## 👥 Equipo

- Arquitecto de Software
- Ingeniero Senior React Native
- Ingeniero Backend Senior
- Diseñador UX/UI Senior
- Ingeniero de Bases de Datos
- Ingeniero DevOps/Cloud
- Ingeniero de Seguridad
- Ingeniero QA/Automation
- Especialista en Rendimiento y Escalabilidad
- Product Manager

---

**Nota:** Este documento está en constante evolución. Para preguntas o sugerencias, por favor abrir un issue.

---

**Fin del README**
