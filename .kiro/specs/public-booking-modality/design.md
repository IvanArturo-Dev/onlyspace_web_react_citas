# Design Document

## Overview

Tres cambios pequenos y acotados en el backend cierran el punto 2, sin tocar el
frontend (que ya esta listo):
1. `public.controller.info` agrega `online_sessions_enabled` leyendo el GoogleAccount
   del tenant.
2. `public.controller.createBooking` acepta `modality` y la pasa al servicio.
3. `booking.service.createBranchBooking` persiste `modality` y dispara el hook de
   Google best-effort (reutilizando el runner ya existente en appointment.service).

## Architecture

```
GET /public/:code/info
   -> resolveBranchByCode -> tenant
   -> prisma.googleAccount.findUnique({ tenant_id })
   -> online_sessions_enabled = (status==="connected" && online_sessions)

POST /public/:code/appointments  { service_id, start_time, modality? }
   -> createBranchBooking(branchId, { service_id, start_time, modality }, user)
        -> persiste Appointment.modality
        -> tras commit: runGoogleHook("created", tenant_id, appointment.id)  [best-effort]
        -> recarga video_call_url y lo devuelve
```

Reutilizacion del hook: `runGoogleHook` es actualmente una funcion privada de
`appointment.service.ts`. Para usarla desde `booking.service.ts` sin duplicarla, se
expone un runner reutilizable. Opciones:
- (Elegida) Extraer `runGoogleHook` a un modulo compartido
  `src/services/google-appointment-hook.ts` que exporte
  `runGoogleAppointmentHook(action, tenantId, appointmentId)`, e importarlo tanto
  desde appointment.service como desde booking.service. Mantiene una sola
  implementacion best-effort.

## Components and Interfaces

### 1. Modulo compartido del hook (refactor sin cambio de comportamiento)

- Nuevo `src/services/google-appointment-hook.ts` con
  `runGoogleAppointmentHook(action: "created"|"confirmed"|"rescheduled"|"cancelled",
  tenantId: string, appointmentId: string): Promise<void>`.
- Mueve la implementacion actual de `runGoogleHook` (best-effort, try/catch, pino)
  tal cual. `appointment.service.ts` pasa a importar y usar este runner (sin cambiar
  su comportamiento ni sus tests, que mockean googleIntegration/googleAccount).

### 2. public.controller.info

- Tras resolver tenant, consulta `prisma.googleAccount.findUnique({ where: {
  tenant_id: branch.tenant_id } })`.
- `online_sessions_enabled = !!ga && ga.status === "connected" && ga.online_sessions`.
- Agrega el booleano al objeto `data`. No expone ningun otro campo del GoogleAccount.

### 3. public.controller.createBooking

- Lee `modality` del body ademas de service_id/start_time.
- Normaliza: solo "online" cuenta como online; cualquier otro valor => "in_person".
- Lo pasa a `createBranchBooking(..., { service_id, start_time, modality }, user)`.

### 4. booking.service.createBranchBooking

- `CreatePublicBookingInput` gana `modality?: "in_person" | "online"`.
- Al crear la Appointment agrega `modality: input.modality ?? "in_person"`. Cuando es
  "online" el hook lo reconoce (googleIntegration.isOnline detecta modality "online").
- DESPUES del commit de la transaccion (patron identico a la auditoria best-effort
  que ya corre fuera de la transaccion), llama
  `await runGoogleAppointmentHook("created", branch.tenant_id, appointment.id)`.
- Tras el hook, recarga `video_call_url` de la cita (el hook pudo haberlo escrito) y
  lo incluye en el `CreatedBooking` devuelto. `CreatedBooking` gana
  `video_call_url?: string | null` y `modality?: string`.

## Data Models

No hay cambios de schema: `Appointment.modality`, `Appointment.video_call_url` y
`GoogleAccount` ya existen. Solo se leen/escriben campos existentes.

## Error Handling

- `googleAccount.findUnique` en info: si no hay registro -> null -> flag false. Un
  error de DB se maneja con el `sendError` existente (500), pero NO deberia ocurrir en
  el camino feliz.
- El hook es best-effort: cualquier fallo de Google se traga dentro del runner
  (try/catch + pino), nunca rompe la reserva.
- `modality` invalida se normaliza a "in_person" (no rompe la reserva).

## Correctness Properties

### Property 1: Flag derivado correcto
`online_sessions_enabled` es true si y solo si existe GoogleAccount con status "connected" y online_sessions true.

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Modalidad persistida y normalizada
La cita creada guarda modality "online" solo cuando el cliente lo pidio; en cualquier otro caso "in_person".

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Hook best-effort en reserva publica
createBranchBooking dispara el hook tras persistir; un fallo de Google no bloquea ni revierte la reserva.

**Validates: Requirements 3.1, 3.3**

### Property 4: Meet en linea via cuenta del tenant
Cuando la cita es en linea y el tenant tiene Google conectado, se genera Meet en la cuenta del tenant y se devuelve video_call_url.

**Validates: Requirements 3.2, 3.4**

### Property 5: Sin tokens en respuesta publica
La respuesta de info nunca incluye tokens ni campos sensibles del GoogleAccount, solo el booleano derivado.

**Validates: Requirements 1.3**

## Testing Strategy

1. Unit `public.controller.info`: online_sessions_enabled true (connected+on), false
   (no account / not connected / off), y que no filtra tokens. prisma mockeado.
2. Unit `createBranchBooking`: persiste modality (online / default in_person); llama
   al hook tras crear; un hook/Google que lanza NO rompe la reserva (best-effort);
   devuelve video_call_url cuando el hook lo escribio. Hook y prisma mockeados.
3. No-regresion: la suite existente de booking (aforo, INVALID_TIME, holiday,
   DUPLICATE_BOOKING, SLOT_TAKEN) sigue verde; appointment.service sigue verde tras
   extraer el runner.
4. `npx tsc --noEmit` 0 errores; jest de booking/appointment/public en verde.
