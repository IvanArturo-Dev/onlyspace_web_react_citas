# Design Document

## Overview

Sistema de retencion y lealtad que acumula **citas completadas** por cliente y otorga **recompensas** segun reglas configurables por el emprendedor. Se integra sobre el backend Express + Prisma/MySQL y el frontend React/Vite existentes, reutilizando roles, aislamiento por tenant, auditoria y notificaciones.

Piezas nuevas:
- Modelos Prisma: `LoyaltyProgram`, `LoyaltyProgress`, `LoyaltyCountedAppointment`, `LoyaltyReward`.
- Servicio `loyaltyService` (acumulacion, otorgamiento, canje, expiracion) y `loyaltyProgramService` (CRUD de programas).
- Enganche (hook) en la transicion de cita a `COMPLETED` (y su reversa) dentro del flujo existente de cambio de estado de cita.
- Endpoints REST para emprendedor (programas + recompensas), cliente (progreso propio) y super admin (metricas globales).
- Frontend: seccion "Lealtad" del emprendedor, vista de progreso/recompensas del cliente, y un bloque de metricas para el super admin.

Principios: acumulacion **por tenant** (negocio), **solo COMPLETED**, **idempotencia** por cita/programa, **transacciones** para el cruce de meta, y **aislamiento por tenant** en todas las consultas.

## Architecture

### Flujo principal (acumulacion y otorgamiento)

```
Emprendedor/Asistente marca cita -> COMPLETED
        |
        v
appointmentService.updateStatus (existente)
        |
        v  (hook)
loyaltyService.onAppointmentCompleted(appointment)
        |
        +-- por cada LoyaltyProgram activo del tenant:
        |     - registra la cita como contada (idempotencia: (program_id, appointment_id))
        |     - incrementa LoyaltyProgress(program_id, customer_id)
        |     - si progreso alcanza meta N -> crea LoyaltyReward(EARNED) [transaccion]
        |           - ACCUMULATION: progreso -= N
        |           - fija expires_at si hay vigencia
        |           - writeAudit + Notification (best-effort)
        v
Respuesta normal del cambio de estado (la lealtad no bloquea el flujo principal)
```

### Reversa de completado

```
cita COMPLETED -> (CANCELLED/NO_SHOW/otro)
        |
        v (hook)
loyaltyService.onAppointmentUncompleted(appointment)
        - si la cita estaba contada para un programa, elimina ese registro y decrementa progreso
        - no revoca recompensas ya canjeadas; documenta el comportamiento para earned no canjeadas
```

### Idempotencia

Una tabla de conteo por evento evita doble acumulacion: la unicidad `(program_id, appointment_id)` garantiza que una cita cuenta una sola vez por programa aunque el hook se ejecute mas de una vez. La reversa borra ese registro.

## Components and Interfaces

### loyaltyProgramService (CRUD, scoped por tenant)
- `list(tenantId)`, `get(tenantId, id)`, `create(tenantId, data)`, `update(tenantId, id, data)`, `setActive(tenantId, id, active)`.
- Validacion: `goal >= 1`; si `type = PERIODIC` requiere `window_days >= 1`; `validity_days` nulo o `>= 1`.
- Aislamiento: toda consulta filtra por `tenant_id`.

### loyaltyService (motor)
- `onAppointmentCompleted({ tenant_id, id: appointment_id, customer_id, ... })`:
  - Carga programas activos del tenant.
  - Para cada uno, en transaccion: intenta insertar `LoyaltyCountedAppointment (program_id, appointment_id)`; si viola unicidad, no hace nada (idempotente).
  - Incrementa `LoyaltyProgress`.
  - Evalua meta segun tipo:
    - ACCUMULATION: si `count >= goal` -> crea `LoyaltyReward(EARNED)` y `count -= goal`.
    - PERIODIC: recalcula el conteo dentro de la ventana (citas contadas con `counted_at >= now - window_days`); si alcanza `goal` y no hay una recompensa vigente de ese ciclo, otorga.
  - `expires_at = now + validity_days` si aplica.
  - `writeAudit` + Notification best-effort.
