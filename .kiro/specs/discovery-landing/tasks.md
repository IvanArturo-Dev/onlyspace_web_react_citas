# Implementation Plan

## Overview

Landing publico de descubrimiento: endpoint `GET /public/discover` con priorizacion
premium, filtros por texto/categoria, orden por cercania (Haversine con lat/lng del
cliente) y branding solo premium; captura de direccion/coordenadas por sucursal (nuevos
campos en Branch); y mejora del Landing (hero, chips, 'Cerca de mi', tarjetas, 'Podria
interesarte'). Reutiliza isPremiumEffective y el criterio de sucursal principal
(coherente con branch-premium-gating).

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4", "5"] },
    { "wave": 4, "tasks": ["6"] }
  ]
}
```

## Tasks

- [x] 1. Schema: ubicacion de sucursal + branchService acepta/valida
  - `schema.prisma` Branch: agregar `address String?`, `city String?`,
    `latitude Decimal? @db.Decimal(10,7)`, `longitude Decimal? @db.Decimal(10,7)`.
  - Aplicar con `prisma db push` (el proyecto NO usa migrate). En Windows, si node bloquea
    el generate, detener node antes; existentes quedan null (sin backfill).
  - `branchService`: extender UpdateBranchInput y BranchView con address/city/latitude/longitude.
    Validar rangos (lat [-90,90], lng [-180,180]) -> 400 VALIDATION_ERROR; permitir null.
  - Pruebas unitarias branch.service: guarda address/city/lat/lng; rango invalido -> 400;
    null limpia; respeta gating free-extra -> 403 (Property 7).
  - `tsc --noEmit` backend + jest branch en verde.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 2. Backend: discoveryService (haversine + discover + categories)
  - Nuevo `discovery.service.ts` con `haversineKm(aLat,aLng,bLat,bLng)` (radio 6371, pura).
  - `discover({q?,category?,lat?,lng?,radius_km?})`: tenants reservables (booking_enabled) con
    >=1 sucursal activa; toma la sucursal PRINCIPAL (created_at asc); deriva is_premium;
    adjunta categorias activas y (solo premium) branding/banner; aplica filtros q (nombre
    negocio/sucursal/categoria contains ci) y category; ordena por premium/cercania.
  - `categories()`: categorias activas distintas de negocios reservables (para chips).
  - Orden: sin lat/lng -> (is_premium desc, name asc). Con lat/lng -> con-coords antes que
    sin-coords; con-coords por (is_premium desc, distance asc); sin-coords al final; radius_km
    opcional filtra con-coords por distancia. lat/lng no numericos se tratan como ausentes.
  - Nunca expone datos sensibles; aislamiento por tenant.
  - Pruebas unitarias: haversine (0 mismo punto, simetria, monotonia); discover (premium
    primero; cercania premium-dentro-de-cercanos; sin-coords al final; filtros; branding solo
    premium; free solo principal; degradacion sin lat/lng; aislamiento) (Property 1-6,8,9).
  - `tsc --noEmit` + jest discovery en verde.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 6.1_

- [x] 3. Backend: rutas publicas discover/categories
  - `public.routes.ts`: agregar `GET /discover` y `GET /categories` ANTES de las rutas
    `/:code/...` (para que no las capture como codigo), sin authMiddleware.
  - `public.controller`: handlers discover/categories que llaman al servicio y responden
    con el patron { success, data }; parametros invalidos no rompen (500 solo ante error real).
  - Prueba de integracion basica: GET /discover responde 200 con lista; premium antes que
    free; GET /categories responde lista.
  - `tsc --noEmit` + jest public/discovery en verde.
  - _Requirements: 1.1, 1.2, 1.3, 6.2_

- [x] 4. Frontend: servicio y tipos de descubrimiento
  - `services/public.service.ts`: agregar `discover(params)` (q, category, lat, lng, radius_km)
    y `getCategories()`; tipos DiscoverItem { business_name, code, branch_name, city, address,
    is_premium, categories, distance_km?, branding? }.
  - `tsc --noEmit` frontend.
  - _Requirements: 1.1, 3.4_

- [x] 5. Frontend: Sucursales del emprendedor captura direccion/coordenadas
  - `Sucursales.tsx`: inputs address, city, latitude, longitude en crear/editar, con ayuda
    'Pega tu latitud/longitud desde Google Maps (clic derecho > coordenadas)'. Validacion
    basica en cliente; backend valida rangos. Manejar 403 (gating free-extra).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 7.1, 7.4_

- [x] 6. Frontend: Landing de descubrimiento
  - `pages/public/Landing.tsx`: hero llamativo; buscador de texto con debounce; chips de
    categoria (toggle) desde getCategories; boton 'Cerca de mi' con navigator.geolocation
    (exito -> pasa lat/lng a discover; negacion/no-soporte -> aviso + orden normal).
  - Tarjetas: premium destacada (banner/logo/brand_color) vs free simple; cada tarjeta
    enlaza a `/reservar/<code>`; mostrar city/address y distancia si viene.
  - Seccion 'Podria interesarte': con categoria/q activa, segunda consulta discover (misma
    categoria) excluyendo los ya mostrados; premium primero; sin login/historial.
  - Accesibilidad (chips focusables, alt en imagenes, contraste), responsive, estado vacio
    con CTA para limpiar filtros.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.4_

## Notes
- 'Sucursal principal' = menor created_at (coherente con branch-premium-gating; conviene
  implementar ese spec antes para reutilizar getPrimaryBranchId e isTenantPremium).
- Cercania con Haversine puro: sin API de mapas ni costo. Coordenadas capturadas a mano.
- Branding/banner solo para premium (coherente con premium-gating-v2).
- Prisma en Windows: si EPERM al db push/generate, detener node primero. Proyecto usa db push.
- Fallos de tests preexistentes y ajenos se ignoran; no son regresiones de esta spec.
