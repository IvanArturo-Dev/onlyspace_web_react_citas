# Implementation Plan

## Overview

Modalidad a domicilio + modalidad ofrecida multiple + contacto/domicilio obligatorios + buscador en combo de servicios + retirar grafica del panel de citas. Empieza por migracion (nuevos campos), luego backend (modalidad multiple, validaciones, persistencia), luego frontend (checkboxes de modalidad, selector con home, campos condicionales, buscador de servicios, quitar grafica). Todo scoped por tenant sin romper flujos existentes.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "wave": 4, "tasks": ["4.1"] }
  ],
  "dependencies": {
    "1.1": [],
    "2.1": ["1.1"],
    "2.2": ["1.1", "2.1"],
    "2.3": ["1.1"],
    "3.1": ["2.1"],
    "3.2": ["2.2"],
    "3.3": ["2.2"],
    "3.4": [],
    "3.5": [],
    "4.1": ["2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4", "3.5"]
  }
}
```

## Tasks

- [x] 1. Migracion de datos
- [x] 1.1 Nuevos campos: offered_modalities + campos de cita
  - schema.prisma: Tenant + offered_modalities (String @default "in_person"). Appointment + contact_phone (String?), + home_address (String?), + maps_url (String?). Modality admite 'home'.
  - Crear migracion (npx prisma migrate dev --name home_service_booking). En Windows detener node antes (EPERM). Regenerar cliente. Backfill: copiar offered_modality a offered_modalities con mapeo both->in_person,online.
  - _Requirements: 1.2, 1.5, 2.3, 3.2_

- [x] 2. Backend
- [x] 2.1 modality.ts: modalidad multiple + validacion de contacto/domicilio
  - Extender Modality a in_person|online|home. normalizeModality reconoce los tres. parseOfferedModalities(csv|array). assertModalityOffered contra lista. assertBookingContact (telefono obligatorio; si home, direccion+maps_url obligatorios y URL http/https). Errores CONTACT_PHONE_REQUIRED, HOME_DETAILS_REQUIRED, MODALITY_NOT_OFFERED.
  - _Requirements: 1.1, 1.3, 2.1, 2.2, 2.4, 2.5, 3.1, 3.3, 3.4_
- [x] 2.2 Reserva: aplicar validaciones y persistir campos
  - booking.service (publico) y appointment.service (panel): usar assertModalityOffered con offered_modalities y assertBookingContact. Persistir contact_phone, home_address, maps_url y modality (incl. home) en create/update.
  - _Requirements: 2.1, 2.3, 3.1, 3.2, 3.4_
- [x] 2.3 Settings + info publica: offered_modalities
  - me.controller GET/PATCH /v1/me/settings: exponer/aceptar offered_modalities (array); compat con offered_modality string. public.controller info: exponer offered_modalities. Validar al menos una modalidad y valores permitidos.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Frontend
- [x] 3.1 Config del negocio: checkboxes de modalidad
  - Profile.tsx BusinessSettingsCard: reemplazar select por checkboxes (presencial/en linea/a domicilio); exigir al menos una; enviar offered_modalities.
  - _Requirements: 1.1, 1.4_
- [x] 3.2 Portal publico: modalidad home + campos condicionales + buscador
  - BookingPortal.tsx: selector de modalidad segun offered_modalities (oculto si una sola). Telefono obligatorio. Si home: direccion + URL Google Maps obligatorias. Combo/listado de servicios con buscador por nombre.
  - _Requirements: 1.3, 1.4, 2.1, 2.2, 3.1, 3.4, 4.1, 4.2, 4.3_
- [x] 3.3 Panel emprendedor: modalidad home + campos condicionales + buscador
  - Appointments.tsx: selector de modalidad con home segun offered_modalities. Telefono obligatorio. Si home: direccion + maps_url obligatorios. Buscador en el combo de servicios (crear y reprogramar).
  - _Requirements: 1.3, 2.1, 2.2, 3.1, 3.4, 4.1, 4.2, 4.3_
- [x] 3.4 Quitar grafica del panel de citas
  - Appointments.tsx: remover el bloque de la grafica "Comportamiento por mes" (permanece en Dashboard).
  - _Requirements: 5.1, 5.2_
- [x] 3.5 Servicio de datos frontend (tipos/payloads)
  - dataService / tipos: agregar offered_modalities, contact_phone, home_address, maps_url a los payloads de reserva y settings.
  - _Requirements: 2.3, 3.2_

- [x] 4. Verificacion
- [x] 4.1 Tests backend + build frontend
  - Unit: parseOfferedModalities, assertModalityOffered (home permitido/rechazado, combinaciones), assertBookingContact (telefono faltante, home sin direccion/maps, home valido, no-home). Persistencia en booking/appointment. tsc backend/frontend verdes. Suite jest existente sin regresiones.
  - _Requirements: 2.2, 2.4, 3.3, 3.4_

## Notes

- Migraciones con prisma migrate (no db push). En Windows detener node antes (EPERM). En produccion migrate deploy corre en el arranque del contenedor.
- Conservar offered_modality (legacy) durante la transicion; leer preferente offered_modalities.
- No romper: gating premium, flujo reserva/waitlist, aislamiento por tenant, modalidad online (Meet).
- Deploy a produccion tras verificar: build frontend + tar + scp + docker compose up -d --build.