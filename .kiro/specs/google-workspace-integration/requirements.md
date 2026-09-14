# Requirements Document

## Introduction

Integracion de Google Workspace por emprendedor (tenant): cada ADMIN conecta SU
propia cuenta de Google via OAuth desde ajustes y, con su consentimiento, la app
sincroniza sus citas con Google Calendar, genera enlaces de Google Meet para citas
en linea, y guarda los datos del cliente en los Google Contacts del propio
emprendedor. Todo opera sobre la cuenta del emprendedor conectado; nunca sobre una
cuenta central ni cruzando tenants.

La app ya tiene un `google-oauth.service.ts` (usado para login) con
`getAuthorizationUrl`, `exchangeCodeForToken`, `refreshAccessToken` y `revokeToken`,
y usa `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`. El modelo `Appointment` ya tiene
`location` y `video_call_url`. Esta integracion reutiliza esa base y agrega scopes,
un flujo de "conectar" separado del login, almacenamiento de tokens y los servicios
que llaman a las APIs de Google.

La integracion es best-effort: si Google no esta conectado o falla, la operacion de
la cita (crear, confirmar, cancelar) NUNCA se bloquea ni se revierte, igual que el
hook de lealtad existente.

## Glossary

- **Emprendedor**: usuario con rol ADMIN, duenio de un tenant.
- **GoogleAccount**: registro que guarda los tokens OAuth de un emprendedor conectado (por tenant).
- **Scopes**: permisos de Google solicitados (calendar, meet via calendar, contacts).
- **Refresh token**: token de larga vida para obtener access tokens sin reautorizar; se guarda cifrado.
- **Best-effort**: la integracion nunca bloquea ni revierte la operacion de la cita si Google falla.
- **Meet**: enlace de videollamada generado como parte de un evento de Calendar (conferenceData).

## Requirements

### Requirement 1: Conectar la cuenta de Google del emprendedor

**User Story:** Como emprendedor, quiero conectar mi propia cuenta de
Google desde ajustes, para que la app pueda sincronizar mis citas, generar Meet y
guardar contactos en mi nombre.

#### Acceptance Criteria

1. CUANDO el emprendedor abre ajustes de integraciones ENTONCES el sistema DEBERA
   mostrar el estado de conexion (conectado / no conectado) de su cuenta Google.
2. CUANDO el emprendedor da clic en "Conectar Google" ENTONCES el sistema DEBERA
   iniciar el flujo OAuth solicitando los scopes de Calendar y Contacts con
   `access_type=offline` y `prompt=consent` para obtener un refresh token.
3. CUANDO Google redirige de vuelta con un `code` ENTONCES el sistema DEBERA
   intercambiarlo por tokens y guardar el refresh token CIFRADO asociado al tenant
   del emprendedor.
4. CUANDO el emprendedor da clic en "Desconectar" ENTONCES el sistema DEBERA revocar
   el token en Google y eliminar el registro `GoogleAccount` del tenant.
5. EL sistema DEBERA aislar por tenant: un emprendedor NUNCA accede ni modifica la
   cuenta Google, eventos o contactos de otro tenant.
6. SOLO el rol ADMIN (emprendedor) DEBERA poder conectar, desconectar o cambiar
   los ajustes de Google. UN colaborador (ASSISTANT) NUNCA DEBERA iniciar el flujo
   OAuth, ver tokens, ni conectar una cuenta a nombre del emprendedor (403).

### Requirement 2: Sincronizar citas con Google Calendar

**User Story:** Como emprendedor con Google conectado, quiero que mis citas
aparezcan en mi Google Calendar, para tener todo mi dia en un solo lugar.

#### Acceptance Criteria

1. CUANDO se crea o confirma una cita Y el emprendedor tiene Google conectado
   ENTONCES el sistema DEBERA crear un evento en su Google Calendar con titulo,
   cliente, servicio, hora inicio/fin y ubicacion o enlace segun corresponda.
2. CUANDO una cita con evento existente se reprograma ENTONCES el sistema DEBERA
   actualizar el evento correspondiente en Calendar.
3. CUANDO una cita con evento existente se cancela ENTONCES el sistema DEBERA
   cancelar o eliminar el evento en Calendar.
4. EL sistema DEBERA guardar el id del evento de Google en la cita para poder
   actualizarlo o eliminarlo despues.
5. SI el emprendedor NO tiene Google conectado O la llamada a Calendar falla
   ENTONCES la cita DEBERA persistirse igual y el error registrarse sin bloquear.

### Requirement 3: Modalidad presencial o en linea y Google Meet

