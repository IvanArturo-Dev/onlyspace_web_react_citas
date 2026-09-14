# Design Document

## Overview

Se desacopla la modalidad de Google: el selector Presencial/En linea deja de depender
de online_sessions. Se agrega captura/edicion de una URL de videollamada manual
(guardada en el `video_call_url` existente), se muestra al cliente, y se protege esa
URL para que el hook de Google no la pise.

## Architecture

```
Panel interno (Appointments.tsx)
  Selector modalidad SIEMPRE (sin gating). Si online -> campo URL videollamada.
  Crear:  POST /appointments { ..., modality, video_call_url }
  Editar: PATCH /appointments/:id { ..., modality, video_call_url }

Backend appointmentService
  createAppointment: persistir modality (ya) + video_call_url (validada)
  updateAppointment: persistir modality (ya) + video_call_url cuando venga
  google-appointment-hook: NO sobrescribir video_call_url si ya existe

Cliente
  GET /me/appointments -> incluir video_call_url + modality
  MisCitas + BookingPortal: mostrar enlace cuando exista
```

## Components and Interfaces

### 1. Backend: validacion y persistencia de video_call_url
- Helper `normalizeVideoUrl(u)`: trim; "" -> null (limpia); si no vacia, validar que
  empiece con http:// o https:// (si no, 400 VALIDATION_ERROR). Devuelve string|null.
- `createAppointment`: leer `data.video_call_url`; si `modality==="online"` y viene,
  persistir la URL normalizada; si "in_person", persistir null. (Solo si el campo viene
  en el payload; si no viene, no romper.)
- `updateAppointment`: cuando `data.video_call_url !== undefined`, incluir la URL
  normalizada en el update (ambas ramas). No resetea otros campos.

### 2. Backend: hook de Google no pisa URL manual
- En `google-appointment-hook.ts`, al recibir `result.meet_url`, SOLO asignar
  `data.video_call_url = result.meet_url` cuando `!appointment.video_call_url` (no hay
  URL previa). Si ya hay una (manual o previa), NO sobrescribir.

### 3. Backend: exponer video_call_url/modality al cliente
- `me.controller.getMyAppointments`: agregar `video_call_url` y `modality` al select y
  al objeto devuelto por cada cita.

### 4. Frontend: quitar gating del selector
- `ModalitySelector` deja de recibir/usar `onlineEnabled`: muestra SIEMPRE Presencial y
  En linea. Se elimina el texto de ayuda de gating. (Se conserva la carga de
  googleService.getStatus solo si se usa para algo mas; si no, se puede quitar.)

### 5. Frontend: campo URL de videollamada (panel)
- FormState gana `video_call_url: string`. En el modal de crear, cuando
  `modality==="online"`, mostrar un input "URL de videollamada" (placeholder
  https://meet.google.com/... o Zoom/Teams). Enviar `video_call_url` en el payload.
- En gestion (reprogramar/gestionar): estado `manageVideoUrl`, precargado con
  `manageAppt.video_call_url`; input visible cuando la modalidad seleccionada es online;
  enviar `video_call_url` en updateAppointment.
- data.service: `AppointmentPayload` y `AppointmentUpdatePayload` ganan
  `video_call_url?: string`.

### 6. Frontend: portal + Mis Citas del cliente
- BookingPortal: el selector de modalidad se muestra SIEMPRE (quitar gating por
  online_sessions_enabled) o mantener el flag pero forzarlo a true por defecto segun
  Req 4.3 (se elige mostrar siempre). La URL (video_call_url) ya se muestra en la
  confirmacion si viene.
- MisCitas (vista del cliente): mostrar enlace "Unirse a la videollamada" cuando la
  cita tenga video_call_url. Ajustar el tipo/servicio para recibir video_call_url y
  modality.

## Data Models
- Ninguno nuevo. Se reutilizan `Appointment.modality` y `Appointment.video_call_url`.

## Error Handling
- URL invalida (no http/https) -> 400 VALIDATION_ERROR en backend; el panel muestra el
  mensaje.
- URL vacia -> se guarda null (limpia el enlace).

## Correctness Properties

### Property 1: Modalidad sin gating
El selector Presencial/En linea esta disponible sin requerir Google conectado.

**Validates: Requirements 1.1, 1.2**

### Property 2: URL manual persistida y validada
Una URL http(s) valida se guarda en video_call_url; vacia la limpia; invalida es rechazada.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: El cliente ve la URL
GET /me/appointments incluye video_call_url y modality, y la UI del cliente muestra el enlace.

**Validates: Requirements 3.2, 3.3**

### Property 4: El hook no pisa la URL manual
Si ya hay video_call_url, el Meet automatico del hook no la sobrescribe.

**Validates: Requirements 4.1, 4.2**

### Property 5: No regresion
Validaciones y Meet automatico (sin URL previa) siguen funcionando; compila y tests verdes.

**Validates: Requirements 5.1, 5.2, 5.3**

## Testing Strategy
1. Unit backend: createAppointment/updateAppointment persisten video_call_url
   normalizada (valida / vacia->null / invalida->400). Hook no sobrescribe si ya hay URL.
2. Unit backend: getMyAppointments incluye video_call_url y modality.
3. Frontend: build + verificacion manual (crear online con URL, verla en detalle,
   verla como cliente en Mis Citas / confirmacion).
4. `tsc --noEmit` backend+frontend 0 errores; `vite build` ok; jest de appointment verde.
