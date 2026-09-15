# Design Document

## Overview

Mejoras al portal del cliente y a la gestion de citas del emprendedor, mas contacto en el portal y direccion de Google Maps en la sucursal. Se apoya en lo existente (MyAppointments, Appointment.modality, Branch.address/lat/lng, WaitlistEntry FIFO, panel de citas) y agrega migraciones Prisma para nuevos campos de configuracion.

## Decisiones de diseno

- **Modalidad ofrecida**: nuevo campo Tenant.offered_modality ('in_person' | 'online' | 'both', default 'in_person'). El portal y el panel solo permiten modalidades habilitadas. Si es una sola, no se muestra selector.
- **Auto-asignacion de waitlist**: nuevo campo Tenant.waitlist_auto_assign (Boolean, default false). Al cancelar/liberar un hueco, si esta ON, se asigna al primer encolado compatible (FIFO), reutilizando la logica de waitlistService.offer dentro de una transaccion con re-verificacion de solape (patron ya existente). Si esta OFF, se mantiene la sugerencia manual actual.
- **Auto-asignacion sigue FIFO** (justo con quien llego primero). La priorizacion por precio es para la VISTA del emprendedor y para la aceptacion MANUAL, no para el automatismo. Se documenta explicitamente.
- **Priorizacion por precio**: se ordena/destaca en la UI por el precio del servicio de la cita/encolado. No cambia el modelo; el precio se obtiene del Service asociado.
- **Mostrar contacto**: nuevo campo Tenant.show_contact (Boolean, default false). El endpoint publico de info expone los datos de contacto solo si esta ON.
- **maps_url**: nuevo campo Branch.maps_url (String?). El formulario de sucursal captura una URL de Google Maps; coordenadas dejan de ser obligatorias. El portal muestra un boton "Como llegar".
- **Sin romper**: gating premium de citas, flujo de reserva y aislamiento por tenant intactos.

## Architecture

### Migraciones (Prisma migrate dev, NO db push)
Una migracion nueva agrega:
- Tenant.offered_modality String @default("in_person")
- Tenant.waitlist_auto_assign Boolean @default(false)
- Tenant.show_contact Boolean @default(false)
- Branch.maps_url String?

Nota operativa (Windows): detener node antes de correr prisma migrate (EPERM). En produccion las migraciones se aplican con prisma migrate deploy en el arranque del contenedor.

### Backend
- me.controller / business settings: exponer y actualizar offered_modality, waitlist_auto_assign, show_contact (ADMIN, tenant-scoped). Reusar el patron de /me/business y /me/booking-settings.
- branch.service / controller: aceptar y persistir maps_url; validar URL http/https; no exigir lat/lng.
- public.controller (info): incluir offered_modality, show_contact (+ datos de contacto si ON), y por sucursal el maps_url.
- booking.service / appointment.service: validar que la modalidad solicitada este habilitada por offered_modality (si 'in_person' solo -> rechazar 'online' y viceversa; 'both' -> ambas). 400 MODALITY_NOT_OFFERED si no.
- waitlist / cancelacion: en cancelAppointment, si Tenant.waitlist_auto_assign ON, tras liberar el hueco intentar asignar automaticamente (waitlistService.offer al primer WAITING compatible) en transaccion con re-verificacion de solape; best-effort (si falla, se deja libre y se puede sugerir manual). Si OFF, comportamiento actual (waitlist_suggestion).
- clientService.myAppointments: incluir en cada cita categoria (service.name), sucursal (branch.name) y logo del tenant (tenant.logo_url) para el rediseno.
- Endpoint de encolados del emprendedor (ya existe listWaitlist): agregar el precio del servicio para ordenar por precio en la UI.

### Frontend
- MyAppointments (/mis-citas): rediseno. Citas activas/proximas arriba en tarjetas destacadas con logo del negocio, categoria y sucursal; pasadas debajo. Placeholder si no hay logo.
- Config del negocio (panel): controles para offered_modality (selector), waitlist_auto_assign (toggle), show_contact (toggle). Reusar la pagina de configuracion/negocio existente.
- Reserva (panel y portal publico): el selector de modalidad respeta offered_modality (oculto si es una sola).
- Sucursales (form): campo maps_url (URL Google Maps) en vez de exigir coordenadas; portal muestra boton "Como llegar".
- Panel de citas: orden/realce por precio del servicio (badge o seccion destacada), sin romper actuales/proximas/historial.
- WaitlistPanel: mostrar precio y orden por precio; boton aceptar (manual) ya existe.

## Components and Interfaces

Backend nuevos/ajustados:
- GET/PATCH /me/business (o /me/settings): + offered_modality, waitlist_auto_assign, show_contact.
- PATCH /branches/:id: + maps_url.
- GET /public/:code/info: + offered_modality, show_contact, contacto (si ON), branch.maps_url.
- cancelAppointment: rama auto-assign cuando waitlist_auto_assign ON.
- Validacion de modalidad en creacion de cita (panel + publico).

Frontend:
- clientService.myAppointments -> tipos con service_name, branch_name, logo_url.
- businessService/settings -> get/update de los 3 flags.
- branchService -> maps_url en create/update.

## Data Models

Cambios (migracion):
- Tenant: + offered_modality (String, default "in_person"), + waitlist_auto_assign (Boolean, default false), + show_contact (Boolean, default false).
- Branch: + maps_url (String?).
Sin borrar campos existentes (address/city/latitude/longitude se conservan).

## Correctness Properties

### Property 1: Modalidad respetada
Ninguna cita puede crearse con una modalidad no habilitada por Tenant.offered_modality.

**Validates: Requirements 2.2, 2.4**

### Property 2: Auto-asignacion consistente (sin doble reserva)
Con auto-asignacion ON, al liberarse un hueco se asigna a lo sumo a UN encolado, re-verificando el solape en la misma transaccion; nunca crea dos citas para el mismo hueco.

**Validates: Requirements 4.2, 4.4**

### Property 3: FIFO en el automatismo
La auto-asignacion elige al PRIMER encolado compatible por orden de llegada (created_at asc), no por precio.

**Validates: Requirements 4.2**

### Property 4: Aislamiento por tenant
Toda config, consulta de cola, priorizacion y accion se scopea al tenant actual.

**Validates: Requirements 3.4, 6.4, 7.4**

### Property 5: Contacto solo si se habilita
El portal publico expone datos de contacto unicamente si Tenant.show_contact esta ON.

**Validates: Requirements 6.2, 6.3**

### Property 6: Sin romper flujos existentes
El gating premium de citas, la separacion actuales/proximas/historial y el flujo de reserva/waitlist siguen funcionando.

**Validates: Requirements 1.4, 5.2**

## Error Handling

- Modalidad no ofrecida al reservar -> 400 MODALITY_NOT_OFFERED.
- maps_url invalida -> 400 (validacion URL).
- Auto-asignacion best-effort: si falla la asignacion automatica, el hueco queda libre y no rompe la cancelacion ya persistida.
- Config invalida (offered_modality fuera de enum) -> 400.

## Testing Strategy

- Unit backend: validacion de modalidad en creacion (both/solo online/solo presencial), auto-asignacion FIFO con re-verificacion de solape (no doble reserva), exposicion de contacto segun show_contact, persistencia de maps_url y flags. tsc backend/frontend verdes. Suite existente sin regresiones (reserva, waitlist, gating premium, comportamiento).
- Verificacion manual: /mis-citas rediseno (logo/categoria/sucursal), selector de modalidad segun config, boton "Como llegar", panel de encolados con precio.
