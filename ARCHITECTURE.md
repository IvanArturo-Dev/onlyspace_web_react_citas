# Documento de Arquitectura del Sistema
## Sistema Profesional de Gestión de Citas

---

**Versión:** 1.0.0  
**Fecha:** Agosto 2026  
**Estado:** Diseño Arquitectónico Completo  
**Preparado por:** Equipo Senior Multidisciplinario

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Requerimientos Funcionales](#2-requerimientos-funcionales)
3. [Requerimientos No Funcionales](#3-requerimientos-no-funcionales)
4. [Arquitectura Propuesta](#4-arquitectura-propuesta)
5. [Stack Tecnológico](#5-stack-tecnológico)
6. [Arquitectura React Native](#6-arquitectura-react-native)
7. [Arquitectura Backend](#7-arquitectura-backend)
8. [Arquitectura de Base de Datos](#8-arquitectura-de-base-de-datos)
9. [Modelo Multi-Tenant](#9-modelo-multi-tenant)
10. [Sistema de Autenticación](#10-sistema-de-autenticación)
11. [Sistema de Autorización RBAC](#11-sistema-de-autorización-rbac)
12. [Sistema de Notificaciones](#12-sistema-de-notificaciones)
13. [Estrategia de Seguridad](#13-estrategia-de-seguridad)
14. [Observabilidad](#14-observabilidad)
15. [Estrategia de Pruebas](#15-estrategia-de-pruebas)
16. [CI/CD](#16-cicd)
17. [Estructura de Carpetas](#17-estructura-de-carpetas)
18. [Diagrama de Componentes](#18-diagrama-de-componentes)
19. [Riesgos Técnicos](#19-riesgos-técnicos)
20. [Roadmap de Implementación](#20-roadmap-de-implementación)
21. [Criterios de Aceptación](#21-criterios-de-aceptación)

---
## 1. Resumen Ejecutivo

### 1.1 Visión del Proyecto

Sistema profesional de gestión de citas multiplataforma (SaaS Multi-Tenant) para negocios y profesionales que necesitan administrar sus citas, clientes, servicios, horarios y notificaciones de manera eficiente.

### 1.2 Objetivos Principales

- **Multiplataforma:** Funcionar en Android, iOS, tablets y diferentes tamaños de pantalla.
- **SaaS Multi-Tenant:** Aislamiento completo de datos entre negocios.
- **UX/UI Profesional:** Interfaz moderna, limpia, rápida y consistente.
- **Escalabilidad:** Soportar miles de usuarios y múltiples negocios concurrentes.
- **Production-Ready:** Código testado, documentado y listo para despliegue.

### 1.3 Alcance del Sistema

- Gestión de clientes
- Gestión de servicios
- Calendario interactivo
- Disponibilidad dinámica
- Notificaciones push y email
- Dashboard con KPIs
- Reportes y estadísticas
- Módulo administrativo

---

## 2. Requerimientos Funcionales

### 2.1 Requerimientos de Autenticación y Autorización
- RF-001: Sistema de login con email y contraseña
- RF-002: Autenticación con OAuth (Google, Apple)
- RF-003: Gestión de sesiones con refresh tokens
- RF-004: Cambio de contraseña y recuperación
- RF-005: Sistema RBAC (Administrador, Empleado, Recepción)

### 2.2 Requerimientos de Clientes
- RF-010: CRUD completo de clientes
- RF-011: Búsqueda y filtros avanzados
- RF-012: Historial de citas por cliente
- RF-013: Etiquetas personalizadas
- RF-014: Campos personalizables

### 2.3 Requerimientos de Servicios
- RF-020: CRUD completo de servicios
- RF-021: Categorías de servicios
- RF-022: Asignación a profesionales
- RF-023: Imágenes y descripciones
- RF-024: Duración, precio y tiempos adicionales

### 2.4 Requerimientos de Calendario
- RF-030: Vista día/semana/mes
- RF-031: Crear, modificar y cancelar citas
- RF-032: Confirmación y marcar completadas
- RF-033: Detección de conflictos
- RF-034: Múltiples profesionales

### 2.5 Requerimientos de Disponibilidad
- RF-040: Horario del negocio
- RF-041: Horario del profesional
- RF-042: Bloqueos y vacaciones
- RF-043: Tiempos de preparación
- RF-044: Validación en frontend y backend

### 2.6 Requerimientos de Notificaciones
- RF-050: Push notifications
- RF-051: Email notifications
- RF-052: Configuración de tiempos
- RF-053: Plantillas personalizables
- RF-054: Historial de notificaciones

### 2.7 Requerimientos de Dashboard
- RF-060: Citas del día y próximas
- RF-061: Estadísticas de ocupación
- RF-062: Ingresos y KPIs
- RF-063: Servicios más utilizados
- RF-064: Exportación de reportes

### 2.8 Requerimientos Administrativos
- RF-070: Gestión de negocios
- RF-071: Configuración general
- RF-072: Audit log
- RF-073: Gestión de usuarios
- RF-074: Copias de seguridad

---

## 3. Requerimientos No Funcionales

### 3.1 Rendimiento
- RNF-001: Navegación fluida (< 100ms transiciones)
- RNF-002: API < 200ms p95
- RNF-003: Dashboard < 1s carga inicial
- RNF-004: Soporte 1000+ citas concurrentes
- RNF-005: Caché inteligente en frontend

### 3.2 Disponibilidad
- RNF-010: 99.9% uptime objetivo
- RNF-011: Failover automático
- RNF-012: Backup diario
- RNF-013: Disaster recovery < 4 horas

### 3.3 Seguridad
- RNF-020: OWASP Top 10 compliance
- RNF-021: Cifrado AES-256 datos sensibles
- RNF-022: Rate limiting en todos los endpoints
- RNF-023: Secrets management
- RNF-024: Audit logging completo

### 3.4 Escalabilidad
- RNF-030: Horizontal scaling backend
- RNF-031: Database read replicas
- RNF-032: CDN para assets
- RNF-033: Cache layer (Redis)
- RNF-034: Service mesh para microservicios

### 3.5 Mantenibilidad
- RNF-040: Código modular y reutilizable
- RNF-041: Documentación actualizada
- RNF-042: CI/CD automatizado
- RNF-043: Testing > 80% cobertura
- RNF-044: Code review obligatorio

### 3.6 UX/UI
- RNF-050: Responsive (teléfono, tablet, desktop)
- RNF-051: Dark mode support
- RNF-052: Accesibilidad WCAG 2.1 AA
- RNF-053: Animaciones significativas
- RNF-054: Offline-first capability

---

## 4. Arquitectura Propuesta

### 4.1 Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Mobile App  │  │  Mobile App  │  │   Web Admin  │               │
│  │   (iOS/Android)││  (Tablet)    │  │  (Responsive)│               │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘               │
└──────────┼─────────────────┼─────────────────┼──────────────────────┘
           │                 │                 │
           └─────────────────┴─────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY LAYER                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Auth | Rate Limit | Request Routing | SSL Termination     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Auth    │  │  Customer│  │ Service  │  │Calendar  │            │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │Notification│ │ Dashboard│  │  Report  │  │  Audit   │            │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└────────────────────────────��────────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ PostgreSQL   │  │    Redis     │  │   S3 / CDN   │              │
│  │  (Primary)   │  │   (Cache)    │  │   (Assets)   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌──────────────┐  ┌──────────────┐                                 │
│  │  Read Replicas│ │   Elasticsearch│                                │
│  │  (Reporting)  │ │    (Search)   │                                 │
│  └──────────────┘  └──────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  AWS SES │  │  Twilio  │  │  Firebase  │  │  Stripe  │            │
│  │ (Email)  │  │  (SMS)   │  │ (Push)   │  │ (Payments)│            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Patrón Arquitectónico

**Backend:** Clean Architecture + Hexagonal Architecture
- Separación clara de capas: Presentation, Domain, Data
- Inversión de dependencias
- Testeabilidad

**Frontend:** Clean Architecture + BLoC Pattern
- Separación lógica de negocio y UI
- Estado predecible
- Reusabilidad

---
## 5. Stack Tecnológico

### 5.1 Mobile (React Native)

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Framework | React Native 0.74+ | Madurez, comunidad, soporte multiplataforma |
| Lenguaje | TypeScript 5.x | Tipado estático, detección temprana de errores |
| Gestión de Estado | Zustand + React Query | Ligero, simple, exelente sync offline-first |
| Navegación | React Navigation 7 | Estándar de la industria, nativo |
| UI Components | Tamagui + Native Base | Performance nativa, sistema de temas |
| Animaciones | Reanimated 3 | 60fps, hardware accelerated |
| Maps | react-native-maps | Soporte iOS y Android |
| Testing | Jest + React Native Testing Library + Detox | Unit e2e tests |

### 5.2 Backend (Node.js)

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Framework | Node.js 20+ LTS | Performance, ecosistema |
| Lenguaje | TypeScript 5.x | Tipado seguro, documentación automática |
| API Framework | Express.js + Zod | Ligero, flexible, validación |
| ORM | Prisma 5.x | Type-safe queries, migrations integradas |
| Base de Datos | PostgreSQL 15+ | Confiable, soporte JSON, escalable |
| Cache | Redis 7.x | Performance, sesiones, colas |
| Colas | BullMQ + Redis | Processamiento asíncrono confiable |
| Auth | Auth0 + JWT | Estándar, secure, scalable |
| Documentación | Swagger OpenAPI 3.0 | Documentación automática |

### 5.3 DevOps y Cloud

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Cloud | AWS (us-east-1) | Robusto, escalable, servicios completos |
| Container | Docker + ECS Fargate | Isolation, portabilidad, scaling |
| CI/CD | GitHub Actions | Integration nativa, flexible |
| Monitoring | AWS CloudWatch + Datadog | Observabilidad completa |
| Logging | Fluentd + Elasticsearch + Kibana | Centralizado, searchable |
| TLS | AWS ACM | Certificados gestionados |

### 5.4 Notificaciones

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Push iOS | Apple Push Notification Service | Oficial, confiable |
| Push Android | Firebase Cloud Messaging | Soporte Google, free |
| Email | AWS SES | Costo-beneficio, delivery rate |
| SMS | Twilio (futuro) | Confiable, internacional |

---

## 6. Arquitectura React Native

### 6.1 Estructura de Carpetas (Frontend)

```
frontend/
├── src/
│   ├── assets/               # Imágenes, íconos, fonts
│   ├── components/           # Componentes reutilizables
│   │   ├── common/          # Componentes base (Button, Input, Card)
│   │   ├── layout/          # Layouts (Header, Sidebar, Grid)
│   │   ├── calendar/        # Componentes del calendario
│   │   └── dashboard/       # KPIs y gráficos
│   ├── screens/             # Pantallas de la aplicación
│   │   ├── auth/           # Login, Register, ForgotPassword
│   │   ├── dashboard/      # Main dashboard
│   │   ├── appointments/   # Gestión de citas
│   │   ├── customers/      # Gestión de clientes
│   │   ├── services/       # Gestión de servicios
│   │   ├── settings/       # Configuración
│   │   └── admin/          # Panel administrativo
│   ├── navigation/          # Navegación (Stack, Tab, Drawer)
│   │   ├── AppNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   └── types.ts
│   ├── store/               # Estado global
│   │   ├── slices/          # Redux/Zustand slices
│   │   ├── hooks.ts
│   │   └── index.ts
│   ├── services/            # API calls y servicios
│   │   ├── api.ts           # Axios instance
│   │   ├── auth.ts
│   │   ├── customers.ts
│   │   ├── appointments.ts
│   │   └── notifications.ts
│   ├── utils/               # Utilidades
│   │   ├── validators.ts
│   │   ├── date.ts
│   │   ├── formats.ts
│   │   └── constants.ts
│   ├── hooks/               # Custom hooks
│   │   ├── useAsync.ts
│   │   ├── usePermissions.ts
│   │   └── useOffline.ts
│   ├── theme/               # Design System
│   │   ├── colors.ts
│   │   ├── spacing.ts
│   │   ├── typography.ts
│   │   └── themes/
│   ├── types/               # Types TypeScript
│   │   ├── api.ts
│   │   ├── domain.ts
│   │   └── index.ts
│   └── config/              # Configuración
│       ├── env.ts
│       └── features.ts
├── __tests__/
├── android/
├── ios/
└── public/
```

### 6.2 Patrón de Diseño

**Clean Architecture:**
```
┌─────────────────────────────────────┐
│       Presentation Layer            │
│  (Screens, Components, Navigation)  │
└──────────────┬──────────────────────┘
               │ uses
┌──────────────▼──────────────────────┐
│        Domain Layer                 │
│  (Use Cases, Entities, Services)    │
└──────────────┬──────────────────────┘
               │ implements
┌──────────────▼──────────────────────┐
│        Data Layer                   │
│  (API, Database, Cache, Repos)      │
└─────────────────────────────────────┘
```

### 6.3 Gestión de Estado

- **Zustand:** Estado global ligero
- **React Query:** Cache y sync con servidor
- **AsyncStorage:** Persistencia offline-first

---

## 7. Arquitectura Backend

### 7.1 Estructura de Carpetas (Backend)

```
backend/
├── src/
│   ├── config/              # Configuración
│   │   ├── env.ts
│   │   ├── database.ts
│   │   ├── redis.ts
│   │   └── jwt.ts
│   ├── database/            # Prisma client
│   │   ├── prisma.service.ts
│   │   └── seed.ts
│   ├── models/              # Domain models (interfaces)
│   │   ├── tenant.model.ts
│   │   ├── user.model.ts
│   │   ├── customer.model.ts
│   │   ├── appointment.model.ts
│   │   └── service.model.ts
│   ├── routes/              # Endpoints
│   │   ├── v1/              # Versioned API
│   │   │   ├── auth.routes.ts
│   │   │   ├── customers.routes.ts
│   │   │   ├── appointments.routes.ts
│   │   │   └── dashboard.routes.ts
│   │   └── index.ts
│   ├── services/            # Business logic
│   │   ├── auth.service.ts
│   │   ├── customer.service.ts
│   │   ├── appointment.service.ts
│   │   ├── availability.service.ts
│   │   └── notification.service.ts
│   ├── controllers/         # HTTP handlers
│   │   ├── auth.controller.ts
│   │   ├── customer.controller.ts
│   │   └── ...
│   ├── middleware/          # Express middleware
│   │   ├── auth.ts
│   │   ├── rateLimit.ts
│   │   ├── validation.ts
│   │   └── error.ts
│   ├── utils/               # Utilidades
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   ├── permissions.ts
│   │   └── validators.ts
│   ├── hooks/               # Prisma hooks (auditing)
│   │   └── audit.ts
│   ├── queues/              # Job queues
│   │   ├── notification.queue.ts
│   │   └── report.queue.ts
│   ├── types/               # TypeScript types
│   │   ├── express.d.ts
│   │   └── domain.ts
│   ├── index.ts
│   └── app.ts
├── migrations/              # Database migrations
├── scripts/                 # Scripts de utilidad
└── tests/                   # Integration tests
```

### 7.2 Patrón de Diseño

**Hexagonal Architecture:**
```
┌─────────────────────────────────────┐
│       Interface Adapters            │
│  (Controllers, CLI, WebSockets)     │
└──────────────┬──────────────────────┘
               │ interacts with
┌──────────────▼──────────────────────┐
│       Application Core              │
│  (Use Cases, Domain Services)       │
└──────────────┬──────────────────────┘
               │ uses
┌──────────────▼──────────────────────┐
│        Domain Layer                 │
│  (Entities, Value Objects)          │
└──────────────┬──────────────────────┘
               │ implements
┌──────────────▼──────────────────────┐
│      Infrastructure Layer           │
│  (DB, APIs externas, Cache)         │
└─────────────────────────────────────┘
```

### 7.3 Validación

- **Zod:** Validación de schemas
- **Express-validator:** Request validation
- **Prisma:** Database constraints

---

## 8. Arquitectura de Base de Datos

### 8.1 Modelo Entidad-Relación

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Tenants      │     │   Users         │     │   Roles         │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK)         │────►│ id (PK)         │     │ id (PK)         │
│ name            │     │ tenant_id (FK)  │────►│ name            │
│ subdomain       │     │ role_id (FK)    │     │ permissions     │
│ domain          │     │ email           │     └─────────────────┘
│ status          │     │ password_hash   │           ▲
│ created_at      │     │ phone           │           │
└─────────────────┘     │ avatar          │           │
                        │ last_login      │           │
                        │ is_active       │           │
                        │ created_at      │           │
                        └─────────────────┘           │
                               ▲                      │
                               │                      │
                        ┌──────┴───────┐              │
                        │ UserRoles    │              │
                        ├──────────────┤              │
                        │ user_id (FK) │              │
                        │ role_id (FK) │              │
                        └──────────────┘              │
                                                        │
┌─────────────────┐     ┌─────────────────┐            │
│   Customers     │     │   Services      │◄──────────┘
├─────────────────┤     ├─────────────────┤
│ id (PK)         │     │ id (PK)         │
│ tenant_id (FK)  │     │ tenant_id (FK)  │
│ name            │     │ name            │
│ email           │     │ description     │
│ phone           │     │ duration_mins   │
│ birth_date      │     │ price           │
│ notes           │     │ category_id     │
│ tags            │     │ is_active       │
│ created_at      │     │ created_at      │
└─────────────────┘     └─────────────────┘
        ▲                       ▲
        │                       │
        │                       │
┌───────┴───────┐     ┌─────────┴─────────┐
│ Appointment   │     │ Categories        │
├───────────────┤     ├───────────────────┤
│ id (PK)       │     │ id (PK)           │
│ tenant_id (FK)│     │ tenant_id (FK)    │
│ customer_id   │────►│ name              │
│ service_id    │────►│ description       │
│ professional_id│     └───────────────────┘
│ start_time    │
│ end_time      │
│ status        │
│ notes         │
│ created_at    │
└───────────────┘
```

### 8.2 Tablas Adicionales

- **Availability:** Horarios disponibles por profesional
- **Blockings:** Bloqueos de calendario (vacaciones, eventos)
- **Notifications:** Historial de notificaciones enviadas
- **NotificationTemplates:** Plantillas personalizables
- **AuditLogs:** Registros de auditoría
- **ApiTokens:** Tokens de API para terceros
- **Devices:** Dispositivos registrados (logout remoto)

### 8.3 Estrategia de Índices

```sql
-- Índices compuestos para queries comunes
CREATE INDEX idx_appointments_tenant_start ON appointments(tenant_id, start_time);
CREATE INDEX idx_appointments_customer ON appointments(customer_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_customers_tenant_email ON customers(tenant_id, email);
CREATE INDEX idx_services_tenant ON services(tenant_id);
```

---
## 9. Modelo Multi-Tenant

### 9.1 Estrategia de Aislamiento

**Estrategia: Shared Database, Row-Level Security**

| Ventajas | Desventajas |
|----------|-------------|
| Costo reducido | Complejidad en queries |
| Fácil backup y restore | Requiere discipline en código |
| Escalabilidad horizontal | |

### 9.2 Implementación

#### 9.2.1 Columna tenant_id en todas las tablas

```typescript
// Ejemplo en Prisma
model Appointment {
  id          String    @id @default(cuid())
  tenant_id   String    // ❗ Clave para multi-tenant
  tenant      Tenant    @relation(fields: [tenant_id], references: [id])
  
  customer_id String
  customer    Customer  @relation(fields: [customer_id], references: [id])
  
  service_id  String
  service     Service   @relation(fields: [service_id], references: [id])
  
  start_time  DateTime
  end_time    DateTime
  status      AppointmentStatus
}
```

#### 9.2.2 Middleware de Tenant en Backend

```typescript
// middleware/tenant.ts
import { Request, Response, NextFunction } from 'express';

export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const tenantId = req.user.tenant_id;
  
  // Agregar tenant_id a todas las queries
  req.tenantId = tenantId;
  
  next();
};
```

#### 9.2.3 Prisma Middleware para Auto-Tenant

```typescript
// database/prisma.middleware.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

prisma.$use(async (params, next) => {
  const { model, action } = params;
  
  // Solo aplicar a operaciones de lectura/escritura
  if (['findUnique', 'findMany', 'create', 'update', 'delete'].includes(action)) {
    // Obtener tenant_id del contexto
    const tenantId = getCurrentTenantId();
    
    // Agregar where_clause con tenant_id
    if (params.args.where) {
      params.args.where = {
        ...params.args.where,
        tenant_id: tenantId
      };
    } else {
      params.args.where = { tenant_id: tenantId };
    }
  }
  
  return next(params);
});
```

### 9.3 Autenticación Multi-Tenant

```typescript
// Ejemplo de token JWT
{
  "user_id": "usr_123",
  "tenant_id": "tn_456",
  "role": "admin",
  "permissions": ["appointments:read", "appointments:write"],
  "iat": 1691846400,
  "exp": 1691932800
}
```

### 9.4 Routing por Subdominio

```typescript
// router.ts
import { Request, Response, NextFunction } from 'express';

export const subdomainMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const subdomain = req.headers.host?.split('.')[0];
  
  // Buscar tenant por subdomain
  const tenant = await prisma.tenant.findUnique({
    where: { subdomain }
  });
  
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }
  
  req.tenant = tenant;
  next();
};
```

---

## 10. Sistema de Autenticación

### 10.1 Flujo de Autenticación

```
┌──────────┐     1. Login     ┌──────────┐     2. JWT + RT     ┌──────────┐
│  Mobile  │ ───────────────► │  Backend │ ◄────────────────── │  Mobile  │
└──────────┘                  └──────────┘                     └──────────┘
     ▲                               │                               │
     │                               │                               │
     │         3. Refresh            │                               │
     │───────────────────────────────┘                               │
                                     │
                                     │ 4. Validate
                                     ▼
                              ┌──────────┐
                              │  Backend │
                              └──────────┘
```

### 10.2 Tokens

**Access Token (JWT):**
- Expiración: 15-30 minutos
- Contenido: user_id, tenant_id, role, permissions
- Firma: HS256 con secret en AWS Secrets Manager

**Refresh Token:**
- Expiración: 7-30 días
- Almacenado: HttpOnly cookie + device binding
- Rotación: New RT en cada refresh

### 10.3 Endpoints de Auth

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/v1/auth/login` | Login con email/clave |
| POST | `/v1/auth/register` | Registro de nuevo usuario |
| POST | `/v1/auth/refresh` | Refresh tokens |
| POST | `/v1/auth/logout` | Logout (revoke token) |
| POST | `/v1/auth/forgot-password` | Solicitar reset |
| POST | `/v1/auth/reset-password` | Resetear contraseña |

### 10.4 Protección contra Fuerza Bruta

```typescript
// middleware/rateLimitAuth.ts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: { error: 'Too many login attempts' },
  standardHeaders: true,
  legacyHeaders: false
});
```

### 10.5 OAuth Integration

**Google:**
```typescript
// services/google-auth.service.ts
const googleConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI
};
```

**Apple:**
```typescript
// services/apple-auth.service.ts
const appleConfig = {
  teamId: process.env.APPLE_TEAM_ID,
  clientId: process.env.APPLE_CLIENT_ID,
  keyId: process.env.APPLE_KEY_ID
};
```

---

## 11. Sistema de Autorización RBAC

### 11.1 Definición de Roles

```typescript
// types/roles.ts
export interface Role {
  id: string;
  name: 'admin' | 'professional' | 'reception';
  permissions: Permission[];
}

export type Permission =
  // Clientes
  | 'customers:read'
  | 'customers:write'
  | 'customers:delete'
  
  // Servicios
  | 'services:read'
  | 'services:write'
  | 'services:delete'
  
  // Citas
  | 'appointments:read'
  | 'appointments:write'
  | 'appointments:cancel'
  | 'appointments:confirm'
  
  // Dashboard
  | 'dashboard:read'
  
  // Admin
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'settings:read'
  | 'settings:write'
  | 'audit:read';
```

### 11.2 Middleware de Autorización

```typescript
// middleware/permissions.ts
import { Request, Response, NextFunction } from 'express';

export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userPermissions = req.user.permissions;
    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Permission '${permission}' required`
      });
    }
    
    next();
  };
};
```

### 11.3 Uso en Rutas

```typescript
// routes/appointments.routes.ts
router.get(
  '/appointments',
  authMiddleware,
  requirePermission('appointments:read'),
  appointmentController.list
);

router.post(
  '/appointments',
  authMiddleware,
  requirePermission('appointments:write'),
  appointmentController.create
);

router.delete(
  '/appointments/:id',
  authMiddleware,
  requirePermission('appointments:cancel'),
  appointmentController.cancel
);
```

### 11.4 Frontend Permissions Hook

```typescript
// hooks/usePermissions.ts
export const usePermissions = () => {
  const user = useUser();
  
  const hasPermission = (permission: Permission) => {
    return user.permissions.includes(permission);
  };
  
  const hasAnyPermission = (permissions: Permission[]) => {
    return permissions.some(p => user.permissions.includes(p));
  };
  
  return { hasPermission, hasAnyPermission };
};
```

---

## 12. Sistema de Notificaciones

### 12.1 Arquitectura de Notificaciones

```
┌─────────────────────────────────────────────────────────────┐
│                    Notification Service                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Push       │  │  Email      │  │  SMS/WhatsApp│          │
│  │  Service    │  │  Service    │  │  Service     │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                     ▲
                     │
         ┌───────────┴───────────┐
         │  Notification Queue   │
         │  (BullMQ + Redis)     │
         └───────────────────────┘
                     ▲
         ┌───────────┴───────────┐
         │  Business Services    │
         │  (Appointments, etc)  │
         └───────────────────────┘
```

### 12.2 Templates de Notificaciones

```typescript
// models/notification-templates.ts
export const NotificationTemplates = {
  appointment_confirmation: {
    title: 'Confirmación de Cita',
    body: 'Tu cita con {{professional}} ha sido confirmada para el {{date}} a las {{time}}.',
    channels: ['push', 'email'],
    timeBefore: 0
  },
  
  appointment_reminder: {
    title: 'Recordatorio de Cita',
    body: 'Tienes una cita programada para mañana a las {{time}}.',
    channels: ['push', 'email'],
    timeBefore: 24 // horas
  },
  
  appointment_cancelled: {
    title: 'Cita Cancelada',
    body: 'Tu cita con {{professional}} ha sido cancelada.',
    channels: ['push', 'email'],
    timeBefore: 0
  }
};
```

### 12.3 Cola de Notificaciones

```typescript
// queues/notification.queue.ts
import Queue from 'bull';

const notificationQueue = new Queue('notifications', {
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT)
  }
});

notificationQueue.process(async (job) => {
  const { notificationId } = job.data;
  
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });
  
  if (notification.channel === 'push') {
    await sendPushNotification(notification);
  } else if (notification.channel === 'email') {
    await sendEmailNotification(notification);
  }
  
  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: 'sent', sent_at: new Date() }
  });
});
```

---

## 13. Estrategia de Seguridad

### 13.1 OWASP Compliance

| Riesgo | Medida |
|--------|--------|
| A01:2021 - Broken Access Control | RBAC + middleware de validación |
| A02:2021 - Cryptographic Failures | AES-256 + bcrypt (cost 12) |
| A03:2021 - Injection | Prisma ORM + parameterized queries |
| A04:2021 - Insecure Design | Secure design reviews |
| A05:2021 - Security Misconfiguration | CI/CD security scans |
| A06:2021 - Vulnerable Components | Dependabot + npm audit |
| A07:2021 - SSRF | Validation de URLs externas |
| A08:2021 - SSRF | Rate limiting + CORS strict |
| A09:2021 - Security Logging | WAF + CloudWatch |
| A10:2021 - SSRF | Input validation + sanitization |

### 13.2 Secrets Management

```typescript
// Configuración con AWS Secrets Manager
const getSecret = async (secretName: string) => {
  const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
  return JSON.parse(data.SecretString);
};

// Usar en configuración
const secrets = await getSecret('app-production');
const dbPassword = secrets.databasePassword;
```

### 13.3 Input Validation

```typescript
// validation/schemas.ts
import { z } from 'zod';

export const AppointmentSchema = z.object({
  customer_id: z.string().cuid(),
  service_id: z.string().cuid(),
  professional_id: z.string().cuid().optional(),
  start_time: z.date(),
  notes: z.string().max(500).optional()
});

export type AppointmentInput = z.infer<typeof AppointmentSchema>;
```

### 13.4 XSS Protection

```typescript
// middleware/xss.ts
import xss from 'xss';

export const sanitizeMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = JSON.parse(xss(JSON.stringify(req.body)));
  }
  next();
};
```

---

## 14. Observabilidad

### 14.1 Logging

```typescript
// utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  },
  formatters: {
    log: (log) => {
      return {
        ...log,
        tenant_id: log.tenant_id || 'system',
        user_id: log.user_id || 'anonymous'
      };
    }
  }
});

logger.info({ action: 'login', user_id: 'usr_123' }, 'User logged in');
```

### 14.2 Metrics

```typescript
// metrics.ts
import Prometheus from 'prom-client';

const requestDuration = new Prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
});

