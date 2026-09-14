# Requirements Document

## Introduction

Este documento define los requisitos para el modulo de SuperAdmin y Observabilidad Global de la plataforma de citas. El objetivo es dotar a la plataforma de un rol de super usuario global (por encima del aislamiento multi-tenant) capaz de observar y medir toda la actividad del sistema: citas, ingresos, usuarios, y el registro de auditoria de cada accion realizada en cualquier tenant.

El super usuario designado es la cuenta con email `xcode.arturo@gmail.com`. Esta cuenta debe poder consultar metricas y actividad de todos los tenants desde un panel unificado, sin poder ser degradada accidentalmente por operaciones normales de administracion de tenant.

Este modulo se construye sobre la arquitectura existente: autenticacion JWT (que ya transporta `role` y `permissions`), el modelo multi-tenant de Prisma/MySQL, el modelo `AuditLog` ya presente en el esquema, y el `dashboard.service` que ya calcula metricas por tenant. El alcance NO incluye vigilancia de personas fuera del contexto operativo del sistema (ubicacion en tiempo real, contenido de comunicaciones privadas). La observabilidad se limita a la actividad de negocio y del sistema registrada dentro de la plataforma.

## Glossary

- **Tenant**: organizacion aislada dentro de la plataforma; cada tenant tiene sus propios usuarios, clientes, servicios y citas.
- **SUPERADMIN**: rol global por encima de los tenants, con capacidad de lectura sobre todos ellos. Distinto de ADMIN, que es administrador dentro de un solo tenant.
- **Super usuario**: la cuenta concreta `xcode.arturo@gmail.com` a la que se le asigna el rol SUPERADMIN.
- **AuditLog**: registro inmutable de acciones (login, logout, create, update, delete, confirm, cancel) sobre recursos del sistema, ya modelado en el esquema Prisma.
- **Observabilidad de negocio**: agregacion de metricas operativas (citas, ingresos, ocupacion, usuarios activos, no-shows) a nivel global.
- **Aislamiento multi-tenant**: regla por la cual un usuario solo puede ver datos de su propio `tenant_id`.

## Requirements

### Requirement 1: Rol SUPERADMIN global

**User Story:** Como duenio de la plataforma, quiero un rol de super usuario por encima de los tenants, para poder supervisar toda la operacion sin estar limitado a un solo tenant.

#### Acceptance Criteria

1. THE sistema SHALL soportar un rol global identificado como `SUPERADMIN` distinguible de los roles por tenant (ADMIN, PROFESSIONAL, RECEPTION).
2. WHEN se genera el token de acceso de un usuario SUPERADMIN THEN el sistema SHALL incluir el rol `SUPERADMIN` en el payload del JWT.
3. WHERE un usuario tiene rol SUPERADMIN THE sistema SHALL permitir el acceso de lectura a recursos de cualquier tenant, ignorando el filtro por `tenant_id` de forma controlada.
4. THE asignacion del rol SUPERADMIN SHALL requerir una operacion explicita (seed o script administrativo) y NO SHALL ser asignable mediante los endpoints normales de gestion de usuarios de un tenant.
5. IF un usuario sin rol SUPERADMIN intenta acceder a un endpoint de super administracion THEN el sistema SHALL responder 403 Forbidden.

### Requirement 2: Designacion de xcode.arturo@gmail.com como super usuario

**User Story:** Como duenio de la plataforma, quiero que mi cuenta xcode.arturo@gmail.com sea el super usuario, para tener control total de observabilidad desde mi propio acceso.

#### Acceptance Criteria

1. THE sistema SHALL proveer un mecanismo idempotente (seed o script) que asigne el rol SUPERADMIN a la cuenta con email `xcode.arturo@gmail.com`.
2. IF la cuenta `xcode.arturo@gmail.com` no existe al ejecutar el mecanismo THEN el sistema SHALL crearla con el rol SUPERADMIN.
3. WHEN el mecanismo se ejecuta mas de una vez THEN el sistema SHALL mantener un unico super usuario consistente sin duplicar la cuenta.
4. THE credencial inicial del super usuario SHALL configurarse mediante variable de entorno y NO SHALL quedar embebida en el codigo fuente.
5. WHEN el super usuario inicia sesion THEN el sistema SHALL emitir un token con rol SUPERADMIN y registrar el evento en AuditLog.

### Requirement 3: Autorizacion y proteccion de endpoints de super administracion

**User Story:** Como responsable de seguridad, quiero que solo el super usuario acceda a las funciones globales, para evitar fugas de datos entre tenants.

#### Acceptance Criteria

