# Implementation Plan

## Overview

Implementa mejoras de portal del cliente y gestion de citas del emprendedor + contacto en portal + Google Maps en sucursal. Empieza por la migracion (nuevos campos), luego backend (config, modalidad, auto-asignacion, contacto, maps_url, mis-citas enriquecido) y frontend (mis-citas, config negocio, selector modalidad, sucursal maps, panel encolados por precio). Todo scoped por tenant, sin romper flujos existentes.

## Task Dependency Graph

```
1.1 (migracion) es la base de casi todo el backend
2.x backend depende de 1.1
3.x frontend depende de los endpoints 2.x
4.1 verificacion depende de todo
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "wave": 4, "tasks": ["4.1"] }
  ],
  "dependencies": {
    "1.1": [],
    "2.1": ["1.1"],
    "2.2": ["1.1"],
    "2.3": ["1.1"],
    "2.4": ["1.1"],
    "3.1": ["2.4"],
    "3.2": ["2.1"],
    "3.3": ["2.2"],
    "3.4": ["2.3"],
    "4.1": ["2.1", "2.2", "2.3", "2.4", "3.1", "3.2", "3.3", "3.4"]
  }
}
```

## Tasks

- [x] 1. Migracion de datos
- [x] 1.1 Agregar campos de configuracion (Prisma migrate)
  - schema.prisma: Tenant + offered_modality (String @default "in_person"), + waitlist_auto_assign (Boolean @default false), + show_contact (Boolean @default false); Branch + maps_url (String?).
  - Crear migracion (npx prisma migrate dev --name appointments_mgmt_plus). En Windows detener node antes (EPERM). Regenerar cliente.
  - _Requirements: 2.1, 4.1, 6.1, 7.1_

- [x] 2. Backend
- [x] 2.1 Config del negocio: modalidad, auto-asignacion, mostrar contacto
  - Endpoints GET/PATCH (me.controller) para offered_modality, waitlist_auto_assign, show_contact (ADMIN, tenant-scoped). Validar offered_modality en {in_person,online,both}.
  - _Requirements: 2.1, 2.3, 4.1, 6.1, 6.4_
- [x] 2.2 Validacion de modalidad al reservar
  - En booking.service (publico) y appointment.service (panel): rechazar 400 MODALITY_NOT_OFFERED si la modalidad no esta habilitada por offered_modality del tenant. 'both' permite ambas.
  - _Requirements: 2.2, 2.4_
- [x] 2.3 Auto-asignacion de lista de espera + maps_url + contacto en portal
  - cancelAppointment: si Tenant.waitlist_auto_assign ON, asignar automaticamente al primer WAITING compatible (FIFO) via waitlistService.offer en transaccion con re-verificacion de solape; best-effort. Si OFF, comportamiento actual.
  - branch.service/controller: aceptar/validar/persistir maps_url (URL http/https); coordenadas no obligatorias.
  - public.controller info: exponer offered_modality, show_contact + contacto (si ON), branch.maps_url.
  - _Requirements: 3.3, 4.2, 4.3, 4.4, 4.5, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_
- [x] 2.4 mis-citas enriquecido + precio en encolados
  - clientService.myAppointments: incluir service_name (categoria), branch_name (sucursal) y logo_url del tenant por cita.
  - listWaitlist (emprendedor): incluir el precio del servicio para ordenar por precio en la UI.
  - _Requirements: 1.2, 3.1, 3.2, 5.3_

- [x] 3. Frontend
- [x] 3.1 Rediseno de /mis-citas (cliente)
  - MyAppointments: citas activas/proximas arriba en tarjetas destacadas con logo, categoria y sucursal; pasadas debajo; placeholder sin logo.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
- [x] 3.2 Config del negocio (panel) + selector de modalidad
  - Controles para offered_modality (selector), waitlist_auto_assign (toggle), show_contact (toggle). El selector de modalidad en reserva (panel y portal) respeta offered_modality (oculto si es una sola).
  - _Requirements: 2.1, 2.4, 4.1, 6.1_
- [x] 3.3 Sucursal con Google Maps + boton "Como llegar"
  - Form de sucursal: campo maps_url en vez de coordenadas obligatorias. Portal publico: boton "Como llegar" que abre maps_url.
  - _Requirements: 7.1, 7.2_
- [x] 3.4 Panel de citas y encolados por precio
  - Realce/orden por precio del servicio en el panel de citas (sin romper actuales/proximas/historial). WaitlistPanel: mostrar precio y ordenar por precio; aceptar manual existente.
  - _Requirements: 3.1, 3.2, 5.1, 5.2_

- [x] 4. Verificacion
- [x] 4.1 Tests backend + build frontend
  - Unit: validacion de modalidad (both/solo online/solo presencial), auto-asignacion FIFO sin doble reserva, contacto segun show_contact, persistencia maps_url y flags. tsc backend/frontend verdes. Suite existente sin regresiones.
  - _Requirements: 2.2, 4.2, 4.4, 6.2, 7.4_

## Notes

- Migraciones con prisma migrate (no db push). En Windows detener node antes (EPERM: Get-Process node | Stop-Process -Force). En produccion migrate deploy corre en el arranque del contenedor.
- Auto-asignacion sigue FIFO; la priorizacion por precio es para la vista/aceptacion manual del emprendedor.
- Deploy a produccion (EC2) tras verificar: aplicar migracion, rebuild backend+frontend, subir por SSH, docker compose up -d --build.
- No romper: gating premium de citas, flujo de reserva/waitlist, aislamiento por tenant.
