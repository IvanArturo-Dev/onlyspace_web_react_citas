# Design Document

## Overview

Modulo de promociones informativas por sucursal. Nuevo modelo `Promotion` (por
branch_id/tenant_id), servicio con CRUD scoped, rutas del emprendedor bajo la sucursal
(premium-only), y exposicion publica de las promos vigentes en `/public/:code/info` y
`/public/discover`. Reutiliza `requirePremium` (que ya salta bajo impersonacion) y el
patron de branding.service/ads.

## Architecture

```
Backend (schema)
  model Promotion { id, tenant_id, branch_id, title, description?, image_url?,
    starts_at?, ends_at?, is_active(default true), created_at, updated_at ;
    @@index([branch_id, is_active]) @@index([tenant_id]) @@map("promotions") }

Backend (servicio)
  promotion.service.ts:
    list(tenantId, branchId) -> promos de la sucursal (valida pertenencia via branchService.get)
    create(tenantId, branchId, input) -> valida title/fechas; crea
    update(tenantId, branchId, id, input) -> valida pertenencia + fechas; edita
    remove(tenantId, branchId, id) -> borra (404 si no es del tenant/branch)
    listActivePublic(branchId) -> promos vigentes (is_active y dentro de fechas) para el cliente
    activeForBranches(branchIds[]) -> mapa branch_id -> promos vigentes (para discover en lote)

Backend (rutas emprendedor, bajo /branches/:id, requireAdmin + premium)
  GET    /branches/:id/promotions              list
  POST   /branches/:id/promotions              create   (requirePremium)
  PATCH  /branches/:id/promotions/:promoId     update   (requirePremium)
  DELETE /branches/:id/promotions/:promoId     remove   (requirePremium)

Backend (publico)
  public.controller.info: agrega `promotions` (vigentes) SOLO si el tenant es premium.
  discovery.service.discover: agrega `promotions` (vigentes de la principal) por item premium.

Frontend
  services/promotion.service.ts (emprendedor) + tipos.
  Pantalla de promociones por sucursal (o seccion en Sucursales / nueva ruta) con CRUD,
    gating 'Solo premium' para free.
  BookingPortal (cliente): muestra promociones vigentes de info.
  Landing DiscoverItem: opcional indicador de promos.
```

## Components and Interfaces

### 1. Schema Promotion (Req 1)
- Nuevo modelo `Promotion` (ver arriba). Sin relaciones formales (scoping por id, estilo
  Assistant/Review). starts_at/ends_at DateTime?. Aplicar con `prisma db push` (Windows:
  detener node antes).

### 2. promotion.service (Req 1, 3)
- Todas las operaciones de gestion validan la sucursal via `branchService.get(tenantId,
  branchId)` (404 si no es del tenant; en free lanzaria 403 salvo principal, pero el
  gating de CREAR/EDITAR/BORRAR lo cubre requirePremium en la ruta; para list, get de la
  principal en free es accesible). NOTA: para no chocar con el gating de branchService.get
  en free (que bloquea sucursales extra), la validacion de pertenencia puede hacerse con
  una consulta directa `prisma.branch.findFirst({ where:{id,tenant_id} })` (404 si null) en
  vez de branchService.get, evitando el 403 de gestion de sucursal; el gating premium del
  MODULO se aplica en la ruta. DECISION: usar findFirst directo para pertenencia.
- Validaciones: title requerido (400); si starts_at y ends_at ambos presentes y ends_at <
  starts_at -> 400 VALIDATION_ERROR.
- `listActivePublic(branchId, now=Date)`: where branch_id, is_active true, (starts_at null
  OR <= now) AND (ends_at null OR >= now); orderBy created_at desc.
- `activeForBranches(branchIds, now)`: findMany en lote con el mismo filtro, agrupado por
  branch_id -> Promotion[] vigentes.

### 3. Rutas emprendedor (Req 1, 2)
- En `branch.routes.ts`, bajo `/:id/promotions`, con `...authenticated, requireAdmin,
  branchesModule` y ademas `requirePremium` en POST/PATCH/DELETE (list sin premium para
  poder ver el estado, pero sin poder mutar). requirePremium ya hace short-circuit bajo
  impersonacion (Req 2.3).
