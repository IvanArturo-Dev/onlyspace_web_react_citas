# Implementation Plan

## Overview

Gating premium: middleware requirePremium + limite de sucursales, exponer is_premium en
/me/tenant, y frontend (badge Premium + leyendas "Solo premium" + manejo de 403). Sin
cambios de schema.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Backend: middleware requirePremium + requireBranchQuota + is_premium en /me/tenant
  - Crear `backend/src/middleware/requirePremium.ts`: carga tenant del JWT, aplica isPremiumEffective (reutiliza subscription.service); premium -> next(); si no -> 403 PREMIUM_REQUIRED. Sin user -> 403.
  - Crear `backend/src/middleware/requireBranchQuota.ts`: si el tenant NO es premium y ya tiene >= 1 branch (prisma.branch.count por tenant) -> 403 PREMIUM_REQUIRED; premium o 0 branches -> next().
  - `me.controller.getTenant`: ampliar el select con subscription_status/subscription_expires_at y agregar `is_premium` (isPremiumEffective) al data devuelto.
  - Pruebas unitarias de ambos middlewares y de getTenant (is_premium).
  - `tsc --noEmit` backend + jest de los nuevos tests en verde.
  - _Requirements: 1.1, 6.3_

- [ ] 2. Backend: aplicar los guards en las rutas
  - `assistant.routes` POST / -> `...authenticated, requireAdmin, requirePremium, invite`.
  - `loyalty.routes` POST /programs -> `...authenticated, requireAdmin, requirePremium, createProgram`.
  - `branch.routes` POST / -> `...authenticated, requireAdmin, branchesModule, requireBranchQuota, create`.
  - Pruebas (unit/integration segun patron del proyecto): free -> 403 en las 3 creaciones (2a sucursal); premium -> pasa; free 0 sucursales -> crea la primera.
  - `tsc` + jest de branch/assistant/loyalty en verde.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 5.1, 6.1, 6.2_

- [ ] 3. Frontend: tenantService.is_premium + badge Premium
  - `tenant.service.ts`: MyTenant gana `is_premium?: boolean`.
  - Dashboard: cargar tenantService.getMine() (best-effort) y mostrar badge "Premium" en el encabezado cuando is_premium.
  - Util/hook opcional para compartir is_premium entre vistas (o cada vista lo consulta).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.2_

- [ ] 4. Frontend: leyendas "Solo premium" + manejo de 403
  - En Sucursales: si free y ya hay >=1 sucursal, el boton "Agregar sucursal" muestra "Solo premium" (deshabilitado o con aviso).
  - En Colaboradores: accion de invitar marcada "Solo premium" para free.
  - En Lealtad: creacion de programa marcada "Solo premium" para free.
  - En Personalizacion/Anuncios: aviso "Solo premium: se vera en tu portal al activar premium" para free (permitir editar/guardar sin borrar).
  - Manejar el 403 PREMIUM_REQUIRED del backend con mensaje claro en las 3 creaciones.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.3, 2.4, 3.3, 4.3, 5.2, 5.3_

## Notes
- Sin cambios de schema: se usa subscription_status/subscription_expires_at del Tenant.
- No se borra nada al perder premium; solo se bloquea crear nuevo (guards en POST).
- Ver proximas/anteriores citas no se gatea (para todos).
- El branding default del portal para free ya existe; solo se agrega el aviso en el panel.