1. THE sistema SHALL exponer los endpoints de super administracion bajo un prefijo dedicado (por ejemplo `/v1/admin`).
2. WHEN se recibe una peticion a un endpoint de super administracion THEN el sistema SHALL verificar el JWT y el rol SUPERADMIN antes de procesarla.
3. IF el token es invalido, expirado o de un rol distinto de SUPERADMIN THEN el sistema SHALL denegar el acceso con 401 o 403 segun corresponda.
4. WHILE un usuario SUPERADMIN opera sobre datos de un tenant especifico THE sistema SHALL permitir filtrar por `tenant_id` opcional en las consultas globales.
5. THE endpoints de super administracion NO SHALL permitir operaciones destructivas de datos de negocio como parte de este modulo (alcance de solo lectura y observabilidad).

### Requirement 4: Panel de observabilidad global

**User Story:** Como super usuario, quiero un panel que agregue metricas de todos los tenants, para medir el estado de toda la plataforma de un vistazo.

#### Acceptance Criteria

1. WHEN el super usuario abre el panel global THEN el sistema SHALL mostrar metricas agregadas de todos los tenants: total de tenants, usuarios, clientes, servicios y citas.
2. THE panel SHALL mostrar metricas de citas agregadas por estado (PENDING, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW) a nivel global.
3. THE panel SHALL mostrar ingresos agregados y por tenant en un rango de fechas seleccionable.
4. THE panel SHALL mostrar la tasa de no-show y la ocupacion agregadas.
5. WHEN el super usuario selecciona un tenant especifico THEN el sistema SHALL mostrar las mismas metricas filtradas a ese tenant.
6. WHILE los datos se cargan THE panel SHALL mostrar un estado de carga, y IF una consulta falla THEN SHALL mostrar un estado de error con opcion de reintentar.

### Requirement 5: Registro de auditoria completo

**User Story:** Como super usuario, quiero que toda accion relevante quede registrada, para poder rastrear cualquier movimiento en la plataforma.

#### Acceptance Criteria

1. WHEN un usuario realiza un login o logout THEN el sistema SHALL crear un registro en AuditLog con la accion correspondiente, el usuario, el tenant, IP y user agent cuando esten disponibles.
2. WHEN se crea, actualiza, elimina, confirma o cancela un recurso de negocio (cita, cliente, servicio) THEN el sistema SHALL crear un registro en AuditLog con el tipo y el id del recurso afectado.
3. THE registros de AuditLog SHALL ser inmutables: el sistema NO SHALL exponer endpoints para editarlos o borrarlos.
4. IF la escritura del registro de auditoria falla THEN el sistema SHALL registrar el error sin bloquear la operacion de negocio principal.
5. THE registro de auditoria SHALL almacenar el resultado de la operacion (exito o fallo).

### Requirement 6: Consulta de actividad global (audit trail)

**User Story:** Como super usuario, quiero consultar y filtrar el historial de acciones de toda la plataforma, para investigar situaciones y movimientos.

#### Acceptance Criteria

1. WHEN el super usuario consulta la actividad global THEN el sistema SHALL devolver registros de AuditLog de todos los tenants ordenados por fecha descendente.
2. THE consulta de actividad SHALL soportar filtros por tenant, usuario, tipo de accion, tipo de recurso y rango de fechas.
3. THE consulta de actividad SHALL soportar paginacion para manejar grandes volumenes de registros.
4. WHEN el super usuario aplica un filtro THEN el sistema SHALL devolver solo los registros que coincidan.
5. THE respuesta de actividad SHALL incluir por cada registro: fecha, usuario, tenant, accion, tipo de recurso, id de recurso y resultado.

### Requirement 7: Metricas tecnicas y salud del sistema

**User Story:** Como super usuario, quiero ver el estado tecnico de la plataforma, para detectar problemas de operacion.

#### Acceptance Criteria

1. THE sistema SHALL exponer al super usuario un indicador de salud del backend (estado y marca de tiempo).
2. THE panel SHALL mostrar contadores basicos de actividad reciente (por ejemplo numero de logins y acciones en las ultimas 24 horas).
3. WHERE existan errores registrados en auditoria THE panel SHALL permitir filtrar por resultado de fallo.
4. IF el backend no responde THEN el panel SHALL indicar el estado no disponible sin romper la interfaz.

### Requirement 8: Acceso desde la app web

**User Story:** Como super usuario, quiero acceder al panel global desde la aplicacion web, para supervisar sin herramientas externas.

#### Acceptance Criteria

1. WHEN el super usuario inicia sesion en la app web THEN la app SHALL detectar el rol SUPERADMIN y habilitar la seccion de administracion global.
2. WHERE el usuario no es SUPERADMIN THE app web NO SHALL mostrar ni permitir el acceso a la seccion de administracion global.
3. THE seccion de administracion global SHALL consumir los endpoints bajo `/v1/admin` reutilizando el cliente API y el manejo de tokens existentes.
4. WHEN el super usuario navega en el panel global THEN la app SHALL registrar eventos de navegacion mediante el mecanismo de analytics existente.
5. THE seccion de administracion global SHALL ser responsive para uso en escritorio y movil.
