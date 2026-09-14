# Requirements Document

## Introduction

Este documento define la evolucion del sistema de citas para soportar **emprendedores con multiples sucursales**, un **panel de super administracion en (casi) tiempo real**, y **gestion de usuarios, perfiles y modulos** por parte del super admin. Amplia el trabajo previo (portal de reservas por codigo, roles SUPERADMIN/ADMIN/CLIENT) con:

- Un modelo donde un **emprendedor** (rol ADMIN, equivalente a un tenant/negocio) administra **N sucursales**. Cada sucursal tiene su propio **codigo de acceso y QR**, **horarios**, **dias de asueto** y **categorias**. Los clientes agendan en una sucursal concreta.
- Un **dashboard amigable** para el emprendedor y otro **en tiempo real** para el super admin.
- Alta de usuarios emprendedores por el super admin, y capacidades de administracion global: bloquear usuarios, cambiar perfiles (roles), habilitar/deshabilitar modulos, y observar sesiones/reservaciones/cancelaciones recientes.
- Un **panel publico de busqueda de sucursal** accesible por quienes no son emprendedores (clientes), por codigo o busqueda.

Decisiones tomadas para esta version:
- "Tiempo real" se implementa mediante **auto-refresco por polling** (cada pocos segundos), sin WebSockets.
- "Sesiones activas" se aproxima como **usuarios con actividad reciente** (ventana configurable, p. ej. ultimos 5-15 minutos) mediante un campo `last_seen` actualizado en cada request autenticado.
- **Ofertas y promociones** quedan fuera de alcance (fase posterior); el portal del cliente cubre categorias, horarios disponibles y agendamiento por sucursal.

Se reutiliza: autenticacion Google/Firebase, JWT con `role`, multi-tenant Prisma/MySQL, `AuthorizedAdmin`, modelos `Service`/`Schedule`/`Appointment`/`Customer`/`AuditLog`, y el frontend con tema claro/oscuro y guards por rol.

## Glossary

- **Super Admin**: cuenta global (`xcode.arturo@gmail.com`) que administra todo el sistema sin importar la sucursal.
- **Emprendedor**: usuario con rol ADMIN; dueno de un negocio (tenant) que puede tener multiples sucursales.
- **Sucursal (Branch)**: ubicacion operativa de un emprendedor, con su propio codigo de acceso, QR, horarios, dias de asueto y categorias.
- **Cliente**: usuario sin perfil de emprendedor; puede buscar sucursales, ver horarios y agendar.
- **Codigo de sucursal**: identificador alfanumerico de 6 caracteres, unico, que da acceso al portal publico de esa sucursal.
- **Dia de asueto (Holiday)**: fecha en la que una sucursal no atiende, excluida de la disponibilidad.
- **Sesion activa (aprox.)**: usuario con `last_seen` dentro de la ventana reciente configurada.
- **Modulo**: funcionalidad conmutable a nivel de sistema o de emprendedor (habilitar/deshabilitar) por el super admin.
- **Perfil**: el rol de un usuario (SUPERADMIN, ADMIN/emprendedor, CLIENT).

## Requirements

### Requirement 1: Alta de emprendedores por el Super Admin

**User Story:** Como super admin, quiero dar de alta usuarios con perfil de emprendedor, para habilitar negocios en la plataforma.

#### Acceptance Criteria

1. THE super admin SHALL poder registrar/dar de alta a un usuario como emprendedor identificado por su email.
2. WHEN el super admin da de alta un emprendedor THEN el sistema SHALL asegurar su negocio (tenant) y permitir que, al iniciar sesion con Google, obtenga el rol de emprendedor (ADMIN).
3. THE super admin SHALL poder ver la lista de emprendedores con su estado (activo/bloqueado) y su negocio.
4. WHEN el super admin da de alta un emprendedor nuevo THEN el sistema SHALL crear al menos una sucursal inicial para ese negocio con su propio codigo de acceso.
5. IF un email no esta dado de alta como emprendedor ni es super admin THEN el sistema SHALL tratarlo como cliente.

### Requirement 2: Modelo de sucursales del emprendedor

**User Story:** Como emprendedor, quiero administrar mis sucursales, para operar varias ubicaciones desde una sola cuenta.

#### Acceptance Criteria