const activeSessions = new Prometheus.Gauge({
  name: 'active_sessions',
  help: 'Number of active sessions'
});
```

### 14.3 Tracing

```typescript
// middleware/tracing.ts
export const tracingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  res.setHeader('X-Trace-ID', traceId);
  req.traceId = traceId;
  next();
};
```

---

## 15. Estrategia de Pruebas

### 15.1 Pyramid de Pruebas

```
        /\
       /  \      E2E Tests (10%)
      /----\
     /      \    Integration Tests (20%)
    /--------\
   /          \  Unit Tests (70%)
  /------------\
```

### 15.2 Unit Tests

```typescript
// services/appointment.service.test.ts
describe('AppointmentService', () => {
  describe('createAppointment', () => {
    it('should create appointment successfully', async () => {
      const result = await service.createAppointment({
        tenant_id: 'tn_123',
        customer_id: 'cust_123',
        service_id: 'svc_123',
        start_time: new Date('2024-01-01 10:00:00')
      });
      
      expect(result.status).toBe('confirmed');
    });
    
    it('should reject conflicting appointment', async () => {
      await expect(service.createAppointment(conflictingData))
        .rejects.toThrow('APPOINTMENT_CONFLICT');
    });
  });
});
```

### 15.3 Integration Tests

```typescript
// tests/integration/auth.test.ts
describe('POST /v1/auth/login', () => {
  it('should return 200 with valid credentials', async () => {
    const response = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('access_token');
  });
});
```

### 15.4 E2E Tests

```typescript
// tests/e2e/appointment-flow.test.ts
describe('Appointment Flow', () => {
  it('should complete full appointment flow', async () => {
    // Login
    const auth = await api.login(testUser);
    
    // Create customer
    const customer = await api.createCustomer(auth.token, customerData);
    
    // Create appointment
    const appointment = await api.createAppointment(auth.token, {
      customer_id: customer.id,
      service_id: serviceId,
      start_time: '2024-01-01 10:00'
    });
    
    // Cancel appointment
    await api.cancelAppointment(auth.token, appointment.id);
    
    expect(appointment.status).toBe('cancelled');
  });
});
```

### 15.5 Testing Libraries

| Tipo | Biblioteca |
|------|------------|
| Unit | Jest + React Native Testing Library |
| Integration | Supertest |
| E2E | Detox |
| Mock | Mock Service Worker (MSW) |
| Snapshot | Jest Snapshot |

---

## 16. CI/CD

### 16.1 Pipeline de CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
      - name: Install dependencies
        run: npm ci
      - name: Run lint
        run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Upload coverage
        uses: actions/upload-artifact@v3
        with:
          name: coverage
          path: coverage/

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
      - name: Build
        run: npm run build
```

