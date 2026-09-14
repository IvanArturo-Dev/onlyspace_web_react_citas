# Requirements Document

## Introduction

Este documento define un conjunto de mejoras a la gestion de citas para hacerla mas completa y profesional. Amplia el sistema existente (multi-tenant, sucursales con codigo, disponibilidad y reserva por sucursal, notificaciones, lealtad) con cinco capacidades:

1. **Aforo por servicio (capacidad):** permitir que un mismo horario acepte mas de una persona, configurable por servicio/categoria.
2. **Recordatorio manual por WhatsApp:** el emprendedor guarda su numero de WhatsApp y, desde cada cita, abre un enlace wa.me hacia el telefono del cliente con un mensaje de recordatorio prellenado (nombre del cliente, fecha y hora).
3. **Confirmacion de pago total o parcial:** registrar manualmente el estado de pago de una cita (sin pasarela de cobro).
4. **Envio de notas:** notas internas tipo bitacora en una cita (solo visibles para el negocio).
5. **Actualizacion de cita:** reprogramar y editar una cita de forma consistente con el aforo.

Decisiones de negocio tomadas para esta version:
- El **aforo se configura por servicio** (cada servicio/categoria define cuantas personas admite por horario; por defecto 1). No es un cupo global de la sucursal.
- El **recordatorio por WhatsApp es manual y sin costo**: se construye un enlace wa.me (o api.whatsapp.com) hacia el telefono del cliente con un texto prellenado; el emprendedor pulsa enviar en su WhatsApp. NO se usa la API oficial de WhatsApp ni hay envio automatico.
- El **numero de WhatsApp del emprendedor** se guarda a nivel de negocio y aparece como firma/contacto dentro del mensaje.
- Los **pagos son de registro manual** (total/parcial/pendiente): el negocio anota montos; NO hay cobro real ni pasarela.
- Las **notas son internas** (no visibles para el cliente) y forman una bitacora (varias por cita).
- Los **recordatorios automaticos por correo** y los **adjuntos (imagenes/archivos)** quedan fuera de alcance en esta version (fase posterior).

Fuera de alcance (fases posteriores): recordatorios automaticos por correo, adjuntos de imagenes/archivos, cobro real con pasarela, API oficial de WhatsApp con plantillas aprobadas, y listas de espera por aforo.

Se reutiliza: modelos Appointment, Service, Branch, Customer (tiene phone), Tenant (nombre del negocio), AuditLog; guards requireAdmin/requireStaff/authenticated; y el frontend con tema y guards por rol.

## Glossary

- **Aforo / capacidad:** numero maximo de personas que pueden reservar el mismo horario para un servicio dado (>= 1).
- **Recordatorio por WhatsApp (manual):** enlace wa.me hacia el telefono del cliente con un texto prellenado; lo envia el emprendedor manualmente desde su WhatsApp.
- **Numero de WhatsApp del negocio:** telefono en formato internacional guardado en el negocio (tenant), usado como firma/contacto en el mensaje.
- **Plantilla de recordatorio:** texto con variables (nombre del cliente, fecha, hora, negocio) que el sistema rellena para construir el mensaje.
- **Estado de pago:** situacion de pago de una cita: unpaid (sin pago), partial (pago parcial), paid (pagado). Incluye monto total, monto pagado y moneda.
- **Nota:** entrada de texto interna asociada a una cita, escrita por el negocio (bitacora); no visible para el cliente.

## Requirements

### Requirement 1: Aforo por servicio (capacidad por horario)

**User Story:** Como emprendedor, quiero definir cuantas personas admite un servicio en el mismo horario, para atender citas grupales o multiples posiciones.

#### Acceptance Criteria

1. THE cada servicio SHALL tener una capacidad entera >= 1 (por defecto 1) configurable por el emprendedor.
2. WHEN la capacidad de un servicio es 1 THEN el comportamiento SHALL ser identico al actual (no se permite una segunda reserva que se solape).
3. WHEN la capacidad de un servicio es N > 1 THEN el sistema SHALL permitir hasta N reservas activas (status != CANCELLED) que se solapen en ese horario para ese servicio, y rechazar la reserva N+1 con 409 SLOT_TAKEN.
4. THE calculo de disponibilidad publica SHALL mostrar un horario como disponible mientras el numero de reservas solapadas para el servicio sea menor que su capacidad.
5. THE verificacion de capacidad y la creacion de la cita SHALL ocurrir en la misma transaccion para evitar sobrecupo por concurrencia.
6. THE la capacidad SHALL respetar el aislamiento por tenant/sucursal (se cuenta solo dentro de la misma sucursal y servicio).

### Requirement 2: Recordatorio manual por WhatsApp

**User Story:** Como emprendedor, quiero enviar un recordatorio por WhatsApp al cliente con un mensaje prellenado, para reducir olvidos sin costo ni configuracion compleja.

#### Acceptance Criteria

