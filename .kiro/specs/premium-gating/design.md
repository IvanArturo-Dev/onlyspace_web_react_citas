# Design Document

## Overview

Se agrega gating premium a las capacidades internas (sucursales, colaboradores,
lealtad) mediante un middleware `requirePremium` reutilizable, se expone `is_premium`
en `GET /me/tenant`, y el frontend muestra el badge "Premium" y leyendas "Solo premium".
El branding default para free ya existe (portal publico) y se preserva.

## Architecture

```
Backend
  middleware requirePremium(req,res,next): carga tenant del JWT, isPremiumEffective;
    premium -> next(); si no -> 403 PREMIUM_REQUIRED.
  Rutas gateadas:
    POST /v1/assistants        -> requireAdmin + requirePremium
    POST /v1/loyalty/programs   -> requireAdmin + requirePremium
    POST /v1/branches           -> requireAdmin + guard de LIMITE (free: max 1)
  me.controller.getTenant -> agrega is_premium (isPremiumEffective del tenant).

Frontend
  tenantService.getMine() -> MyTenant + is_premium.
  Dashboard/encabezado: badge "Premium" si is_premium.
  Branches/Assistants/Loyalty/Personalizacion: leyenda "Solo premium" si !is_premium.
```

## Components and Interfaces

### 1. Middleware requirePremium (nuevo)
- `backend/src/middleware/requirePremium.ts`: async. Lee `req.user!.tenant_id`, carga
  `prisma.tenant.findUnique({ where:{id}, select:{subscription_status, subscription_expires_at} })`,
  aplica `isPremiumEffective` (reutiliza subscription.service). Si premium -> next();
  si no -> `throw new HttpError("Funcion premium", 403, "PREMIUM_REQUIRED")`.
- Debe ejecutarse DESPUES de authMiddleware/requireAdmin (usa req.user).

### 2. Limite de sucursales (free: 1)
- Opcion A: middleware dedicado `requireBranchQuota` que, si el tenant NO es premium y
  ya tiene >= 1 branch, responde 403 PREMIUM_REQUIRED.
- Opcion elegida: aplicar la verificacion dentro de `branchService.create` (o un guard
  previo) para tener acceso al conteo. Diseno: en la ruta POST /branches insertar un
  middleware `requireBranchQuota` que cuente `prisma.branch.count({ where:{ tenant_id } })`
  y, si !premium && count >= 1 -> 403 PREMIUM_REQUIRED. Premium pasa siempre.

### 3. Rutas
- `assistant.routes`: `POST /` -> `...authenticated, requireAdmin, requirePremium, invite`.
- `loyalty.routes`: `POST /programs` -> `...authenticated, requireAdmin, requirePremium, createProgram`.
- `branch.routes`: `POST /` -> `...authenticated, requireAdmin, branchesModule, requireBranchQuota, create`.
  (Solo se gatea la CREACION; list/get/update no cambian.)

### 4. me.controller.getTenant
- Ampliar el select para traer subscription_status/subscription_expires_at y calcular
  `is_premium = isPremiumEffective(tenant)`. Agregar `is_premium` al data devuelto.

### 5. Frontend
- `tenant.service.ts` (MyTenant): agregar `is_premium?: boolean`.
- Dashboard `BrandHeader`: si is_premium, mostrar badge "Premium" (usar el tenant del
  nuevo getMine o un pequeño fetch). Como el Dashboard hoy no carga getMine, agregar la
  carga de `tenantService.getMine()` (best-effort) para conocer is_premium y pintar el badge.
- Vistas con acciones gateadas (Sucursales, Colaboradores, Lealtad, Personalizacion):
  cargar is_premium (via tenantService.getMine) y, si false, mostrar el boton/accion
  con una etiqueta "Solo premium" (deshabilitado o con aviso). Ademas, manejar el 403
  PREMIUM_REQUIRED del backend con un mensaje claro "Esta funcion es solo para premium.".
- Personalizacion: permitir editar/guardar pero mostrar aviso "Solo premium: se vera en
  tu portal cuando actives premium" cuando free (sin borrar datos).

## Data Models
- Ninguno nuevo. Se usa subscription_status/subscription_expires_at del Tenant.

## Error Handling
- 403 PREMIUM_REQUIRED consistente para las tres creaciones y la sucursal extra.
- El frontend mapea PREMIUM_REQUIRED a un mensaje claro y, cuando aplica, muestra
  "Solo premium" de forma proactiva (sin esperar el error).

## Correctness Properties

### Property 1: Estado premium expuesto
GET /me/tenant devuelve is_premium consistente con isPremiumEffective del tenant.

**Validates: Requirements 1.1**

### Property 2: Free no crea recursos premium
Un tenant free recibe 403 PREMIUM_REQUIRED al crear colaborador, programa de lealtad o una segunda sucursal, sin persistir nada.

**Validates: Requirements 2.1, 3.1, 4.1**

### Property 3: Premium sin limite
Un tenant premium crea sucursales, colaboradores y programas sin bloqueo.

**Validates: Requirements 2.3, 3.2, 4.2**

### Property 4: Primera sucursal en free
Un tenant free con 0 sucursales puede crear su primera sucursal.

**Validates: Requirements 2.2**

### Property 5: Conservacion al perder premium
Perder premium no borra sucursales/colaboradores/programas existentes; solo bloquea crear nuevos.

**Validates: Requirements 6.1**

### Property 6: Aislamiento por tenant
requirePremium evalua el premium del tenant del JWT; nunca el de otro tenant.

**Validates: Requirements 6.3**

## Testing Strategy
1. Unit `requirePremium`: premium -> next(); no premium -> 403 PREMIUM_REQUIRED; sin user -> 403.
2. Unit `requireBranchQuota`: free con 0 -> pasa; free con >=1 -> 403; premium -> pasa.
3. Unit getTenant: incluye is_premium correcto (active/vencido/inactivo).
4. Frontend: verificacion manual del badge Premium y leyendas "Solo premium"; manejo de
   403 PREMIUM_REQUIRED. tsc + vite build.
5. No regresion: suites de branch/assistant/loyalty/subscription en verde.
