# Implementation Plan

## Overview

Carrusel de banners premium animado en el landing + modo soporte del super admin por
impersonacion (token JWT con impersonated_by; salta gating; auditado). Sin cambios de
schema. Reutiliza discover (branding premium), el JWT existente y los guards.

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

- [ ] 1. Backend: JWT + auth soportan impersonated_by
  - `config/jwt.ts`: agregar `impersonated_by?: string` a `JwtPayload`. Permitir firmar
    con expiracion corta (parametro opcional expiresIn en generateAccessToken, o firmar
    inline en el servicio de la tarea 2).
  - `types/express.d.ts`: agregar `impersonated_by?: string` a Request.user.
  - `middleware/auth.ts`: al decodificar, propagar `decoded.impersonated_by` a
    `req.user.impersonated_by` cuando exista.
  - `tsc --noEmit` backend en verde.
  - _Requirements: 3.1, 6.2_

- [ ] 2. Backend: impersonation.service + endpoints admin
  - Nuevo `impersonation.service.ts`: `start(superAdminUserId, targetTenantId)` valida
    tenant (404 TENANT_NOT_FOUND), emite token (role ADMIN, tenant_id=objetivo,
    permissions [], impersonated_by=superAdminUserId, exp corto ~2h) y devuelve
    { token, tenant:{ id, name } }; audita START. `stop(superAdminUserId, targetTenantId)`
    audita END y devuelve { ok:true }.
  - `admin.controller` + `admin.routes`: POST /admin/impersonation/:tenantId y
    POST /admin/impersonation/:tenantId/stop, ambos authMiddleware + requireSuperAdmin.
  - Pruebas unitarias (Property 1,3,4,6): emite token correcto; tenant inexistente ->
    404; audita; (el 403 para no-superadmin lo cubre requireSuperAdmin en integracion).
  - `tsc` + `jest --testPathPattern="impersonation|admin"` en verde.
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 6.1_

- [ ] 3. Backend: guards saltan gating bajo impersonacion
  - `requirePremium`, `requireBranchQuota`, `requireServiceQuota`: al inicio, si
    `req.user?.impersonated_by` -> next() (salta gating). Sin el claim, comportamiento
    intacto.
  - `branch.service` list/get/update: aceptar un tercer parametro opcional
    `bypassPremium=false`; cuando true, tratar como premium (no filtrar/no 403). El
    controlador de sucursales pasa `!!req.user?.impersonated_by`. Documentar el flag.
  - Pruebas unitarias (Property 2): cada guard hace next() con impersonated_by aunque el
    tenant sea free; branch.service con bypassPremium=true lista todas / permite extra.
  - `tsc` + `jest --testPathPattern="premium|branch|quota"` en verde.
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 4. Frontend: estado de impersonacion + api + banner global
  - Servicio `services/impersonation.service.ts`: `start(tenantId)` (POST) y
    `stop(tenantId)` (POST).
  - Estado (useAuthStore o nuevo store): guarda impersonationToken + impersonatingName;
    persistente en sessionStorage. `services/api.ts`: el interceptor usa el token de
    impersonacion como Authorization cuando esta activo; si no, el token normal.
  - Banner global en `components/Layout.tsx`: si hay impersonacion activa, barra fija
    'Actuando como: <negocio>' + boton 'Salir' (llama stop, limpia estado, navega a /admin).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 5.2, 5.3, 5.4_

- [ ] 5. Frontend: panel super admin 'Actuar como'
  - Pantalla admin (nueva `AdminTenants` o seccion en AdminOverview): lista tenants
    (GET /admin/tenants) con boton 'Actuar como' -> impersonation.start(tenantId),
    guarda token+nombre y navega a '/' (area de gestion). Agregar enlace en el menu
    admin (Layout) y ruta en App.tsx si es pantalla nueva.
  - Manejo de error (tenant invalido / 403) con mensaje claro.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 5.1, 5.2_

- [ ] 6. Frontend: BannerCarousel premium en el landing
  - Componente `components/BannerCarousel.tsx`: recibe items premium (con branding);
    autoplay ~5s, pausa en hover/focus, botones prev/next + dots, cada slide con logo,
    banner_title, banner_text, acento brand_color y click -> /reservar/<code>. Respeta
    prefers-reduced-motion (sin autoplay). Accesible (aria-labels, teclado). Responsive.
  - `Landing.tsx`: filtrar los items de discover que sean premium con branding y pasarlos
    al carrusel en el hero; si no hay, no renderizar el carrusel (sin hueco).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2_

## Notes
- Sin cambios de schema; impersonacion 100% por token JWT.
- El token de impersonacion lleva user_id=superAdminUserId para que la auditoria quede a
  su nombre; impersonated_by lo confirma.
- El carrusel reutiliza discover (branding solo premium); no requiere endpoint nuevo.
- Seguridad: solo requireSuperAdmin puede emitir el token; un rol normal no puede.
- Fallos de tests preexistentes y ajenos (auth.service, customer.service, adminUsersModules)
  se ignoran; no son regresiones de esta spec.
