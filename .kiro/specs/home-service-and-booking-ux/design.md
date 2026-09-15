# Design Document

## Overview

Se amplia la modalidad de cita a tres valores (`in_person`, `online`, `home`) y la modalidad ofrecida por el negocio pasa de un string unico (`offered_modality`) a una lista de modalidades (`offered_modalities`). Se agregan datos por cita: telefono de contacto (obligatorio siempre) y, para domicilio, direccion + URL de Google Maps (obligatorias). Se agrega un buscador al combo de servicios y se retira la grafica "Comportamiento por mes" del panel de citas.

## Architecture

- **Datos (Prisma/MySQL):**
  - `Tenant.offered_modalities String @default("in_person")`: lista CSV normalizada (p.ej. `"in_person,home"`). Se conserva `offered_modality` durante la transicion y la migracion la copia a la nueva columna con el mapeo `both -> in_person,online`.
  - `Appointment`: nuevos campos `contact_phone String?`, `home_address String?`, `maps_url String?`. Se reutiliza `modality String?` ahora admitiendo `home`. `location` existente queda para uso libre; el domicilio estructurado va en `home_address`.
- **Backend (Express/TS):**
  - `utils/modality.ts`: extender `Modality` a `'in_person' | 'online' | 'home'`; `normalizeModality` reconoce los tres; `assertModalityOffered` compara contra la lista `offered_modalities` (helper `parseOfferedModalities`). Nuevo `assertBookingContact` que valida telefono y, si `home`, direccion + maps_url.
  - `booking.service.ts` (portal publico) y `appointment.service.ts` (panel): aplican validaciones y persisten los nuevos campos.
  - `me.controller`: GET/PATCH `/v1/me/settings` devuelve/acepta `offered_modalities` (array). Mantener compat: si llega `offered_modality` string, mapear.
  - `public.controller` info: exponer `offered_modalities`.
- **Frontend (React):**
  - `Profile.tsx` `BusinessSettingsCard`: reemplazar el `<select>` de modalidad por checkboxes (in_person/online/home) con validacion de al menos una.
  - `BookingPortal.tsx` (publico) y `Appointments.tsx` (panel): selector de modalidad segun `offered_modalities`; campos condicionales (telefono siempre; direccion + maps_url si home). Combo de servicios con buscador.
  - `Appointments.tsx`: quitar el bloque de la grafica "Comportamiento por mes".

## Components and Interfaces

### parseOfferedModalities(value: string | string[] | null): Modality[]
Normaliza CSV o array a lista unica y valida contra el set permitido; vacio -> `['in_person']`.

### assertModalityOffered(offered: string | string[], requested?: string): void
Lanza 400 `MODALITY_NOT_OFFERED` si `requested` normalizado no esta en la lista ofrecida.

### assertBookingContact(input): void
- `contact_phone` requerido no vacio -> si falta, 400 `CONTACT_PHONE_REQUIRED`.
- si `modality === 'home'`: `home_address` y `maps_url` requeridos (URL http/https) -> si faltan/invalidos, 400 `HOME_DETAILS_REQUIRED`.

### API
- GET `/v1/me/settings` -> `{ offered_modalities: string[], waitlist_auto_assign, show_contact }`.
- PATCH `/v1/me/settings` acepta `offered_modalities: string[]`.
- POST reserva (publico y panel): acepta `contact_phone`, `home_address?`, `maps_url?`.
- GET `/v1/public/:code` info: incluye `offered_modalities`.

## Data Models

```prisma
model Tenant {
  // ...
  offered_modality   String  @default("in_person") // legacy, se conserva
  offered_modalities String  @default("in_person") // CSV: in_person,online,home
}

model Appointment {
  // ...
  modality      String? @default("in_person") // in_person | online | home
  contact_phone String?
  home_address  String?
  maps_url      String?
}
```

## Error Handling

- `MODALITY_NOT_OFFERED` (400): modalidad no habilitada por el negocio.
- `CONTACT_PHONE_REQUIRED` (400): falta telefono de contacto.
- `HOME_DETAILS_REQUIRED` (400): a domicilio sin direccion o sin URL de Maps valida.
- Mensajes en espanol. Validaciones aplican en portal publico y panel.

## Testing Strategy

- Unit `modality.ts`: parseOfferedModalities (CSV/array/vacio/desconocido), assertModalityOffered con listas (home permitido/rechazado, combinaciones), assertBookingContact (telefono faltante, home sin direccion/maps, home valido, no-home no exige).
- Unit booking.service/appointment.service: persistencia de contact_phone/home_address/maps_url; rechazos 400.
- Compat: offered_modality legacy string mapeado a lista.
- Frontend: `tsc --noEmit` verde. Suite jest existente sin regresiones.