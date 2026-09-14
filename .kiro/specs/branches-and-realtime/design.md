# Design Document

## Overview

Este documento describe el diseno tecnico para: (1) introducir **sucursales (Branch)** bajo cada emprendedor (tenant), moviendo el codigo de reservas, horarios, dias de asueto y categorias al nivel de sucursal; (2) un **dashboard del emprendedor** y un **dashboard/monitoreo del super admin en (casi) tiempo real** por polling; y (3) **administracion global** por el super admin (bloquear usuarios, cambiar perfiles, conmutar modulos, alta de emprendedores).

Decisiones base (confirmadas):
- Un emprendedor = un tenant con **N sucursales**; cada sucursal tiene **su propio `booking_code`/QR**, horarios, asuetos y categorias.
- Tiempo real = **polling** cada pocos segundos (sin WebSockets).
- Sesiones activas = usuarios con **`last_seen`** dentro de una ventana reciente.
- Ofertas/promociones: fuera de alcance.

Se reutiliza: JWT con `role`, multi-tenant Prisma/MySQL, `AuthorizedAdmin`, `authorizationService`, `availabilityService`/`bookingService`, `writeAudit`, guards `requireSuperAdmin`/`requireAdmin`, y el frontend con tema y guards por rol.

## Architecture

### Jerarquia de datos

```
Tenant (negocio del emprendedor)
  └── Branch (sucursal) 1..N   [booking_code unico por sucursal]
        ├── BranchSchedule (horario semanal)  -> ScheduleDay
        ├── Holiday (dias de asueto)
        ├── Service (categoria, ahora con branch_id)
        └── Appointment (cita, ahora con branch_id)
```

El `booking_code` se mueve conceptualmente del Tenant a la Branch. La resolucion publica `code -> branch -> tenant`.

### Roles y flujo (se mantiene, se extiende)

```
SUPERADMIN  -> alta de emprendedores, admin global (bloqueo/perfil/modulos), monitoreo tiempo real
ADMIN (emprendedor) -> administra sus Branches, horarios, asuetos, categorias, reservaciones; dashboard propio
CLIENT      -> panel de busqueda de sucursal, portal por codigo, sus citas
```

### last_seen y sesiones activas

Un middleware ligero (`touchLastSeen`) se ejecuta tras `authMiddleware` en rutas autenticadas y actualiza `User.last_seen = now()` de forma best-effort (sin bloquear la respuesta; escritura throttled para no saturar: solo si pasaron > N segundos desde el ultimo update). El super admin consulta "sesiones activas" como usuarios con `last_seen >= now - VENTANA` (config por env, default 10 min).

### Bloqueo de usuarios

`authMiddleware` (o un guard adicional) verifica `User.is_active`/`blocked`. Si el usuario esta bloqueado, responde 403 `USER_BLOCKED`, incluso con JWT valido. Esto hace efectivo el bloqueo en requests siguientes (Req 10.7).

## Components and Interfaces

### Data model (Prisma) — cambios

Aditivos, con migracion de datos para negocios/citas existentes.

1. **Nuevo modelo `Branch`**:
   ```
   model Branch {
     id            String   @id @default(cuid())
     tenant_id     String
     name          String
     status        String   @default("active") // active | inactive
     booking_code  String?  @unique
     timezone      String   @default("America/Mexico_City")
     created_at    DateTime @default(now())
     updated_at    DateTime @updatedAt
     tenant        Tenant   @relation(fields: [tenant_id], references: [id])
     @@index([tenant_id, status])
     @@map("branches")
   }
   ```
2. **`Service`**: agregar `branch_id String?` (+ indice). Las categorias pasan a pertenecer a una sucursal.
3. **`Appointment`**: agregar `branch_id String?` (+ indice). Las citas se asocian a la sucursal donde se agendan.
4. **`Schedule`**: agregar `branch_id String?` para vincular el horario a una sucursal (se mantiene `tenant_id` por compatibilidad).
5. **Nuevo modelo `Holiday`** (dias de asueto por sucursal):
   ```
   model Holiday {
     id         String   @id @default(cuid())
     branch_id  String
     date       DateTime // fecha del asueto (a medianoche UTC)
     label      String?
     created_at DateTime @default(now())
     @@unique([branch_id, date])
     @@index([branch_id])
     @@map("holidays")
   }
   ```
