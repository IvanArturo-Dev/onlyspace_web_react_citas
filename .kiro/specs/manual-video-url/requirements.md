# Requirements Document

## Introduction

Desacoplar la modalidad de la cita de la integracion de Google. El emprendedor debe
poder marcar cualquier cita como Presencial o En linea SIEMPRE (sin depender de tener
Google conectado), y cuando es En linea, agregar manualmente la URL de la videollamada
(Meet, Zoom, Teams, etc.). Esa URL se muestra al cliente a la hora de su cita.

Contexto actual:
- El selector de modalidad en el panel y en el portal esta GATED por online_sessions
  (solo aparece "En linea" si el tenant tiene Google conectado con sesiones en linea).
  Como Google no esta conectado, hoy solo se puede elegir Presencial.
- `Appointment.modality` y `Appointment.video_call_url` ya existen.
- El hook de Google escribe `video_call_url` con el Meet generado, PERO sobrescribe
  cualquier valor previo (pisaria una URL manual).
- El endpoint del cliente `GET /me/appointments` NO devuelve `video_call_url`.

Alcance: quitar el gating por Google en la eleccion de modalidad, permitir capturar y
editar una URL de videollamada manual, mostrarla al cliente, y evitar que el hook de
Google pise una URL manual.

## Glossary

- **Modalidad**: "in_person" (presencial) | "online" (en linea).
- **URL de videollamada manual**: enlace que el emprendedor pega (Meet/Zoom/Teams/...),
  guardado en `video_call_url`.
- **Meet automatico**: enlace generado por la integracion de Google (solo si esta conectada).

## Requirements

### Requirement 1: Elegir modalidad sin depender de Google

**User Story:** Como emprendedor, quiero elegir Presencial o En linea en cualquier
cita, tenga o no Google conectado.

#### Acceptance Criteria

1. EL selector de modalidad (Presencial / En linea) DEBERA estar SIEMPRE disponible en
   el panel interno (crear y gestionar), sin gating por online_sessions.
2. EN el portal publico del cliente el selector Presencial / En linea DEBERA estar
   disponible SIEMPRE que el negocio permita citas en linea (ver Req 4), sin requerir
   Google conectado.
3. LA modalidad elegida DEBERA persistirse como hoy (createAppointment / updateAppointment /
   reserva publica).

### Requirement 2: URL de videollamada manual (emprendedor)

**User Story:** Como emprendedor, quiero pegar la URL de la videollamada de una cita en
linea, para compartir mi propio enlace sin depender de Google.

#### Acceptance Criteria

1. CUANDO una cita es "online" EL panel DEBERA permitir capturar/editar una URL de
   videollamada (campo de texto) que se guarda en `video_call_url`.
2. EL backend DEBERA aceptar `video_call_url` en la creacion y en la actualizacion de
   la cita, validando que sea una URL http(s) valida o vacia (para limpiarla).
3. SI la modalidad es "in_person" EL panel NO DEBERA exigir URL; una URL previa puede
   limpiarse.
4. LA URL manual DEBERA poder editarse desde el panel de gestion de la cita.

### Requirement 3: El cliente ve la URL a la hora de su cita

**User Story:** Como cliente, quiero ver el enlace de mi videollamada, para unirme a mi
cita en linea.

#### Acceptance Criteria

1. CUANDO una cita en linea tiene `video_call_url` EL portal de reserva DEBERA mostrar
   el enlace en la confirmacion (ya existe para el flujo de reserva).
2. EL endpoint `GET /me/appointments` DEBERA incluir `video_call_url` y `modality` para
   que el cliente vea el enlace en "Mis citas".
3. LA vista "Mis citas" del cliente DEBERA mostrar el enlace de videollamada cuando
   exista, para citas en linea.

### Requirement 4: El hook de Google no pisa la URL manual + control de sesiones en linea

**User Story:** Como emprendedor, no quiero que mi enlace manual sea reemplazado por el
Meet automatico, y quiero controlar si ofrezco citas en linea.

#### Acceptance Criteria

1. CUANDO el hook de Google genera un Meet Y la cita YA tiene un `video_call_url`
   ENTONCES el hook NO DEBERA sobrescribirlo (la URL manual tiene prioridad).
2. CUANDO la cita NO tiene `video_call_url` y el hook genera un Meet ENTONCES SI DEBERA
   guardarlo (comportamiento actual para quien usa Google).
3. EL portal publico DEBERA ofrecer "En linea" cuando el negocio lo permita. Como el
   gating actual usa online_sessions (Google), y ahora se desacopla, el portal DEBERA
   basarse en un flag de negocio: si el tenant tiene online_sessions (Google) O el
   emprendedor habilito citas en linea manualmente. Para mantener el alcance acotado y
   sin nuevos toggles/DB, el portal publico DEBERA ofrecer "En linea" SIEMPRE (el
   negocio decide caso por caso si captura URL); esta decision se documenta y puede
   ajustarse luego con un toggle dedicado.

### Requirement 5: No regresion

**User Story:** Como usuario, quiero que el resto del flujo de citas siga igual.

#### Acceptance Criteria

1. LAS validaciones existentes (aforo, duplicado, conflicto, aislamiento por tenant)
   DEBERAN permanecer intactas.
2. EL Meet automatico (con Google conectado) DEBERA seguir funcionando cuando no hay
   URL manual.
3. EL sistema DEBERA compilar (tsc) y construir (vite build); las suites de citas
   DEBERAN seguir en verde.
