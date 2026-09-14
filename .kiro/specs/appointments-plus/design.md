# Design Document

## Overview

Mejoras a la gestion de citas construidas sobre el backend Express + Prisma/MySQL y el frontend React/Vite existentes. Se agrupan cinco capacidades: aforo por servicio, recordatorio manual por WhatsApp (enlace wa.me), pago manual total/parcial, notas internas y actualizacion de cita consistente con el aforo. Ademas se permite editar el telefono del cliente para poder generar el enlace de WhatsApp.

Piezas nuevas:
- Cambios de esquema Prisma: `Service.capacity`, campos de pago en `Appointment`, campos de WhatsApp en `Tenant` (numero + plantilla), y modelo `AppointmentNote`.
- Cambio en la logica de disponibilidad/reserva para contar solapes contra la capacidad del servicio.
- Construccion del enlace de WhatsApp (backend arma texto+numero; frontend abre wa.me).
- Servicios/endpoints para pago, notas, actualizacion de cita, edicion de telefono del cliente y datos de WhatsApp del negocio.
- Frontend: capacidad en servicios; en la vista de cita: pago, notas, reprogramacion, editar telefono del cliente y boton "Recordatorio por WhatsApp"; en el perfil del negocio: numero y plantilla de WhatsApp.

Principios: aislamiento por tenant, verificacion de capacidad + escritura en la misma transaccion, y el recordatorio de WhatsApp es 100% manual (solo se construye un enlace; no hay envio automatico ni API oficial).

## Architecture

### Aforo (capacidad por servicio)

Hoy la regla es "si existe >=1 cita no cancelada que se solapa -> 409". Cambia a contar y comparar contra capacidad:

```
reservar(servicio S, [start,end), sucursal B):
  transaccion:
    ocupadas = count(appointments where tenant, branch=B, service=S,
                     status != CANCELLED, se solapan con [start,end))
    if ocupadas >= S.capacity: throw 409 SLOT_TAKEN
    crear cita
```

Disponibilidad publica: un candidato de horario queda disponible mientras `count(solapadas para S) < S.capacity`. Con capacity=1 el comportamiento es identico al actual. Conteo scoping por tenant+branch+service. Verificacion y creacion en la misma transaccion.

### Recordatorio manual por WhatsApp

El sistema NO envia mensajes; solo construye un enlace que abre WhatsApp con el chat del cliente y un texto prellenado.

```
generarEnlaceRecordatorio(cita):
  telefono = normalizarDigitos(cita.customer.phone)   // requiere telefono valido
  if telefono invalido -> error PHONE_REQUIRED (el negocio captura/edita el telefono)
  texto = plantilla(negocio).rellenar({
            cliente: cita.customer.name,
            fecha:  formatoFecha(cita.start_time),
            hora:   formatoHora(cita.start_time),
            negocio: tenant.name,
            contacto: tenant.whatsapp_number   // firma/contacto
          })
  url = "https://wa.me/" + telefono + "?text=" + encodeURIComponent(texto)
  return { url, phone: telefono, message: texto }
```

El backend arma `{ url, message }` (fuente unica de la plantilla y del formato de fecha/hora, respetando la zona horaria de la sucursal). El frontend abre `url` en una pestana nueva; el emprendedor pulsa enviar en WhatsApp. La plantilla por defecto (es):
"Hola {cliente}, te recordamos tu cita en {negocio} el {fecha} a las {hora}. Cualquier duda escribenos: {contacto}."

### Telefono del cliente

Las reservas publicas guardan phone='sin-telefono'. Para WhatsApp se permite editar el telefono del Customer de la cita (tenant-scoped). El enlace solo se genera con un telefono valido.

## Components and Interfaces

### capacity / availability / booking
- `serviceService`: agregar `capacity` a create/update (entero >= 1, default 1; invalido -> 400 VALIDATION_ERROR).
- `availabilityService.getBranchAvailability` y `getPublicAvailability`: un slot es disponible si `solapadas < capacity`.
- `bookingService.createBranchBooking` / `createPublicBooking`: en la transaccion, contar solapadas del servicio y comparar con capacity; >= capacity -> 409 SLOT_TAKEN.

