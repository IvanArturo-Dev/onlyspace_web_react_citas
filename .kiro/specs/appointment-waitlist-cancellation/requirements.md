# Requirements Document

## Introduction

Modulo de ENCOLAMIENTO (waitlist), POLITICA DE CANCELACION con penalizacion y
NOTIFICACIONES al emprendedor. Permite que clientes se anoten en espera cuando un
horario esta ocupado; cuando se libera un espacio (por cancelacion o por no
confirmacion 12h antes), el sistema SUGIERE al primero de la cola (FIFO) y el
emprendedor confirma la reasignacion generando un mensaje de WhatsApp de "espacio
abierto". Las cancelaciones se hacen SOLO por llamada (las registra el emprendedor,
no el cliente); no confirmar o no asistir cuenta como falta. Se aplica una politica
de cancelaciones configurable por negocio: cancelacion gratuita dentro de una
ventana de gracia y, superado un numero de cancelaciones, una penalizacion (deuda)
que el emprendedor confirma como pagada antes de permitir nuevas reservas. El
emprendedor recibe notificaciones dentro de la app (bandeja tipo campana) sobre
nueva cita, cita encolada y cancelacion.

Decisiones de producto (confirmadas con el usuario):
1. Encolamiento FIFO: al liberarse un espacio, se ofrece al PRIMERO de la cola,
   notificandole para que confirme. No es una "carrera" ni seleccion manual del
   destinatario (aunque el emprendedor SI confirma la reasignacion).
2. Politica de cancelacion CONFIGURABLE por el emprendedor: horas de gracia,
   numero de cancelaciones permitidas antes de penalizar, monto de penalizacion y
   periodo de reinicio del contador (dias).
3. El contador de cancelaciones es POR CLIENTE y POR NEGOCIO (no global) y se
   reinicia cada `reset_days` (ej. 30/90 dias).
4. La penalizacion se registra como DEUDA; el emprendedor confirma el pago
   manualmente. Con deuda pendiente el cliente no puede reservar en ese negocio.
5. Cancelaciones SOLO por llamada: no hay boton de cancelar para el cliente. El
   emprendedor registra la cancelacion. No confirmar ni asistir = falta.
6. Notificaciones al emprendedor DENTRO de la app (bandeja/campana + contador de no
   leidas) para: nueva cita, cita encolada y cancelacion.
7. Reasignacion SEMIautomatica: el sistema detecta el espacio liberado (cancelacion
   o no confirmacion 12h antes) y SUGIERE al primero de la cola; el emprendedor
   confirma y se genera el mensaje de WhatsApp para el cliente encolado (mismo
   mecanismo que el recordatorio, con texto de "se abrio un espacio, confirma").
8. El cliente encolado confirma por llamada/respuesta; el emprendedor marca la cita
   como CONFIRMED en la app (consistente con "cancelaciones por llamada").

## Glossary

- **Waitlist / Encolamiento**: lista FIFO de clientes en espera de un horario
  (tenant + branch + service + franja/fecha) que esta ocupado.
- **WaitlistEntry**: registro de un cliente en la cola, con posicion por orden de
  llegada (created_at) y estado (WAITING, OFFERED, CONFIRMED, EXPIRED, CANCELLED).
- **Espacio liberado**: slot que queda disponible por una cancelacion registrada o
  por una cita no confirmada dentro de la ventana de 12h.
- **Ventana de gracia (grace_hours)**: horas antes del inicio dentro de las cuales
  aun se permite cancelar sin que cuente como falta.
- **Falta**: cuando el cliente no asiste (NO_SHOW) o no confirma su cita a tiempo.
- **Penalizacion / Deuda**: monto que el cliente debe pagar para volver a reservar,
  tras superar el numero de cancelaciones permitidas en el periodo.
- **Politica de cancelacion**: configuracion por tenant: grace_hours,
  allowed_cancellations, penalty_amount, reset_days.
- **Reasignacion semiautomatica**: el sistema sugiere al primero de la cola para un
  espacio liberado; el emprendedor confirma y se genera el mensaje al cliente.
