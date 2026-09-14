# Implementation Plan

## Overview

Integracion de Google Workspace por emprendedor: modelo GoogleAccount + tokens
cifrados, servicios de Calendar/Meet/Contacts, hooks best-effort en el flujo de
citas, endpoints ADMIN y ajustes de frontend. Reutiliza google-oauth.service.ts.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3", "4"] },
    { "wave": 3, "tasks": ["5", "6"] },
    { "wave": 4, "tasks": ["7"] },
    { "wave": 5, "tasks": ["8"] }
  ]
}
```

- Tarea 1 (schema/migracion) y 2 (crypto util) son la base, independientes entre si.
- Tareas 3 (google-oauth ext) y 4 (googleAccountService) dependen de 1 y 2.
- Tareas 5 (integrationService) y 6 (endpoints me) dependen de 3 y 4.
- Tarea 7 (hooks en appointment.service) depende de 5.
- Tarea 8 (frontend ajustes + portal modalidad) depende de 6 y 7.

## Tasks

- [x] 1. Modelo de datos y migracion
  - Agregar `model GoogleAccount` en `schema.prisma` (tenant_id unico, tokens, toggles, status).
  - Agregar a `Appointment`: `google_event_id String?` y `modality String? @default("in_person")`.
  - Detener node y ejecutar `prisma generate` + migracion aditiva (Windows: parar procesos node por EPERM).
  - _Requirements: 1.3, 2.4, 3.3, 5.1_

- [x] 2. Utilidad de cifrado de tokens
  - Crear `src/utils/crypto.ts` con `encrypt`/`decrypt` AES-256-GCM usando `GOOGLE_TOKEN_ENC_KEY`.
  - Documentar `GOOGLE_TOKEN_ENC_KEY`, `GOOGLE_CONNECT_REDIRECT_URI` en `.env.example`.
  - Prueba unitaria de round-trip (encrypt->decrypt) y que el cifrado difiere del texto plano.
  - _Requirements: 5.1_

- [x] 3. Extender google-oauth.service para scopes de Workspace
  - Agregar `getWorkspaceAuthorizationUrl(state)` con scopes `calendar.events` + `contacts` y redirect de conexion.
  - Reutilizar exchangeCodeForToken / refreshAccessToken / revokeToken existentes.
  - _Requirements: 1.2, 1.3_

- [x] 4. googleAccountService (conexion, tokens, settings)
  - Implementar getStatus, getConnectUrl, handleCallback (cifra y upsert), disconnect (revoke+borra), updateSettings, ensureAccessToken (refresh transparente + re-cifrado).
  - Aislar por tenant en todas las operaciones. Nunca exponer tokens.
  - Pruebas unitarias con google-oauth.service mockeado (incluye refresh transparente).
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 5.1, 5.2_

- [x] 5. googleIntegrationService (Calendar/Meet/Contacts)
  - `syncAppointmentEvent` (crea/actualiza evento; conferenceData/Meet si en linea) devolviendo event_id y meet_url.
  - `deleteAppointmentEvent` y `upsertContact` (People API).
  - No-op si `ensureAccessToken` devuelve null (no conectado).
  - Pruebas unitarias con el cliente HTTP de Google mockeado (sin red real).
  - _Requirements: 2.1, 2.2, 2.3, 3.4, 4.2, 4.3_

- [x] 6. Endpoints ADMIN en me.controller / me.routes
  - `GET /v1/me/google`, `GET /v1/me/google/connect`, callback, `PATCH /v1/me/google/settings`, `DELETE /v1/me/google`.
  - ADMIN-only con guard de rol: ASSISTANT recibe 403 en conectar/desconectar/settings.
  - Tenant-scoped, con auditoria. No devolver tokens.
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 3.1, 4.1, 5.1, 6.3_

- [x] 7. Hooks best-effort en appointment.service.ts
  - `runGoogleHook` en try/catch que nunca lanza (patron runLoyaltyHook).
  - Enganchar create (upsert evento + contacto si save_contacts), updateStatus CONFIRMED (evento + Meet si en linea), updateAppointment (actualizar), cancel/CANCELLED (eliminar).
  - Persistir google_event_id y video_call_url en la cita.
  - El hook SIEMPRE resuelve el GoogleAccount del ADMIN del tenant (aunque quien agende sea un colaborador ASSISTANT).
  - Pruebas: un fallo de Google NO revierte ni bloquea la cita; toggles respetados; cita creada por colaborador usa la cuenta del emprendedor.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.4, 3.6, 4.2, 4.4, 4.5, 5.3, 6.1, 6.2, 6.4_

- [x] 8. Frontend: ajustes de integracion + modalidad en portal
  - Pantalla de ajustes (SOLO visible para ADMIN): estado conectar/desconectar Google + toggles online_sessions y save_contacts.
  - Portal de reserva: selector presencial/en linea cuando online_sessions activo; enviar modalidad al crear.
  - Mostrar video_call_url (Meet) al confirmar, para cliente y emprendedor.
  - Verificar `tsc --noEmit` y `vite build`.
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 5.4_

## Notes

- Google Meet no tiene API propia: el enlace se genera via conferenceData de un evento de Calendar (conferenceDataVersion=1, requestId unico).
- La integracion es best-effort: los hooks nunca lanzan; un fallo de Google no toca la cita.
- En Windows, detener procesos node antes de `prisma generate` para evitar EPERM.
- La aprobacion de scopes sensibles de Google puede requerir verificacion de la app en produccion (fuera del alcance de codigo).
