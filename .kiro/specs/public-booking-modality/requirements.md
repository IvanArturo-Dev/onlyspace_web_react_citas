# Requirements Document

## Introduction

Cierra el "punto 2" pendiente de la integracion de Google Workspace: exponer en el
portal publico de reserva si el negocio ofrece sesiones en linea, permitir que el
cliente elija la modalidad, y persistir esa modalidad al crear la cita, de modo que
el hook de Google genere el Meet cuando corresponda.

Estado actual (ya implementado en otro spec):
- `GoogleAccount.online_sessions` (toggle por tenant) existe.
- `Appointment.modality` (default "in_person") y `video_call_url` existen.
- El frontend `BookingPortal` ya muestra el selector presencial/en linea SOLO si
  `PublicInfo.online_sessions_enabled` es true, y ya envia `modality` en `book()`.
- El hook `runGoogleHook` de Google vive en `appointment.service` y se dispara en
  `createAppointment`. PERO la reserva publica usa `booking.service.createBranchBooking`,
  que crea la cita SIN pasar por ese hook y SIN guardar la modalidad.

Lo que falta (alcance de este spec):
1. `GET /public/:code/info` debe devolver `online_sessions_enabled` (del GoogleAccount
   del tenant: connected AND online_sessions).
2. `POST /public/:code/appointments` debe aceptar `modality` y persistirla.
3. `createBranchBooking` debe guardar `modality` y disparar el hook de Google
   best-effort para que se genere el Meet en citas en linea y se devuelva
   `video_call_url`.

Se mantiene el principio best-effort: si Google no esta conectado o falla, la reserva
nunca se bloquea.

## Glossary

- **online_sessions**: toggle del emprendedor (GoogleAccount) que habilita citas en linea.
- **online_sessions_enabled**: flag derivado que el endpoint publico expone al portal (connected AND online_sessions).
- **modality**: "in_person" | "online" de una cita.
- **createBranchBooking**: servicio de reserva publica por sucursal.
- **runGoogleHook**: hook best-effort que crea evento/Meet/contacto en Google.

## Requirements

### Requirement 1: Exponer online_sessions_enabled en el info publico

**User Story:** Como cliente, quiero ver la opcion de cita en linea solo cuando el
negocio realmente la ofrece, para no elegir una modalidad no soportada.

#### Acceptance Criteria

1. CUANDO se solicita `GET /public/:code/info` ENTONCES la respuesta DEBERA incluir
   `online_sessions_enabled: boolean`.
2. EL valor DEBERA ser true solo si el tenant de la sucursal tiene un `GoogleAccount`
   con `status = "connected"` Y `online_sessions = true`; en cualquier otro caso false.
3. LA consulta del GoogleAccount NO DEBERA exponer tokens ni otros datos sensibles en
   la respuesta publica; solo el booleano derivado.
4. SI el tenant no tiene GoogleAccount ENTONCES `online_sessions_enabled` DEBERA ser
   false (sin lanzar error).

### Requirement 2: Aceptar y persistir la modalidad en la reserva publica

**User Story:** Como cliente, quiero que mi eleccion de presencial o en linea quede
guardada en la cita, para que el negocio y yo sepamos como sera.

#### Acceptance Criteria

1. CUANDO se llama `POST /public/:code/appointments` con `modality` en el cuerpo
   ENTONCES el sistema DEBERA aceptar solo los valores "in_person" u "online";
   cualquier otro valor DEBERA tratarse como "in_person" (o rechazarse con 400
   VALIDATION_ERROR, a eleccion del diseno, documentado).
2. CUANDO no se envia `modality` ENTONCES la cita DEBERA quedar como "in_person".
3. EL sistema DEBERA persistir `modality` en la `Appointment` creada.
4. SI la modalidad es "online" ENTONCES el sistema DEBERA marcar la cita como en
   linea de forma que el hook de Google la reconozca (modality "online").

### Requirement 3: Disparar el hook de Google en la reserva publica

**User Story:** Como emprendedor con Google conectado, quiero que las reservas que
hacen mis clientes desde el portal tambien se sincronicen con mi Calendar y generen
Meet si son en linea, igual que las que creo yo.

#### Acceptance Criteria

1. CUANDO `createBranchBooking` crea una cita ENTONCES DEBERA disparar el hook de
   Google (best-effort) para el tenant de la sucursal, DESPUES de persistir la cita.
2. CUANDO el tenant tiene Google conectado Y la cita es en linea ENTONCES el hook
   DEBERA generar el Meet y persistir `video_call_url`, y la respuesta de la reserva
   DEBERA incluir `video_call_url` cuando exista.
3. SI Google no esta conectado O la llamada falla ENTONCES la reserva DEBERA
   completarse igual (best-effort), sin bloquear ni revertir.
4. EL hook DEBERA resolver SIEMPRE la cuenta Google del tenant (del emprendedor),
   sin importar que quien reserva sea un cliente.

### Requirement 4: No regresion

**User Story:** Como usuario, quiero que las reservas y el portal sigan funcionando
igual que antes cuando no hay sesiones en linea.

#### Acceptance Criteria

1. CUANDO el negocio no ofrece sesiones en linea ENTONCES el portal DEBERA comportarse
   como hoy (solo presencial) y la reserva DEBERA seguir creando la cita.
2. LAS reglas existentes (aforo, dia futuro, asueto, anti-duplicado, aislamiento por
   tenant) DEBERAN permanecer intactas.
3. EL sistema DEBERA compilar sin errores (`tsc --noEmit`) y la suite jest existente
   DEBERA seguir en verde (salvo fallos preexistentes ajenos).