- `onAppointmentUncompleted(appointment)`: elimina el `LoyaltyCountedAppointment` correspondiente y decrementa progreso; no revoca recompensas canjeadas.
- `redeem(tenantId, rewardId, userId)`: valida estado EARNED y no vencida; marca REDEEMED con `redeemed_at/redeemed_by`; 409 si ya canjeada; validacion si expirada.
- `expireDue(tenantId?)`: marca EXPIRED las recompensas con `expires_at < now` en estado EARNED. Se ejecuta por tarea programada y/o de forma perezosa al listar (defensa en profundidad).
- `progressForCustomer(tenantId, customerId)`: devuelve, por programa activo, `{ program, count, goal }`.
- Metricas: `statsForTenant(tenantId)` y `globalStats()` para super admin.

### Integracion con el flujo de citas
El hook se invoca desde el punto unico donde una cita cambia de estado (appointment status update). Debe:
- Ejecutarse **despues** de confirmar el cambio de estado.
- No romper el flujo si la lealtad falla (try/catch, registrar error): marcar la cita no debe fallar por un problema de lealtad.
- Detectar transiciones: `-> COMPLETED` (acumula) y `COMPLETED -> otro` (revierte).

### API (REST /v1)

Emprendedor (auth + requireAdmin; canje tambien para ASSISTANT via requireStaff):
- `GET /v1/loyalty/programs` | `POST /v1/loyalty/programs` | `GET/PATCH /v1/loyalty/programs/:id` | `PATCH /v1/loyalty/programs/:id/active`
- `GET /v1/loyalty/rewards?status=&customer_id=`
- `PATCH /v1/loyalty/rewards/:id/redeem`
- `GET /v1/loyalty/stats`

Cliente (auth):
- `GET /v1/me/loyalty` -> progreso y recompensas propias (resuelve el customer del usuario en el tenant correspondiente)

Super admin (requireSuperAdmin):
- `GET /v1/admin/loyalty/stats` -> metricas agregadas globales

### Frontend
- Servicios: `loyalty.service.ts` (programas, recompensas, stats); extender cliente para `GET /v1/me/loyalty`.
- Emprendedor: pagina `Lealtad` (ruta `/lealtad`, item de nav): administracion de programas (tabla + modal crear/editar, activar/desactivar) y recompensas por canjear (filtro por estado, busqueda por cliente, boton "Marcar canjeada"), con metricas arriba.
- Cliente: bloque "Mis recompensas / progreso" en `MyAppointments`: barras "7 de 10" por programa y lista de recompensas con estado/vencimiento; estado vacio claro.
- Super admin: tarjetas/grafica de metricas de lealtad reutilizando los componentes SVG de charts ya creados.
- Estilo: tokens de `ui.ts` y variables CSS, dark mode, estados de carga/error.

## Data Models

Consistente con el estilo del esquema actual (cuid ids, snake_case de columnas, `@@map`, indices por tenant). Los ids de relacion se guardan como campos sueltos (como ya se hace con `branch_id`), sin forzar relaciones formales salvo donde ayuda.

```prisma
enum LoyaltyProgramType {
  ACCUMULATION
  PERIODIC
}

enum LoyaltyRewardStatus {
  EARNED
  REDEEMED
  EXPIRED
}

model LoyaltyProgram {
  id             String             @id @default(cuid())
  tenant_id      String
  name           String
  type           LoyaltyProgramType @default(ACCUMULATION)
  goal           Int
  window_days    Int?
  reward_text    String
  validity_days  Int?
  is_active      Boolean            @default(true)
  created_at     DateTime           @default(now())
  updated_at     DateTime           @updatedAt

  @@index([tenant_id, is_active])
  @@map("loyalty_programs")
}

model LoyaltyProgress {
  id          String   @id @default(cuid())
  tenant_id   String
  program_id  String
  customer_id String
  count       Int      @default(0)
  updated_at  DateTime @updatedAt

  @@unique([program_id, customer_id])
  @@index([tenant_id])
  @@map("loyalty_progress")
}

model LoyaltyCountedAppointment {
  id             String   @id @default(cuid())
  program_id     String
  appointment_id String
  customer_id    String
  counted_at     DateTime @default(now())

  @@unique([program_id, appointment_id])
  @@index([program_id, customer_id])
  @@map("loyalty_counted_appointments")
}

model LoyaltyReward {
  id          String              @id @default(cuid())
  tenant_id   String
  program_id  String
  customer_id String
  status      LoyaltyRewardStatus @default(EARNED)
  reward_text String
  earned_at   DateTime            @default(now())
  expires_at  DateTime?
  redeemed_at DateTime?
  redeemed_by String?
  created_at  DateTime            @default(now())
  updated_at  DateTime            @updatedAt

  @@index([tenant_id, status])
  @@index([customer_id, status])
  @@map("loyalty_rewards")
}
```

