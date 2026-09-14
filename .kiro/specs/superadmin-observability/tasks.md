# Implementation Plan

## Overview

Este plan implementa el modulo de SuperAdmin y Observabilidad Global sobre la arquitectura existente (JWT con `role`, multi-tenant Prisma/MySQL, `AuditLog` ya modelado, `dashboard.service` y la app web React en `frontend-web`).

La estrategia es incremental y de menor a mayor riesgo:
1. Base de identidad: seed del super usuario y middleware de autorizacion.
2. Auditoria: helper centralizado e integracion en operaciones de negocio.
3. Agregaciones y audit trail: servicios de solo lectura cross-tenant.
4. Exposicion: rutas `/v1/admin` protegidas.
5. Frontend: cliente API, navegacion condicional y paginas del panel.
6. Verificacion end-to-end.

El backend NO sufre migraciones estructurales: SUPERADMIN se representa como un `UserRole` cuyo `name` decide la autorizacion. El alcance es solo lectura y observabilidad.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["1.1", "2.1", "3.1", "4", "5", "8"] },
    { "wave": 3, "tasks": ["5.1", "6", "8.1"] },
    { "wave": 4, "tasks": ["6.1", "7"] },
    { "wave": 5, "tasks": ["7.1", "9"] },
    { "wave": 6, "tasks": ["10"] },
    { "wave": 7, "tasks": ["11"] },
    { "wave": 8, "tasks": ["12"] }
  ],
  "dependencies": {
    "1.1": ["1"],
    "2.1": ["2"],
    "3.1": ["3"],
    "4": ["3"],
    "5.1": ["5"],
    "6": ["3", "4"],
    "6.1": ["6"],
    "7": ["2", "5", "6"],
    "7.1": ["7"],
    "8": ["1"],
    "8.1": ["8"],
    "9": ["7"],
    "10": ["9"],
    "11": ["9", "10"],
    "12": ["1", "7", "10", "11"]
  }
}
```

Orden sugerido de ejecucion: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12, intercalando cada subtarea de prueba tras su tarea padre.

## Tasks

- [x] 1. Seed del super usuario y rol SUPERADMIN
  - Crear `backend/src/database/seed-superadmin.ts` idempotente
  - Upsert del rol SUPERADMIN (`id = "superadmin-role"`, `tenant_id = "default"`, `name = "SUPERADMIN"`)
  - Leer `SUPERADMIN_EMAIL` (default `xcode.arturo@gmail.com`) y `SUPERADMIN_PASSWORD` de env; abortar con mensaje claro si falta la contrasena
  - Crear el usuario si no existe (password hasheado con bcrypt) o actualizar su `role_id` si existe
  - Agregar script npm `seed:superadmin` en `backend/package.json`
  - Documentar las variables en `backend/.env.example`
  - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 1.1 Prueba de idempotencia del seed
  - Escribir prueba que ejecute el seed dos veces y verifique un unico super usuario con rol SUPERADMIN
  - _Requirements: 2.1, 2.2, 2.3_
  - _Properties: Property 6 (Idempotencia del seed)_

- [x] 2. Middleware de autorizacion SUPERADMIN
  - Crear `backend/src/middleware/requireSuperAdmin.ts`
  - Leer `req.user.role` poblado por `authMiddleware`; `next()` si es SUPERADMIN, 403 `FORBIDDEN` en caso contrario
  - No consultar base de datos (confiar en el rol firmado en el JWT)
  - _Requirements: 1.5, 3.2, 3.3_

- [x] 2.1 Pruebas del middleware requireSuperAdmin
  - Permite con role SUPERADMIN; responde 403 con cualquier otro rol
  - Verificar que ningun header/query/body otorgue acceso si el JWT no contiene SUPERADMIN
  - _Requirements: 1.5, 3.2, 3.3_
  - _Properties: Property 1 (Aislamiento por defecto), Property 2 (Autoridad exclusiva del rol firmado)_

- [x] 3. Helper de auditoria centralizado
  - Crear `writeAudit` en `backend/src/utils/audit.ts` (o servicio equivalente)
  - Firma segun diseno; escritura best-effort envuelta en try/catch que loguea con pino sin propagar
  - Almacenar `result` (success/failure) en cada registro
  - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [x] 3.1 Prueba de auditoria no bloqueante
  - Mock de Prisma que rechaza la escritura; verificar que `writeAudit` no lanza
  - _Requirements: 5.4_
  - _Properties: Property 4 (Auditoria no bloqueante)_

- [x] 4. Integrar auditoria en operaciones de negocio
  - Invocar `writeAudit` en create/update/delete/cancel/confirm de citas, clientes y servicios
  - Reutilizar el patron ya presente para LOGIN/LOGOUT en `auth.service`
  - Capturar `ip_address` y `user_agent` desde la request cuando esten disponibles
  - _Requirements: 5.1, 5.2, 5.5_

- [x] 5. Servicio de agregaciones globales
  - Crear `backend/src/services/admin.service.ts`
  - `getOverview`: contadores globales (tenants, users, customers, services) y citas por estado via groupBy
  - `getMetrics`: ingresos totales y por tenant (suma de price en citas COMPLETED), ocupacion y no-show en rango de fechas, con filtro opcional `tenant_id`
  - `listTenants`: tenants con contadores basicos
  - `getHealth`: estado del backend y contadores de actividad de las ultimas 24h
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2_

- [x] 5.1 Prueba de consistencia de agregaciones
  - Con datos de multiples tenants, verificar que la metrica global iguala la suma por tenant para un rango dado
  - _Requirements: 4.1, 4.2, 4.5_
  - _Properties: Property 7 (Consistencia de agregaciones)_

- [x] 6. Servicio y consulta del audit trail
  - `getAuditTrail(filters)` en `admin.service` con filtros por tenant, usuario, accion, tipo de recurso y rango de fechas
  - Paginacion (page, page_size, total) ordenado por `created_at` descendente
  - No exponer mutaciones sobre AuditLog
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 5.3_

- [x] 6.1 Prueba de paginacion total del audit trail
  - Recorrer todas las paginas para un filtro dado devuelve exactamente `total` registros sin duplicados ni omisiones
  - _Requirements: 6.1, 6.3_
  - _Properties: Property 8 (Paginacion total)_

- [x] 7. Rutas y controlador de administracion
  - Crear `backend/src/controllers/admin.controller.ts` y `backend/src/routes/v1/admin.routes.ts`
  - Endpoints GET: `/overview`, `/metrics`, `/tenants`, `/audit`, `/health`
  - Aplicar `authMiddleware` seguido de `requireSuperAdmin` en todas
  - Registrar `router.use('/admin', adminRoutes)` en `routes/index.ts`
  - Respuestas siguiendo el patron `{ success, data }` / `{ success, error }` existente
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 4.1, 6.1, 7.1_

- [x] 7.1 Pruebas de integracion de endpoints admin
  - Token SUPERADMIN -> 200; token de otro rol -> 403; sin token -> 401
  - Filtro opcional `tenant_id` en consultas globales
  - _Requirements: 3.2, 3.3, 3.4_
  - _Properties: Property 1 (Aislamiento por defecto)_

- [x] 8. Proteger contra elevacion de privilegios desde tenant
  - En el flujo de gestion de usuarios, rechazar asignar `role = SUPERADMIN`
  - _Requirements: 1.4_

- [x] 8.1 Prueba de no elevacion desde tenant
  - Un rol distinto de SUPERADMIN no puede producir un usuario objetivo con rol SUPERADMIN
  - _Requirements: 1.4_
  - _Properties: Property 3 (No elevacion desde tenant)_

- [x] 9. Cliente API de administracion (frontend)
  - Crear `frontend-web/src/services/admin.service.ts` usando el `api` axios existente
  - Metodos para `/admin/overview`, `/admin/metrics`, `/admin/tenants`, `/admin/audit`, `/admin/health`
  - Portar los tipos de respuesta (`GlobalOverview`, `GlobalMetrics`, `AuditEntry`, `Paginated`) a `frontend-web/src/types`
  - _Requirements: 8.3_

- [x] 10. Deteccion de rol y navegacion condicional (frontend)
  - Agregar selector `isSuperAdmin` derivado de `user.role === "SUPERADMIN"` en `useAuthStore`
  - Mostrar el enlace "Admin Global" en `Layout` solo si `isSuperAdmin`
  - Crear `SuperAdminRoute` que redirige a no-superadmins
  - Registrar evento de analytics al navegar el panel global
  - _Requirements: 8.1, 8.2, 8.4_

- [x] 11. Paginas del panel de observabilidad global (frontend)
  - `pages/admin/AdminOverview.tsx`: tarjetas de metricas globales y salud
  - `pages/admin/AdminMetrics.tsx`: ingresos/ocupacion/no-show con selector de rango y de tenant
  - `pages/admin/AdminAudit.tsx`: tabla del audit trail con filtros y paginacion
  - Estados de carga, error y reintento; estado no disponible si health no responde; responsive
  - Registrar rutas `/admin/*` bajo `SuperAdminRoute` en `App.tsx`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2, 6.3, 7.3, 7.4, 8.5_

- [x] 12. Verificacion end-to-end
  - Ejecutar `seed:superadmin`, iniciar backend y frontend web
  - Login con `xcode.arturo@gmail.com`, confirmar acceso al panel global y ocultamiento para otros roles
  - Verificar metricas agregadas y audit trail contra datos de prueba
  - _Requirements: 2.5, 8.1, 8.2_

## Notes

- SUPERADMIN se decide por el `name` del rol firmado en el JWT; no requiere migracion del esquema.
- La credencial inicial del super usuario proviene de `SUPERADMIN_PASSWORD` (env), nunca del codigo.
- El modulo es de solo lectura: no expone mutaciones de datos de negocio ni de AuditLog.
- Las subtareas con `_Properties:` son candidatas a pruebas basadas en propiedades sobre las Correctness Properties del diseno.
- El framework de pruebas del backend debe confirmarse antes de la tarea 1.1; si no existe uno configurado, agregarlo como parte de esa subtarea.