### 16.2 Pipeline de CD

```yaml
# .github/workflows/cd.yml
name: CD

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: docker build -t myapp:${{ github.sha }} .
      - name: Push to ECR
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
          docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/myapp:${{ github.sha }}
      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster production --service myapp --force-new-deployment
```

---

## 17. Estructura de Carpetas

### 17.1 Estructura Completa

```
citas/
├── ARCHITECTURE.md
├── README.md
├── ROADMAP.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── docker-compose.yml
│   ├── src/
│   │   ├── config/
│   │   ├── database/
│   │   ├── models/
│   │   ├── routes/
│   │   │   └── v1/
│   │   ├── services/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── utils/
│   │   ├── hooks/
│   │   ├── queues/
│   │   ├── migrations/
│   │   └── types/
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── app.json
│   ├── babel.config.js
│   ├── metro.config.js
│   ├── __tests__/
│   ├── android/
│   ├── ios/
│   └── src/
│       ├── assets/
│       ├── components/
│       │   ├── common/
│       │   ├── layout/
│       │   ├── calendar/
│       │   └── dashboard/
│       ├── screens/
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── appointments/
│       │   ├── customers/
│       │   ├── services/
│       │   └── settings/
│       ├── navigation/
│       ├── store/
│       ├── services/
│       ├── utils/
│       ├── hooks/
│       ├── theme/
│       └── types/
└── docs/
    ├── api/
    ├── database/
    └── deployment/
```

