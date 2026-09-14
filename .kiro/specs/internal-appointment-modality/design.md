# Design Document

## Overview

Cierra el gap de modalidad en el flujo interno: el backend persiste `modality` en
createAppointment y updateAppointment; el frontend agrega un selector Presencial/En
linea en el modal de crear y en el panel de gestion, habilitando "En linea" solo si el
tenant tiene online_sessions activo.

## Architecture

```
Panel interno (Appointments.tsx)
  getStatus() -> { online_sessions }  ==> habilita opcion "En linea"
  Crear cita  -> payload { ..., modality } -> POST /appointments
  Gestionar   -> updateAppointment { ..., modality } -> PATCH /appointments/:id

Backend appointmentService
  createAppointment: data.create.modality = normalize(modality)
  updateAppointment: si viene modality, incluirla en el update (normalizada)
  runGoogleAppointmentHook (created/confirmed) ya genera Meet para online
```

## Components and Interfaces

### 1. Backend: appointmentService
- Helper `normalizeModality(m)`: "online" si m === "online", si no "in_person".
  (Reusar el mismo criterio que booking.service; puede duplicarse local o extraerse a
  un util compartido pequeño; se elige helper local para no acoplar.)
- `createAppointment(tenantId, data)`: leer `data.modality`; en `prisma.appointment.create`
  agregar `modality: normalizeModality(data.modality)`.
- `updateAppointment(tenantId, id, data)`: cuando `data.modality !== undefined`, pasar
  `modality: normalizeModality(data.modality)` al update (en ambas ramas: la rama
  sin cambio de horario que hace update directo, y la rama transaccional que hace
  `data: { ...data, end_time }` -> normalizar el modality dentro de ese objeto).
- No cambian validaciones ni el disparo del hook.

### 2. Frontend: data.service.ts
- `AppointmentPayload.modality` ya existe. `updateAppointment(id, data)` ya pasa un
  objeto arbitrario; permitir `modality` en su tipo.

### 3. Frontend: Appointments.tsx
- Estado nuevo: `onlineEnabled` (boolean) cargado una vez via `googleService.getStatus()`
  al montar (best-effort; si falla, onlineEnabled=false -> solo presencial).
- FormState gana `modality: "in_person" | "online"` (default "in_person").
- Modal de crear: selector (dos botones/segmented) Presencial / En linea. "En linea"
  visible solo si onlineEnabled. Enviar `modality` en el payload de createAppointment.
- Panel de gestion (reprogramar): agregar el mismo selector; incluir `modality` en
  updateAppointment. Precargar con la modalidad actual de la cita.
- Detalle: mostrar fila "Modalidad" (Presencial/En linea). El enlace Meet ya se muestra.

## Data Models
- Ninguno nuevo. Se usa `Appointment.modality` existente.

## Error Handling
- getStatus falla -> onlineEnabled=false; el panel opera en modo presencial sin romper.
- modality invalida -> normalizada a in_person en backend.

## Correctness Properties

### Property 1: Persistencia normalizada al crear
createAppointment guarda modality "online" solo si se pidio "online"; en otro caso "in_person".

**Validates: Requirements 1.1, 1.2**

### Property 2: Persistencia al actualizar
updateAppointment persiste el modality normalizado cuando se envia, sin resetear otros campos.

**Validates: Requirements 2.1, 2.3**

### Property 3: Meet en online
Una cita interna marcada online genera Meet al confirmar (via hook existente).

**Validates: Requirements 1.3, 2.2**

### Property 4: Gating por online_sessions
El panel solo permite elegir "en linea" si el tenant tiene online_sessions activo.

**Validates: Requirements 3.2, 4.1**

## Testing Strategy
1. Unit backend: createAppointment persiste modality (online / default in_person /
   valor invalido -> in_person); updateAppointment persiste modality normalizada sin
   tocar otros campos. Reusar el mock de appointment.service.test.ts.
2. Frontend: verificacion manual + build. Selector visible/oculto segun online_sessions,
   crear y reprogramar con modalidad, detalle muestra modalidad.
3. `tsc --noEmit` backend+frontend 0 errores; `vite build` ok; jest de appointment verde.
