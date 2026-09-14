# Requirements Document

## Introduction

Este documento define un **sistema de retencion y lealtad** para la plataforma de citas. El objetivo es aumentar la recurrencia de los clientes: cada cliente acumula progreso por sus **citas completadas** y, al cumplir las reglas que el emprendedor configura, gana **recompensas** que luego el emprendedor canjea manualmente.

Se construye sobre lo existente: multi-tenant Prisma/MySQL, roles SUPERADMIN/ADMIN(emprendedor)/CLIENT + ASSISTANT, modelo `Appointment` con estados (incluye COMPLETED), `Customer` por tenant, sucursales (`Branch`), `Notification`/`NotificationTemplate`, `writeAudit`, y el frontend web con tema claro/oscuro y guards por rol.

Decisiones de negocio tomadas para esta version:
- **Solo cuentan las citas COMPLETADAS** (estado COMPLETED). Confirmadas o pendientes no acumulan.
- La acumulacion es **por negocio** (todas las sucursales del emprendedor suman al mismo progreso del cliente), no por sucursal.
- Existen **dos tipos de programa**: por acumulacion ("tarjeta de sellos": junta N citas) y por periodo (N citas dentro de una ventana de tiempo, p. ej. un mes).
- Las **recompensas son descriptivas** (texto libre configurado por el emprendedor). El **canje es manual**: el sistema registra que la recompensa esta disponible y el emprendedor la marca como canjeada.
- Las recompensas tienen **vigencia configurable** por el emprendedor (p. ej. 30/60/90 dias, o sin vencimiento). Una recompensa vencida pasa a `expirada`.
- En el programa por acumulacion, el **contador se reinicia** al ganar la recompensa.
- El **cliente ve su progreso** ("llevas 7 de 10") y sus recompensas en su portal / "Mis citas".

Fuera de alcance (fases posteriores): aplicacion automatica de descuentos/cita gratis en facturacion, puntos canjeables por catalogo, niveles/tiers, e integraciones externas (WhatsApp/email marketing).

## Glossary

- **Programa de lealtad (LoyaltyProgram)**: conjunto de reglas configuradas por un emprendedor (tipo, meta, ventana de tiempo, descripcion de recompensa, vigencia, activo/inactivo).
- **Tipo ACCUMULATION**: junta N citas completadas (sin ventana de tiempo). Al ganar, el contador se reinicia.
- **Tipo PERIODIC**: alcanza N citas completadas dentro de una ventana de tiempo (p. ej. 30 dias) para ganar.
- **Progreso (LoyaltyProgress)**: conteo actual de un cliente para un programa dado (por negocio).
- **Recompensa (LoyaltyReward)**: recompensa ganada por un cliente; estados `ganada` (earned) | `canjeada` (redeemed) | `expirada` (expired).
- **Cita elegible**: cita en estado COMPLETED, del negocio (tenant) del programa.
- **Canje manual**: el emprendedor marca una recompensa como canjeada al momento de aplicarla al cliente.

## Requirements

### Requirement 1: Configuracion de programas de lealtad por el emprendedor

**User Story:** Como emprendedor, quiero configurar programas de lealtad con sus reglas y recompensas, para incentivar que mis clientes regresen.

#### Acceptance Criteria

1. THE emprendedor SHALL poder crear, editar, activar y desactivar programas de lealtad de su negocio.
2. THE cada programa SHALL tener: un nombre, un tipo (ACCUMULATION | PERIODIC), una meta N (numero de citas completadas), una descripcion de recompensa (texto), una vigencia de recompensa (dias o sin vencimiento) y un estado activo/inactivo.
3. WHERE el tipo es PERIODIC THE el programa SHALL definir una ventana de tiempo (p. ej. 30 dias) dentro de la cual deben acumularse las N citas.
4. WHERE el tipo es ACCUMULATION THE el programa NO SHALL requerir ventana de tiempo.
5. THE la meta N SHALL ser un entero mayor o igual a 1; valores invalidos SHALL rechazarse con un error de validacion.
6. THE un emprendedor solo SHALL ver y administrar los programas de su propio negocio (aislamiento por tenant).
7. WHEN un programa se desactiva THEN el sistema NO SHALL acumular nuevo progreso para ese programa, pero SHALL conservar las recompensas ya ganadas.

### Requirement 2: Acumulacion de progreso por citas completadas

**User Story:** Como cliente, quiero que mis visitas se acumulen automaticamente, para avanzar hacia una recompensa sin tener que hacer nada extra.

#### Acceptance Criteria

1. WHEN una cita pasa a estado COMPLETED THEN el sistema SHALL incrementar el progreso del cliente en cada programa activo aplicable del negocio.
2. THE la acumulacion SHALL ser por negocio (tenant): citas de cualquier sucursal del emprendedor suman al mismo progreso.
3. THE solo las citas en estado COMPLETED SHALL contar; PENDING, CONFIRMED, CANCELLED y NO_SHOW NO SHALL acumular.
4. IF una cita que estaba COMPLETED se revierte a otro estado THEN el sistema SHALL ajustar (decrementar) el progreso de forma consistente para no inflar el conteo.
5. THE cada cita completada SHALL contarse una sola vez por programa (idempotencia): reprocesar el mismo evento NO SHALL duplicar progreso.
6. WHERE un programa es PERIODIC THE el progreso relevante SHALL considerar unicamente las citas completadas dentro de la ventana de tiempo vigente.