### tenant / whatsapp
- `tenantService` (o meService): `getBusinessProfile` / `updateBusinessProfile` para leer/guardar `whatsapp_number` y `whatsapp_template` del negocio; validar numero (digitos + longitud) -> 400 VALIDATION_ERROR.
- `whatsappService.buildReminderLink(tenantId, appointmentId)`: carga cita (tenant-scoped) + tenant; valida telefono del cliente; construye { url, message, phone }; PHONE_REQUIRED (409/400) si el telefono no es valido.

### appointmentService
- `updatePayment(tenantId, appointmentId, { amount_total, amount_paid, currency })`: valida amount_paid <= amount_total, deriva payment_status, audita.
- `updateAppointment(tenantId, appointmentId, { start_time?, service_id?, notes? })`: si cambia start_time/service, revalida capacidad en transaccion (409 si sobrecupo); audita; no toca pago/notas.
- `updateCustomerPhone(tenantId, appointmentId, phone)`: valida y actualiza el telefono del Customer de la cita; tenant-scoped.
- Notas: `addNote/listNotes/deleteNote` (tenant-scoped, autor=userId).

### API (REST /v1)
Emprendedor/staff (authenticated + requireStaff salvo config de servicio y WhatsApp del negocio que son requireAdmin):
- `PATCH /v1/services/:id` (requireAdmin) -> acepta `capacity`.
- `GET/PATCH /v1/me/business` (requireAdmin) -> whatsapp_number, whatsapp_template.
- `GET /v1/appointments/:id/whatsapp-reminder` (requireStaff) -> { url, message, phone }.
- `PATCH /v1/appointments/:id` -> updateAppointment.
- `PATCH /v1/appointments/:id/payment` -> updatePayment.
- `PATCH /v1/appointments/:id/customer-phone` -> updateCustomerPhone.
- `GET/POST /v1/appointments/:id/notes`, `DELETE /v1/appointments/:id/notes/:noteId`.

### Frontend
- `Services`/`Categorias`: campo capacidad (numero >= 1).
- Perfil del negocio (nueva seccion o dentro de Mi Codigo/Perfil): numero de WhatsApp + plantilla, con guardado.
- Vista de cita del negocio (Reservaciones/Appointments): panel de pago; bitacora de notas; reprogramar (fecha/hora/servicio) con manejo de 409; editar telefono del cliente; boton "Recordatorio por WhatsApp" que pide el enlace al backend y abre wa.me (o muestra aviso si falta telefono).
- Servicios frontend: `appointments.service.ts` extendido (payment, notes, update, customer-phone, whatsapp-reminder) y `business.service.ts` (perfil WhatsApp).

## Data Models

```prisma
enum PaymentStatus {
  unpaid
  partial
  paid
}

model AppointmentNote {
  id             String   @id @default(cuid())
  tenant_id      String
  appointment_id String
  author_id      String?
  body           String   @db.Text
  created_at     DateTime @default(now())

  @@index([appointment_id])
  @@index([tenant_id])
  @@map("appointment_notes")
}
```

Cambios a modelos existentes:
- `Service`: `capacity Int @default(1)`.
- `Appointment`: `payment_status PaymentStatus @default(unpaid)`, `amount_total Decimal @db.Decimal(10,2) @default(0)`, `amount_paid Decimal @db.Decimal(10,2) @default(0)`, `currency String @default("MXN")`.
- `Tenant`: `whatsapp_number String?`, `whatsapp_template String? @db.Text`.

Se aplica con `prisma db push` + `prisma generate` sobre citas_dev (detener node antes por el DLL en Windows).

## Correctness Properties

### Property 1: Aforo respeta la capacidad
Para un servicio con capacidad N, el sistema permite hasta N reservas activas solapadas y rechaza la N+1 con 409; con N=1 equivale al comportamiento actual.