Se aplica con `prisma db push` + `prisma generate` sobre `citas_dev` (mismo enfoque que el resto del proyecto, sin carpeta de migraciones formal). Nota Windows: detener el dev server que bloquea el DLL antes de generar.

## Correctness Properties

### Property 1: Idempotencia por cita
Procesar el mismo `appointment_id` varias veces para un programa produce exactamente 1 conteo; el otorgamiento no se duplica.

**Validates: Requirements 2.5, 3.6, 8.2**

### Property 2: Solo COMPLETED acumula
Ningun estado distinto de COMPLETED incrementa el progreso.

**Validates: Requirements 2.1, 2.3**

### Property 3: Meta y reinicio
Al alcanzar la meta N se crea exactamente una recompensa EARNED; en ACCUMULATION el progreso se reduce en N.

**Validates: Requirements 3.1, 3.2**

### Property 4: Aislamiento por tenant
Ninguna consulta de programas, progreso o recompensas cruza tenants.

**Validates: Requirements 1.6, 4.5, 7.2, 8.4**

### Property 5: Reversa consistente
COMPLETED -> otro estado decrementa el conteo y no deja conteos huerfanos.

**Validates: Requirements 2.4, 8.3**

### Property 6: Canje unico
Una recompensa EARNED pasa a REDEEMED una sola vez; un segundo canje falla (409); una recompensa expirada no puede canjearse.

**Validates: Requirements 4.2, 4.3**

### Property 7: Ventana PERIODIC
Solo cuentan las citas completadas dentro de la ventana vigente; citas fuera de ventana no otorgan.

**Validates: Requirements 2.6, 3.1**

## Error Handling

- Contrato consistente con el resto del backend: `HttpError(message, status, code)` -> `{ success:false, error:{ code, message } }`.
- Codigos: `VALIDATION_ERROR` (400) para meta/ventana/vigencia invalidas; `PROGRAM_NOT_FOUND` (404); `REWARD_NOT_FOUND` (404); `REWARD_ALREADY_REDEEMED` (409); `REWARD_EXPIRED` (400/409 al intentar canjear una vencida); `FORBIDDEN` (403) para acceso fuera de rol/tenant.
- El hook de lealtad se ejecuta en try/catch: si falla, registra el error y NO revierte ni bloquea el cambio de estado de la cita.
- Aislamiento: cualquier acceso a un recurso de otro tenant responde 404 (no revela existencia) o 403 segun el patron existente.
- La expiracion perezosa al listar nunca lanza: si el marcado falla, se registra y se continua devolviendo datos.

## Testing Strategy

Unit / property-based (backend, Jest):
- Property 1-7 anteriores, cada una con su prueba dedicada.
- Matriz de roles en endpoints (401/403/200) reutilizando el patron existente.
- Reversa: COMPLETED -> otro decrementa y no deja conteos huerfanos.

Verificacion E2E manual:
- Crear programa ACCUMULATION goal=2; completar 2 citas del mismo cliente en 2 sucursales -> 1 recompensa EARNED; progreso reinicia.
- Canjear; segundo canje -> 409.
- Programa PERIODIC goal=3/30 dias; completar 3 en ventana -> recompensa; una cuarta no duplica indebidamente.
- Cliente ve progreso y recompensas; aislamiento entre dos negocios.

Verificacion por tarea: `npx tsc --noEmit`, `npx jest --testPathPattern=loyalty --runInBand`, frontend `npx tsc --noEmit` + `npx vite build`.


