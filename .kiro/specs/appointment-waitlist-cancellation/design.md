# Design Document

## Overview

Este diseno agrega tres capacidades sobre el modulo de citas existente, respetando
la arquitectura actual (servicios por dominio, controladores delgados, rutas con
`authenticated` + `requireStaff`/`requireAdmin`, aislamiento por `tenant_id`,
transacciones donde hay concurrencia, WhatsApp por link manual `wa.me`):

1. Politica de cancelacion configurable por tenant + contador de cancelaciones por
   cliente/negocio + deuda (penalizacion) con confirmacion manual de pago.
2. Cancelacion registrada SOLO por el emprendedor (ADMIN), que aplica la politica y
   dispara la deteccion de espacio liberado.
3. Encolamiento FIFO (waitlist) + reasignacion semiautomatica (sugerencia del sistema,
   confirmacion del emprendedor, mensaje WhatsApp "se abrio un espacio").
4. Notificaciones in-app al emprendedor (bandeja/campana) para nueva cita, encolada y
   cancelacion.

No se envian mensajes automaticos: el WhatsApp sigue siendo un link `wa.me` que el
emprendedor abre (consistente con el recordatorio actual). Las cancelaciones no tienen
endpoint de cliente.

## Data Models

Se usa `prisma db push` (no migrate). Nuevos modelos y campos:

### CancellationPolicy (nuevo, 1:1 con Tenant)
- `id String @id @default(cuid())`
- `tenant_id String @unique`
- `grace_hours Int @default(24)`         // horas antes del inicio con cancelacion sin falta
- `allowed_cancellations Int @default(1)`// cancelaciones permitidas por periodo antes de penalizar
- `penalty_amount Decimal @default(0) @db.Decimal(10,2)`
- `reset_days Int @default(30)`          // periodo de reinicio del contador (0 = no reinicia)
- timestamps
- `@@map("cancellation_policies")`

Si un tenant no tiene registro, se usan los defaults anteriores (getOrDefault).

### CustomerCancellationState (nuevo, por cliente/tenant)
- `id`, `tenant_id`, `customer_id`
- `count Int @default(0)`                // cancelaciones en el periodo vigente
- `period_started_at DateTime @default(now())` // inicio del conteo (para reset_days)
- `debt_amount Decimal @default(0) @db.Decimal(10,2)` // deuda pendiente (penalizacion)
- `debt_reason String?`
- timestamps
- `@@unique([tenant_id, customer_id])`
- `@@index([tenant_id])`
- `@@map("customer_cancellation_state")`

### WaitlistEntry (nuevo)
- `id`, `tenant_id`, `branch_id String?`, `service_id`, `customer_id`
- `desired_date DateTime`                // dia/franja deseada (referencia FIFO por dia/servicio)
- `desired_start DateTime?`              // inicio deseado si el cliente pidio hora concreta
- `status WaitlistStatus @default(WAITING)` // WAITING|OFFERED|CONFIRMED|EXPIRED|CANCELLED
- `offered_appointment_id String?`       // cita generada/asociada al ofrecer el espacio
- `created_at DateTime @default(now())`  // orden FIFO
- `updated_at`
- indices: `@@index([tenant_id, service_id, status, created_at])`, `@@index([customer_id])`
- `@@map("waitlist_entries")`

enum `WaitlistStatus { WAITING OFFERED CONFIRMED EXPIRED CANCELLED }`

### Notification (existente) — reuso
Ya existe el modelo `Notification`. Para las notificaciones in-app al emprendedor se
agrega (si falta) un campo `read_at DateTime?` y se usa `professional_id`/`tenant_id`
para dirigirlas al negocio. Se define un conjunto de "tipos" via el campo `title`/`body`
y un nuevo campo opcional `event_type String?` (ej. "appointment_created",
"appointment_waitlisted", "appointment_cancelled") para el contador/bandeja. Canal
in-app: se reutiliza `channel` con un valor logico (o se filtra por `event_type`).
`@@index([tenant_id, read_at])`.

Nota: si tocar el enum NotificationChannel resulta invasivo, las notificaciones in-app
se almacenan con el canal existente mas cercano y se distinguen por `event_type`; el
endpoint de bandeja filtra por `event_type != null` y `tenant_id`.

## Architecture

### cancellationPolicy.service.ts
- `getOrDefault(tenantId)` -> politica (o defaults).
- `update(tenantId, { grace_hours, allowed_cancellations, penalty_amount, reset_days })`
  con validacion (>=0, numericos) -> 400 VALIDATION_ERROR si invalido.

### customerCancellation.service.ts
- `getState(tenantId, customerId)` -> estado (crea implicito con count 0 si no existe;
  aplica reset si `period_started_at + reset_days < now`).
- `registerCancellation(tenantId, customerId)` (dentro de tx de cancelacion): aplica
  reset si corresponde, incrementa count; si `count > allowed_cancellations` agrega
  `penalty_amount` a `debt_amount` y setea `debt_reason`.
