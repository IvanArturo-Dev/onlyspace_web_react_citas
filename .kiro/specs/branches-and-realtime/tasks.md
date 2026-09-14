# Implementation Plan

## Overview

Plan para implementar sucursales (Branch), dashboards y monitoreo en (casi) tiempo real por polling, y administracion global del super admin (bloqueo, perfiles, modulos). Se construye sobre el portal de reservas existente.

Estrategia incremental de menor a mayor riesgo:
1. Modelo de datos (Branch, Holiday, ModuleFlag, last_seen, branch_id) + migracion de datos existentes.
2. Utilidades y middlewares transversales (codigo de sucursal, last_seen, no-bloqueado, modulo).
3. Sucursales del emprendedor (CRUD) y config por sucursal (horarios, asuetos, categorias).
4. Portal publico por sucursal + busqueda + disponibilidad con asuetos + reserva.
5. Dashboards (emprendedor y super admin) y monitoreo en tiempo real (polling).
6. Administracion global del super admin (usuarios/bloqueo/perfil, modulos) + alta de emprendedor con sucursal inicial.
7. Frontend por rol.
8. Verificacion end-to-end.

Reutiliza: JWT con role, multi-tenant Prisma/MySQL, authorizationService, availability/booking, writeAudit, requireSuperAdmin/requireAdmin, frontend con tema y guards.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["1.1", "3", "4", "5"] },
    { "wave": 3, "tasks": ["3.1", "4.1", "5.1", "6", "7"] },
    { "wave": 4, "tasks": ["6.1", "7.1", "8", "9"] },
    { "wave": 5, "tasks": ["8.1", "9.1", "10"] },
    { "wave": 6, "tasks": ["10.1", "11", "12", "13"] },
    { "wave": 7, "tasks": ["14", "15", "16"] },
    { "wave": 8, "tasks": ["17"] }
  ],
  "dependencies": {
    "1.1": ["1"],
    "2": ["1"],
    "3": ["1", "2"],
    "3.1": ["3"],
    "4": ["1", "2"],
    "4.1": ["4"],
    "5": ["1"],
    "5.1": ["5"],
    "6": ["3", "4"],
    "6.1": ["6"],
    "7": ["4", "6"],
    "7.1": ["7"],
    "8": ["6", "7"],
    "8.1": ["8"],
    "9": ["2", "5"],
    "9.1": ["9"],
    "10": ["2", "5"],
    "10.1": ["10"],
    "11": ["3", "4", "6"],
    "12": ["8"],
    "13": ["9", "10"],
    "14": ["7", "11"],
    "15": ["12"],
    "16": ["13"],
    "17": ["11", "12", "13", "14", "15", "16"]
  }
}
```

## Tasks

- [x] 1. Modelo de datos: Branch, Holiday, ModuleFlag, last_seen, branch_id
  - En `backend/prisma/schema.prisma`: crear modelo `Branch` (tenant_id, name, status, booking_code @unique, timezone, timestamps, index [tenant_id,status], map "branches")
  - Crear modelo `Holiday` (branch_id, date, label?, unique [branch_id,date], map "holidays")
  - Crear modelo `ModuleFlag` (scope, tenant_id?, module_key, enabled, unique [scope,tenant_id,module_key], map "module_flags")
  - Agregar `branch_id String?` a `Service`, `Appointment`, `Schedule` (con indices)
  - Agregar `last_seen DateTime?` a `User`
  - Aplicar con `prisma db push` y `prisma generate` sobre citas_dev
  - _Requirements: 2.1, 2.2, 3.2, 8.1, 10.4_

- [x] 1.1 Migracion de datos (backfill de sucursales)
  - Crear `backend/src/database/backfill-branches.ts` idempotente
  - Por cada Tenant: crear Branch "Principal" heredando su booking_code (o generar uno nuevo con la utilidad) si no existe
  - Asignar branch_id de esa Branch a Service/Appointment/Schedule del tenant sin sucursal
  - Script npm `backfill:branches`; ejecutar contra citas_dev
  - _Requirements: 2.1, 2.2_

- [x] 2. Utilidades y middlewares transversales
  - Reutilizar `bookingCode` para codigos de sucursal (mismo alfabeto/longitud/unicidad, verificando contra `Branch.booking_code`)
  - Middleware `touchLastSeen` (best-effort/throttled) que actualiza `User.last_seen` tras authMiddleware
  - Middleware/guard `ensureNotBlocked` -> 403 USER_BLOCKED si `is_active=false`
  - Integrar `touchLastSeen` y `ensureNotBlocked` en el pipeline de rutas autenticadas
  - _Requirements: 8.1, 10.2, 10.7_

- [x] 3. Servicio y endpoints de sucursales (Emprendedor)
  - `branchService`: list/create/update/get scoped por tenant; genera booking_code unico al crear
  - Rutas `/v1/branches` (GET, POST, GET/:id, PATCH/:id) con authMiddleware + requireAdmin
  - `GET /v1/branches/:id` incluye code y portal_path (`/reservar/<code>`)
  - Auditar creacion/edicion
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 4.1_

- [x] 3.1 Pruebas de sucursales (Property 1, Property 5)
  - Codigo de sucursal: formato/unicidad; crear genera codigo valido
  - Aislamiento: un emprendedor no lista/edita sucursales de otro tenant
  - _Requirements: 2.2, 2.5, 2.6_
  - _Properties: Property 1 (codigo de sucursal), Property 5 (aislamiento)_

- [x] 4. Config por sucursal: horarios, asuetos, categorias
  - `scheduleService` extendido para operar por branch_id (horario semanal de la sucursal)
  - `holidayService`: list/add/remove dias de asueto por sucursal (unique branch+date)
  - Categorias por sucursal: `Service` con branch_id; list/create/update/delete scoped por tenant+branch
  - Rutas: `/v1/branches/:id/schedule` (GET/POST), `/v1/branches/:id/holidays` (GET/POST/DELETE), categorias por `/v1/branches/:id/services` o `/v1/services?branch_id=`
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 4.1 Pruebas de config por sucursal (Property 5)
  - Horarios/asuetos/categorias scoped por sucursal; no afectan otra sucursal
  - Aislamiento por tenant
  - _Requirements: 3.6, 3.5_
  - _Properties: Property 5 (aislamiento)_

- [x] 5. Administracion de usuarios y modulos (servicios base)
  - `userAdminService`: list usuarios (rol, estado, last_seen); block/unblock (is_active); changeRole (rechaza SUPERADMIN)
  - `moduleService`: get/set ModuleFlag (scope system|tenant); `isModuleEnabled(tenantId, key)`
  - Auditar bloqueo/cambio de rol/conmutacion de modulo
  - _Requirements: 10.2, 10.3, 10.4, 10.6_

- [x] 5.1 Pruebas de admin de usuarios/modulos (Property 6, 7, 9)
  - block -> is_active=false; changeRole nunca produce SUPERADMIN
  - isModuleEnabled refleja el flag; deshabilitado -> false
  - _Requirements: 10.2, 10.3, 10.4_
  - _Properties: Property 6 (bloqueo efectivo), Property 7 (no elevacion), Property 9 (modulo)_

- [x] 6. Disponibilidad y reserva por sucursal
  - `availabilityService.getPublicAvailability` por branch_id: genera slots del horario de la sucursal, excluye asuetos (Holiday), ocupados y pasado
  - `bookingService.createPublicBooking` asocia branch_id; revalida solape en transaccion (no doble reserva)
  - _Requirements: 3.4, 4.4, 7.4_

- [x] 6.1 Pruebas de disponibilidad/reserva por sucursal (Property 3, 4)
  - Slots dentro de horario, excluye asueto/ocupado/pasado; dia de asueto -> sin slots
  - Reserva doble en misma sucursal -> 409
  - _Requirements: 3.4, 7.4_
  - _Properties: Property 3 (disponibilidad), Property 4 (no doble reserva)_

- [x] 7. Portal publico por sucursal + busqueda
  - Resolucion de codigo -> Branch activa -> tenant (`resolveBranchByCode`); invalida/inactiva -> 404 INVALID_CODE
  - `GET /v1/public/:code/info` (negocio+sucursal+categorias activas), `/availability`, `POST /appointments` por sucursal
  - `GET /v1/public/search?q=` busqueda basica por nombre de negocio/sucursal (datos no sensibles)
  - _Requirements: 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7.1 Pruebas de portal/busqueda (Property 2)
  - Codigo valido -> una sucursal; invalido/inactiva -> 404; busqueda no expone datos sensibles
  - _Requirements: 4.5, 5.4, 5.5_
  - _Properties: Property 2 (resolucion de sucursal)_

- [x] 8. Reservaciones del emprendedor (gestion por sucursal)
  - Listar reservaciones de sus sucursales con filtros (branch, estado, fechas)
  - Confirmar/cancelar/completar/no-show/modificar/agregar; validar disponibilidad al modificar/agregar
  - Auditar cambios de estado
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 8.1 Pruebas de reservaciones (Property 5)
  - Emprendedor solo opera reservaciones de sus sucursales
  - _Requirements: 7.6_
  - _Properties: Property 5 (aislamiento)_

- [x] 9. Monitoreo en tiempo real (backend, Super Admin)
  - `realtimeService`: sesiones activas (last_seen en ventana env, default 10 min) con rol y ultima actividad; reservaciones y cancelaciones recientes (24h); totales (emprendedores, sucursales, clientes, categorias, citas) y citas por estado
  - `GET /v1/admin/realtime` (requireSuperAdmin) devuelve el snapshot
  - _Requirements: 8.2, 8.3, 8.6, 9.1, 9.2, 9.3_

- [x] 9.1 Pruebas de realtime (Property 8)
  - Sesiones activas = usuarios con last_seen en la ventana; totales/recientes correctos
  - _Requirements: 8.2, 9.3_
  - _Properties: Property 8 (sesiones activas)_

- [x] 10. Endpoints de administracion global (Super Admin)
  - `GET /v1/admin/users`, `PATCH /v1/admin/users/:id/block`, `PATCH /v1/admin/users/:id/role`
  - `GET /v1/admin/modules`, `PATCH /v1/admin/modules`
  - Todos con requireSuperAdmin; auditar
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

- [x] 10.1 Pruebas de endpoints admin global (Property 6, 7, 9)
  - Matriz de roles (401/403/200); block efectivo; role no eleva a SUPERADMIN; modulo conmuta
  - _Requirements: 10.2, 10.3, 10.4_
  - _Properties: Property 6, Property 7, Property 9_

- [x] 11. Alta de emprendedor con sucursal inicial (Super Admin)
  - Extender `authorizationService.authorize` para crear una Branch inicial (con codigo) al dar de alta un emprendedor
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 12. Frontend Super Admin: dashboard en tiempo real
  - Hook `usePolling(fetchFn, intervalMs)` (pausa con document.hidden; expone error/reconexion)
  - Pagina `AdminRealtime`: totales, citas por estado, sesiones activas, reservaciones/cancelaciones recientes; auto-refresco ~5s; indicador de reconexion
  - _Requirements: 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Frontend Super Admin: usuarios y modulos
  - `AdminUsers`: tabla con bloquear/desbloquear y cambiar perfil
  - `AdminModules`: conmutar modulos (system y por emprendedor)
  - Navegacion y rutas en el area /admin
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 14. Frontend Emprendedor: sucursales y config por sucursal
  - `Sucursales` (CRUD) + selector de sucursal activa que contextualiza Horarios/Asuetos/Categorias/Reservaciones
  - `Horarios`, `Categorias`, `Asuetos` operan sobre la sucursal seleccionada
  - `MiCodigo` por sucursal: codigo, enlace y QR exportable (descargar imagen)
  - _Requirements: 2.1, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

- [x] 15. Frontend Emprendedor: dashboard y reservaciones
  - `Dashboard` del emprendedor: metricas del negocio y por sucursal, actividad reciente; estados de carga/error
  - `Reservaciones`: filtros por sucursal/estado/fecha; confirmar/cancelar/completar/no-show/modificar/agregar
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3_

- [x] 16. Frontend Cliente: busqueda de sucursal y portal
  - `Buscar sucursal`: input de codigo + busqueda por nombre; abre el portal de la sucursal
  - Portal de sucursal (reusa flujo actual resuelto por codigo de sucursal); Mis citas
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 4.4_

- [x] 17. Verificacion end-to-end
  - Aplicar migracion; super admin da de alta un emprendedor (crea sucursal inicial)
  - Emprendedor crea 2 sucursales con codigos, configura horarios/asuetos/categorias por sucursal, exporta QR
  - Cliente busca sucursal y agenda; emprendedor gestiona la reservacion
  - Super admin ve en su dashboard (polling) sesiones/reservaciones/cancelaciones; bloquea un usuario (403 efectivo) y conmuta un modulo (403 efectivo)
  - Confirmar aislamiento por tenant/sucursal y separacion de roles
  - _Requirements: 1.4, 3.4, 4.4, 5.4, 6.1, 7.3, 8.2, 9.1, 10.2, 10.4, 11.4_

## Notes

- El super admin administra todo sin filtro de tenant; el emprendedor queda aislado a su negocio/sucursales.
- "Bloquear" = `is_active=false`; `ensureNotBlocked` lo hace efectivo en requests posteriores.
- El cambio de perfil nunca otorga SUPERADMIN (solo el seed lo asigna).
- Tiempo real = polling; sesiones activas = last_seen reciente.
- La resolucion publica pasa de tenant.booking_code a branch.booking_code; la migracion preserva los codigos existentes.
- Aplicar cambios de esquema con `prisma db push` en citas_dev (sin carpeta de migraciones formal).
- Subtareas con `_Properties:` son candidatas a pruebas basadas en propiedades.
