# Design Document

## Overview

Mejoras de reglas, permisos y UX sobre la gestion de citas existente (backend Express + Prisma/MySQL, frontend React/Vite). Incluye: regla anti-duplicado por cliente/dia/servicio; nuevo texto por defecto del recordatorio; renombrado visible Asistentes a Colaboradores; dashboard del emprendedor mejorado; permisos explicitos de colaborador; y una reescritura de la vista de Citas con acciones rapidas, indicadores de ocupacion y secciones Hoy/Proximas.

Piezas afectadas:
- Backend (logica): regla anti-duplicado en bookingService (publico + sucursal) y en appointmentService.createAppointment/updateAppointment; nuevo DEFAULT_TEMPLATE en whatsappService.
- Backend (permisos): rutas de customers pasan a requireStaff; me/business ya es requireAdmin (colaborador no lo ve).
- Frontend: renombrado a Colaboradores; Dashboard; Appointments (acciones rapidas, indicadores, Hoy/Proximas); Mi Codigo en solo-lectura para colaborador; navegacion por rol en Layout.

Principios: no romper el rol tecnico ASSISTANT (solo cambian textos); regla anti-duplicado consistente en todos los flujos y dentro de la misma transaccion que la reserva; aislamiento por tenant.

## Architecture

### Regla anti-duplicado (cliente/dia/servicio)

Se anade una verificacion junto a la creacion de la cita, dentro de la misma transaccion que ya valida aforo: se calcula el rango del dia (medianoche a medianoche+1) del start_time y se cuenta si el mismo customer_id ya tiene una cita con ese service_id y status != CANCELLED en ese rango; si existe, se lanza 409 DUPLICATE_BOOKING antes de crear.

- Publico: en createPublicBooking y createBranchBooking, el customer se resuelve por email; tras resolver/crear el Customer se aplica la verificacion por customer_id en la misma transaccion.
- Panel: en createAppointment se aplica con el customer_id recibido; en updateAppointment, cuando cambia service_id o el dia del start_time, se revalida que no genere duplicado con OTRA cita del cliente ese dia (excluyendo la propia).
- Aislamiento por tenant en todas las consultas.

### Indicadores de disponibilidad/ocupacion (frontend)

El frontend reutiliza el endpoint de disponibilidad de la sucursal (GET /v1/public/:code/availability) y/o el listado de citas del dia para pintar los slots: por cada slot cuenta citas activas solapadas del servicio y muestra libre o usado/total. No requiere endpoint nuevo obligatorio.

### Renombrado Asistentes a Colaboradores

Solo textos de interfaz. El rol interno sigue siendo ASSISTANT; el modelo Assistant, las rutas /v1/assistants y el codigo no cambian. El super admin muestra el rol ASSISTANT con la etiqueta Colaborador.

## Components and Interfaces

### bookingService (backend)
- createPublicBooking / createBranchBooking: agregar verificacion anti-duplicado (customer_id + service_id + mismo dia, status != CANCELLED) dentro de la transaccion, antes del chequeo de aforo. Error 409 DUPLICATE_BOOKING.

### appointmentService (backend)
- createAppointment: aplicar la misma verificacion (customer_id + service_id + dia) -> 409 DUPLICATE_BOOKING.
- updateAppointment: cuando cambie service_id o el dia de start_time, verificar que no exista OTRA cita activa del mismo cliente/servicio ese dia (id != actual) -> 409 DUPLICATE_BOOKING; mantener la revalidacion de aforo existente.

### whatsappService (backend)
- DEFAULT_TEMPLATE nuevo (Requirement 2.1). El resto del armado del enlace no cambia.

### Permisos (backend)
- customer.routes: anteponer requireStaff (ADMIN | ASSISTANT) a list/get/create/update/patch/delete, para que solo staff gestione clientes (Requirement 5.5).
- me/business: se mantiene requireAdmin (colaborador no configura WhatsApp).

