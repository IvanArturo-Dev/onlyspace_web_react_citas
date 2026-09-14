# Design Document

## Overview

Dos entregables: (1) carrusel de banners premium animado en el landing, alimentado por
los items premium con branding del descubrimiento; y (2) modo de soporte del super
admin por IMPERSONACION: emite un JWT de corta duracion con role=ADMIN, tenant_id del
negocio objetivo y un claim `impersonated_by`. Con ese token, el super admin reutiliza
todos los endpoints del emprendedor; los guards premium reconocen el claim y saltan el
gating; toda accion queda auditada como del super admin.

## Architecture

```
Backend
  JWT payload (config/jwt.ts): + impersonated_by?: string (opcional).
  authMiddleware: propaga impersonated_by a req.user (si viene en el token).
  requireSuperAdmin: sin cambios (valida role firmado).
  requirePremium / requireBranchQuota / requireServiceQuota / branchService gating:
    si req.user.impersonated_by esta presente -> se considera premium (salta gating).

  Endpoints (SUPERADMIN-only, admin.routes):
    POST /admin/impersonation/:tenantId  -> emite { token, tenant } (role ADMIN,
      tenant_id=objetivo, impersonated_by=superAdminUserId, exp corto). Audita START.
    (Terminar impersonacion es del lado cliente: descarta el token; se audita END
     opcionalmente via POST /admin/impersonation/:tenantId/stop, o se omite el server
     y se audita solo START. Se incluye endpoint stop para auditar el fin.)

  Carrusel: usa el endpoint publico existente GET /public/discover; el frontend filtra
    items premium con branding (banner_title/text/logo). Opcional: exponer tenant_id en
    DiscoverItem (habilita ademas el boton de favorito en el landing).

Frontend
  store useImpersonation (o extension de useAuthStore): guarda el token de
    impersonacion y el nombre del negocio; el axios `api` usa ese token cuando esta
    activo. Banner global 'Actuando como: <negocio>' + Salir.
  Panel super admin: pantalla/lista de tenants con boton 'Actuar como'.
  Landing: componente BannerCarousel (premium items) animado y accesible.
```

## Components and Interfaces

### 1. JWT + auth (Req 3, 4, 6)
- `JwtPayload` (config/jwt.ts): agregar `impersonated_by?: string`.
- `authMiddleware`: al decodificar, si `decoded.impersonated_by` existe, incluirlo en
  `req.user.impersonated_by`. Extender el tipo global Express.Request.user y AuthRequest.
- La emision reutiliza `generateAccessToken` (misma firma/secre). El token de
  impersonacion NO incluye refresh; duracion corta: firmar con `expiresIn` (p.ej. 2h)
  usando jwt.sign con opciones (ajustar generateAccessToken para aceptar expiresIn, o
  firmar inline en el servicio de impersonacion).

### 2. impersonation.service + endpoints (Req 3, 4, 6)
- Nuevo `impersonation.service.ts`: `startImpersonation(superAdminUserId, targetTenantId)`
  valida que el tenant exista (404), emite el token (role ADMIN, tenant_id=objetivo,
  permissions [], impersonated_by=superAdminUserId, exp corto) y devuelve { token,
  tenant: { id, name } }. Audita START (writeAudit action UPDATE/LOGIN, resource
  'impersonation', details { target_tenant, by }).
- `stopImpersonation(superAdminUserId, targetTenantId)`: solo audita END (el token se
  descarta en el cliente). Devuelve { ok: true }.
- Rutas en admin.routes (authMiddleware + requireSuperAdmin):
  `POST /admin/impersonation/:tenantId` y `POST /admin/impersonation/:tenantId/stop`.

### 3. Guards saltan gating bajo impersonacion (Req 4)
- `requirePremium`: al inicio, si `req.user?.impersonated_by` -> next() (salta gating).
- `requireBranchQuota` y `requireServiceQuota`: mismo short-circuit.
- `branch.service` (isTenantPremium usada por list/get/update/assertBranchManageable):
  el gating de sucursales se evalua en el SERVICE, que no ve req.user. Para no
  reescribir la firma, el enfoque: los guards de RUTA (requirePremium/quota) ya cubren
  creacion; para list/get/update de sucursal extra, se agrega un parametro opcional o
  se traslada la decision. DECISION: pasar un flag `bypassPremium` desde el controlador
  de sucursales cuando `req.user.impersonated_by` esta presente, a traves de un tercer
  argumento opcional en branchService.list/get/update (default false). Asi el super
  admin ve/gestiona todas las sucursales del tenant objetivo. Documentar el flag.
- La operacion sigue acotada al tenant del token (Req 4.2): como tenant_id ES el
  objetivo, el aislamiento normal ya lo garantiza.

