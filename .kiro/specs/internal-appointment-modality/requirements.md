# Requirements Document

## Introduction

El emprendedor (y sus colaboradores) deben poder elegir si una cita creada desde el
PANEL INTERNO es presencial o en linea (remota), igual que ya puede hacerlo el cliente
en el portal publico. Hoy el portal publico persiste `modality` y genera Meet, pero el
flujo interno (`POST /appointments` -> appointmentService.createAppointment) NO lee ni
guarda `modality`, y el modal de crear/gestionar cita del panel no ofrece el selector.

Contexto ya implementado:
- `Appointment.modality` (default "in_person") y `video_call_url` existen.
- El hook de Google (runGoogleAppointmentHook) genera Meet al confirmar una cita en
  linea y ya se dispara en createAppointment/updateStatus.
- El frontend ya tiene `googleService.getStatus()` -> { connected, online_sessions, ... }.
- El portal publico solo ofrece "en linea" si el negocio tiene online_sessions activo.

Alcance: cerrar el gap en el flujo interno para que el emprendedor elija la modalidad
al crear y al reprogramar/gestionar una cita, coherente con la regla de online_sessions.

## Glossary

- **Modalidad**: "in_person" (presencial) | "online" (remota) de una cita.
- **online_sessions**: toggle del tenant (GoogleAccount) que habilita citas en linea.
- **Panel interno**: vistas del emprendedor/colaborador (Appointments.tsx), distinto del portal publico.

## Requirements

### Requirement 1: Persistir modalidad al crear cita interna

**User Story:** Como emprendedor, quiero elegir presencial o en linea al crear una
cita desde mi panel, para que quede registrada como corresponde.

#### Acceptance Criteria

1. CUANDO se llama `createAppointment` con `modality` ENTONCES el sistema DEBERA
   persistir solo "in_person" u "online" (cualquier otro valor o ausencia -> "in_person").
2. CUANDO no se envia `modality` ENTONCES la cita DEBERA quedar "in_person".
3. CUANDO la cita es "online" ENTONCES el hook de Google (al crear/confirmar) DEBERA
   reconocerla como en linea para generar el Meet (comportamiento ya existente).
4. EL cambio NO DEBERA alterar las validaciones existentes (aforo, duplicado, conflicto).

### Requirement 2: Cambiar modalidad al reprogramar/gestionar

**User Story:** Como emprendedor, quiero poder cambiar la modalidad de una cita
existente desde el panel de gestion.

#### Acceptance Criteria

1. CUANDO `updateAppointment` recibe `modality` ENTONCES el sistema DEBERA persistir el
   nuevo valor normalizado ("online" u "in_person").
2. CUANDO una cita pasa a "online" y luego se confirma ENTONCES DEBERA generarse el
   Meet (via hook existente).
3. EL cambio de modalidad NO DEBERA resetear pago, notas ni otros campos.

### Requirement 3: Selector en el panel (UI)

**User Story:** Como emprendedor, quiero un selector claro de presencial/en linea en
el formulario de cita.

#### Acceptance Criteria

1. EL modal de crear cita DEBERA incluir un selector Presencial / En linea.
2. LA opcion "En linea" solo DEBERA estar disponible si el tenant tiene
   `online_sessions` activo (consultado via googleService.getStatus). Si no, solo
   Presencial (y el selector puede ocultarse o mostrar la opcion deshabilitada con nota).
3. AL crear la cita el frontend DEBERA enviar `modality` en el payload.
4. EL panel de gestion (reprogramar) DEBERA permitir cambiar la modalidad con el mismo
   criterio de disponibilidad de "en linea".
5. EN el detalle de la cita DEBERA mostrarse la modalidad, y el enlace de Meet
   (video_call_url) cuando exista (esto ultimo ya se muestra).

### Requirement 4: Coherencia y no regresion

**User Story:** Como usuario, quiero que el resto del flujo de citas siga igual.

#### Acceptance Criteria

1. SI el tenant no tiene online_sessions activo ENTONCES el panel NO DEBERA permitir
   crear/gestionar citas "online" (solo presencial).
2. LAS reglas del portal publico y del hook de Google DEBERAN permanecer intactas.
3. EL sistema DEBERA compilar (tsc) y construir (vite build); las suites existentes de
   citas DEBERAN seguir en verde.
