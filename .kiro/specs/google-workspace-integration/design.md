# Design Document

## Overview

La integracion agrega tres capacidades sobre la cuenta Google DEL emprendedor
(tenant): sincronizar citas con Google Calendar, generar Google Meet para citas en
linea, y guardar clientes en Google Contacts. Reutiliza el `google-oauth.service.ts`
existente (login) para el manejo de OAuth de bajo nivel (intercambio de code,
refresh, revoke) y agrega: un flujo de "conectar" con scopes de Workspace, una tabla
`GoogleAccount` con tokens cifrados por tenant, tres servicios de integracion
(calendar/meet/contacts), y hooks best-effort en `appointment.service.ts`.

Principio rector: la integracion es best-effort. Igual que `runLoyaltyHook`, los
hooks de Google se ejecutan en try/catch y NUNCA lanzan, de modo que un fallo de
Google no bloquea ni revierte crear/confirmar/reprogramar/cancelar una cita.

## Architecture

```
Ajustes del emprendedor (frontend)
   |  Conectar Google -> GET /v1/me/google/connect  -> URL OAuth (scopes Workspace)
   |  Callback         -> GET /v1/me/google/callback -> guarda GoogleAccount (cifrado)
   |  Desconectar      -> DELETE /v1/me/google       -> revoke + borra registro
   |  Toggles          -> PATCH /v1/me/google/settings (online_sessions, save_contacts)
   v
appointment.service.ts (crear/confirmar/reprogramar/cancelar)
   |  runGoogleHook(...) best-effort (try/catch, nunca lanza)
   v
googleIntegrationService
   |-- ensureAccessToken(tenantId)  -> refresh transparente via google-oauth.service
   |-- calendar.upsertEvent / deleteEvent   (Google Calendar API)
   |-- meet: conferenceData al crear/confirmar evento en linea
   |-- contacts.upsertContact               (Google People API)
   v
Google APIs (Calendar / People)   [mockeadas en pruebas]
```

Notas clave:

- Google Meet NO tiene API propia: el enlace se crea como `conferenceData` de un
  evento de Calendar (`conferenceDataVersion=1`, requestId unico). Por eso Meet y
  Calendar comparten scope y flujo.
- Scopes solicitados al conectar: `calendar.events` y `contacts`, ademas de
  `openid email profile` para identificar la cuenta.
- Los hooks se disparan DESPUES de que la cita ya se persistio (patron identico a
  `runLoyaltyHook`).

## Components and Interfaces

### 1. Modelo de datos: GoogleAccount (nuevo) + toggles en Tenant + campos en Appointment

Nueva tabla `GoogleAccount` (1 por tenant):

``` prisma
model GoogleAccount {
  id                    String   @id @default(cuid())
  tenant_id             String   @unique
  google_email          String
  google_sub            String?
  access_token          String?  @db.Text   // cifrado
  refresh_token         String   @db.Text   // cifrado (obligatorio)
  token_expiry          DateTime?
  scopes                String?  @db.Text
  online_sessions       Boolean  @default(false) // habilita modalidad en linea + Meet
  save_contacts         Boolean  @default(false) // guardar clientes en Contacts
  status                String   @default("connected") // connected | revoked
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt

  @@map("google_accounts")
}
```

Cambios en `Appointment` (aditivos, no rompen datos):

- `google_event_id String?`  -> id del evento de Calendar para actualizar/eliminar.
- La modalidad en linea se representa con `location` = "En linea" (o un campo
  `modality String? @default("in_person")`); `video_call_url` (ya existe) guarda el Meet.

### 2. Cifrado de tokens (nuevo util)

- `src/utils/crypto.ts`: `encrypt(text)` / `decrypt(text)` con AES-256-GCM usando
  `GOOGLE_TOKEN_ENC_KEY` (32 bytes en base64/hex desde `.env`).
- Los tokens se cifran ANTES de guardar y se descifran solo en memoria al llamar a
  Google. Nunca se devuelven en respuestas de API ni se logean.

### 3. google-oauth.service.ts (extension minima)

- Nuevo `getWorkspaceAuthorizationUrl(state)`: igual que `getAuthorizationUrl` pero
  con scopes de Workspace y usando un redirect propio de conexion
  (`GOOGLE_CONNECT_REDIRECT_URI`) para no colisionar con el login.
- Se reutilizan `exchangeCodeForToken`, `refreshAccessToken`, `revokeToken`.

### 4. googleAccountService (nuevo)

- `getStatus(tenantId)` -> { connected, google_email, online_sessions, save_contacts }.
- `getConnectUrl(tenantId)` -> URL OAuth Workspace + state firmado con tenantId.
- `handleCallback(tenantId, code)` -> intercambia code, cifra y hace upsert del
  registro `GoogleAccount`.
- `disconnect(tenantId)` -> revoke en Google + borra registro.
- `updateSettings(tenantId, { online_sessions, save_contacts })`.
- `ensureAccessToken(tenantId)` -> devuelve un access token valido, refrescandolo y
  re-cifrando si expiro. Devuelve null si el tenant no esta conectado.

### 5. googleIntegrationService (nuevo) — Calendar/Meet/Contacts

