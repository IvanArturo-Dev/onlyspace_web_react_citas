# Implementation Plan

## Overview

El emprendedor elige presencial/en linea al crear y gestionar citas internas. Backend
persiste modality; frontend agrega selector gated por online_sessions.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] }
  ]
}
```

## Tasks

- [ ] 1. Backend: persistir modality en create/update
  - `appointmentService`: helper `normalizeModality`. En `createAppointment` agregar `modality: normalizeModality(data.modality)` al `prisma.appointment.create`.
  - En `updateAppointment`: cuando `data.modality !== undefined`, incluir `modality` normalizada en el update (ambas ramas: update directo sin cambio de horario, y update transaccional).
  - Pruebas unitarias (tests/unit/appointment.service.test.ts): create persiste online/in_person/valor invalido->in_person; update persiste modality normalizada sin resetear otros campos.
  - `tsc --noEmit` backend + `jest --testPathPattern="appointment"` en verde.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_

- [ ] 2. Frontend: selector de modalidad en crear cita
  - En `Appointments.tsx`: cargar `onlineEnabled` una vez via `googleService.getStatus()` al montar (best-effort, false si falla).
  - FormState gana `modality` (default "in_person"). Selector Presencial/En linea en el modal de crear; "En linea" solo si onlineEnabled. Enviar `modality` en el payload de createAppointment.
  - Asegurar que `AppointmentPayload`/`updateAppointment` acepten modality en data.service.ts.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 3.1, 3.2, 3.3, 4.1_

- [ ] 3. Frontend: modalidad en gestion + detalle
  - En el panel de gestion (reprogramar): agregar selector de modalidad (mismo gating), precargado con la modalidad actual; incluir `modality` en `updateAppointment`.
  - En el detalle de la cita: mostrar fila "Modalidad" (Presencial/En linea). El enlace Meet ya se muestra.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 3.4, 3.5, 4.2, 4.3_

## Notes
- Reusar el hook de Google existente (no cambia): online + confirmar -> Meet.
- Sin cambios de schema (modality ya existe).
- Gating de "en linea" por online_sessions, coherente con el portal publico.
