# Design Document

## Overview

Amplia el gating premium: guards backend para branding/ads, lealtad (todos los
endpoints de programas), y limite de 5 servicios; el free ve solo citas de hoy; la
personalizacion no surte efecto ni se aplica en el panel mientras free; y se elimina
Integraciones de la UI. Reutiliza `requirePremium` y el patron de `requireBranchQuota`.

## Architecture

```
Backend
  requirePremium (existe) -> se aplica a:
    PATCH /me/branding, POST/PATCH/DELETE /me/ads
    GET/POST/GET:id/PATCH:id/PATCH:id/active /loyalty/programs (todos)
  requireServiceQuota (nuevo) -> POST /services (free: max 5)
  getBranding: si el tenant NO es premium, devuelve branding DEFAULT (vacio) para
    que el panel no aplique la personalizacion guardada.

Frontend
  usePremium() (existe) -> isPremium.
  Citas y Dashboard: si !isPremium, ocultar Proximas/Pasadas (Citas) y Proximas (Dashboard).
  Lealtad: si !isPremium, pantalla bloqueada "Solo premium".
  Personalizacion (Marketing): solo lectura + "Solo premium" si free.
  Servicios: leyenda "Solo premium" al llegar a 5; manejar 403.
  Menu: eliminar enlace Integraciones; App: quitar ruta /integraciones.
```

## Components and Interfaces

### 1. Backend: guards en branding/ads (Req 2)
- En `me.routes`, agregar `requirePremium` a: `PATCH /branding`, `POST /ads`,
  `PATCH /ads/:id`, `DELETE /ads/:id`. (GET /branding y GET /ads NO se gatean, pero
  ver punto 3.)

### 2. Backend: guards en lealtad (Req 3)
- En `loyalty.routes`, agregar `requirePremium` a TODOS los endpoints de programas:
  `GET /programs`, `POST /programs` (ya), `GET /programs/:id`, `PATCH /programs/:id`,
  `PATCH /programs/:id/active`. Las recompensas y stats se dejan como estan (o se
  gatean tambien si se decide; alcance: solo programas para no romper /me/loyalty del
  cliente que es otra ruta).

### 3. Backend: getBranding devuelve default si free (Req 5)
- `me.controller.getBranding`: cargar el premium efectivo del tenant; si NO premium,
  devolver un objeto de branding DEFAULT (logo_url:null, brand_color:null, banners
  null) en lugar de los datos guardados. Los datos NO se borran (siguen en DB); solo
  no se exponen mientras free. Al reactivar premium, getBranding vuelve a devolverlos.
- El portal publico ya oculta branding para free (sin cambios).

### 4. Backend: limite de servicios (Req 4)
- Nuevo middleware `requireServiceQuota` (analogo a requireBranchQuota, limite 5):
  si !premium y `prisma.service.count({ where:{ tenant_id } }) >= 5` -> 403
  PREMIUM_REQUIRED; premium o < 5 -> next(). Cuenta servicios del tenant.
- Aplicar en `POST /v1/services`. Nota: esa ruta usa `authMiddleware, requireAdmin`
  (no la cadena compuesta), asi que el guard debe funcionar con req.user poblado por
  authMiddleware. Insertar: `authMiddleware, requireAdmin, requireServiceQuota, create`.

### 5. Frontend: citas de hoy (Req 1)
- `Appointments.tsx`: con `usePremium()`, si !isPremium ocultar las columnas Proximas
  y Pasadas (o mostrarlas con un placeholder "Solo premium"). Mantener Hoy.
- `Dashboard.tsx`: si !isPremium, ocultar la seccion "Proximas citas" (mantener Hoy).

### 6. Frontend: Lealtad bloqueada (Req 3)
- `Lealtad.tsx`: si !isPremium, no cargar/mostrar programas; mostrar estado bloqueado
  "Solo premium" con explicacion. (El backend ya devuelve 403.)

### 7. Frontend: Personalizacion solo lectura (Req 2/5)
- `Marketing.tsx`: si !isPremium, deshabilitar inputs y el boton Guardar, con leyenda
  "Solo premium". No romper si getBranding devuelve default.

### 8. Frontend: servicios limite 5 (Req 4)
- `Services.tsx`: si !isPremium y ya hay 5, el boton crear muestra "Solo premium" y se
  deshabilita; manejar 403 PREMIUM_REQUIRED con mensaje claro.

### 9. Frontend: eliminar Integraciones (Req 6)
- `Layout.tsx`: quitar el item `/integraciones` de managementNav y de CONFIG_ONLY_ROUTES.
- `App.tsx`: quitar la ruta `/integraciones`. El componente Integraciones.tsx puede
  quedar en el repo sin ruta (o eliminarse); alcance: quitar el enlace y la ruta.

## Data Models
- Ninguno nuevo.

## Error Handling
- 403 PREMIUM_REQUIRED consistente en branding/ads/lealtad/servicios.
- Frontend mapea PREMIUM_REQUIRED a mensajes claros y muestra "Solo premium" proactivo.

## Correctness Properties

### Property 1: Free no personaliza
PATCH /me/branding y mutaciones de /me/ads devuelven 403 para free; no modifican datos.

**Validates: Requirements 2.1**

### Property 2: Branding default en free
getBranding devuelve branding default (sin logo/color/banner) cuando el tenant es free, sin borrar la DB.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 3: Lealtad bloqueada en free
Los endpoints de programas de lealtad devuelven 403 para free.

**Validates: Requirements 3.1**

### Property 4: Limite de 5 servicios
Un free con 5 servicios recibe 403 al crear el 6o; con menos de 5 puede crear; premium sin limite.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 5: Solo hoy en free
La UI de citas y dashboard oculta Proximas/Pasadas para free; premium las ve.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 6: Integraciones fuera de la UI
El menu y la navegacion no exponen /integraciones.

**Validates: Requirements 6.1, 6.2**

## Testing Strategy
1. Unit `requireServiceQuota`: free <5 -> next; free >=5 -> 403; premium -> next.
2. Unit getBranding: free -> default; premium -> datos guardados.
3. Integration: branding/ads/lealtad-programas -> 403 para free, ok para premium.
4. Frontend: verificacion manual + build. Citas/Dashboard ocultan proximas/pasadas en
   free; Lealtad bloqueada; Personalizacion solo lectura; servicios limite 5; sin
   Integraciones en el menu.
5. `tsc --noEmit` backend+frontend 0 errores; `vite build` ok; suites en verde.
