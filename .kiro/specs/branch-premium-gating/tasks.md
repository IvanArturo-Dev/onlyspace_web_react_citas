# Implementation Plan

## Overview

Extiende el gating premium a las sucursales: la principal es la mas antigua
(created_at asc). Un tenant FREE solo gestiona/expone su sucursal principal; las extra
quedan ocultas (no borradas) y su reserva publica se bloquea. Reutiliza
isPremiumEffective y el patron de requireBranchQuota.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4"] },
    { "wave": 3, "tasks": ["5"] }
  ]
}
```

## Tasks

- [x] 1. Backend: helpers de premium y sucursal principal
  - Nuevo helper `getPrimaryBranchId(tenantId)` (en branch.service.ts o util compartido):
    `prisma.branch.findFirst({ where:{tenant_id}, orderBy:{created_at:'asc'}, select:{id:true} })`.
  - Helper `isTenantPremium(tenantId)`: carga `{subscription_status, subscription_expires_at}`
    y aplica `isPremiumEffective` (reusa subscription/branding service; no duplicar logica).
  - Pruebas unitarias: getPrimaryBranchId devuelve la de menor created_at; isTenantPremium
    true/false segun estado y expiracion.
  - `tsc --noEmit` backend + jest de los tests nuevos en verde.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Backend: gating de gestion de sucursales (branchService)
  - `branchService.list(tenantId)`: si NO premium, devolver SOLO la sucursal principal.
  - `branchService.get(tenantId, id)`: si NO premium y `id !== primaryId` -> 403 PREMIUM_REQUIRED.
  - `branchService.update(tenantId, id, ...)`: mismo guard antes de escribir (no muta si 403).
  - Verificar que los subrecursos por sucursal (`/:id/schedule|holidays|services`) resuelven
    la sucursal via branchService.get; si alguno no pasa por get, aplicar el mismo guard.
  - Pruebas unitarias branch.service: free lista solo principal; get/update de extra -> 403;
    premium sin cambios; aislamiento por tenant (Property 2,3,7).
  - `tsc --noEmit` + jest branch en verde.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2_

- [x] 3. Backend: reserva publica de sucursales extra bloqueada (publicService)
  - `resolveBranchByCode(code)`: tras hallar la branch activa, cargar su tenant; si es FREE
    y la branch no es la principal de ese tenant -> 404 INVALID_CODE. La principal de un
    free resuelve normal; premium sin cambios.
  - `searchBranches(q)`: excluir del resultado las sucursales extra de tenants FREE (calcular
    en lote el mapa principal-por-tenant de los tenants involucrados).
  - Pruebas unitarias public.service: resolveBranchByCode de extra-free -> 404; de principal-
    free -> ok; premium extra -> ok; searchBranches excluye extras de free e incluye premium
    (Property 4).
  - `tsc --noEmit` + jest public en verde.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Backend: bloquear agendado en sucursal extra siendo free (appointmentService)
  - En `createAppointment`, cuando llega `branch_id` y el tenant es FREE, validar que
    `branch_id === primaryId`; si no -> 403 PREMIUM_REQUIRED. NO afecta citas existentes.
  - Confirmar que list/get de citas NO se filtran por sucursal (las citas de extras siguen
    visibles para seguimiento, Req 4.2).
  - Pruebas unitarias appointment.service: crear en extra siendo free -> 403; en principal
    -> ok; premium sin restriccion (Property 5). No destruccion (Property 6).
  - `tsc --noEmit` + jest appointment en verde.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. Frontend: pantalla de sucursales refleja el gating
  - `Sucursales.tsx`: como `GET /branches` ya devuelve solo la principal en free, la lista
    sale reducida; agregar leyenda 'Solo premium' junto a agregar/gestionar mas sucursales.
  - Manejar 403 PREMIUM_REQUIRED (via helper mapPremiumError) en get/update/create sin
    romper la UI (mensaje claro).
  - `tsc --noEmit` frontend + `vite build`.
  - _Requirements: 5.1, 5.2, 5.3_

## Notes
- 'Principal' = sucursal de menor created_at; sin columna nueva ni migracion.
- Reutiliza isPremiumEffective (subscription/branding service) y el patron de requireBranchQuota.
- Al perder premium NO se borra nada; solo se oculta/bloquea. Al reactivar, todo reaparece.
- Fallos de tests preexistentes y ajenos (auth.service, customer.service, adminUsersModules)
  se ignoran; no son regresiones de esta spec.