1. THE emprendedor SHALL poder guardar el numero de WhatsApp de su negocio en formato internacional (solo digitos, con codigo de pais).
2. THE el sistema SHALL validar que el numero contenga solo digitos (y opcional +) y una longitud razonable; invalido -> 400 VALIDATION_ERROR.
3. THE para una cita dada, el sistema SHALL construir un enlace wa.me hacia el telefono del cliente con un mensaje de recordatorio prellenado que incluya el nombre del cliente, la fecha y la hora de la cita, y el nombre del negocio.
4. WHERE el negocio tiene numero de WhatsApp configurado THE el mensaje SHALL incluirlo como contacto/firma.
5. IF el cliente no tiene un telefono valido registrado en la cita THEN el sistema SHALL indicarlo y NO SHALL generar un enlace hacia el cliente (permitiendo capturar/editar el telefono).
6. THE el envio es manual: el sistema solo SHALL abrir/entregar el enlace prellenado; NO SHALL enviar mensajes automaticamente ni usar la API oficial de WhatsApp.
7. THE la plantilla del mensaje SHALL poder personalizarse por negocio (texto con variables), con una plantilla por defecto en espanol.
8. THE el numero telefonico usado SHALL normalizarse a solo digitos para construir el enlace wa.me.

### Requirement 3: Confirmacion de pago total o parcial

**User Story:** Como emprendedor, quiero registrar si una cita esta pagada total o parcialmente, para llevar el control de cobros.

#### Acceptance Criteria

1. THE cada cita SHALL tener un estado de pago con: payment_status (unpaid|partial|paid), amount_total (>= 0), amount_paid (>= 0) y currency.
2. THE emprendedor (o su asistente) SHALL poder registrar/actualizar el monto total, el monto pagado y derivar el estado.
3. WHEN amount_paid es 0 THEN el estado SHALL ser unpaid.
4. WHEN 0 < amount_paid < amount_total THEN el estado SHALL ser partial.
5. WHEN amount_paid >= amount_total y amount_total > 0 THEN el estado SHALL ser paid.
6. THE amount_paid NO SHALL exceder amount_total (validacion; exceso -> 400).
7. THE cambios de pago SHALL registrarse en auditoria y respetar el aislamiento por tenant.
8. THE el registro de pago es manual (no hay cobro real ni pasarela).

### Requirement 4: Envio de notas (bitacora interna)

**User Story:** Como negocio, quiero escribir notas internas en una cita, para dejar constancia de detalles.

#### Acceptance Criteria

1. THE una cita SHALL poder tener multiples notas (bitacora), cada una con autor, texto y fecha.
2. THE las notas SHALL ser internas: NO SHALL exponerse en el portal del cliente ni en endpoints publicos.
3. THE crear/listar/eliminar notas SHALL estar disponible para el emprendedor y su asistente, scoping por tenant.
4. THE la creacion de una nota SHALL registrar el autor (userId) y la marca de tiempo.
5. THE eliminar una nota SHALL respetar el aislamiento por tenant.

### Requirement 5: Actualizacion de cita

**User Story:** Como negocio, quiero actualizar/reprogramar una cita, para adaptarme a cambios manteniendo la consistencia.

#### Acceptance Criteria

1. THE emprendedor (o su asistente) SHALL poder actualizar una cita: fecha/hora, servicio y notas de la cita.
2. WHEN se cambia la fecha/hora o el servicio THEN el sistema SHALL revalidar disponibilidad respetando el aforo del servicio (Requirement 1) en la misma transaccion.
3. IF la actualizacion provocaria sobrecupo THEN el sistema SHALL rechazarla con 409 SLOT_TAKEN sin modificar la cita.
4. THE la actualizacion SHALL respetar el aislamiento por tenant y auditar el cambio.
5. THE actualizar una cita NO SHALL alterar indebidamente su estado de pago ni notas.

### Requirement 6: Telefono del cliente utilizable

**User Story:** Como negocio, quiero capturar/editar el telefono del cliente en la cita, para poder enviarle el recordatorio por WhatsApp.

#### Acceptance Criteria

1. THE emprendedor (o su asistente) SHALL poder ver y editar el telefono del cliente asociado a una cita.
2. WHEN una reserva publica no capturo telefono THEN el negocio SHALL poder agregarlo despues.
3. THE el telefono SHALL validarse (digitos, longitud razonable) antes de construir el enlace de WhatsApp.
4. THE la edicion del telefono SHALL respetar el aislamiento por tenant.

### Requirement 7: Roles, aislamiento y consistencia

**User Story:** Como responsable del sistema, quiero que estas funciones respeten roles y aislamiento.

#### Acceptance Criteria

1. THE la configuracion de aforo (servicio) y el numero de WhatsApp del negocio SHALL ser exclusivos del emprendedor (ADMIN).
2. THE pagos, notas, actualizacion de cita, edicion de telefono del cliente y generacion del enlace de recordatorio SHALL estar disponibles para ADMIN y ASSISTANT, scoping por tenant.
3. THE ningun cliente SHALL ver notas internas ni datos de otro tenant.
4. THE todas las operaciones de escritura SHALL registrarse en auditoria.
5. THE las verificaciones de capacidad SHALL ser consistentes ante concurrencia (transacciones).
