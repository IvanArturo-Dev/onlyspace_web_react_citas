# Implementation Plan

## Overview

Agregar archivado de citas, restringir acciones en Pasadas a solo Archivar, limitar
Pasadas a 7 dias, y confirmar orden por horario. Backend (schema+service+ruta) y
frontend (Appointments.tsx).

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Schema: campo archived en Appointment
  - Agregar `archived Boolean @default(false)` a `Appointment` en schema.prisma.
  - Detener node y aplicar con `prisma db push` (este proyecto NO usa migrate; migrate dev exige reset destructivo). `prisma generate`.
  - Verificar `tsc --noEmit` en backend.
  - _Requirements: 1.1_

- [ ] 2. Backend: archivar + excluir archivadas del listado
  - `appointmentService.archiveAppointment(tenantId, id)`: getAppointment (404 ajena) + update { archived: true }; NO llamar runGoogleAppointmentHook.
  - `listAppointments`: agregar `archived: false` al where.
  - `appointmentController.archive` + ruta `PATCH /v1/appointments/:id/archive` con requireStaff, auditada.
  - Pruebas unitarias: setea archived, 404 en ajena, no llama hook; listado filtra archived=false.
  - Verificar `tsc` + jest de appointment en verde.
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 5.2_

- [ ] 3. Frontend: Pasadas solo archivar + ventana 7 dias
  - `dataService.archiveAppointment(id)` -> PATCH /appointments/:id/archive.
  - En Appointments.tsx: grupo `past` filtrado a start_time en [hoy-7d, hoy) manteniendo orden descendente.
  - En el detalle de una cita PASADA: mostrar SOLO el boton Archivar (ocultar confirmar/completar/no-asistio/cancelar/WhatsApp/gestionar).
  - Tras archivar: recargar lista.
  - Verificar `tsc --noEmit` y `vite build`.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [ ] 4. Verificacion: orden por horario + no regresion
  - Confirmar que Hoy/Proximas ordenan ascendente y Pasadas descendente (ya existe; verificar tras cambios).
  - Correr `npx jest --testPathPattern="appointment" --runInBand` en verde.
  - Confirmar Hoy/Proximas conservan sus acciones.
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.3_

## Notes
- Prisma en Windows: detener procesos node antes de `prisma db push`/`generate` (EPERM).
- Este proyecto usa `prisma db push`, no migrate dev.
- Archivar NO toca Google (no dispara el hook).
