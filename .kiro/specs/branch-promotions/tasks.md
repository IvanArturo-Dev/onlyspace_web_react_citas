# Implementation Plan

## Overview

Modulo de promociones informativas por sucursal (premium-only para gestionar; visibles al
cliente si vigentes y el negocio es premium). Nuevo modelo Promotion, servicio con CRUD +
consulta publica, rutas del emprendedor, exposicion en info/discover, y UI. Reutiliza
requirePremium (salta bajo impersonacion) y patrones existentes.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3", "4"] },
    { "wave": 4, "tasks": ["5", "6"] }
  ]
}
```

## Tasks

- [ ] 1. Schema: modelo Promotion
  - `schema.prisma`: modelo `Promotion { id, tenant_id, branch_id, title, description?
    @db.Text, image_url?, starts_at DateTime?, ends_at DateTime?, is_active Boolean
    @default(true), created_at, updated_at }` con `@@index([branch_id, is_active])`,
    `@@index([tenant_id])`, `@@map("promotions")`. Sin relaciones formales.
  - Aplicar `prisma db push` (Windows: detener node antes). Aditivo.
  - `tsc --noEmit` backend en verde.
  - _Requirements: 1.1, 1.2_

- [ ] 2. Backend: promotion.service (CRUD + consulta publica)
  - Nuevo `promotion.service.ts`: list/create/update/remove (pertenencia via
    prisma.branch.findFirst por id+tenant_id -> 404; NO usar branchService.get para no
    chocar con su gating de sucursal). Validaciones: title requerido (400); ends_at <
    starts_at (ambos presentes) -> 400.
  - `listActivePublic(branchId, now?)` y `activeForBranches(branchIds, now?)` con filtro
    is_active + rango de fechas (limites nulos no restringen).
  - Pruebas unitarias (Property 1,3,4): vigencia (activa/inactiva/futura/expirada);
    title vacio y ends<starts -> 400; pertenencia 404; aislamiento; lote activeForBranches.
  - `tsc` + `jest --testPathPattern="promotion"` en verde.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.3_

- [ ] 3. Backend: rutas emprendedor + gating
  - `promotion.controller.ts` (o en branch.controller): list/create/update/remove; auditar
    create/update/delete (writeAudit).
  - `branch.routes.ts`: GET /:id/promotions (authenticated+requireAdmin+branchesModule);
    POST/PATCH/DELETE con requirePremium adicional (free -> 403; salta bajo impersonacion).
  - Prueba de integracion ligera: premium crea (201); free crea -> 403; aislamiento.
  - `tsc` + `jest --testPathPattern="promotion|branch"` en verde.
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 6.1_

- [ ] 4. Backend: exposicion publica (info + discover)
  - `public.controller.info`: si premium, agrega `data.promotions` =
    listActivePublic(branch.id) (campos publicos).
  - `discovery.service.discover`: por item premium, agrega `promotions` vigentes de su
    sucursal principal via activeForBranches (en lote). Extender DiscoverItem.
  - Pruebas: discover unit -> premium con promos vigentes; free sin; expiradas excluidas.
  - `tsc` + `jest --testPathPattern="discovery|public|promotion"` en verde.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.3_

- [ ] 5. Frontend: servicio + pantalla del emprendedor
  - `services/promotion.service.ts` + tipos (Promotion, PromotionInput).
  - Pantalla de promociones por sucursal (ruta `/promociones` usando la sucursal activa,
    o subpantalla): CRUD con formulario (title, description, image_url, starts_at,
    ends_at, is_active), estado vigente/expirada/inactiva, gating 'Solo premium' + manejo
    403. Enlace en el menu (Layout) + ruta en App.tsx.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 6. Frontend: cliente (portal + descubrimiento)
  - `public.service` PublicInfo: + `promotions?`; BookingPortal muestra promos vigentes.
  - DiscoverItem: + `promotions?` (o indicador); Landing/tarjeta muestra un chip 'Promos'
    o el titulo de una promo vigente si viene. Sin hueco si no hay.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 5.1, 5.2, 5.3_

## Notes
- Aditivo; `prisma db push` (no migrate). Detener node antes en Windows.
- requirePremium ya salta bajo impersonacion (impersonated_by), asi el super admin gestiona.
- Pertenencia de sucursal en promotion.service via prisma.branch.findFirst directo (evita
  el 403 de gestion de sucursal del branchService.get en free; el gating del modulo va en la ruta).
- Fallos de tests preexistentes y ajenos (auth.service, customer.service, adminUsersModules)
  se ignoran; no son regresiones de esta spec.