- `hasDebt(tenantId, customerId)` -> boolean.
- `confirmPayment(tenantId, customerId)` (ADMIN) -> pone `debt_amount=0`, limpia razon;
  audita.
- El bloqueo de reserva/encolamiento consulta `hasDebt` y lanza 409 CUSTOMER_HAS_DEBT.

### waitlist.service.ts
- `join({ tenantId, branchId?, serviceId, customerId, desiredDate, desiredStart? })`:
  valida deuda (409), idempotencia (no duplicar WAITING/OFFERED del mismo
  cliente/servicio/dia), crea WaitlistEntry WAITING. Genera notificacion "encolada".
- `listQueue(tenantId, { serviceId, date })` -> entradas WAITING en orden FIFO.
- `firstWaiting(tenantId, serviceId, date)` -> primera entrada compatible (FIFO).
- `offer(tenantId, entryId, { start, end, branchId })` (ADMIN): marca OFFERED, crea/asocia
  la cita (PENDING) para ese espacio y devuelve datos para el mensaje WhatsApp.
- `confirmOffer(tenantId, entryId)` (ADMIN): marca CONFIRMED y la cita asociada CONFIRMED.
- `expire(entryId)` / `cancelEntry`: transiciones EXPIRED/CANCELLED.

### appointment.service.ts (extension)
- `cancelAppointment` (existente) se amplia: dentro de la transaccion, llama
  `customerCancellation.registerCancellation`, marca CANCELLED, revierte lealtad
  (actual), y tras confirmar libera el espacio -> `waitlist.firstWaiting` para sugerir.
  Genera notificacion "cancelacion".
- Nuevo `listOpenAtRisk(tenantId)`: citas PENDING no confirmadas cuyo `start_time` cae
  dentro de las proximas 12h (candidatas a reasignacion) para la vista del emprendedor.
- `create` (existente) genera notificacion "nueva cita".
- Bloqueo por deuda: `create`/booking valida `hasDebt` -> 409 CUSTOMER_HAS_DEBT.

### notification.service.ts (nuevo o extension)
- `notify(tenantId, { event_type, title, body, appointment_id?, customer_id? })`
  best-effort (try/catch, nunca rompe la operacion principal).
- `listForTenant(tenantId, { unreadOnly?, limit? })`, `unreadCount(tenantId)`,
  `markRead(tenantId, id)`, `markAllRead(tenantId)`.

### whatsapp.service.ts (extension)
- `buildSpotOpenedLink(tenantId, appointmentId)`: analogo a `buildReminderLink`, pero
  con una plantilla propia de "se abrio un espacio, confirma tu cita" usando los mismos
  placeholders ({cliente},{negocio},{sucursal},{fecha},{hora},{contacto}). No envia nada;
  devuelve { url, message, phone }.

## Components and Interfaces

Politica (ADMIN):
- GET   /v1/me/cancellation-policy
- PATCH /v1/me/cancellation-policy

Deuda / estado de cancelacion (ADMIN):
- GET   /v1/customers/:id/cancellation-state
- POST  /v1/customers/:id/confirm-penalty-payment

Waitlist:
- POST  /v1/appointments/waitlist            (staff crea entrada; o publico si aplica) 
- GET   /v1/appointments/waitlist?service_id=&date=   (staff, cola FIFO)
- POST  /v1/appointments/waitlist/:entryId/offer      (ADMIN confirma reasignacion)
- GET   /v1/appointments/waitlist/:entryId/whatsapp   (link "espacio abierto")
- POST  /v1/appointments/waitlist/:entryId/confirm    (ADMIN marca CONFIRMED)

Espacios en riesgo (no confirmadas 12h antes):
- GET   /v1/appointments/at-risk              (staff)

Cancelacion (ADMIN, ya existe DELETE /v1/appointments/:id -> se amplia la logica).

Notificaciones (staff, tenant-scoped):
- GET   /v1/me/notifications?unread=1
- GET   /v1/me/notifications/unread-count
- PATCH /v1/me/notifications/:id/read
- PATCH /v1/me/notifications/read-all

Guards: `authenticated` + `requireStaff` (operativo) o `requireAdmin` (politica, deuda,
confirmar reasignacion) segun el patron existente.

## Frontend

- Config politica: seccion en la pantalla de configuracion del emprendedor (nueva
  tarjeta "Politica de cancelacion" en Profile o una pantalla dedicada), campos con
  labels asociados, guardado con feedback.
- Vista de cita (Appointments): boton "Cancelar (por llamada)" solo ADMIN; al cancelar,
  si hay alguien en cola, mostrar sugerencia de reasignacion (modal) con boton
  "Generar mensaje de WhatsApp" (abre wa.me) y "Marcar confirmada".
- Waitlist: en la agenda, un panel/pestana "En espera" por servicio/dia (FIFO) y una
  lista "Espacios en riesgo (12h)".
