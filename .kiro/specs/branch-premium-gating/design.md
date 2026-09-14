# Design Document

## Overview

Extiende el gating premium a las sucursales. La sucursal PRINCIPAL es la mas antigua
(menor created_at). Un tenant FREE solo puede gestionar y exponer publicamente su
sucursal principal; las extra quedan ocultas (no borradas) y su reserva publica se
bloquea. Se reutiliza `isPremiumEffective` (ya existente) y el patron de
`requireBranchQuota`. El filtrado se centraliza en el servicio para no dispersar la
regla por controladores.

## Architecture

```
Backend
  helper resolvePrimaryBranchId(tenantId) -> id de la sucursal mas antigua
  helper isTenantPremium(tenantId) -> isPremiumEffective(tenant) (reusa subscription)

  branchService.list(tenantId): si FREE -> devuelve SOLO la principal.
  branchService.get(tenantId, id): si FREE y id != principal -> 403 PREMIUM_REQUIRED.
  branchService.update(tenantId, id, ...): si FREE y id != principal -> 403.
  (create ya gateado por requireBranchQuota; sin cambios.)

  publicService.resolveBranchByCode(code): tras cargar la branch, si su tenant es
    FREE y la branch NO es la principal -> 404 INVALID_CODE (no se expone).
  publicService.searchBranches(q): filtra fuera las sucursales extra de tenants FREE.

  appointmentService.createAppointment: si FREE y branch_id apunta a una extra -> 403
    PREMIUM_REQUIRED (no se agenda en sucursal oculta). Citas existentes intactas.

Frontend
  usePremium() (existe) -> isPremium.
  Pantalla Sucursales: si !isPremium, la API ya devuelve solo la principal; mostrar
    leyenda "Solo premium" para gestionar mas y manejar 403.
```

## Components and Interfaces

### 1. Backend: helpers de premium + principal (Req 1)
- Nuevo helper en `branch.service.ts` (o util compartido) `getPrimaryBranchId(tenantId)`:
  `prisma.branch.findFirst({ where:{tenant_id}, orderBy:{created_at:'asc'}, select:{id:true} })`.
- Helper `isTenantPremium(tenantId)`: carga `{subscription_status, subscription_expires_at}`
  y aplica `isPremiumEffective`. Reutilizable por branch y public services.

### 2. Backend: branchService gating (Req 2)
- `list(tenantId)`: si NO premium, filtra el resultado a la sola sucursal principal
  (la primera por created_at asc). Si premium, sin cambios.
- `get(tenantId, id)`: si NO premium y `id !== primaryId`, lanza 403 PREMIUM_REQUIRED.
- `update(tenantId, id, ...)`: mismo guard que get antes de escribir.
- Nota: los subrecursos por sucursal (schedule/holidays/services de `/:id/...`) heredan
  la proteccion si el `:id` no es la principal, porque el controlador resuelve la
  sucursal via branchService.get. Verificar en tareas que asi sea; si algun endpoint
  no pasa por get, aplicar el mismo guard.

### 3. Backend: reserva publica (Req 3)
- `resolveBranchByCode(code)`: tras hallar la branch activa, cargar su tenant y, si es
  FREE y la branch no es la principal de ese tenant, lanzar 404 INVALID_CODE. La
  principal de un free sigue resolviendo normal.
- `searchBranches(q)`: tras el findMany, para cada branch de un tenant FREE, excluir
  las que no sean la principal. Para eficiencia, resolver el conjunto de principales
  de los tenants involucrados (un findFirst por tenant o un group-by por created_at).
  Como el limite es 20, un mapa de principal-por-tenant calculado en lote es suficiente.

### 4. Backend: bloqueo de agendado en sucursal extra (Req 4)
- En `appointmentService.createAppointment`, cuando llega `branch_id` y el tenant es
  FREE, validar que `branch_id === primaryId`; si no, 403 PREMIUM_REQUIRED. NO afecta
  a citas ya existentes ni a su consulta/seguimiento.
- Consulta/seguimiento de citas (list/get) NO se filtra por sucursal: las citas de
  sucursales extra siguen visibles para el emprendedor (Req 4.2).

### 5. Frontend: pantalla de sucursales (Req 5)
- Como `GET /branches` ya devuelve solo la principal en free, la lista se ve reducida
  sola. Agregar leyenda "Solo premium" junto al boton de agregar/gestionar mas.
- Manejar 403 PREMIUM_REQUIRED (via helper `mapPremiumError`) en get/update/create.

## Data Models

- Sin cambios de schema. "Principal" se deriva por `created_at asc`; no se agrega
  columna. Branch, Appointment y Tenant permanecen igual.

## Error Handling

- Gestion (emprendedor): sucursal extra en free -> 403 PREMIUM_REQUIRED.
- Reserva publica: sucursal extra en free -> 404 INVALID_CODE (no se revela que existe).
- Agendar en extra siendo free -> 403 PREMIUM_REQUIRED.
- Aislamiento por tenant: todos los helpers filtran por tenant_id; jamas se devuelven
  ni principales ni extras de otro tenant.

## Testing Strategy

- Unit `branch.service`: free lista solo principal; get/update de extra -> 403; premium
  sin cambios; aislamiento por tenant.
- Unit `public.service`: resolveBranchByCode de extra-free -> 404; de principal-free ->
  ok; searchBranches excluye extras de free e incluye las de premium.
- Unit `appointment.service`: createAppointment en extra siendo free -> 403; en
  principal -> ok; premium sin restriccion.
- Regresion: tsc backend/frontend 0 errores; vite build ok; suites existentes verdes
  (salvo fallos preexistentes ajenos ya conocidos).

## Correctness Properties

### Property 1: Principal estable
Para un tenant dado, getPrimaryBranchId devuelve siempre la sucursal de menor
created_at, sin importar el orden de consulta.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Free ve solo la principal (gestion)
Para cualquier tenant FREE, branchService.list devuelve exactamente 1 sucursal y es la
principal.

**Validates: Requirements 2.1, 2.4**

### Property 3: Free bloquea la extra (gestion)
Para un tenant FREE, get/update de una sucursal que no es la principal siempre lanza
403 PREMIUM_REQUIRED y nunca muta datos.

**Validates: Requirements 2.2**

### Property 4: Free oculta la extra (publico)
resolveBranchByCode de una sucursal extra de un tenant FREE siempre lanza 404
INVALID_CODE; la principal de ese tenant resuelve ok.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Free bloquea agendado en extra
createAppointment con branch_id de una extra y tenant FREE siempre lanza 403; con la
principal (o siendo premium) procede.

**Validates: Requirements 4.3**

### Property 6: No destruccion
Ninguna operacion de esta spec borra sucursales, citas ni branding; solo oculta o
bloquea. Al volver a premium, list y el publico incluyen de nuevo las extras.

**Validates: Requirements 4.1, 4.2, 4.4, 6.2**

### Property 7: Aislamiento por tenant
Ningun helper o filtro devuelve sucursales de un tenant distinto al del contexto (JWT
en gestion; tenant de la branch en publico).

**Validates: Requirements 6.1**