- **Notificacion in-app**: aviso al emprendedor en su bandeja (campana) por eventos
  de citas (nueva/encolada/cancelacion).

## Requirements

### Requirement 1: Configuracion de la politica de cancelacion (emprendedor)

**User Story:** Como emprendedor, quiero configurar mi politica de cancelaciones,
para controlar cuando un cliente puede cancelar sin costo y cuando debe pagar una
penalizacion.

#### Acceptance Criteria

1. EL emprendedor (ADMIN) DEBERA poder leer y actualizar su politica: `grace_hours`
   (>=0), `allowed_cancellations` (>=0), `penalty_amount` (>=0, moneda del tenant) y
   `reset_days` (>=0; 0 = no reinicia). Scoped por tenant.
2. LA lectura/actualizacion DEBERA requerir rol ADMIN (403 si no lo es).
3. SI un valor es invalido (negativo o no numerico) ENTONCES el sistema DEBERA
   responder 400 VALIDATION_ERROR sin persistir.
4. EL sistema DEBERA aplicar valores por defecto sensatos cuando el tenant no ha
   configurado la politica (ej. grace_hours=24, allowed_cancellations=1,
   penalty_amount=0, reset_days=30).

### Requirement 2: Cancelacion registrada por el emprendedor (solo por llamada)

**User Story:** Como emprendedor, quiero registrar la cancelacion de una cita que un
cliente me pidio por llamada, para liberar el espacio y aplicar la politica.

#### Acceptance Criteria

1. SOLO el emprendedor (ADMIN) DEBERA poder cancelar una cita; NO existe accion de
   cancelacion para el cliente (ni endpoint publico ni boton de cliente).
2. AL cancelar, el sistema DEBERA incrementar el contador de cancelaciones del
   cliente en ese tenant dentro del periodo vigente (`reset_days`).
3. SI la cancelacion supera `allowed_cancellations` en el periodo ENTONCES el
   sistema DEBERA registrar una DEUDA por `penalty_amount` para ese cliente en ese
   tenant, quedando el cliente bloqueado para reservar hasta que se confirme el pago.
4. AL cancelar, el sistema DEBERA marcar la cita como CANCELLED, revertir la lealtad
   acumulada (comportamiento actual) y detectar el espacio liberado para el flujo de
   waitlist (Requirement 5).
5. LA cancelacion DEBERA generar una notificacion in-app al emprendedor (Req 6) y
   registrarse en auditoria.

### Requirement 3: Penalizacion como deuda y confirmacion de pago

**User Story:** Como emprendedor, quiero ver y confirmar el pago de la penalizacion
de un cliente, para permitirle volver a reservar.

#### Acceptance Criteria

1. EL sistema DEBERA mantener el estado de deuda por cliente/tenant: monto pendiente
   y motivo (penalizacion por cancelaciones).
2. SI un cliente con deuda pendiente intenta reservar en ese negocio ENTONCES el
   sistema DEBERA impedir la reserva con un error claro (ej. 409 CUSTOMER_HAS_DEBT).
3. EL emprendedor (ADMIN) DEBERA poder confirmar el pago de la deuda, tras lo cual el
   cliente puede reservar de nuevo; la accion DEBERA registrarse en auditoria.
4. EL contador de cancelaciones DEBERA reiniciarse cuando pase el periodo
   `reset_days` desde el inicio del conteo vigente.

### Requirement 4: Encolamiento (waitlist) FIFO

**User Story:** Como cliente, quiero anotarme en espera cuando el horario que quiero
esta ocupado, para que me ofrezcan el lugar si se libera.

#### Acceptance Criteria

1. CUANDO un cliente solicite un horario ocupado (o pida explicitamente encolarse) el
   sistema DEBERA crear una WaitlistEntry (tenant, branch?, service, referencia de
   franja/fecha, customer) en estado WAITING, ordenada por created_at (FIFO).
