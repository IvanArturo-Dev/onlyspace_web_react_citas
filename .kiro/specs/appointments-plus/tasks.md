# Implementation Plan

## Overview

Plan para implementar cinco mejoras de citas: aforo por servicio, recordatorio manual por WhatsApp (enlace wa.me), pago manual total/parcial, notas internas y actualizacion de cita consistente con el aforo; mas edicion del telefono del cliente y datos de WhatsApp del negocio. Se construye sobre disponibilidad/reserva y el flujo de citas existentes.

Estrategia incremental de menor a mayor riesgo:
1. Esquema de datos (capacidad, pago, notas, WhatsApp del negocio).
2. Aforo: disponibilidad y reserva por capacidad.
3. Pago manual.
4. Notas internas.
5. WhatsApp: perfil del negocio + edicion de telefono del cliente + generacion del enlace.
6. Actualizacion de cita consistente con aforo.
7. Frontend por area.
8. Verificacion end-to-end.

Reutiliza: Service/Appointment/Branch/Customer/Tenant, availabilityService/bookingService, guards requireAdmin/requireStaff/authenticated, y componentes UI existentes.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4", "5"] },
    { "wave": 3, "tasks": ["2.1", "3.1", "5.1", "6"] },
    { "wave": 4, "tasks": ["6.1"] },
    { "wave": 5, "tasks": ["7", "8"] },
    { "wave": 6, "tasks": ["9"] }
  ],
  "dependencies": {
    "2": ["1"],
    "2.1": ["2"],
    "3": ["1"],
    "3.1": ["3"],
    "4": ["1"],
    "5": ["1"],
    "5.1": ["5"],
    "6": ["1", "2"],
    "6.1": ["6"],
    "7": ["2", "3", "4", "5", "6"],
    "8": ["3", "4", "5"],
    "9": ["7", "8"]
  }
}
```

## Tasks

- [x] 1. Esquema de datos
  - En backend/prisma/schema.prisma: agregar `Service.capacity Int @default(1)`; en `Appointment` agregar `payment_status` (enum PaymentStatus unpaid|partial|paid, default unpaid), `amount_total`/`amount_paid` (Decimal(10,2) default 0), `currency` (default "MXN"); en `Tenant` agregar `whatsapp_number String?` y `whatsapp_template String? @db.Text`
  - Crear modelo `AppointmentNote` (author_id, body, tenant_id, appointment_id) con indices y @@map
  - Aplicar con prisma db push + prisma generate sobre citas_dev
  - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 2. Aforo: disponibilidad y reserva por capacidad
  - `serviceService`: aceptar `capacity` (entero >= 1, default 1) en create/update; invalido -> 400 VALIDATION_ERROR
  - `availabilityService` (getBranchAvailability y getPublicAvailability): un slot es disponible si el numero de citas activas solapadas del servicio es menor que su capacidad
  - `bookingService` (createBranchBooking y createPublicBooking): en la transaccion, contar solapadas del servicio y rechazar con 409 SLOT_TAKEN si >= capacity
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2.1 Pruebas de aforo (Property 1, 2)
  - capacity=1 igual al actual; capacity=N permite N y bloquea N+1 (409); disponibilidad refleja el conteo; aislamiento por tenant/branch/service
  - _Requirements: 1.2, 1.3, 1.4_
  - _Properties: Property 1 (aforo), Property 2 (disponibilidad)_

- [x] 3. Pago manual (total/parcial)
  - `appointmentService.updatePayment`: set amount_total/amount_paid/currency; validar amount_paid <= amount_total (exceso -> 400); derivar payment_status; auditar; tenant-scoped
  - Endpoint `PATCH /v1/appointments/:id/payment` (authenticated + requireStaff)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3.1 Pruebas de pago (Property 5, 6)
  - Derivacion unpaid/partial/paid; rechazo amount_paid>total; aislamiento por tenant
  - _Requirements: 3.3, 3.4, 3.5, 3.6_
  - _Properties: Property 5 (estado de pago), Property 6 (aislamiento)_

- [x] 4. Notas internas (bitacora)
  - `appointmentService.addNote/listNotes/deleteNote` tenant-scoped, author_id=userId; nunca expuestas en portal publico/cliente
  - Endpoints `GET/POST /v1/appointments/:id/notes`, `DELETE /v1/appointments/:id/notes/:noteId` (authenticated + requireStaff)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. WhatsApp: perfil del negocio, telefono del cliente y enlace de recordatorio
  - Perfil del negocio: `GET/PATCH /v1/me/business` (requireAdmin) para whatsapp_number (validar solo digitos/+ y longitud -> 400) y whatsapp_template
  - Editar telefono del cliente de una cita: `PATCH /v1/appointments/:id/customer-phone` (requireStaff), validado y tenant-scoped
  - `whatsappService.buildReminderLink(tenantId, appointmentId)`: valida telefono del cliente (PHONE_REQUIRED si falta), normaliza a digitos, rellena la plantilla (cliente/fecha/hora/negocio/contacto) respetando la zona de la sucursal y devuelve { url, message, phone }
  - Endpoint `GET /v1/appointments/:id/whatsapp-reminder` (requireStaff)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.1, 6.2, 6.3, 6.4_

- [x] 5.1 Pruebas de WhatsApp (Property 3, 4, 6)
  - Enlace apunta al telefono normalizado; el texto incluye cliente/fecha/hora/negocio; sin telefono valido -> PHONE_REQUIRED; la operacion no realiza llamadas de red; validacion del numero del negocio; aislamiento por tenant
  - _Requirements: 2.3, 2.5, 2.6, 2.8_
  - _Properties: Property 3 (enlace bien formado), Property 4 (solo enlace), Property 6 (aislamiento)_

- [x] 6. Actualizacion de cita consistente con aforo
  - `appointmentService.updateAppointment`: cambiar start_time/service_id/notes; si cambia horario/servicio revalidar capacidad en transaccion (409 SLOT_TAKEN si sobrecupo) sin modificar la cita; no alterar pago/notas; auditar
  - Endpoint `PATCH /v1/appointments/:id` (authenticated + requireStaff)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6.1 Pruebas de actualizacion (Property 7, 6)
  - Reprogramar a horario lleno -> 409 sin cambios; a horario con cupo -> OK; aislamiento por tenant
  - _Requirements: 5.2, 5.3, 5.4_
  - _Properties: Property 7 (actualizacion consistente), Property 6 (aislamiento)_

- [x] 7. Frontend: aforo, reprogramacion y WhatsApp
  - Campo capacidad (>= 1) en el formulario de servicio/categoria
  - Perfil del negocio: numero de WhatsApp + plantilla de recordatorio (con vista previa)
  - En la vista de cita del negocio: reprogramar (fecha/hora/servicio) con manejo de 409; editar telefono del cliente; boton "Recordatorio por WhatsApp" que pide el enlace al backend y abre wa.me (o avisa PHONE_REQUIRED)
  - _Requirements: 1.1, 2.1, 2.3, 2.5, 2.7, 5.1, 5.3, 6.1_

- [x] 8. Frontend: pago y notas
  - Panel de pago (total/pagado/estado) -> PATCH payment
  - Bitacora de notas (agregar/eliminar) -> endpoints notes
  - _Requirements: 3.2, 4.1, 4.3_

- [x] 9. Verificacion end-to-end
  - Servicio capacity=2: dos reservas mismo horario OK, tercera 409; disponibilidad deja de ofrecer el slot al llegar a 2
  - Guardar WhatsApp del negocio y plantilla; cita con telefono valido -> enlace con texto correcto (cliente/fecha/hora/negocio/contacto); cita sin telefono -> PHONE_REQUIRED, capturar telefono y reintentar
  - Pago parcial y total; derivacion de estado; notas agregar/eliminar y confirmar que el cliente no las ve
  - Reprogramar a horario lleno -> 409; a uno con cupo -> OK; aislamiento entre negocios; matriz de roles
  - _Requirements: 1.3, 2.3, 2.5, 3.4, 4.2, 5.3, 7.3_

## Notes

- Aforo por servicio; con capacity=1 el comportamiento es identico al actual (no regresion).
- WhatsApp es 100% manual: el backend arma el enlace wa.me y el texto; el emprendedor envia desde su WhatsApp. Sin API oficial ni costo.
- El enlace requiere telefono valido del cliente; si falta, se responde PHONE_REQUIRED para capturarlo.
- Notas internas: nunca expuestas al cliente ni en endpoints publicos.
- Verificacion de capacidad + escritura en la misma transaccion (sin sobrecupo por concurrencia).
- Aplicar cambios de esquema con prisma db push en citas_dev; detener node antes por el DLL en Windows.
- Recordatorios automaticos por correo y adjuntos quedan fuera de esta version.
- Subtareas con _Properties: son candidatas a pruebas basadas en propiedades.
