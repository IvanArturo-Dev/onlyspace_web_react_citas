# Design Document

## Overview

Se agrega un recargo a domicilio por negocio (`Tenant.home_service_fee`), se enriquece el detalle de la cita del cliente (modal con ubicacion), se cambia el precio de suscripcion a 99, se crea una pagina de guia de uso con progreso derivado de datos reales, y se pule visualmente la pagina Mi Codigo / QR.

## Architecture

- **Datos (Prisma/MySQL):**
  - `Tenant.home_service_fee Decimal @default(0) @db.Decimal(10,2)`: recargo por servicio a domicilio a nivel de negocio. 0 = sin costo adicional.
- **Backend (Express/TS):**
  - `me.controller` GET/PATCH `/v1/me/settings`: exponer/aceptar `home_service_fee` (number >= 0). Validacion.
  - `public.controller` info: exponer `home_service_fee` cuando el negocio ofrece 'home' (para mostrar el recargo en el portal).
  - `me.controller` getMyAppointments: incluir por cita `modality`, `home_address`, `maps_url` (de la cita) y `branch_maps_url` + `branch_address` (de la sucursal) para el detalle. Ya resuelve branch en lote; se agrega maps_url/address al select de branch.
  - Nuevo `GET /v1/me/setup-progress` (ADMIN): calcula los pasos completados del negocio consultando conteos (sucursales activas, servicios activos, horarios, offered_modalities, whatsapp_number, logo_url, y si alguna sucursal tiene booking_code para compartir). Devuelve `{ steps: [{key,label,done,optional}], required_done, required_total, percent, ready }`.
  - Precio de suscripcion: leer `SUBSCRIPTION_PRICE_MXN` (ya existe, cambia a 99) donde se arma el preapproval de Mercado Pago; exponer el precio efectivo en el status de suscripcion para que el front no lo tenga hardcodeado.
- **Frontend (React):**
  - `Profile.tsx` BusinessSettingsCard: campo "Recargo a domicilio" (number) visible; ayuda "0 = sin costo adicional". Se envia en `updateBusinessSettings`.
  - `BookingPortal.tsx`: al elegir modalidad 'home', mostrar el recargo (`home_service_fee`) o "Sin costo adicional a domicilio".
  - `MyAppointments.tsx`: tarjeta de cita clicable -> modal de detalle con ubicacion (boton "Como llegar" con branch_maps_url; direccion+maps para home; enlace de videollamada). Conserva el area de resena.
  - `Suscripcion.tsx`: precio 99 (idealmente leido del status; fallback 99).
  - Nueva pagina `GuiaUso.tsx` (ruta `/guia`, dentro del Layout de gestion): consume `/me/setup-progress`, barra de progreso, lista de pasos con check y CTA a cada seccion.
  - `Layout.tsx`: item de navegacion "Guia" (managementNav).
  - `MiCodigo.tsx`: mejorar estilos de la tarjeta del QR (encuadre, marco, contraste, espaciado) sin cambiar la logica de generacion/descarga/compartir.

## Components and Interfaces

### GET /v1/me/settings (extendido)
Respuesta agrega `home_service_fee: number`.

### PATCH /v1/me/settings (extendido)
Acepta `home_service_fee?: number` (>= 0; NaN/negativo -> 400 VALIDATION_ERROR).

### GET /v1/public/:code info (extendido)
Agrega `home_service_fee?: number` (solo relevante si 'home' esta en offered_modalities).

### GET /v1/me/setup-progress (nuevo, ADMIN)
```json
{
  "steps": [
    { "key": "branch", "label": "Crear una sucursal", "done": true, "optional": false },
    { "key": "service", "label": "Crear un servicio", "done": false, "optional": false },
    { "key": "schedule", "label": "Configurar horarios", "done": false, "optional": false },
    { "key": "modality", "label": "Elegir modalidades", "done": true, "optional": false },
    { "key": "whatsapp", "label": "Configurar WhatsApp", "done": false, "optional": false },
    { "key": "branding", "label": "Personalizar marca", "done": false, "optional": true },
    { "key": "share", "label": "Compartir tu codigo/QR", "done": true, "optional": false }
  ],
  "required_done": 3, "required_total": 6, "percent": 50, "ready": false
}
```

### GET /v1/me/appointments (getMyAppointments, extendido)
Cada item agrega: `modality`, `home_address`, `maps_url` (de la cita), `branch_maps_url`, `branch_address`.

## Data Models

```prisma
model Tenant {
  // ...
  home_service_fee Decimal @default(0) @db.Decimal(10, 2) // recargo a domicilio (0 = sin costo)
}
```

## Error Handling
- `home_service_fee` invalido (no numerico o < 0) -> 400 VALIDATION_ERROR (mensaje en espanol).
- setup-progress y detalle de cita son best-effort de lectura; ante error muestran mensajes claros sin romper la pagina.

## Testing Strategy
- Unit backend: validacion de home_service_fee en /me/settings; setup-progress marca pasos done/optional y calcula percent/ready; getMyAppointments incluye los nuevos campos. tsc backend/frontend verdes. Suite jest sin regresiones.
- Precio 99: verificar que el preapproval usa SUBSCRIPTION_PRICE_MXN y el status expone el precio.