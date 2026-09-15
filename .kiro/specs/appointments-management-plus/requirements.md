# Requirements Document

## Introduction

Esta spec agrupa mejoras del portal del cliente y de la gestion de citas del emprendedor, mas dos features pendientes (contacto en el portal y direccion de Google Maps en la sucursal). Construye sobre lo existente: la vista /mis-citas del cliente (MyAppointments), el modelo Appointment con campo modality (in_person/online), el modelo Branch con address/city/latitude/longitude, la lista de espera (WaitlistEntry, FIFO, estados WAITING/OFFERED/CONFIRMED/EXPIRED/CANCELLED) y el panel de citas del emprendedor.

Requiere migraciones nuevas (Prisma migrate, no db push): campos de configuracion en Tenant (modalidad ofrecida, mostrar contacto, auto-asignar lista de espera) y en Branch (URL de Google Maps).

Objetivos:
1. Mejorar la vista /mis-citas del cliente: citas arriba, mas visibles, con categoria, sucursal y logo.
2. Permitir al emprendedor configurar la modalidad que ofrece (presencial, en linea o ambas).
3. Dar al emprendedor visibilidad y control de la lista de espera: ver encolados, orden por prioridad (precio), aceptar manualmente o auto-asignar al liberarse un espacio.
4. Priorizar/destacar citas por precio del servicio para que el emprendedor enfoque las de mejor ganancia.
5. Bandera por-negocio para mostrar datos de contacto en el portal publico.
6. Capturar una direccion/URL de Google Maps en la sucursal y mostrarla al cliente (en lugar de exigir coordenadas).

Multi-tenant: toda config y dato se scopea por tenant. No se rompe el flujo de reserva ni el gating premium existente.

## Glossary

- Modalidad: forma de la cita, "in_person" (presencial) u "online" (en linea).
- Encolado: cliente en la lista de espera (WaitlistEntry en estado WAITING) para un servicio/dia.
- Auto-asignacion: opcion por-negocio que, al liberarse un espacio, asigna automaticamente el hueco al primer encolado compatible.
- Prioridad por precio: orden/realce de citas y encolados segun el precio del servicio (mayor precio primero).
- maps_url: enlace de Google Maps de la sucursal (comparte-ubicacion), mostrado al cliente.

## Requirements

### Requirement 1: Rediseno de /mis-citas del cliente

**User Story:** Como cliente, quiero ver mis citas de forma clara y destacada, con la categoria, la sucursal y el logo del negocio, para identificarlas facil.

#### Acceptance Criteria

1. THE vista /mis-citas SHALL mostrar las citas en la parte superior, destacadas y con un diseno mas visible que el actual.
2. THE cada cita SHALL mostrar la categoria (servicio), el nombre de la sucursal y el logo del negocio cuando esten disponibles.
3. WHERE el negocio no tiene logo THE UI SHALL degradar con un placeholder sin romper el diseno.
4. THE orden SHALL priorizar las citas proximas/activas arriba; las pasadas quedan despues.

### Requirement 2: Modalidad configurable por el emprendedor

**User Story:** Como emprendedor, quiero configurar si ofrezco citas presenciales, en linea o ambas, para que solo se ofrezca lo que realmente doy.

#### Acceptance Criteria

1. THE emprendedor SHALL poder configurar la modalidad ofrecida por el negocio: solo presencial, solo en linea, o ambas.
2. WHEN un cliente reserva THEN el sistema SHALL permitir unicamente las modalidades habilitadas por el negocio.
3. THE configuracion SHALL persistir a nivel tenant y aplicar en el panel y en el portal publico.
4. IF el negocio ofrece solo una modalidad THEN la UI de reserva NO SHALL mostrar el selector (usa esa modalidad directamente).

### Requirement 3: Visibilidad y control de la lista de espera

**User Story:** Como emprendedor, quiero ver los encolados y su orden, y decidir a quien asignar, para gestionar mejor mi agenda.

#### Acceptance Criteria

1. THE panel del emprendedor SHALL mostrar los encolados (WAITING) por servicio/dia, con datos utiles (cliente, servicio, precio, fecha deseada, orden).
2. THE encolados SHALL poder ordenarse/destacarse por prioridad de precio (mayor precio del servicio primero) para la vista del emprendedor.
3. WHEN el emprendedor acepta un encolado THEN el sistema SHALL asignarle el espacio (crear/confirmar la cita) como ya ocurre hoy (aceptacion manual).
4. THE aislamiento por tenant SHALL mantenerse en todas las consultas y acciones de la cola.

### Requirement 4: Auto-asignacion de la lista de espera (config por-negocio)

**User Story:** Como emprendedor, quiero activar que, al liberarse un espacio, se asigne automaticamente al siguiente encolado, para no perder el hueco.

#### Acceptance Criteria

1. THE negocio SHALL tener una configuracion (on/off) de auto-asignacion de la lista de espera, editable por el emprendedor.
2. WHEN se libera un espacio (p. ej. una cancelacion) AND la auto-asignacion esta activada THEN el sistema SHALL asignar ese espacio al primer encolado compatible (FIFO) de forma automatica, creando/confirmando la cita.
3. WHERE la auto-asignacion esta desactivada THE sistema SHALL mantener el comportamiento actual (el emprendedor acepta manualmente).
4. THE auto-asignacion SHALL re-verificar la disponibilidad del hueco en la misma transaccion para no crear dobles reservas (consistencia ante concurrencia).
5. IF no hay encolado compatible THEN el espacio SHALL quedar libre sin efectos.

### Requirement 5: Priorizacion de citas por precio

**User Story:** Como emprendedor, quiero que las citas de mayor precio se destaquen/prioricen, para enfocar las de mejor ganancia.

#### Acceptance Criteria

1. THE panel de citas SHALL permitir ver/destacar las citas segun el precio del servicio (mayor precio con mayor realce/prioridad de orden).
2. THE realce por precio NO SHALL romper la separacion existente entre actuales/proximas e historial ni el gating premium.
3. THE calculo SHALL basarse en el precio real del servicio asociado a la cita.

### Requirement 6: Mostrar datos de contacto en el portal (bandera por-negocio)

**User Story:** Como emprendedor, quiero poder mostrar mis datos de contacto en el portal publico, para que el cliente me contacte directo.

#### Acceptance Criteria

1. THE negocio SHALL tener una bandera (on/off) para mostrar datos de contacto en su portal publico.
2. WHERE la bandera esta activada THE portal publico SHALL mostrar los datos de contacto disponibles (p. ej. WhatsApp/telefono del negocio).
3. WHERE la bandera esta desactivada THE portal NO SHALL exponer datos de contacto.
4. THE configuracion SHALL persistir a nivel tenant.

### Requirement 7: Direccion de Google Maps en la sucursal

**User Story:** Como emprendedor, quiero pegar la direccion/enlace de Google Maps de mi sucursal en lugar de coordenadas, para que el cliente vea como llegar facilmente.

#### Acceptance Criteria

1. THE formulario de sucursal SHALL permitir capturar una URL/direccion de Google Maps (maps_url), sin exigir coordenadas manuales.
2. WHERE la sucursal tiene maps_url THE portal publico SHALL mostrar al cliente un enlace/boton "Como llegar" que abra esa ubicacion.
3. THE captura de coordenadas (latitude/longitude) SHALL dejar de ser obligatoria; si ya existen se conservan, pero el flujo principal usa maps_url.
4. THE maps_url SHALL validarse minimamente (URL http/https) y persistir por sucursal (scoped por tenant).