1. THE emprendedor SHALL poder crear, editar y desactivar sucursales de su negocio.
2. THE cada sucursal SHALL tener un nombre, un estado (activa/inactiva) y un codigo de acceso alfanumerico de 6 caracteres unico en todo el sistema.
3. THE datos operativos (horarios, dias de asueto, categorias, citas) SHALL asociarse a una sucursal especifica.
4. WHERE una sucursal esta inactiva THE su portal publico NO SHALL permitir agendar.
5. THE un emprendedor solo SHALL ver y administrar las sucursales de su propio negocio (aislamiento por tenant).
6. WHEN se crea una sucursal THEN el sistema SHALL generarle un codigo de acceso unico automaticamente.

### Requirement 3: Horarios, categorias y dias de asueto por sucursal

**User Story:** Como emprendedor, quiero configurar horarios, categorias y dias de asueto por sucursal, para reflejar la operacion real de cada ubicacion.

#### Acceptance Criteria

1. THE emprendedor SHALL poder definir horarios de trabajo por dia de la semana para cada sucursal.
2. THE emprendedor SHALL poder definir dias de asueto (fechas concretas sin atencion) por sucursal.
3. THE emprendedor SHALL poder configurar categorias (tipo de cita con duracion) por sucursal.
4. WHEN se calcula la disponibilidad de una sucursal THEN el sistema SHALL excluir los dias de asueto ademas de los horarios cerrados y los slots ocupados.
5. WHERE una categoria esta inactiva THE portal publico de la sucursal NO SHALL ofrecerla.
6. THE configuracion de una sucursal NO SHALL afectar la de otra sucursal del mismo u otro negocio.

### Requirement 4: Codigo y QR de acceso por sucursal

**User Story:** Como emprendedor, quiero exportar un QR con el enlace y el codigo de cada sucursal, para que mis clientes accedan directamente.

#### Acceptance Criteria

1. THE emprendedor SHALL poder ver, por cada sucursal, su codigo de acceso, el enlace del portal y un codigo QR.
2. THE QR SHALL codificar el enlace publico del portal de la sucursal (que contiene su codigo).
3. THE emprendedor SHALL poder exportar/descargar el QR (por ejemplo como imagen) o copiar el enlace.
4. WHEN un cliente accede por el codigo o QR de una sucursal THEN el sistema SHALL mostrar el portal de esa sucursal (categorias y horarios disponibles).
5. IF el codigo no corresponde a una sucursal activa THEN el sistema SHALL indicar que no es valido.

### Requirement 5: Panel publico de busqueda de sucursal

**User Story:** Como cliente (sin perfil de emprendedor), quiero buscar una sucursal, para acceder a su portal y agendar.

#### Acceptance Criteria

1. WHERE un usuario no tiene perfil de emprendedor THE sistema SHALL permitirle acceder al panel de busqueda de sucursal.
2. THE panel de busqueda SHALL permitir ingresar un codigo de sucursal para abrir su portal.
3. THE panel de busqueda SHALL permitir buscar sucursales por nombre de negocio o de sucursal (busqueda basica), mostrando resultados con datos no sensibles.
4. WHEN el usuario selecciona una sucursal THEN el sistema SHALL abrir su portal publico de reservas.
5. THE panel de busqueda NO SHALL exponer datos sensibles (clientes, citas de otros) de las sucursales.

### Requirement 6: Dashboard del emprendedor

**User Story:** Como emprendedor, quiero un dashboard claro y entendible, para ver el estado de mi negocio de un vistazo.

#### Acceptance Criteria

1. THE dashboard del emprendedor SHALL mostrar metricas agregadas de su negocio: numero de sucursales, categorias, y citas por estado.
2. THE dashboard SHALL permitir ver metricas por sucursal ademas del consolidado del negocio.
3. THE dashboard SHALL mostrar la actividad reciente relevante (proximas citas, reservaciones y cancelaciones recientes) de su negocio.
4. WHILE los datos se cargan THE dashboard SHALL mostrar estados de carga; IF una consulta falla THEN SHALL mostrar error con reintento.
5. THE dashboard SHALL ser responsive y consistente con el tema (claro/oscuro).

### Requirement 7: Gestion de reservaciones por el emprendedor

**User Story:** Como emprendedor, quiero gestionar las reservaciones de mis sucursales, para dar seguimiento y control.

#### Acceptance Criteria