6. **`User`**: agregar `last_seen DateTime?` y `blocked Boolean @default(false)` (o reutilizar `is_active`: se usara `is_active=false` como bloqueado para no duplicar; se documenta que "bloquear" setea `is_active=false`). Para claridad de dominio se usa `is_active` existente como estado de bloqueo.
7. **Nuevo modelo `ModuleFlag`** (modulos conmutables):
   ```
   model ModuleFlag {
     id         String   @id @default(cuid())
     scope      String   // 'system' | 'tenant'
     tenant_id  String?  // null para system
     module_key String   // p.ej. 'branches','reservations','search'
     enabled    Boolean  @default(true)
     updated_at DateTime @updatedAt
     @@unique([scope, tenant_id, module_key])
     @@map("module_flags")
   }
   ```
8. **`Tenant.booking_code`**: se conserva por compatibilidad pero deja de usarse para resolucion publica (la resolucion pasa a `Branch.booking_code`). La migracion crea una Branch por cada tenant existente heredando su `booking_code`.

### Migracion de datos

Script idempotente que, para cada Tenant existente:
- Crea una Branch "Principal" con el `booking_code` del tenant (si tenia) o uno nuevo.
- Asigna `branch_id` de esa Branch a los `Service`, `Appointment` y `Schedule` existentes del tenant que no tengan sucursal.
Se ejecuta con `prisma db push` (schema) + un seed de migracion (`backfill-branches.ts`).

### Backend: servicios y endpoints

**Alta de emprendedores (Super Admin)** — reutiliza `authorizationService`, extendido para crear una Branch inicial:
- `POST /v1/admin/authorized { email }` — autoriza + asegura tenant + crea Branch inicial con codigo.

**Sucursales (Emprendedor)** — bajo `/v1/branches`, `authMiddleware + requireAdmin`, scoped al tenant del token:
- `GET /v1/branches` — lista sus sucursales.
- `POST /v1/branches { name }` — crea sucursal (genera booking_code).
- `PATCH /v1/branches/:id` — edita nombre/estado.
- `GET /v1/branches/:id` — detalle (incluye code, portal_path).

**Config por sucursal** (scoped a branch del tenant):
- `GET/POST /v1/branches/:id/schedule` — horario semanal.
- `GET/POST/DELETE /v1/branches/:id/holidays` — dias de asueto.
- `GET/POST /v1/branches/:id/services` (o reutilizar `/v1/services?branch_id=`) — categorias por sucursal.

**Portal publico por sucursal** — bajo `/v1/public`:
- `GET /v1/public/:code/info` — resuelve Branch por codigo -> negocio+sucursal+categorias activas.
- `GET /v1/public/:code/availability?service_id=&date=` — disponibilidad de esa sucursal (excluye asuetos).
- `POST /v1/public/:code/appointments` — reserva en esa sucursal (transaccional, no doble reserva).
- `GET /v1/public/search?q=` — busqueda basica de sucursales por nombre (datos no sensibles).

**Dashboard emprendedor**:
- `GET /v1/me/dashboard` — metricas del negocio: sucursales, categorias, citas por estado, actividad reciente; soporta `?branch_id=` para filtrar.
- `GET /v1/me/appointments` (emprendedor) — reservaciones de sus sucursales con filtros (branch, estado, fechas); ya existe base, se extiende con branch.

**Super Admin — monitoreo y admin global** — bajo `/v1/admin`, `requireSuperAdmin`:
- `GET /v1/admin/realtime` — snapshot para polling: sesiones activas (por last_seen), reservaciones y cancelaciones recientes (24h), totales (emprendedores, sucursales, clientes, categorias, citas), citas por estado.
- `GET /v1/admin/users` — lista de usuarios con rol, estado, last_seen.
- `PATCH /v1/admin/users/:id/block { blocked }` — bloquea/desbloquea (setea is_active).
- `PATCH /v1/admin/users/:id/role { role }` — cambia perfil (no permite elevar a SUPERADMIN por esta via).
- `GET /v1/admin/modules` y `PATCH /v1/admin/modules { scope, tenant_id?, module_key, enabled }` — conmuta modulos.

### Middlewares nuevos

