# Implementation Plan

## Overview

Cierra el punto 2: exponer online_sessions_enabled en el info publico, aceptar y
persistir modality en la reserva publica, y disparar el hook de Google best-effort
en createBranchBooking. Solo backend; el frontend ya esta listo.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

- Tarea 1 (extraer el runner del hook) es la base para la 3.
- Tarea 2 (info flag) es independiente; puede ir con la 3.
- Tarea 3 (booking: modality + hook) depende de 1.
- Tarea 4 (verificacion e2e local) depende de 2 y 3.

## Tasks

- [x] 1. Extraer runGoogleHook a un modulo compartido
  - Crear `backend/src/services/google-appointment-hook.ts` exportando `runGoogleAppointmentHook(action, tenantId, appointmentId)` con la implementacion actual (best-effort, try/catch, pino) movida tal cual.
  - Actualizar `appointment.service.ts` para importar y usar el runner compartido, sin cambiar comportamiento.
  - Verificar que la suite de appointment.service sigue en verde.
  - _Requirements: 3.1, 4.2, 4.3_

- [x] 2. Exponer online_sessions_enabled en GET /public/:code/info
  - En `public.controller.info`, consultar `prisma.googleAccount.findUnique({ where: { tenant_id } })` y derivar `online_sessions_enabled = status === "connected" && online_sessions`.
  - Agregar el booleano a `data`. NO exponer tokens ni otros campos del GoogleAccount.
  - Pruebas unitarias: true (connected+on), false (sin cuenta / no conectado / off), y que no filtra tokens.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Aceptar y persistir modality + hook en la reserva publica
  - `public.controller.createBooking`: leer `modality` del body, normalizar ("online" o "in_person"), pasar a createBranchBooking.
  - `booking.service.ts`: `CreatePublicBookingInput` gana `modality?`; persistir `modality: input.modality ?? "in_person"` en la Appointment.
  - Tras el commit, `await runGoogleAppointmentHook("created", branch.tenant_id, appointment.id)`; luego recargar y devolver `video_call_url` (y modality) en `CreatedBooking`.
  - Pruebas unitarias: persiste modality (online/default), llama al hook tras crear, best-effort (hook que lanza NO rompe la reserva), devuelve video_call_url cuando el hook lo escribio.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

- [x] 4. Verificacion e2e local (build + tests + humo)
  - `npx tsc --noEmit` (backend y frontend) 0 errores.
  - `npx jest --testPathPattern="booking|appointment|public|google" --runInBand` en verde (salvo fallos preexistentes ajenos ya conocidos: auth/customer/adminUsers).
  - Confirmar manualmente que `GET /public/:code/info` responde `online_sessions_enabled` (false para el tenant de prueba sin Google conectado).
  - _Requirements: 4.1, 4.2, 4.3_

## Notes

- Sin cambios de schema: modality, video_call_url y GoogleAccount ya existen.
- El hook es best-effort: nunca bloquea ni revierte la reserva.
- Fallos preexistentes ajenos (auth.service/customer.service/adminUsersModules) no son parte de este spec.
