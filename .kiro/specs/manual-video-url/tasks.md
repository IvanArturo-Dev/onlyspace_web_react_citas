# Implementation Plan

## Overview

Desacoplar modalidad de Google, permitir URL de videollamada manual (guardada en
video_call_url), mostrarla al cliente, y evitar que el hook de Google la pise.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Backend: persistir/validar video_call_url + hook no sobrescribe + exponer al cliente
  - Helper `normalizeVideoUrl(u)` (trim; ""->null; requiere http(s) o 400 VALIDATION_ERROR).
  - `createAppointment`: si `data.video_call_url !== undefined`, persistir normalizada (o null si in_person).
  - `updateAppointment`: si `data.video_call_url !== undefined`, incluir normalizada en el update (ambas ramas).
  - `google-appointment-hook.ts`: asignar `data.video_call_url = result.meet_url` SOLO si `!appointment.video_call_url`.
  - `me.controller.getMyAppointments`: incluir `video_call_url` y `modality` en select y respuesta.
  - Pruebas unitarias: create/update persisten URL (valida/vacia/invalida); hook no pisa URL existente.
  - `tsc` backend + `jest --testPathPattern="appointment|google|me"` en verde.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 4.1, 4.2, 5.1, 5.2_

- [ ] 2. Frontend data.service: tipos con video_call_url
  - `AppointmentPayload` y `AppointmentUpdatePayload` ganan `video_call_url?: string`.
  - Servicio/tipo de Mis Citas del cliente recibe `video_call_url` y `modality`.
  - `tsc --noEmit`.
  - _Requirements: 2.1, 3.2_

- [ ] 3. Frontend panel: quitar gating + campo URL
  - `ModalitySelector`: quitar `onlineEnabled` (mostrar siempre Presencial/En linea).
  - Modal crear: FormState gana `video_call_url`; input visible cuando modality online; enviar en payload.
  - Gestion: estado `manageVideoUrl` precargado; input cuando online; enviar en updateAppointment.
  - Detalle: ya muestra Videollamada; sin cambios (o mostrar aunque sea manual).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.1, 2.1, 2.4_

- [ ] 4. Frontend cliente: portal + Mis Citas muestran el enlace
  - BookingPortal: mostrar selector de modalidad siempre (quitar gating) y el enlace en confirmacion (ya existe).
  - Mis Citas del cliente: mostrar "Unirse a la videollamada" cuando la cita tenga video_call_url.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.2, 3.1, 3.3, 4.3_

## Notes
- Sin cambios de schema (modality y video_call_url existen).
- Meet automatico sigue funcionando si NO hay URL manual previa.
- Portal publico ofrece En linea siempre (Req 4.3); un toggle dedicado queda como ajuste futuro.