---

## 18. Diagrama de Componentes

### 18.1 Componentes Frontend

```
┌─────────────────────────────────────────────────────────┐
│                      App Root                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Navigation  │  │  Store       │  │  Services    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                    ▲          ▲          ▲
                    │          │          │
┌───────────────────┴────┐ ┌──┴───────────┴────┐ ┌───────┴──────────────┐
│   Presentation Layer   │ │  Business Logic   │ │  Data Layer          │
│                        │ │                   │ │                      │
│  ┌──────────┐          │ │  ┌────────────┐   │ │  ┌──────────────┐    │
│  │  Screens │          │ │  │  Use Cases │   │ │  │  API Client  │    │
│  └────┬─────┘          │ │  └────────────┘   │ │  └──────────────┘    │
│       │                │ │                   │ │       │              │
│  ┌────▼────┐           │ │  ┌────────────┐   │ │  ┌───▼──────────┐    │
│  │  Hooks  │           │ │  │  Services  │   │ │  │  Cache       │    │
│  └─────────┘           │ │  └────────────┘   │ │  └──────────────┘    │
│                        │ │                   │ │                      │
│  ┌──────────┐          │ │  ┌────────────┐   │ │  ┌──────────────┐    │
│  │  Styles  │          │ │  │  Validators│   │ │  │  Storage     │    │
│  └──────────┘          │ │  └────────────┘   │ │  └──────────────┘    │
└────────────────────────┴┴─────────────────────┴┴──────────────────────┘
```