2. EL sistema NO DEBERA permitir entradas duplicadas activas del mismo cliente para
   la misma franja/servicio (idempotente).
3. UN cliente con deuda pendiente NO DEBERA poder encolarse (mismo bloqueo que
   reservar).
4. AL crear una entrada en cola, el sistema DEBERA generar una notificacion in-app al
   emprendedor ("cita encolada", Req 6).
5. EL emprendedor DEBERA poder ver la cola por franja/servicio en orden FIFO.

### Requirement 5: Deteccion de espacio liberado y reasignacion semiautomatica

**User Story:** Como emprendedor, quiero que el sistema me sugiera a quien ofrecer un
espacio que se libero, para reasignarlo rapido al siguiente en la cola.

#### Acceptance Criteria

1. CUANDO se libere un espacio (cancelacion registrada, o cita PENDING no confirmada
   detectada dentro de la ventana de 12h antes del inicio) el sistema DEBERA
   identificar al PRIMER cliente en cola (FIFO) compatible con esa franja/servicio.
2. EL sistema DEBERA SUGERIR esa reasignacion al emprendedor (no la aplica solo).
3. AL confirmar el emprendedor, el sistema DEBERA marcar la WaitlistEntry como OFFERED
   y generar un mensaje de WhatsApp para el cliente encolado, reutilizando el
   mecanismo del recordatorio (buildReminderLink) pero con un texto de "se abrio un
   espacio, confirma tu cita" (plantilla propia con {cliente},{negocio},{sucursal},
   {fecha},{hora},{contacto}).
4. CUANDO el cliente confirme (por llamada/respuesta) el emprendedor DEBERA poder
   marcar la cita resultante como CONFIRMED en la app; la WaitlistEntry pasa a
   CONFIRMED. No hay auto-confirmacion por enlace.
5. LA deteccion de "no confirmadas 12h antes" DEBERA ser observable/consultable por
   el emprendedor (lista de espacios en riesgo) para disparar la sugerencia; no se
   aplica reasignacion automatica sin su confirmacion.

### Requirement 6: Notificaciones in-app al emprendedor

**User Story:** Como emprendedor, quiero recibir avisos dentro de la app de los
movimientos de mis citas, para enterarme de nuevas citas, encolamientos y
cancelaciones.

#### Acceptance Criteria

1. EL sistema DEBERA generar una notificacion in-app (tenant-scoped) en estos
   eventos: nueva cita creada, nueva entrada en cola (encolada) y cancelacion.
2. EL emprendedor (ADMIN/ASSISTANT segun corresponda) DEBERA poder listar sus
   notificaciones (mas recientes primero) y ver un contador de NO leidas.
3. EL emprendedor DEBERA poder marcar notificaciones como leidas (individual o
   todas).
4. LAS notificaciones DEBERAN estar aisladas por tenant (un negocio no ve las de
   otro).
5. LA generacion de notificaciones DEBERA ser best-effort: un fallo al notificar NO
   DEBERA romper la operacion principal (crear/cancelar/encolar).

### Requirement 7: Aislamiento, seguridad y consistencia

**User Story:** Como plataforma, quiero que todo el modulo respete el aislamiento por
tenant y las reglas de acceso, para no filtrar datos entre negocios.

#### Acceptance Criteria

1. TODAS las operaciones (politica, deuda, waitlist, notificaciones) DEBERAN estar
   scoped por tenant_id; una cita/entrada/notificacion de otro tenant NO DEBERA ser
   accesible (404/403).
2. LAS acciones sensibles (cancelar, confirmar pago, confirmar reasignacion,
   configurar politica) DEBERAN requerir rol ADMIN; el ASSISTANT queda limitado a lo
   operativo segun el patron existente.
3. BAJO impersonacion del super admin, las acciones del emprendedor DEBERAN funcionar
   en el contexto del tenant objetivo (patron actual).
4. LAS transiciones de estado (cita y waitlist) DEBERAN ser consistentes ante
   concurrencia (transacciones donde aplique, como en booking.service).