**User Story:** Como emprendedor, quiero habilitar sesiones en linea para
que el cliente elija presencial o en linea, y que en linea se genere un Google Meet,
para atender remoto sin configurar nada manual.

#### Acceptance Criteria

1. EL emprendedor DEBERA poder activar/desactivar "sesiones en linea" en ajustes.
2. CUANDO las sesiones en linea estan activas ENTONCES el cliente en el portal de
   reserva DEBERA poder elegir modalidad presencial o en linea.
3. CUANDO se reserva una cita en linea ENTONCES el sistema DEBERA registrar la
   modalidad en la cita (p.ej. `location` = "En linea" o campo de modalidad).
4. CUANDO una cita en linea se confirma (clic en Confirmar) Y el emprendedor tiene
   Google conectado ENTONCES el sistema DEBERA generar un enlace de Google Meet
   (via conferenceData del evento de Calendar) y guardarlo en `video_call_url`.
5. SI el emprendedor NO tiene sesiones en linea activas ENTONCES el portal NO DEBERA
   ofrecer la opcion en linea y toda cita sera presencial.
6. SI la generacion del Meet falla ENTONCES la confirmacion de la cita NO DEBERA
   bloquearse; el error se registra y `video_call_url` queda vacio.

### Requirement 4: Guardar el cliente en Google Contacts del emprendedor

**User Story:** Como emprendedor, quiero guardar los datos del cliente en
mis Google Contacts si lo acepto, para tener mi agenda de clientes en mi cuenta.

#### Acceptance Criteria

1. EL emprendedor DEBERA poder activar/desactivar "guardar clientes en mis
   contactos" en ajustes.
2. CUANDO la opcion esta activa Y se crea una cita con un cliente Y el emprendedor
   tiene Google conectado ENTONCES el sistema DEBERA crear o actualizar el contacto
   (nombre, telefono, email) en los Google Contacts DEL emprendedor.
3. EL contacto SOLO DEBERA guardarse en la cuenta Google del emprendedor conectado;
   NUNCA en una cuenta central ni en la de otro tenant.
4. SI la opcion esta desactivada O el emprendedor no acepto O no hay Google
   conectado ENTONCES el sistema NO DEBERA guardar ningun contacto.
5. SI la llamada a Contacts falla ENTONCES la creacion de la cita NO DEBERA
   bloquearse; el error se registra.

### Requirement 5: Almacenamiento seguro de tokens y no-regresion

**User Story:** Como duenio del sistema, quiero que los tokens de Google se
guarden de forma segura y que la app siga funcionando aunque Google no este
conectado, para proteger datos y no romper el flujo de citas.

#### Acceptance Criteria

1. EL refresh token DEBERA guardarse cifrado en reposo en una tabla `GoogleAccount`
   por tenant; el sistema NUNCA lo expone en respuestas de API ni en logs.
2. CUANDO un access token expira ENTONCES el sistema DEBERA renovarlo con el refresh
   token de forma transparente antes de llamar a las APIs de Google.
3. LA integracion completa DEBERA ser best-effort: ningun fallo de Google bloquea o
   revierte crear, confirmar, reprogramar o cancelar una cita.
4. EL sistema DEBERA compilar sin errores (`tsc --noEmit`) y pasar las pruebas
   unitarias existentes tras los cambios.
5. LAS operaciones de Calendar/Meet/Contacts DEBERAN estar cubiertas por pruebas
   unitarias con el cliente de Google mockeado (sin llamadas de red reales).

### Requirement 6: Rol de colaborador (no conecta ni agenda a su nombre)

**User Story:** Como emprendedor, quiero que mis colaboradores puedan agendar en mi
negocio pero que la cuenta de Google, los eventos, el Meet y los contactos queden
siempre a mi nombre, para que la integracion sea unicamente mia.

#### Acceptance Criteria

1. UN colaborador (ASSISTANT) DEBERA poder crear, confirmar, reprogramar y cancelar
   citas del tenant, igual que hoy.
2. CUANDO un colaborador crea o confirma una cita ENTONCES el evento de Calendar, el
   Meet y el contacto DEBERAN crearse en la cuenta Google DEL emprendedor (ADMIN)
   del tenant, NUNCA en la del colaborador.
3. UN colaborador NUNCA DEBERA poder conectar/desconectar Google ni cambiar los
   toggles online_sessions/save_contacts; esos endpoints DEBERAN responder 403 para
   ASSISTANT.
4. SI el emprendedor no ha conectado Google ENTONCES las citas creadas por un
   colaborador se comportan como best-effort (no se crea evento) sin bloquear.