- `touchLastSeen`: actualiza `User.last_seen` best-effort/throttled tras authMiddleware.
- `ensureNotBlocked`: 403 `USER_BLOCKED` si el usuario esta bloqueado (is_active=false). Se integra en authMiddleware o como guard tras el.
- `requireModule(moduleKey)`: opcional en rutas de emprendedor; 403 `MODULE_DISABLED` si el modulo esta deshabilitado para su tenant/sistema.

### Frontend

- **Super Admin**:
  - `AdminRealtime` (dashboard tiempo real): totales, citas por estado, sesiones activas, reservaciones/cancelaciones recientes; `useEffect` + `setInterval` para polling (cada ~5s), con pausa al ocultar pestana; indicador de reconexion ante fallo.
  - `AdminUsers`: tabla de usuarios con acciones bloquear/desbloquear y cambiar perfil.
  - `AdminModules`: lista de modulos conmutables (system y por emprendedor).
  - Se mantienen Autorizaciones/Observabilidad previas.
- **Emprendedor**:
  - `Sucursales`: CRUD de sucursales; selector de sucursal activa que contextualiza Horarios/Asuetos/Categorias/Reservaciones.
  - `Horarios`, `Categorias`, `Asuetos` ahora operan sobre la sucursal seleccionada.
  - `MiCodigo` -> por sucursal: muestra codigo, enlace y QR exportable (descargar imagen) de la sucursal.
  - `Dashboard` del emprendedor: metricas del negocio y por sucursal.
  - `Reservaciones`: lista con filtros por sucursal/estado/fecha; confirmar/cancelar/completar/no-show/modificar/agregar.
- **Cliente**:
  - `Buscar sucursal`: input de codigo + busqueda por nombre; abre el portal de la sucursal.
  - Portal de sucursal (reusa el flujo actual, ahora resuelto por codigo de sucursal).
  - `Mis citas`.
- **Polling util**: hook `usePolling(fetchFn, intervalMs)` que refresca y expone estado de error/reconexion; pausa cuando `document.hidden`.

## Data Models (resumen de proposito)

- `Branch`: sucursal; portadora del `booking_code`, timezone, estado.
- `Holiday`: fecha de asueto por sucursal, excluida de disponibilidad.
- `ModuleFlag`: conmutador de modulo por sistema o por tenant.
- `Service`/`Appointment`/`Schedule`: ganan `branch_id`.
- `User`: gana `last_seen`; `is_active` representa bloqueo.

## Availability Algorithm (extendido)

Igual que el actual, pero:
- Los slots se generan desde el `Schedule` de la **sucursal** (branch_id) y su duracion de categoria.
- Se excluyen fechas presentes en `Holiday` de la sucursal (si la fecha consultada es asueto -> sin disponibilidad).
- Se excluyen citas no canceladas de esa sucursal.
- La reserva revalida en transaccion el solape en la sucursal (no doble reserva).

## Error Handling

- Codigo de sucursal invalido/inactiva -> 404 `INVALID_CODE`.
- Reserva en slot ocupado -> 409 `SLOT_TAKEN`.
- Usuario bloqueado -> 403 `USER_BLOCKED`.
- Modulo deshabilitado -> 403 `MODULE_DISABLED`.
- Acceso cruzado entre tenants/sucursales -> 403/404 segun corresponda.
- Polling: fallos de red conservan ultimos datos y muestran indicador; no rompen el panel.
- Cambio de perfil que intente elevar a SUPERADMIN -> 400/403 (no permitido por esta via).
- Auditoria best-effort no bloquea la operacion principal.

## Security Considerations

- El rol viaja firmado en el JWT; el backend valida rol, estado (bloqueado) y modulo en cada endpoint.
- La resolucion de codigo mapea a UNA sucursal/tenant; endpoints publicos solo exponen datos no sensibles.
- Aislamiento por tenant en todas las consultas de emprendedor; el super admin ignora el filtro de forma controlada.
- Cambiar perfil no puede otorgar SUPERADMIN; alta de emprendedor solo por el super admin.
- Bloqueo efectivo: is_active=false -> 403 en requests posteriores.
- Rate limiting global aplica a busqueda/portal publico.

## Correctness Properties

### Property 1: Unicidad y formato del codigo de sucursal