### Requirement 3: Otorgamiento de recompensas

**User Story:** Como cliente, quiero ganar una recompensa al cumplir la meta, para sentir que mi lealtad es reconocida.

#### Acceptance Criteria

1. WHEN el progreso de un cliente alcanza la meta N de un programa activo THEN el sistema SHALL crear una recompensa en estado `ganada` (earned) para ese cliente y programa.
2. WHERE el programa es ACCUMULATION THE al otorgar la recompensa el sistema SHALL reiniciar el contador de progreso a 0 (descontando N).
3. WHERE el programa tiene vigencia configurada THE la recompensa SHALL registrar su fecha de expiracion (fecha de otorgamiento + vigencia).
4. WHERE el programa no tiene vencimiento THE la recompensa NO SHALL expirar.
5. WHEN se otorga una recompensa THEN el sistema SHALL registrar el evento (auditoria) y SHALL poder notificar al cliente (reutilizando Notification).
6. THE el otorgamiento SHALL ser idempotente respecto al mismo cruce de meta para no crear recompensas duplicadas.

### Requirement 4: Canje y expiracion de recompensas

**User Story:** Como emprendedor, quiero marcar cuando un cliente usa su recompensa, para llevar el control de lo entregado.

#### Acceptance Criteria

1. THE emprendedor (o su asistente) SHALL poder ver las recompensas `ganadas` de sus clientes y marcarlas como `canjeadas`.
2. WHEN una recompensa se marca como canjeada THEN el sistema SHALL registrar quien y cuando (auditoria) y NO SHALL permitir canjearla dos veces.
3. THE una recompensa cuya fecha de expiracion ya paso SHALL considerarse `expirada` y NO SHALL poder canjearse.
4. THE el sistema SHALL disponer de un proceso que marque como `expiradas` las recompensas vencidas de forma consistente (p. ej. tarea programada o verificacion perezosa al consultarlas).
5. THE el emprendedor solo SHALL operar recompensas de clientes de su propio negocio (aislamiento por tenant).

### Requirement 5: Visibilidad para el cliente

**User Story:** Como cliente, quiero ver mi progreso y mis recompensas, para saber cuanto me falta y que gane.

#### Acceptance Criteria

1. THE cliente SHALL poder ver, por cada programa activo del negocio donde tiene actividad, su progreso actual y la meta (p. ej. "7 de 10").
2. THE cliente SHALL poder ver sus recompensas con su estado (ganada/canjeada/expirada) y, si aplica, su fecha de expiracion.
3. WHERE el cliente no tiene progreso ni recompensas THE la vista SHALL mostrar un estado vacio claro.
4. THE la vista del cliente SHALL integrarse en su portal / seccion "Mis citas" existente.

### Requirement 6: Panel del emprendedor y metricas

**User Story:** Como emprendedor, quiero un panel de lealtad, para gestionar programas y ver el impacto.

#### Acceptance Criteria

1. THE emprendedor SHALL tener una seccion de "Lealtad" para administrar programas (CRUD) y ver recompensas por canjear.
2. THE el panel SHALL mostrar metricas basicas: numero de programas activos, recompensas ganadas, canjeadas y pendientes por canjear.
3. THE el panel SHALL permitir filtrar recompensas por estado y buscar por cliente.
4. THE las vistas SHALL manejar estados de carga y error de forma clara.

### Requirement 7: Roles, aislamiento y observabilidad global

**User Story:** Como super admin, quiero que la lealtad respete roles y aislamiento, y poder observar su uso globalmente.

#### Acceptance Criteria

1. THE la administracion de programas y el canje SHALL estar disponibles para el emprendedor (ADMIN); los asistentes (ASSISTANT) SHALL poder al menos consultar y canjear recompensas de su negocio.
2. THE ningun emprendedor SHALL ver programas, progreso ni recompensas de otro negocio (aislamiento por tenant).
3. THE el cliente (CLIENT) SHALL ver unicamente su propio progreso y recompensas.
4. THE el super admin SHALL poder observar metricas agregadas de lealtad a nivel global (p. ej. total de programas, recompensas ganadas/canjeadas) sin filtro de tenant.
5. THE todas las operaciones sensibles (crear/editar programa, otorgar, canjear, expirar) SHALL registrarse en auditoria.

### Requirement 8: Consistencia e integridad

**User Story:** Como responsable del sistema, quiero que el conteo y las recompensas sean consistentes, para evitar abusos o errores.

#### Acceptance Criteria

1. THE el progreso y el otorgamiento de recompensas SHALL calcularse de forma consistente ante concurrencia (transacciones donde aplique) para no duplicar ni perder conteos.
2. THE reprocesar el mismo cambio de estado de cita NO SHALL alterar el resultado (idempotencia).
3. THE revertir una cita completada SHALL mantener el progreso coherente (Requirement 2.4).
4. THE los datos de lealtad SHALL respetar el aislamiento por tenant en todas las consultas.