### Frontend
- Textos: reemplazar Asistente(s) por Colaborador(es) en Layout (nav), la pagina de gestion, y donde el super admin muestre el rol.
- Layout: navegacion por rol. Para ASSISTANT mostrar solo Dashboard, Citas, Clientes, Mi Codigo (solo-lectura). Ocultar sucursales/horarios/categorias/asuetos/lealtad/colaboradores/config.
- Dashboard: metricas (hoy, proximas, pagos), citas de hoy destacadas, accesos rapidos, jerarquia visual; respeta filtro de sucursal.
- Appointments: secciones separadas Hoy / Proximas (y opcional Pasadas) con contador y orden por hora; acciones rapidas por cita (confirmar/completar/cancelar/no-show + Recordatorio WhatsApp) con icono + etiqueta; cancelar pide confirmacion; gestion avanzada (pago/notas/reprogramar/telefono) en el modal existente; indicador de ocupacion al elegir sucursal+servicio+dia con cupo usado/total cuando capacity > 1.
- Mi Codigo: si el rol es ASSISTANT, renderizar solo la seccion de codigo/enlace/QR (sin WhatsappCard).

## Data Models

No se requieren cambios de esquema. Se reutilizan Appointment (service_id, customer_id, start_time, status, payment_*), Service (capacity), Customer, Branch (timezone), Tenant (whatsapp_number/template). La regla anti-duplicado y los indicadores se calculan con consultas sobre estos modelos.

## Correctness Properties

### Property 1: Anti-duplicado por cliente/dia/servicio
Un cliente no puede tener dos citas activas del mismo servicio el mismo dia; el segundo intento (publico o panel) se rechaza con 409 DUPLICATE_BOOKING; una cita cancelada no cuenta.

**Validates: Requirements 1.1, 1.3, 1.4**

### Property 2: Anti-duplicado consistente y aislado
La verificacion ocurre en la misma transaccion que la creacion (sin duplicados por concurrencia) y solo considera citas del mismo tenant.

**Validates: Requirements 1.6, 1.7**

### Property 3: Plantilla por defecto correcta
Cuando el negocio no definio plantilla, el mensaje usa exactamente el nuevo texto por defecto con las variables sustituidas.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 4: Permisos de colaborador
Un colaborador (ASSISTANT) puede operar citas y clientes y compartir codigo, pero toda ruta de configuracion responde 403.

**Validates: Requirements 5.1, 5.2, 5.3, 5.5**

### Property 5: Renombrado sin ruptura
Los textos visibles muestran Colaborador(es) mientras el rol tecnico y las rutas/identificadores internos siguen siendo ASSISTANT/assistants.

**Validates: Requirements 3.1, 3.3**

## Error Handling

- Contrato uniforme HttpError(message, status, code) -> objeto { success:false, error:{ code, message } }.
- Codigos: DUPLICATE_BOOKING (409) nuevo; se mantienen SLOT_TAKEN (409), VALIDATION_ERROR (400), APPOINTMENT_NOT_FOUND (404), FORBIDDEN (403), PHONE_REQUIRED (400).
- La regla anti-duplicado y el aforo son verificaciones distintas con codigos distintos (DUPLICATE_BOOKING vs SLOT_TAKEN); el frontend muestra mensajes claros para cada una.
- El frontend traduce 409 DUPLICATE_BOOKING a un mensaje del tipo: este cliente ya tiene una cita de esta categoria hoy.

## Testing Strategy

Unit / property-based (backend, Jest):
- Property 1/2: segundo booking mismo cliente/servicio/dia -> 409 DUPLICATE_BOOKING (publico, sucursal y panel); cancelada no cuenta; verificacion dentro de la transaccion; scoped por tenant; update que generaria duplicado -> 409.
- Property 3: sin plantilla del negocio, buildReminderLink usa el nuevo DEFAULT_TEMPLATE con variables sustituidas.
- Property 4: matriz de roles en customers (ASSISTANT 200, CLIENT 403) y en rutas de config (ASSISTANT 403).
- No romper suites de aforo/pago/notas/whatsapp/update existentes.

Verificacion E2E manual:
- Reservar dos veces misma categoria/dia/cliente en publico -> primera OK, segunda 409; cancelar la primera -> se permite de nuevo.
- Recordatorio sin plantilla propia -> texto nuevo por defecto.
- Login como colaborador -> ve solo citas/clientes/Mi Codigo (solo lectura); intentar config -> 403/oculto.
- Dashboard: citas de hoy, proximas, pagos, accesos rapidos.
- Citas: secciones Hoy/Proximas, acciones rapidas + recordatorio, indicadores de ocupacion.

Verificacion por tarea: npx tsc --noEmit, npx jest --testPathPattern por area --runInBand, frontend npx tsc --noEmit + npx vite build.
