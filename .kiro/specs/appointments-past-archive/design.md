# Design Document

## Overview

Se agrega un campo `archived` a Appointment, un endpoint para archivar, y ajustes de
UI: en la columna Pasadas solo se permite Archivar, se limita a los ultimos 7 dias, y
se confirma el orden por horario (ya existente). El listado backend excluye
archivadas por defecto.

## Architecture

```
Appointment + archived (Boolean, default false)
PATCH /v1/appointments/:id/archive  (staff, tenant-scoped)
   -> appointmentService.archiveAppointment(tenantId, id) -> set archived=true
GET /v1/appointments  -> where archived=false por defecto
Frontend Appointments.tsx:
   - Pasadas: filtra a ultimos 7 dias, tarjeta con unica accion Archivar
   - Hoy/Proximas: sin cambios
```

## Components and Interfaces

### 1. Schema
- `Appointment.archived Boolean @default(false)`. Migracion via `prisma db push`
  (este proyecto no usa migrate; ver notas de tareas). Aditivo.

### 2. Backend service/controller/route
- `appointmentService.archiveAppointment(tenantId, appointmentId)`: carga via
  getAppointment (404 si es de otro tenant) y hace update { archived: true }.
  NO dispara runGoogleAppointmentHook.
- `listAppointments`: agrega `archived: false` al where (excluye archivadas).
- `appointmentController.archive` + ruta `PATCH /v1/appointments/:id/archive` con
  `requireStaff` (ADMIN o ASSISTANT), tenant-scoped, auditado (AuditAction.UPDATE).

### 3. Frontend (Appointments.tsx)
- `dataService.archiveAppointment(id)` -> PATCH /appointments/:id/archive.
- Grupo `past`: filtrar a start_time >= (hoy - 7 dias) y < inicio de hoy. Mantener
  orden descendente.
- Render de tarjeta en Pasadas: la tarjeta sigue abriendo detalles, pero el modal de
  detalle para citas pasadas muestra SOLO el boton Archivar (oculta confirmar/
  completar/no-asistio/cancelar/WhatsApp/gestionar). Alternativa: boton Archivar
  directo en la tarjeta pasada. Se elige: modal de detalle con unica accion Archivar
  para pasadas (consistente con el patron actual de acciones en el detalle).
- Tras archivar: recargar la lista (la cita desaparece).

## Data Models
- Appointment gana `archived Boolean @default(false)`. Sin otros cambios.

## Error Handling
- archiveAppointment de una cita ajena -> 404 APPOINTMENT_NOT_FOUND (via getAppointment).
- Fallos de red en el front -> mensaje y opcion de reintentar (patron actual).

## Correctness Properties

### Property 1: Archivar no destruye
Archivar solo cambia archived=true; status y datos permanecen; el registro sigue en DB.

**Validates: Requirements 1.2, 1.3**

### Property 2: Archivadas ocultas
El listado por defecto excluye archived=true, por lo que las archivadas no aparecen en ninguna columna.

**Validates: Requirements 1.3, 5.2**

### Property 3: Pasadas solo archivar
Para una cita pasada la UI no expone ninguna accion operativa salvo Archivar.

**Validates: Requirements 2.1, 2.2**

### Property 4: Ventana de 7 dias solo en Pasadas
Pasadas lista unicamente start_time en [hoy-7d, hoy); Hoy y Proximas no se ven afectadas.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Aislamiento por tenant
archiveAppointment y el listado se scopean por tenant; nunca tocan citas de otro tenant.

**Validates: Requirements 1.4**

## Testing Strategy
1. Unit `appointmentService.archiveAppointment`: setea archived, 404 en cita ajena,
   NO llama al hook de Google.
2. Unit `listAppointments`: el where incluye archived=false.
3. Frontend: verificacion manual + build (tsc/vite). Pasadas limitada a 7 dias y con
   unica accion Archivar; Hoy/Proximas intactas.
4. `tsc --noEmit` 0 errores; suites de appointment en verde.
