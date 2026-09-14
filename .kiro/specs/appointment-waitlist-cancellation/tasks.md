# Implementation Plan

## Overview

Encolamiento (waitlist FIFO), politica de cancelacion configurable con penalizacion
(deuda), cancelacion registrada solo por el emprendedor, reasignacion semiautomatica con
mensaje de WhatsApp "espacio abierto", y notificaciones in-app al emprendedor. Nuevos
modelos (CancellationPolicy, CustomerCancellationState, WaitlistEntry) + reuso de
Notification. Servicios, endpoints y UI siguiendo patrones existentes (authenticated +
requireStaff/requireAdmin, transacciones, WhatsApp por link manual). Aditivo:
`prisma db push` (Windows: detener node antes). Editar archivos con fs.writeFileSync
(SIN BOM), nunca Out-File utf8 en .ts/.tsx.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4"] },
    { "wave": 3, "tasks": ["5", "6"] },
    { "wave": 4, "tasks": ["7", "8"] },
    { "wave": 5, "tasks": ["9", "10", "11"] }
  ]
}
```

## Tasks

- [x] 1. Schema: modelos nuevos + campos de notificacion
  - `schema.prisma`: `CancellationPolicy { id, tenant_id @unique, grace_hours Int
    @default(24), allowed_cancellations Int @default(1), penalty_amount Decimal
    @default(0) @db.Decimal(10,2), reset_days Int @default(30), timestamps }
    @@map("cancellation_policies")`.
  - `CustomerCancellationState { id, tenant_id, customer_id, count Int @default(0),
    period_started_at DateTime @default(now()), debt_amount Decimal @default(0)
    @db.Decimal(10,2), debt_reason String?, timestamps } @@unique([tenant_id,
    customer_id]) @@index([tenant_id]) @@map("customer_cancellation_state")`.
  - `WaitlistEntry { id, tenant_id, branch_id String?, service_id, customer_id,
    desired_date DateTime, desired_start DateTime?, status WaitlistStatus
    @default(WAITING), offered_appointment_id String?, created_at, updated_at }`
    con `@@index([tenant_id, service_id, status, created_at])`, `@@index([customer_id])`,
    `@@map("waitlist_entries")`; enum `WaitlistStatus { WAITING OFFERED CONFIRMED EXPIRED
    CANCELLED }`.
  - `Notification`: agregar `read_at DateTime?` y `event_type String?` con
    `@@index([tenant_id, read_at])` (aditivo; no romper campos existentes).
  - Aplicar `prisma db push` + `prisma generate` (detener node antes en Windows). Reiniciar
    backend tras generar.
  - `tsc --noEmit` backend en verde.
  - _Requirements: 1.1, 2.2, 2.3, 3.1, 4.1, 6.1_

- [x] 2. Backend: cancellationPolicy.service (config politica)
  - Nuevo `cancellationPolicy.service.ts`: `getOrDefault(tenantId)` (defaults
    grace_hours=24, allowed_cancellations=1, penalty_amount=0, reset_days=30);
    `update(tenantId, data)` con validacion (todos >=0, numericos) -> 400
    VALIDATION_ERROR sin persistir.
  - Pruebas unitarias (mock prisma): defaults cuando no existe; update valido persiste;
    negativos/no numericos -> 400.
  - `tsc` + `jest --testPathPattern="cancellationPolicy"` en verde.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Backend: customerCancellation.service (contador + deuda)
  - Nuevo `customerCancellation.service.ts`: `getState(tenantId, customerId)` (crea
    implicito count 0; aplica reset si `period_started_at + reset_days < now`);
    `registerCancellation(tenantId, customerId)` (reset si toca, incrementa count; si
    `count > allowed_cancellations` suma `penalty_amount` a debt y setea razon);
    `hasDebt(...)`; `confirmPayment(...)` (deuda 0, limpia razon).
  - Pruebas unitarias (Property 4,5): incremento; reset por periodo; penaliza en N+1;
    hasDebt true/false; confirmPayment limpia.
  - `tsc` + `jest --testPathPattern="customerCancellation"` en verde.
  - _Requirements: 2.2, 2.3, 3.1, 3.3, 3.4_

- [x] 4. Backend: whatsapp.buildSpotOpenedLink (mensaje "espacio abierto")
  - `whatsapp.service.ts`: `buildSpotOpenedLink(tenantId, appointmentId)` analogo a
    `buildReminderLink`, con plantilla propia de "se abrio un espacio, confirma tu cita"
    y los mismos placeholders ({cliente},{negocio},{sucursal},{fecha},{hora},{contacto}).
    Reutiliza la resolucion de telefono/zona/sucursal existente. No envia nada.
  - Pruebas unitarias: placeholders reemplazados; fallback sucursal->negocio; sin
    telefono valido -> 400 PHONE_REQUIRED.
  - `tsc` + `jest --testPathPattern="whatsapp"` en verde.
  - _Requirements: 5.3_

- [x] 5. Backend: waitlist.service (FIFO + transiciones)
  - Nuevo `waitlist.service.ts`: `join(...)` (valida deuda -> 409 CUSTOMER_HAS_DEBT;
    idempotente por cliente/servicio/dia; crea WAITING); `listQueue(tenantId,
    {serviceId, date})` FIFO; `firstWaiting(...)`; `offer(tenantId, entryId, {start,end,
    branchId})` (ADMIN: re-verifica solape como booking.service -> 409 SLOT_TAKEN; crea
    cita PENDING; marca OFFERED, guarda offered_appointment_id); `confirmOffer(tenantId,
    entryId)` (marca CONFIRMED entrada + cita); `expire`/`cancelEntry`.
  - Pruebas unitarias (Property 2,3,9): FIFO estable; idempotencia; bloqueo por deuda;
    offer re-verifica solape (409); transiciones.
  - `tsc` + `jest --testPathPattern="waitlist"` en verde.
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.1, 5.3_

- [x] 6. Backend: notification.service (in-app best-effort)
  - Nuevo/extension `notification.service.ts`: `notify(tenantId, {event_type, title,
    body, appointment_id?, customer_id?})` best-effort (try/catch, nunca propaga);
    `listForTenant(tenantId, {unreadOnly?, limit?})`; `unreadCount(tenantId)`;
    `markRead(tenantId, id)` (scoped, 404 ajeno); `markAllRead(tenantId)`.
  - Pruebas unitarias (Property 8,1): notify no rompe ante fallo; listado/contador
    aislados por tenant; markRead ajeno -> 404.
  - `tsc` + `jest --testPathPattern="notification"` en verde.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 7. Backend: integrar en appointment.service (cancelar/crear/at-risk + bloqueo deuda)
  - `cancelAppointment`: dentro de tx, llamar `customerCancellation.registerCancellation`,
    marcar CANCELLED, revertir lealtad (actual); tras commit, `waitlist.firstWaiting` para
    sugerencia y `notification.notify("appointment_cancelled")`.
  - `create`/booking: bloquear si `hasDebt` -> 409 CUSTOMER_HAS_DEBT; al crear,
    `notification.notify("appointment_created")`. `waitlist.join` genera
    `notification.notify("appointment_waitlisted")`.
  - Nuevo `listOpenAtRisk(tenantId)`: citas PENDING no confirmadas con start_time dentro
    de las proximas 12h.
  - Pruebas unitarias (Property 4,5,6,7): cancelar incrementa/penaliza y notifica
    (best-effort mock); create con deuda -> 409; at-risk filtra 12h; sin ruta de
    cancelacion para cliente.
  - `tsc` + `jest --testPathPattern="appointment"` en verde.
  - _Requirements: 2.1, 2.4, 2.5, 3.2, 5.1, 5.5, 6.1_

- [x] 8. Backend: controladores + rutas + guards
  - Politica (ADMIN): GET/PATCH `/me/cancellation-policy`.
  - Deuda (ADMIN): GET `/customers/:id/cancellation-state`, POST
    `/customers/:id/confirm-penalty-payment`.
  - Waitlist: POST `/appointments/waitlist`, GET `/appointments/waitlist`, POST
    `/appointments/waitlist/:entryId/offer` (ADMIN), GET
    `/appointments/waitlist/:entryId/whatsapp`, POST `/appointments/waitlist/:entryId/
    confirm` (ADMIN).
  - At-risk: GET `/appointments/at-risk` (staff).
  - Notificaciones: GET `/me/notifications`, GET `/me/notifications/unread-count`, PATCH
    `/me/notifications/:id/read`, PATCH `/me/notifications/read-all`.
  - Guards `authenticated` + `requireStaff`/`requireAdmin` segun corresponde. Auditar
    acciones sensibles (cancelar, confirmar pago, ofrecer, confirmar, politica).
  - Prueba de integracion ligera: 403 sin ADMIN en acciones sensibles; 409 por deuda;
    bandeja aislada por tenant.
  - `tsc` + `jest --testPathPattern="cancellation|waitlist|notification|appointment"` verde.
  - _Requirements: 1.1, 1.2, 2.1, 3.2, 3.3, 4.1, 4.5, 5.2, 5.3, 5.4, 6.2, 6.3, 7.1, 7.2_

- [x] 9. Frontend: servicios + tipos
  - `services/cancellationPolicy.service.ts` (get/update); extender customer service con
    estado de cancelacion + confirmar pago; `services/waitlist.service.ts`
    (join/list/offer/whatsapp/confirm + at-risk); `services/notification.service.ts`
    (list/unreadCount/markRead/markAllRead). Tipos correspondientes. Usan `api` + unwrap.
  - `tsc --noEmit` en verde.
  - _Requirements: 1.1, 3.3, 4.1, 5.2, 6.2_

- [x] 10. Frontend: emprendedor (politica, cancelar, waitlist, deuda, at-risk)
  - Politica: tarjeta "Politica de cancelacion" (grace_hours, allowed_cancellations,
    penalty_amount, reset_days) con labels y guardado con feedback.
  - Appointments: boton "Cancelar (por llamada)" solo ADMIN; al cancelar, si hay cola,
    modal de sugerencia de reasignacion con "Generar mensaje de WhatsApp" (abre wa.me) y
    "Marcar confirmada". Panel "En espera" (FIFO) y lista "Espacios en riesgo (12h)".
  - Customers: badge de deuda + boton "Confirmar pago" (ADMIN).
  - Tokens de ui.ts, accesibilidad, estados loading/vacio/error.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.1, 2.1, 3.2, 3.3, 4.5, 5.1, 5.2, 5.3, 5.4_

- [x] 11. Frontend: campana de notificaciones + encolar cliente
  - Layout (barra superior): icono de campana con contador de no leidas + bandeja
    (dropdown) que lista notificaciones y permite marcar leidas (individual/todas). Usa
    el servicio de notificaciones; refresco al abrir.
  - Cliente (BookingPortal): opcion "Anotarme en espera" cuando el horario esta lleno,
    respetando bloqueo por deuda (mensaje claro). 
  - Tokens de ui.ts, accesibilidad (aria-live para el contador, foco en la bandeja).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 4.1, 4.3, 6.2, 6.3_

## Notes
- Aditivo; `prisma db push` (no migrate). Detener node antes en Windows; reiniciar backend
  tras `prisma generate` para cargar el nuevo cliente.
- Editar .ts/.tsx con herramientas de edicion o Node fs.writeFileSync (SIN BOM); NUNCA
  Out-File -Encoding utf8 (rompe el runtime de Vite -> pantalla en blanco).
- Reasignacion SEMIautomatica: el "12h antes" es filtro de consulta (at-risk), no un cron
  que mute datos; el emprendedor confirma cada oferta.
- WhatsApp permanece manual (link wa.me), sin API de mensajeria.
- El bloqueo por deuda aplica tanto a reservar como a encolarse (409 CUSTOMER_HAS_DEBT).
- Fallos de tests preexistentes y ajenos (auth.service, customer.service,
  adminUsersModules) se ignoran; no son regresiones de esta spec.
