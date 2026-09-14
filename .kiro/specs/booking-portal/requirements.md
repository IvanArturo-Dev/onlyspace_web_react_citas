# Requirements Document

## Introduction

Este documento define los requisitos para la evolucion del sistema de citas hacia un modelo de tres actores con un portal publico de reservas. El sistema pasa de ser una app de gestion generica a una plataforma donde:

- El **Super Admin** actua como portero de acceso: unicamente autoriza que personas pueden usar el sistema como administradores de citas.
- Los **Administradores de citas** (autorizados por el Super Admin) configuran sus categorias, duraciones y horarios de trabajo, y gestionan/dan seguimiento a sus citas. Cada administrador tiene un **codigo alfanumerico de 6 caracteres** que identifica su panel publico de reservas.
- Los **Clientes** acceden al panel publico de un administrador mediante su codigo de 6 caracteres (escrito en un input o escaneado desde un QR), inician sesion con Google, consultan categorias y disponibilidad, agendan su cita y reciben una notificacion in-app de confirmacion.

La disponibilidad que ve el cliente se genera automaticamente a partir del horario de trabajo del administrador y la duracion de la categoria seleccionada, ocultando los espacios ya ocupados.

Este trabajo se apoya en la arquitectura existente: autenticacion con Google/Firebase, JWT con `role`, multi-tenant Prisma/MySQL, y modelos ya presentes como `Schedule`, `ScheduleDay`, `Category`, `Service`, `Appointment`, `Customer` y `AuditLog`. El modulo previo de observabilidad del Super Admin se mantiene.

## Glossary

- **Super Admin**: cuenta global (`xcode.arturo@gmail.com`) cuyo unico proposito en este modulo es autorizar o revocar el acceso de administradores de citas.
- **Administrador de citas (Admin)**: usuario autorizado que gestiona su propia agenda: categorias, horarios, y citas. Equivale a un tenant/negocio.
- **Cliente**: persona que agenda una cita en el panel publico de un administrador. Inicia sesion con Google pero no administra nada.
- **Codigo de acceso**: identificador alfanumerico de 6 caracteres, unico por administrador, usado por los clientes para llegar al panel publico de reservas.
- **Categoria**: tipo de cita ofrecido por un administrador, con una duracion definida (reutiliza/entrelaza el concepto de Service/Category existente).
- **Horario de trabajo**: definicion por dia de la semana de los rangos horarios en que el administrador atiende.
- **Slot de disponibilidad**: espacio de tiempo agendable generado a partir del horario de trabajo y la duracion de la categoria, que no se solapa con citas existentes.
- **Notificacion in-app**: aviso mostrado dentro de la aplicacion (confirmacion inmediata y lista de citas del cliente), sin envio de email/SMS en esta version.

## Requirements

### Requirement 1: Autorizacion de acceso por el Super Admin

**User Story:** Como Super Admin, quiero autorizar o revocar que personas pueden usar el sistema como administradores de citas, para controlar quien tiene acceso.

#### Acceptance Criteria

1. THE sistema SHALL permitir al Super Admin registrar personas autorizadas identificadas por su email de Google.
2. WHEN el Super Admin autoriza un email THEN el sistema SHALL habilitar que esa persona, al iniciar sesion con Google, obtenga el rol de administrador de citas.
3. WHEN el Super Admin revoca una autorizacion THEN el sistema SHALL impedir el acceso de administrador de esa persona en inicios de sesion posteriores.
4. IF una persona inicia sesion con Google y su email NO esta autorizado ni es Super Admin THEN el sistema SHALL tratarla unicamente como cliente (sin capacidades de administracion).
5. THE Super Admin SHALL poder ver la lista de administradores autorizados con su estado (activo/revocado) y su codigo de acceso.
6. THE unico rol que el Super Admin gestiona en este modulo SHALL ser el de administrador de citas; el Super Admin NO administra citas, categorias ni horarios.
7. WHEN se autoriza a un nuevo administrador THEN el sistema SHALL asignarle un codigo de acceso alfanumerico de 6 caracteres unico.

### Requirement 2: Identidad y codigo de acceso del administrador

**User Story:** Como administrador de citas, quiero un codigo unico y un QR de mi panel publico, para compartirlo con mis clientes.

#### Acceptance Criteria

1. THE sistema SHALL generar para cada administrador un codigo alfanumerico de exactamente 6 caracteres, unico en todo el sistema.
2. THE codigo SHALL usar un alfabeto sin caracteres ambiguos (evitando confusiones como O/0 e I/1) y ser insensible a mayusculas/minusculas al resolverlo.
3. WHEN un administrador consulta su panel THEN el sistema SHALL mostrar su codigo de acceso y un QR que enlaza a su portal publico de reservas.
4. THE portal publico de un administrador SHALL ser accesible mediante una URL que contenga el codigo de acceso.
5. IF un codigo no corresponde a ningun administrador activo THEN el sistema SHALL responder que el codigo no es valido.

### Requirement 3: Configuracion de categorias y duraciones

**User Story:** Como administrador de citas, quiero configurar mis categorias con su duracion, para ofrecer distintos tipos de cita.

#### Acceptance Criteria

1. THE administrador SHALL poder crear, editar y desactivar categorias de cita.
2. THE cada categoria SHALL tener al menos un nombre y una duracion en minutos.
3. WHERE una categoria esta inactiva THE portal publico NO SHALL ofrecerla a los clientes.
4. WHEN el administrador cambia la duracion de una categoria THEN el sistema SHALL usar la nueva duracion para calcular los slots de disponibilidad de futuras reservas.
5. THE categorias SHALL pertenecer exclusivamente al administrador que las creo (aislamiento por tenant).

### Requirement 4: Configuracion de horarios de trabajo