- Controlador `promotion` handlers en un nuevo `promotion.controller.ts` o dentro de
  branch.controller; auditar create/update/delete (writeAudit) como el resto.

### 4. Exposicion publica (Req 3, 5)
- `public.controller.info`: cuando `isPremium`, agrega `data.promotions =
  await promotionService.listActivePublic(branch.id)` (mapea a campos publicos: title,
  description, image_url, starts_at, ends_at).
- `discovery.service.discover`: para los tenants premium, resuelve las promos vigentes de
  su sucursal principal via `activeForBranches` (branch principal por item) y agrega
  `promotions` al DiscoverItem (o `has_promotions`/primer titulo). Solo premium.

### 5. Frontend emprendedor (Req 4)
- `services/promotion.service.ts`: list/create/update/remove contra /branches/:id/promotions.
- Pantalla: seccion 'Promociones' por sucursal (nueva pagina `/promociones` que usa la
  sucursal activa del store, o subpantalla dentro de Sucursales). CRUD con formulario
  (title, description, image_url, starts_at, ends_at, is_active). Free: leyenda 'Solo
  premium' + manejar 403 (mapPremiumError). Mostrar estado vigente/expirada/inactiva.
- Agregar enlace en el menu del emprendedor (Layout) y ruta en App.tsx.

### 6. Frontend cliente (Req 5)
- `BookingPortal` (public.service PublicInfo): extender con `promotions?: Promotion[]` y
  renderizar una seccion de promociones vigentes si viene.
- Landing DiscoverItem: `promotions?` opcional; mostrar un chip/indicador si hay.

## Data Models

- Nuevo `Promotion` (aditivo). Sin otros cambios. `prisma db push`.

## Error Handling

- title vacio / ends_at < starts_at -> 400 VALIDATION_ERROR.
- Sucursal o promo de otro tenant -> 404.
- Free crear/editar/borrar -> 403 PREMIUM_REQUIRED (requirePremium; salta bajo impersonacion).
- Publico: solo promos vigentes de negocios premium; nunca de free.

## Testing Strategy

- Unit promotion.service: create valida title/fechas; pertenencia (404); listActivePublic
  filtra por is_active + rango de fechas (vigente/expirada/futura); activeForBranches en
  lote; aislamiento por tenant.
- Unit discovery: items premium reciben sus promos vigentes; free no.
- Integracion (opcional): rutas /branches/:id/promotions con premium (crea) y free (403).
- E2E en vivo (peticion del usuario): crear promo (premium), verla en /public/:code/info,
  free -> 403, promo expirada no aparece.
- Regresion: tsc backend/frontend, vite build, suites existentes verdes (salvo ajenos).

## Correctness Properties

### Property 1: Vigencia correcta
listActivePublic devuelve una promocion si y solo si is_active=true y ahora esta dentro
de [starts_at, ends_at] (limites nulos no restringen ese lado); una inactiva, futura o
expirada nunca se incluye.

**Validates: Requirements 3.1, 3.3, 5.1**

### Property 2: Gating premium en mutaciones
Crear/editar/eliminar una promocion siendo free (sin impersonacion) siempre responde 403
PREMIUM_REQUIRED y no muta datos; premium (o impersonacion) procede.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Validacion de datos
title vacio o ends_at < starts_at (ambos presentes) siempre resulta en 400
VALIDATION_ERROR sin persistir.

**Validates: Requirements 1.3, 1.4**

### Property 4: Aislamiento por tenant/sucursal
Toda lectura/escritura de promociones esta acotada al tenant y a una sucursal propia; una
sucursal o promo de otro tenant resuelve 404 y jamas se exponen promos ajenas.

**Validates: Requirements 1.5, 6.1**

### Property 5: Publico solo premium y vigente
El cliente (info/discover) solo recibe promociones vigentes de negocios premium; los free
nunca exponen promociones.

**Validates: Requirements 3.1, 3.4, 5.3**