- `syncAppointmentEvent(tenantId, appointment)` -> crea o actualiza el evento; si la
  cita es en linea agrega `conferenceData` (Meet) y devuelve `{ event_id, meet_url }`.
- `deleteAppointmentEvent(tenantId, appointment)` -> elimina/cancela el evento.
- `upsertContact(tenantId, customer)` -> crea/actualiza el contacto en People API.
- Todas usan `ensureAccessToken`; si devuelve null (no conectado) hacen no-op.

### 6. Hooks en appointment.service.ts (best-effort)

- `runGoogleHook(action, tenantId, appointment)` en try/catch que NUNCA lanza
  (patron identico a `runLoyaltyHook`). Se llama:
  - tras `createAppointment` -> upsert evento (+ contacto si save_contacts).
  - tras `updateStatus` a CONFIRMED -> asegurar evento y, si en linea, generar Meet.
  - tras `updateAppointment` (reprogramar) -> actualizar evento.
  - tras `cancelAppointment` / updateStatus CANCELLED -> eliminar evento.
- Persiste `google_event_id` y `video_call_url` en la cita cuando aplica.

### 7. Endpoints (me.routes / me.controller) — ADMIN, tenant-scoped

> Guard de rol ADMIN: todos estos endpoints exigen rol ADMIN. Un ASSISTANT recibe 403.
> El flujo de conexion OAuth ocurre SIEMPRE despues del login, iniciado por el ADMIN desde ajustes (no durante el login).

- `GET /v1/me/google` -> estado de conexion + toggles.
- `GET /v1/me/google/connect` -> devuelve auth_url + state.
- `GET /v1/me/google/callback` -> procesa code (o el frontend hace POST del code).
- `PATCH /v1/me/google/settings` -> online_sessions / save_contacts.
- `DELETE /v1/me/google` -> desconectar.

### 8. Portal de reserva (frontend)

- Si el tenant tiene `online_sessions` activo, el portal muestra selector
  presencial / en linea. La modalidad se envia al crear la cita.
- El enlace de Meet (video_call_url) se muestra al cliente y al emprendedor una vez
  confirmada la cita.

## Data Models

- Nuevo: `GoogleAccount` (1:1 con Tenant via tenant_id unico).
- `Appointment`: + `google_event_id String?`, + `modality String? @default("in_person")`
  (reutiliza `video_call_url` y `location` existentes).
- Migracion Prisma aditiva; sin borrado de columnas.

## Error Handling

- No conectado: `ensureAccessToken` devuelve null -> los servicios hacen no-op sin error.
- Fallo de red/API Google: capturado por `runGoogleHook`, logeado con pino, swallow.
- Refresh fallido (refresh token revocado): marcar `GoogleAccount.status=revoked`,
  logear, y tratar como no conectado en llamadas siguientes.
- Cifrado: si falta `GOOGLE_TOKEN_ENC_KEY`, el connect falla con 500 explicito
  (config), pero las citas siguen funcionando (los hooks solo corren si hay cuenta).

## Correctness Properties

### Property 1: Aislamiento por tenant
Toda operacion de Google (Calendar/Meet/Contacts) usa exclusivamente el GoogleAccount del tenant del emprendedor; nunca accede al de otro tenant.

**Validates: Requirements 1.5, 4.3**

### Property 2: Best-effort no bloqueante
Ningun fallo de Google (no conectado, red, API) revierte ni bloquea crear, confirmar, reprogramar o cancelar una cita.

**Validates: Requirements 2.5, 3.6, 4.5, 5.3**

### Property 3: Meet solo en linea y con consentimiento
Un enlace de Meet solo se genera cuando el tenant tiene online_sessions activo y la cita es en linea; en otros casos video_call_url queda vacio.

**Validates: Requirements 3.4, 3.5**

### Property 4: Contactos solo con opt-in
Un contacto solo se crea/actualiza cuando save_contacts esta activo y hay Google conectado; de lo contrario no se guarda ningun contacto.

**Validates: Requirements 4.2, 4.4**

### Property 5: Tokens nunca expuestos
El refresh token se guarda cifrado y nunca aparece en respuestas de API ni en logs; el access token se refresca de forma transparente.

**Validates: Requirements 5.1, 5.2**

### Property 6: Solo ADMIN conecta; el colaborador agenda a nombre del emprendedor
Los endpoints de conexion/settings de Google exigen rol ADMIN (403 para ASSISTANT); cuando un colaborador agenda, el evento/Meet/contacto se crean en la cuenta Google del ADMIN del tenant, nunca en la del colaborador.

**Validates: Requirements 1.6, 6.2, 6.3**

## Testing Strategy

1. Unit `googleAccountService`: connect/callback/disconnect/updateSettings y
   `ensureAccessToken` (refresh transparente) con `google-oauth.service` mockeado.
2. Unit `googleIntegrationService`: syncEvent (presencial y en linea con Meet),
   deleteEvent, upsertContact con el cliente HTTP de Google mockeado (sin red real).
3. Unit hooks en `appointment.service`: verificar que un fallo de Google NO revierte
   ni bloquea la operacion de la cita (best-effort) y que save_contacts respeta el toggle.
4. Unit `crypto.ts`: encrypt/decrypt round-trip; el texto cifrado difiere del plano.
5. `npx tsc --noEmit` -> 0 errores; suite jest existente en verde.