- Deuda: en la ficha del cliente (Customers), badge de deuda y boton "Confirmar pago".
- Notificaciones: icono de campana en la barra superior (Layout) con contador de no
  leidas y un dropdown/bandeja; marca como leidas. Usa el interceptor api actual.
- Cliente: opcion "Anotarme en espera" cuando un horario esta lleno en el portal de
  reserva (BookingPortal), respetando el bloqueo por deuda.
- Todo con tokens de ui.ts y accesibilidad (aria, foco, estados loading/vacio/error).

## Correctness Properties

### Property 1: Aislamiento por tenant
Toda politica, estado de cancelacion, entrada de waitlist y notificacion se filtra por
tenant_id; ninguna operacion devuelve o muta datos de otro tenant (404/403 en cruces).

**Validates: Requirements 7.1, 6.4**

### Property 2: FIFO estable
firstWaiting devuelve siempre la entrada WAITING mas antigua (menor created_at)
compatible con el servicio/dia; ofrecer nunca salta a una mas nueva mientras exista una
mas antigua en WAITING.

**Validates: Requirements 4.1, 4.5, 5.1**

### Property 3: Idempotencia de encolamiento
Un mismo cliente no puede tener dos entradas activas (WAITING/OFFERED) para el mismo
servicio/dia; un segundo join no crea duplicado.

**Validates: Requirements 4.2**

### Property 4: Penalizacion monotona y por periodo
El contador solo incrementa al cancelar; se reinicia cuando period_started_at +
reset_days < now; la deuda se agrega exactamente cuando count > allowed_cancellations.

**Validates: Requirements 2.2, 2.3, 3.4**

### Property 5: Bloqueo por deuda
Con debt_amount > 0, reservar o encolarse siempre falla con 409 CUSTOMER_HAS_DEBT; tras
confirmPayment (deuda 0) vuelve a permitirse.

**Validates: Requirements 3.2, 3.3, 4.3**

### Property 6: Cancelacion solo staff
No existe ruta accesible por un cliente para cancelar; la cancelacion siempre pasa por el
guard de staff/ADMIN.

**Validates: Requirements 2.1**

### Property 7: Reasignacion no automatica
Ninguna entrada pasa a OFFERED/CONFIRMED sin una accion explicita del emprendedor; el
filtro at-risk solo lee, no muta.

**Validates: Requirements 5.2, 5.5**

### Property 8: Notificaciones best-effort
Un fallo en notify nunca revierte ni impide la operacion principal (crear/cancelar/
encolar); las notificaciones listadas y el contador de no leidas respetan el aislamiento
por tenant.

**Validates: Requirements 6.1, 6.5**

### Property 9: Consistencia de reasignacion ante concurrencia
Al ofrecer un espacio se re-verifica el solape antes de crear la cita; si el slot fue
tomado, la operacion falla con 409 SLOT_TAKEN sin dejar la entrada inconsistente.

**Validates: Requirements 5.3, 7.4**

## Error Handling

- Validacion politica: 400 VALIDATION_ERROR.
- Reserva/encolamiento con deuda: 409 CUSTOMER_HAS_DEBT (mensaje claro en espanol).
- Entradas/citas de otro tenant: 404.
- Acciones sensibles sin ADMIN: 403 (guard).
- Notificaciones best-effort: los fallos se registran pero no propagan.
- Concurrencia: la cancelacion + registro de contador + deteccion de espacio en una
  transaccion; la oferta de waitlist re-verifica el solape antes de crear la cita
  (patron booking.service) -> 409 SLOT_TAKEN si se ocupo.

## Testing Strategy

Unit (jest, mock de prisma como en los tests existentes):
- cancellationPolicy: validacion y defaults.
- customerCancellation: incremento, reset por periodo, penalizacion al superar limite,
  hasDebt, confirmPayment.
- waitlist: join idempotente, bloqueo por deuda, FIFO (firstWaiting), transiciones
  offer/confirm/expire.
- appointment.cancel: incrementa contador, penaliza en el N+1, revierte lealtad, genera
  notificacion (best-effort mockeado).
- notification: notify best-effort (no rompe), listForTenant/unreadCount/markRead
  aislados por tenant.
- whatsapp.buildSpotOpenedLink: placeholders y fallback de sucursal/negocio.

Integration (supertest): endpoints con guards (403 sin ADMIN), 409 por deuda, cola FIFO,
oferta -> confirmacion, bandeja de notificaciones aislada por tenant.

## Sequenced Notes / Consistencia

- El contador y la deuda viven en CustomerCancellationState (por tenant+cliente),
  desacoplados de Customer para no ampliar ese modelo.
- La reasignacion NUNCA es automatica: el sistema solo detecta y sugiere; el emprendedor
  confirma (Requirement 5). El "12h antes" es un filtro de consulta (at-risk), no un job
  que mueva datos por su cuenta (se puede agregar un hook/cron opcional despues, fuera de
  este alcance).
- WhatsApp permanece manual (link wa.me); no se integra API de mensajeria.