Toda sucursal activa tiene un `booking_code` de 6 caracteres del alfabeto permitido, y no existen dos sucursales con el mismo codigo.

**Validates: Requirements 2.2, 2.6, 4.5**

### Property 2: Resolucion inequivoca de sucursal por codigo

Resolver un codigo valido devuelve exactamente una sucursal activa (y su tenant); un codigo inexistente o de sucursal inactiva no resuelve.

**Validates: Requirements 4.4, 4.5, 5.4**

### Property 3: Disponibilidad respeta horario, asuetos y ocupacion

Todo slot ofrecido de una sucursal esta dentro de su horario, no cae en un dia de asueto, no se solapa con citas no canceladas de esa sucursal, y no esta en el pasado.

**Validates: Requirements 3.4, 3.1**

### Property 4: No doble reserva por sucursal

No existe secuencia de reservas concurrentes que produzca dos citas no canceladas solapadas en la misma sucursal.

**Validates: Requirements 7.4**

### Property 5: Aislamiento por tenant/sucursal

Ninguna consulta de un emprendedor devuelve u opera datos (sucursales, horarios, asuetos, categorias, reservaciones) de otro negocio o sucursal ajena.

**Validates: Requirements 2.5, 3.6, 7.6, 11.4**

### Property 6: Bloqueo efectivo

Para cualquier usuario con estado bloqueado, todo request autenticado posterior es rechazado (403), independientemente de tener un JWT valido.

**Validates: Requirements 10.2, 10.7, 11.5**

### Property 7: No elevacion a super admin por cambio de perfil

Ninguna operacion de cambio de perfil por el super admin (ni por nadie) produce un usuario con rol SUPERADMIN; ese rol solo se asigna por el mecanismo de seed.

**Validates: Requirements 10.3**

### Property 8: Sesiones activas = actividad reciente

El conjunto de "sesiones activas" reportado es exactamente el de usuarios cuyo `last_seen` esta dentro de la ventana configurada al momento de la consulta.

**Validates: Requirements 8.1, 8.2, 9.3**

### Property 9: Modulo deshabilitado bloquea acceso

Si un modulo esta deshabilitado para un emprendedor (o sistema), sus endpoints asociados responden 403 y sus pantallas no estan disponibles para ese emprendedor.

**Validates: Requirements 10.4, 10.5**

## Testing Strategy

- Unit (backend):
  - `branchCode`/reuso de bookingCode: formato/unicidad del codigo de sucursal.
  - `branchService`: crear/editar/desactivar scoped por tenant; genera codigo unico.
  - `holidayService` + disponibilidad: excluye asuetos; dia de asueto -> sin slots.
  - `availabilityService` por sucursal: slots correctos; excluye ocupados/pasado/asueto.
  - `bookingService` por sucursal: 409 en solape; asocia branch_id.
  - `userAdminService`: bloquear (is_active=false), cambiar rol (rechaza SUPERADMIN), auditoria.
  - `moduleService`/`requireModule`: 403 cuando deshabilitado.
  - `ensureNotBlocked`: 403 USER_BLOCKED con usuario bloqueado.
  - `realtimeService`: sesiones activas = last_seen en ventana; recientes 24h; totales correctos.
- Integracion (backend): endpoints `/v1/branches/*`, `/v1/public/*` (por sucursal), `/v1/admin/realtime|users|modules` con matriz de roles (401/403/200), bloqueo efectivo, aislamiento por tenant.
- Property-based (candidatas): Property 1 (codigo), Property 3 (disponibilidad con asuetos), Property 4 (no doble reserva), Property 5 (aislamiento), Property 6 (bloqueo), Property 8 (sesiones activas).
- Frontend: guards por rol; dashboards con polling (mock timers); CRUD de sucursales/horarios/asuetos; QR exportable; panel de busqueda; bloqueo/perfil/modulos del super admin.
- E2E manual: super admin da de alta emprendedor -> emprendedor crea 2 sucursales con codigos, configura horarios/asuetos/categorias por sucursal, exporta QR -> cliente busca sucursal y agenda -> emprendedor gestiona reservacion -> super admin ve en su dashboard (polling) las sesiones/reservaciones/cancelaciones y puede bloquear un usuario / conmutar un modulo.
