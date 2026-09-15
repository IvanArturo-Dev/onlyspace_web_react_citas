# Requirements Document

## Introduction

Evolucion de la reserva de citas: modalidad "a domicilio" (ademas de presencial y en linea), modalidad ofrecida como seleccion multiple por el negocio, datos de contacto/domicilio obligatorios segun modalidad, buscador dentro del combo de servicios al agendar, y retirar la grafica "Comportamiento por mes" del panel de citas (permanece en el dashboard). Todo scoped por tenant, sin romper el flujo de reserva/waitlist existente.

## Requirements

### Requirement 1: Modalidad ofrecida como seleccion multiple

**User Story:** Como emprendedor, quiero marcar cuales modalidades ofrezco (presencial, en linea, a domicilio) en cualquier combinacion, para que el cliente solo vea las que aplican.

#### Acceptance Criteria
1. WHEN el emprendedor configura su negocio THEN el sistema SHALL permitir marcar cualquier combinacion de {in_person, online, home} con al menos una seleccionada.
2. WHEN se guarda la configuracion THEN el sistema SHALL persistir la lista de modalidades ofrecidas por tenant.
3. WHEN el cliente o el panel elige modalidad al reservar THEN el sistema SHALL ofrecer unicamente las modalidades habilitadas por el negocio.
4. IF una sola modalidad esta habilitada THEN el sistema SHALL preseleccionarla y ocultar el selector.
5. WHEN existe configuracion previa (offered_modality string) THEN el sistema SHALL migrarla sin perdida: in_person->[in_person], online->[online], both->[in_person,online].

### Requirement 2: Modalidad a domicilio

**User Story:** Como emprendedor que da servicio a domicilio, quiero ofrecer esa modalidad y saber a donde ir, para atender fuera de mi local.

#### Acceptance Criteria
1. WHEN el negocio ofrece "a domicilio" y el cliente/panel la elige THEN el sistema SHALL aceptar la modalidad 'home'.
2. IF la modalidad es 'home' THEN el sistema SHALL requerir la direccion donde se recibira el servicio y una URL de Google Maps, ambas obligatorias.
3. WHEN se agenda una cita a domicilio THEN el sistema SHALL persistir direccion y URL de Maps en la cita.
4. IF la modalidad no es 'home' THEN el sistema SHALL NOT exigir direccion ni URL de Maps.
5. WHEN la modalidad solicitada no esta ofrecida por el negocio THEN el sistema SHALL rechazar con 400 MODALITY_NOT_OFFERED.

### Requirement 3: Contacto obligatorio y datos por cita

**User Story:** Como emprendedor, quiero un telefono de contacto en cada cita, para poder comunicarme con el cliente.

#### Acceptance Criteria
1. WHEN se agenda una cita (portal publico o panel) THEN el sistema SHALL requerir un numero de contacto obligatorio.
2. WHEN se agenda THEN el sistema SHALL persistir el telefono de contacto en la cita.
3. IF falta el telefono THEN el sistema SHALL rechazar con 400 y mensaje claro en espanol.
4. WHEN es a domicilio Y falta direccion o URL de Maps THEN el sistema SHALL rechazar con 400 y mensaje claro en espanol.

### Requirement 4: Buscador en el combo de servicios

**User Story:** Como emprendedor/cliente, quiero buscar el servicio por nombre al desplegar el listado, para elegir rapido cuando hay muchos.

#### Acceptance Criteria
1. WHEN se despliega el listado de servicios al agendar THEN el sistema SHALL mostrar un campo de busqueda que filtra por nombre en vivo.
2. WHEN no hay coincidencias THEN el sistema SHALL mostrar un aviso vacio sin romper el formulario.
3. WHEN se limpia la busqueda THEN el sistema SHALL mostrar todos los servicios de nuevo.

### Requirement 5: Retirar grafica del panel de citas

**User Story:** Como emprendedor, no quiero la grafica "Comportamiento por mes" en el panel de citas, para no perder el foco.

#### Acceptance Criteria
1. WHEN el emprendedor abre el panel de citas THEN el sistema SHALL NOT mostrar la grafica "Comportamiento por mes".
2. WHEN abre el dashboard THEN el sistema SHALL seguir mostrando la grafica alli (sin cambios).