### 18.2 Componentes Backend

```
┌─────────────────────────────────────────────────────────┐
│                  API Gateway Layer                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Auth    │  │  Rate    │  │  Router  │  │  Logger  │ │
│  │  Middleware││  Limiting│  │          │  │          │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Application Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Auth    │  │Customer  │  │Appointment│ │Dashboard │ │
│  │  Service │  │  Service │  │  Service  │ │  Service │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Infrastructure Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Prisma  │  │  Redis   │  │  Queue   │  │  Email   │ │
│  │  ORM     │  │  Cache   │  │  (Bull)  │  │  (SES)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 19. Riesgos Técnicos

### 19.1 Riesgo 1: Complejidad del Calendario

**Descripción:** La lógica de disponibilidad y conflictos puede volverse compleja con múltiples profesionales y servicios.

**Probabilidad:** ALTA  
**Impacto:** ALTO

**Mitigación:**
- Separar lógica en servicio dedicado `AvailabilityService`
- Unit tests exhaustivos
- Documentación clara
- Revisión de pares

### 19.2 Riesgo 2: Sincronización Offline

**Descripción:** Manejar conflictos de concurrencia cuando el usuario está offline y luego se reconecta.

**Probabilidad:** MEDIA  
**Impacto:** ALTO

**Mitigación:**
- Control de versiones en cada entidad
- Algoritmo de resolución de conflictos
- UI clara de estado
- Tests de concurrencia

### 19.3 Riesgo 3: Performance Dashboard

**Descripción:** Dashboard con grandes volúmenes de datos puede volverse lento.

**Probabilidad:** MEDIA  
**Impacto:** MEDIO

**Mitigación:**
- Agregados pre-calculados
- Caching de métricas
- Paginación
- Lazy loading

### 19.4 Riesgo 4: Seguridad Multi-Tenant

**Descripción:** Fallo en middleware podría exponer datos de otro tenant.

**Probabilidad:** BAJA  
**Impacto:** CRÍTICO

**Mitigación:**
- Pruebas de penetración
- Code review obligatorio
- Middleware de seguridad
- Audit logging

### 19.5 Riesgo 5: Escalabilidad

**Descripción:** Crecimiento de usuarios puede superar capacidad inicial.

**Probabilidad:** MEDIA  
**Impacto:** ALTO

**Mitigación:**
- Arquitectura escalable desde el inicio
- Load testing
- Horizontal scaling
- Caching inteligente

---

## 20. Roadmap de Implementación

### FASE 0 — Análisis (Semana 1-2)
**Objetivo:** Finalizar análisis y aprobación de arquitectura

- [ ] Revisión de requerimientos
- [ ] Aprobación de arquitectura
- [ ] Definición de tooling
- [ ] Configuración de repositorio

### FASE 1 — Backend Base (Semana 3-4)
**Objetivo:** Establecer infraestructura backend

- [ ] Configuración de proyecto Node.js
- [ ] Configuración de PostgreSQL
- [ ] Setup de Prisma ORM
- [ ] Middlewares de autenticación
- [ ] Estructura de errores
- [ ] CI/CD básico

### FASE 2 — Autenticación Completa (Semana 5)
**Objetivo:** Sistema de auth funcional

- [ ] Login/Logout
- [ ] Refresh tokens
- [ ] OAuth (Google, Apple)
- [ ] Recuperación de contraseña
- [ ] Gestión de sesiones

### FASE 3 — Gestión de Clientes (Semana 6)
**Objetivo:** CRUD de clientes con búsqueda

- [ ] CRUD completo
- [ ] Búsqueda y filtros
- [ ] Paginación
- [ ] Validaciones
- [ ] Tests

### FASE 4 — Gestión de Servicios (Semana 7)
**Objetivo:** CRUD de servicios con categorías

- [ ] CRUD de servicios
- [ ] Categorías
- [ ] Asignación a profesionales
- [ ] Imágenes y descripciones
- [ ] Tests

### FASE 5 — Calendario y Citas (Semana 8-9)
**Objetivo:** Módulo principal de calendario

- [ ] CRUD de citas
- [ ] Detección de conflictos
- [ ] Validación de disponibilidad
- [ ] Cambio de estado
- [ ] Tests E2E

### FASE 6 — Frontend Base (Semana 10)
**Objetivo:** App móvil funcional básica

- [ ] Setup React Native
- [ ] Navegación
- [ ] Design System
- [ ] Auth UI
- [ ] Navigation structure

### FASE 7 — UI Clientes y Servicios (Semana 11)
**Objetivo:** Pantallas de gestión

- [ ] Lista y detalle clientes
- [ ] Lista y detalle servicios
- [ ] Formularios
- [ ] Validaciones
- [ ] Tests

### FASE 8 — UI Calendario (Semana 12-13)
**Objetivo:** Calendario interactivo

- [ ] Vista día/semana/mes
- [ ] Gestión de citas
- [ ] Arrastrar y soltar
- [ ] Modales
- [ ] Tests

### FASE 9 — Dashboard (Semana 14)
**Objetivo:** Visualización de KPIs

- [ ] Métricas del día
- [ ] Gráficos de ocupación
- [ ] Servicios más utilizados
- [ ] Exportación
- [ ] Tests

### FASE 10 — Notificaciones (Semana 15)
**Objetivo:** Sistema de notificaciones

- [ ] Push notifications setup
- [ ] Email templates
- [ ] Colas de notificaciones
- [ ] Plantillas
- [ ] Historial

### FASE 11 — Seguridad y Auditoría (Semana 16)
**Objetivo:** Hardening

- [ ] Audit logging
- [ ] Rate limiting
- [ ] Security review
- [ ] OWASP compliance
- [ ] Tests de seguridad

### FASE 12 — QA y Performance (Semana 17)
**Objetivo:** Calidad de producción

- [ ] Test automation
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] Cross-platform testing
- [ ] Bug fixing

### FASE 13 — Release (Semana 18)
**Objetivo:** Despliegue a producción

- [ ] Deploy staging
- [ ] UAT testing
- [ ] Deploy production
- [ ] Monitoring setup
- [ ] Documentation

---

## 21. Criterios de Aceptación

### 21.1 Código
- [ ] Compila sin errores
- [ ] Type-checking pasa
- [ ] Linting pasa (sin warnings)
- [ ] Tests > 80% cobertura
- [ ] No secrets en código

### 21.2 Funcionalidad
- [ ] Casos de uso completos
- [ ] Manejo de errores robusto
- [ ] Validaciones en frontend y backend
- [ ] UI/UX aprobada

### 21.3 Performance
- [ ] Navegación < 100ms
- [ ] API p95 < 200ms
- [ ] Dashboard < 1s carga
- [ ] Sin memory leaks

### 21.4 Seguridad
- [ ] OWASP Top 10 passed
- [ ] Penetration testing
- [ ] Code review completo
- [ ] Secrets management

### 21.5 Documentación
- [ ] API documentation
- [ ] Deployment guide
- [ ] User documentation
- [ ] Architecture decisions

---

## Apendices

### A. Glosario
- **Tenant:** Negocio o empresa que usa el sistema
- **Professional:** Profesional que presta servicios
- **Reception:** Personal de recepción
- **RBAC:** Role-Based Access Control
- **SaaS:** Software as a Service

### B. Referencias
- [React Native Docs](https://reactnative.dev/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

---

**Fin del Documento**