**User Story:** Como administrador de citas, quiero definir mis horarios de trabajo por dia, para que solo se ofrezcan citas dentro de mi disponibilidad.

#### Acceptance Criteria

1. THE administrador SHALL poder definir, por cada dia de la semana, uno o varios rangos horarios de atencion (hora de inicio y fin).
2. THE administrador SHALL poder marcar dias sin atencion (cerrado).
3. WHEN el administrador guarda su horario THEN el sistema SHALL persistirlo y usarlo para generar la disponibilidad publica.
4. WHERE un dia no tiene rangos definidos THE sistema NO SHALL ofrecer slots ese dia.
5. THE horario SHALL pertenecer exclusivamente al administrador (aislamiento por tenant).

### Requirement 5: Consulta de disponibilidad por el cliente

**User Story:** Como cliente, quiero ver los horarios disponibles de una categoria, para elegir cuando agendar.

#### Acceptance Criteria

1. WHEN el cliente accede al portal con un codigo valido y elige una categoria y una fecha THEN el sistema SHALL mostrar los slots disponibles.
2. THE slots SHALL generarse a partir del horario de trabajo del administrador y la duracion de la categoria seleccionada.
3. THE sistema NO SHALL ofrecer slots que se solapen con citas existentes no canceladas.
4. THE sistema NO SHALL ofrecer slots en fechas/horas pasadas.
5. WHERE no hay disponibilidad para la fecha elegida THE sistema SHALL indicar que no hay horarios disponibles.
6. THE consulta de disponibilidad publica SHALL requerir un codigo de acceso valido y NO SHALL exponer datos de otros administradores.

### Requirement 6: Agendamiento de cita por el cliente

**User Story:** Como cliente, quiero agendar una cita en un slot disponible, para reservar mi lugar.

#### Acceptance Criteria

1. THE cliente SHALL iniciar sesion con Google antes de confirmar una reserva.
2. WHEN el cliente selecciona un slot disponible y confirma THEN el sistema SHALL crear una cita en estado pendiente asociada al administrador correspondiente.
3. THE cita creada SHALL registrar quien la agendo (identidad del cliente por su email de Google) y la categoria y horario elegidos.
4. IF el slot elegido dejo de estar disponible antes de confirmar (condicion de carrera) THEN el sistema SHALL rechazar la reserva e informar el conflicto.
5. WHEN la reserva se crea con exito THEN el sistema SHALL mostrar una notificacion in-app de confirmacion al cliente.
6. THE cliente SHALL poder ver la lista de sus propias citas con su estado (pendiente, confirmada, cancelada, etc.).
7. THE cliente NO SHALL poder ver ni modificar citas de otros clientes.

### Requirement 7: Notificacion in-app de la reserva

**User Story:** Como cliente, quiero recibir confirmacion de que mi cita fue agendada, para tener certeza de la reserva.

#### Acceptance Criteria

1. WHEN una cita se agenda con exito THEN el sistema SHALL mostrar una confirmacion in-app inmediata al cliente.
2. THE cliente SHALL poder consultar en la aplicacion el estado actualizado de sus citas (por ejemplo si el administrador la confirma o cancela).
3. WHERE el administrador cambia el estado de una cita THE cliente SHALL poder ver el nuevo estado al consultar sus citas.
4. THE version actual NO SHALL requerir envio de email o SMS; la notificacion es in-app.

### Requirement 8: Gestion y seguimiento de citas por el administrador

**User Story:** Como administrador de citas, quiero administrar y dar seguimiento a mis citas, para operar mi agenda.

#### Acceptance Criteria

1. THE administrador SHALL poder ver la lista de sus citas con el detalle de quien agendo, categoria, fecha/hora y estado.
2. THE administrador SHALL poder confirmar, cancelar y eliminar citas, asi como marcarlas completadas o como no-asistio.
3. WHEN el administrador cambia el estado de una cita THEN el sistema SHALL persistir el cambio y registrarlo en auditoria.
4. THE administrador SHALL poder filtrar sus citas por estado y por rango de fechas.
5. THE administrador solo SHALL ver y gestionar las citas de su propia agenda (aislamiento por tenant).
6. WHEN se crea, confirma, cancela o elimina una cita THEN el sistema SHALL registrar la accion en el log de auditoria con el actor correspondiente.

### Requirement 9: Separacion de roles y accesos

**User Story:** Como responsable del producto, quiero que cada rol vea solo lo que le corresponde, para mantener orden y seguridad.

#### Acceptance Criteria

1. THE Super Admin SHALL ver unicamente el area de autorizacion de administradores y observabilidad; NO SHALL ver pantallas de gestion de agenda.
2. THE administrador de citas SHALL ver unicamente su area de gestion (categorias, horarios, citas, su codigo/QR); NO SHALL ver el area del Super Admin.
3. THE cliente SHALL ver unicamente el portal de reservas y sus propias citas; NO SHALL ver areas de administracion.
4. IF un actor intenta acceder a un area que no le corresponde THEN el sistema SHALL redirigirlo o denegar el acceso.
5. THE endpoints del backend SHALL validar el rol/identidad antes de exponer datos o permitir acciones, sin depender solo de la interfaz.

### Requirement 10: Aislamiento de datos entre administradores

**User Story:** Como administrador de citas, quiero que mis datos esten aislados de otros administradores, para privacidad y orden.

#### Acceptance Criteria

1. THE categorias, horarios, citas y clientes de un administrador SHALL estar aislados por su tenant.
2. WHEN un cliente agenda mediante un codigo THEN la cita SHALL asociarse al tenant del administrador dueno del codigo.
3. THE consultas de un administrador NO SHALL devolver datos de otro administrador.
4. THE resolucion de un codigo de acceso SHALL mapear inequivocamente a un unico administrador/tenant.
