# Requirements Document

## Introduction

Ajustes a la vista de Citas del emprendedor:
- Las citas PASADAS ya no permiten acciones operativas (confirmar, completar,
  cancelar, no-asistio, reprogramar, WhatsApp); solo se pueden ARCHIVAR.
- La columna "Pasadas" muestra unicamente los ultimos 7 dias.
- Las citas se ordenan por horario dentro de cada columna.
- Archivar OCULTA la cita de la vista sin borrarla (se conserva en la base de
  datos, auditable/recuperable).

Contexto actual (ya implementado): la vista agrupa en Hoy / Proximas / Pasadas y ya
ordena por hora (Hoy/Proximas ascendente, Pasadas descendente). El modelo
Appointment NO tiene un campo de archivado; se agregara.

## Glossary

- **Cita pasada**: cita cuyo dia calendario local es anterior a hoy.
- **Archivar**: marcar la cita como archivada para ocultarla de la vista; NO la borra.
- **archived**: campo booleano nuevo en Appointment (default false).
- **Ventana de 7 dias**: solo se listan citas pasadas con start_time >= hoy - 7 dias.

## Requirements

### Requirement 1: Archivar citas (soft, no borra)

**User Story:** Como emprendedor, quiero archivar citas pasadas para limpiar mi
vista sin perder el historial.

#### Acceptance Criteria

1. EL modelo Appointment DEBERA tener un campo `archived Boolean @default(false)`.
2. CUANDO el emprendedor archiva una cita ENTONCES el sistema DEBERA marcar
   `archived = true` sin cambiar su status ni borrar el registro.
3. LAS citas archivadas NO DEBERAN aparecer en la vista de Citas (Hoy/Proximas/Pasadas).
4. EL endpoint de archivar DEBERA estar scoped por tenant (una cita de otro tenant
   -> 404) y disponible para ADMIN y ASSISTANT (staff), igual que las demas
   acciones de gestion de citas.
5. ARCHIVAR NO DEBERA disparar el hook de Google ni alterar Calendar/Meet.

### Requirement 2: Citas pasadas solo permiten archivar

**User Story:** Como emprendedor, no quiero operar citas que ya ocurrieron; solo
quiero poder archivarlas.

#### Acceptance Criteria

1. EN la columna "Pasadas" cada tarjeta/detalle NO DEBERA ofrecer confirmar,
   completar, no-asistio, cancelar, reprogramar ni WhatsApp.
2. EN la columna "Pasadas" la unica accion disponible DEBERA ser "Archivar".
3. LAS columnas "Hoy" y "Proximas" DEBERAN conservar todas sus acciones actuales.
4. UNA cita se considera pasada por su dia calendario local (anterior a hoy),
   consistente con la agrupacion actual.

### Requirement 3: Ventana de 7 dias en Pasadas

**User Story:** Como emprendedor, quiero ver en Pasadas solo lo reciente (ultimos 7
dias), para no saturar la vista con historial viejo.

#### Acceptance Criteria

1. LA columna "Pasadas" DEBERA mostrar solo citas con start_time dentro de los
   ultimos 7 dias (>= inicio del dia de hace 7 dias y < hoy).
2. LAS citas pasadas de mas de 7 dias NO DEBERAN mostrarse (siguen existiendo en DB).
3. LA ventana de 7 dias NO DEBERA afectar a Hoy ni a Proximas.

### Requirement 4: Orden por horario

**User Story:** Como emprendedor, quiero ver las citas ordenadas por horario para
seguir mi dia con claridad.

#### Acceptance Criteria

1. HOY y PROXIMAS DEBERAN ordenarse por start_time ascendente (lo inmediato primero).
2. PASADAS DEBERAN ordenarse por start_time descendente (lo mas reciente primero).
3. ESTE comportamiento ya existe y DEBERA verificarse/preservarse.

### Requirement 5: No regresion

**User Story:** Como usuario, quiero que el resto de la gestion de citas siga igual.

#### Acceptance Criteria

1. LAS reglas y acciones de Hoy/Proximas (crear, confirmar, pago, notas, reprogramar,
   WhatsApp) DEBERAN permanecer intactas.
2. EL listado de citas del backend DEBERA excluir archivadas por defecto.
3. EL sistema DEBERA compilar sin errores (tsc) y las suites existentes seguir en
   verde (salvo fallos preexistentes ajenos).