1. THE emprendedor SHALL poder ver las reservaciones de sus sucursales, con quien agendo, categoria, sucursal, fecha/hora y estado.
2. THE emprendedor SHALL poder filtrar reservaciones por sucursal, estado y rango de fechas.
3. THE emprendedor SHALL poder confirmar, cancelar, completar, marcar no-asistio, modificar y agregar reservaciones.
4. WHEN el emprendedor modifica o agrega una reservacion THEN el sistema SHALL validar que el horario este disponible en la sucursal.
5. WHEN cambia el estado de una reservacion THEN el sistema SHALL persistirlo y registrarlo en auditoria.
6. THE emprendedor solo SHALL operar reservaciones de sus propias sucursales (aislamiento por tenant).

### Requirement 8: Monitoreo (casi) en tiempo real del Super Admin

**User Story:** Como super admin, quiero ver sesiones, reservaciones y cancelaciones recientes actualizandose solas, para monitorear el uso en vivo.

#### Acceptance Criteria

1. THE sistema SHALL registrar la ultima actividad (`last_seen`) de cada usuario autenticado en sus requests.
2. THE super admin SHALL poder ver el numero de sesiones activas (usuarios con actividad dentro de la ventana reciente configurada) con su rol y su ultima actividad.
3. THE super admin SHALL poder ver reservaciones y cancelaciones recientes (por ejemplo ultimas 24h) a nivel global.
4. WHEN el dashboard del super admin esta abierto THEN el sistema SHALL auto-refrescar los datos por polling cada pocos segundos.
5. IF una actualizacion de datos falla THEN el panel SHALL conservar los ultimos datos y mostrar un indicador de reconexion, sin romperse.
6. THE monitoreo SHALL abarcar todas las sucursales y negocios, sin filtro por tenant.

### Requirement 9: Dashboard global del Super Admin

**User Story:** Como super admin, quiero un dashboard en tiempo real del uso de la aplicacion, para conocer el estado de la plataforma.

#### Acceptance Criteria

1. THE dashboard global SHALL mostrar totales: numero de emprendedores, sucursales, clientes, categorias y citas.
2. THE dashboard global SHALL mostrar citas por estado a nivel global y reservaciones/cancelaciones recientes.
3. THE dashboard global SHALL mostrar las sesiones activas actuales (aprox. por actividad reciente).
4. THE dashboard global SHALL auto-refrescarse por polling.
5. WHILE carga THE dashboard SHALL mostrar estados de carga; IF falla una consulta THEN SHALL mostrar error sin romper el resto del panel.

### Requirement 10: Administracion global de usuarios, perfiles y modulos

**User Story:** Como super admin, quiero administrar usuarios, perfiles y modulos, para controlar accesos y funcionalidades sin importar la sucursal.

#### Acceptance Criteria

1. THE super admin SHALL poder administrar recursos de cualquier negocio/sucursal sin restriccion de tenant.
2. THE super admin SHALL poder bloquear y desbloquear usuarios; un usuario bloqueado NO SHALL poder autenticarse ni operar.
3. THE super admin SHALL poder cambiar el perfil (rol) de un usuario entre los perfiles soportados, respetando que la elevacion a super admin no ocurra por vias normales.
4. THE super admin SHALL poder habilitar o deshabilitar modulos a nivel de sistema o de emprendedor.
5. WHERE un modulo esta deshabilitado para un emprendedor THE sus endpoints/pantallas asociados NO SHALL estar disponibles para ese emprendedor.
6. WHEN el super admin bloquea un usuario, cambia su perfil o conmuta un modulo THEN el sistema SHALL registrar la accion en auditoria.
7. IF un usuario es bloqueado durante una sesion activa THEN sus siguientes requests SHALL ser rechazados.

### Requirement 11: Separacion de roles y aislamiento (se mantiene y extiende)

**User Story:** Como responsable del producto, quiero que cada rol vea solo lo que le corresponde y que los datos entre negocios/sucursales esten aislados, para mantener seguridad.

#### Acceptance Criteria

1. THE super admin SHALL acceder a administracion global y monitoreo; NO SHALL operar la agenda como emprendedor salvo por sus capacidades de administracion global.
2. THE emprendedor SHALL acceder solo a la gestion de su negocio y sucursales; NO SHALL ver el area del super admin.
3. THE cliente SHALL acceder solo al panel de busqueda, portales de sucursal y sus propias citas.
4. THE datos de una sucursal/negocio NO SHALL ser accesibles por otro emprendedor.
5. THE backend SHALL validar rol/identidad y estado (bloqueado) en cada endpoint, sin depender solo de la interfaz.