**Validates: Requirements 1.2, 1.3, 1.5**

### Property 2: Disponibilidad refleja la capacidad
Un horario aparece disponible si y solo si el numero de reservas activas solapadas del servicio es menor que su capacidad.

**Validates: Requirements 1.4**

### Property 3: Enlace de WhatsApp bien formado
El enlace generado apunta al telefono normalizado del cliente (solo digitos) y su texto contiene el nombre del cliente, la fecha y la hora de la cita; sin telefono valido no se genera enlace.

**Validates: Requirements 2.3, 2.5, 2.8**

### Property 4: WhatsApp es solo enlace (sin envio)
La operacion de recordatorio nunca envia mensajes por si misma: solo devuelve un enlace/texto; no llama a ninguna API de mensajeria.

**Validates: Requirements 2.6**

### Property 5: Derivacion del estado de pago
amount_paid=0 -> unpaid; 0<paid<total -> partial; paid>=total>0 -> paid; amount_paid>total se rechaza.

**Validates: Requirements 3.3, 3.4, 3.5, 3.6**

### Property 6: Aislamiento por tenant
Pagos, notas, actualizacion, telefono del cliente y datos de WhatsApp solo operan sobre recursos del tenant del solicitante; recursos de otro tenant no son accesibles.

**Validates: Requirements 4.5, 5.4, 6.4, 7.3**

### Property 7: Actualizacion consistente con aforo
Reprogramar o cambiar servicio revalida capacidad en transaccion; si provocaria sobrecupo, se rechaza con 409 y la cita no se modifica.

**Validates: Requirements 5.2, 5.3**

## Error Handling

- Contrato uniforme: HttpError(message, status, code) -> { success:false, error:{ code, message } }.
- Codigos: VALIDATION_ERROR (400) para capacidad/montos/numero invalidos; SLOT_TAKEN (409) para sobrecupo; APPOINTMENT_NOT_FOUND (404); NOTE_NOT_FOUND (404); PHONE_REQUIRED (400) cuando el cliente no tiene telefono valido para WhatsApp; FORBIDDEN (403) fuera de rol/tenant.
- El enlace de WhatsApp se construye en backend de forma pura (sin efectos de red); si falta telefono valido responde PHONE_REQUIRED para que el negocio lo capture.
- La construccion del texto respeta la zona horaria de la sucursal para la fecha/hora mostradas.

## Testing Strategy

Unit / property-based (backend, Jest):
- Property 1/2: capacidad N permite N y bloquea N+1; disponibilidad refleja el conteo; N=1 igual al actual.
- Property 3/4: enlace apunta al telefono normalizado y el texto trae cliente/fecha/hora; sin telefono -> PHONE_REQUIRED; la operacion no realiza llamadas de red (solo arma string).
- Property 5: derivacion de payment_status y rechazo de amount_paid>total.
- Property 6: aislamiento por tenant en notas/pago/update/telefono/whatsapp (recurso ajeno -> 404/403).
- Property 7: update que provoca sobrecupo -> 409 y sin cambios.
- Matriz de roles en endpoints (401/403/200).

Verificacion E2E manual:
- Servicio capacity=2: dos reservas al mismo horario OK, tercera 409; disponibilidad deja de ofrecer el slot al llegar a 2.
- Guardar numero de WhatsApp del negocio y plantilla; en una cita con telefono valido, obtener el enlace y verificar el texto (cliente/fecha/hora/negocio/contacto); en una cita sin telefono, ver PHONE_REQUIRED, capturar telefono y reintentar.
- Registrar pago parcial y total; verificar derivacion de estado.
- Agregar y eliminar notas; confirmar que el cliente no las ve.
- Reprogramar a un horario lleno -> 409; a uno con cupo -> OK.

Verificacion por tarea: npx tsc --noEmit, npx jest --testPathPattern=<area> --runInBand, frontend npx tsc --noEmit + npx vite build.