### 4. Auditoria bajo impersonacion (Req 4.3)
- Los controladores del emprendedor ya llaman writeAudit con user_id=req.user.id. Bajo
  impersonacion req.user.id es el super admin (el token lo emitio para el; user_id se
  fija al superAdminUserId), y ademas impersonated_by lo confirma. Se incluye
  impersonated_by en details donde sea practico. NOTA: para que las acciones queden a
  nombre del super admin, el token lleva user_id = superAdminUserId.

### 5. Frontend: estado de impersonacion + api (Req 5)
- `useAuthStore` (o nuevo `useImpersonation`): guarda `impersonationToken` y
  `impersonatingName`. El interceptor de `services/api.ts` usa el token de
  impersonacion como Authorization cuando esta activo; si no, el token normal.
- Banner global (en Layout): si hay impersonacion activa, barra fija 'Actuando como:
  <negocio>' + boton Salir (llama stop, limpia el token, navega a /admin).

### 6. Frontend: panel super admin 'Actuar como' (Req 5)
- Pantalla admin (reusar/añadir en AdminOverview o AdminUsers, o nueva AdminTenants):
  lista tenants (GET /admin/tenants ya existe) con boton 'Actuar como' -> llama
  POST /admin/impersonation/:tenantId, guarda el token y navega a '/' (area de gestion
  del emprendedor) que ahora resuelve el contexto del tenant objetivo via el token.

### 7. Frontend: BannerCarousel en el landing (Req 1)
- Componente `BannerCarousel` que recibe los items premium (con branding) de discover.
  Rota automaticamente (setInterval ~5s), pausa en hover/focus, botones prev/next e
  indicadores (dots). Cada slide: logo, banner_title, banner_text, fondo/acento con
  brand_color, y click -> /reservar/<code>. Respeta prefers-reduced-motion (sin
  autoplay si el usuario lo pide). Se oculta si no hay banners premium. Se coloca en el
  hero del landing, encima o debajo del buscador.

## Data Models

- Sin cambios de schema. La impersonacion es puramente de token (JWT). El carrusel usa
  datos existentes (branding premium). Opcional: exponer tenant_id en DiscoverItem
  (no es dato sensible).

## Error Handling

- Emitir impersonacion sobre tenant inexistente -> 404 TENANT_NOT_FOUND.
- Emitir impersonacion sin ser SUPERADMIN -> 403 (requireSuperAdmin).
- Token de impersonacion expirado -> 401 TOKEN_EXPIRED (authMiddleware normal); el
  cliente limpia el estado y vuelve al super admin.
- El carrusel ante error de datos: no se muestra (sin romper el landing).

## Testing Strategy

- Unit impersonation.service: emite token con role ADMIN + tenant objetivo +
  impersonated_by; tenant inexistente -> 404; audita START/END.
- Unit guards: requirePremium/requireBranchQuota/requireServiceQuota hacen next() si
  impersonated_by presente (aunque el tenant sea free); sin el claim mantienen el gating.
- Integracion: POST /admin/impersonation/:tenantId solo SUPERADMIN (403 para otros);
  con el token emitido, un endpoint premium del emprendedor responde OK aunque el
  tenant sea free.
- Frontend: tsc + vite build. BannerCarousel renderiza slides premium y se oculta sin
  datos.
- Regresion: suites existentes verdes (salvo fallos preexistentes ajenos).

## Correctness Properties

### Property 1: Solo SUPERADMIN emite impersonacion
startImpersonation solo puede invocarse por un SUPERADMIN (guard de ruta); el token
resultante lleva role=ADMIN, tenant_id=objetivo e impersonated_by=superAdminUserId.

**Validates: Requirements 3.1, 3.4, 6.1**

### Property 2: Impersonacion salta el gating premium
Con impersonated_by presente, requirePremium/requireBranchQuota/requireServiceQuota
llaman next() aunque el tenant objetivo sea free; sin el claim, mantienen el 403.

**Validates: Requirements 4.1**

### Property 3: Impersonacion acotada al tenant objetivo
El token de impersonacion solo autoriza operaciones sobre su tenant_id (el objetivo);
nunca permite tocar otro tenant.

**Validates: Requirements 4.2**

### Property 4: Acciones auditadas al super admin
Iniciar y terminar impersonacion se auditan; las operaciones durante la impersonacion
se registran con el super admin (user_id/impersonated_by).

**Validates: Requirements 3.5, 4.3**

### Property 5: Carrusel solo premium
El carrusel solo incluye negocios premium con banner; ningun negocio free aparece, y
si no hay banners premium el carrusel no se renderiza.

**Validates: Requirements 1.1, 1.4, 1.5, 2.3**

### Property 6: No fabricacion de permisos
Un usuario no-SUPERADMIN no puede obtener un token de impersonacion valido (la emision
valida el rol firmado del JWT original).

**Validates: Requirements 6.1, 6.2**

