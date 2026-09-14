# Implementation Plan

## Overview

Endurece el gating premium (branding/ads, lealtad, limite 5 servicios, solo citas de
hoy, personalizacion default en free) y elimina Integraciones de la UI. Reutiliza
requirePremium y el patron de requireBranchQuota.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] }
  ]
}
```

## Tasks

- [ ] 1. Backend: guards de branding/ads/lealtad + getBranding default + limite servicios
  - `me.routes`: agregar `requirePremium` a PATCH /branding, POST /ads, PATCH /ads/:id, DELETE /ads/:id.
  - `loyalty.routes`: agregar `requirePremium` a GET /programs, GET /programs/:id, PATCH /programs/:id, PATCH /programs/:id/active (POST /programs ya lo tiene).
  - `me.controller.getBranding`: si el tenant NO es premium, devolver branding DEFAULT (logo_url/brand_color/banner_* en null) sin borrar DB; si premium, datos guardados. (Reutiliza isPremiumEffective + prisma.tenant.)
  - Nuevo `backend/src/middleware/requireServiceQuota.ts` (limite 5, patron de requireBranchQuota; cuenta prisma.service por tenant). Aplicar en `POST /v1/services` (service.routes usa authMiddleware+requireAdmin): `authMiddleware, requireAdmin, requireServiceQuota, serviceController.create`.
  - Pruebas unitarias: requireServiceQuota (free <5 next / >=5 403 / premium next); getBranding (free default / premium datos).
  - `tsc --noEmit` backend + jest de los tests nuevos/afectados en verde.
  - _Requirements: 2.1, 3.1, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 7.1_

- [ ] 2. Backend (integration) + no regresion
  - Extender el test de integracion de premium (premiumGating.routes.integration): free -> 403 en PATCH /me/branding, POST /me/ads, GET /loyalty/programs, POST /services (con service.count>=5); premium -> no 403. free con <5 servicios -> crea.
  - Ajustar cualquier test existente que ahora choque con el gating (mockear tenant premium donde el test asuma acceso), SIN cambiar logica.
  - `tsc` + `jest --testPathPattern="branch|assistant|loyalty|premium|service|me|branding" --runInBand` en verde (salvo fallos preexistentes ajenos).
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 3. Frontend: citas de hoy, lealtad bloqueada, personalizacion solo lectura, limite servicios, quitar Integraciones
  - `Appointments.tsx`: con usePremium(), si !isPremium ocultar columnas Proximas y Pasadas (mantener Hoy).
  - `Dashboard.tsx`: si !isPremium ocultar la seccion Proximas citas (mantener Hoy).
  - `Lealtad.tsx`: si !isPremium, no listar programas; mostrar estado bloqueado "Solo premium".
  - `Marketing.tsx`: si !isPremium, inputs y Guardar deshabilitados + leyenda "Solo premium"; tolerar branding default.
  - `Services.tsx`: si !isPremium y ya hay 5 servicios, boton crear "Solo premium" deshabilitado + manejar 403 PREMIUM_REQUIRED.
  - `Layout.tsx`: quitar item /integraciones de managementNav y de CONFIG_ONLY_ROUTES.
  - `App.tsx`: quitar la ruta /integraciones (y el import si queda sin uso).
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 3.2, 4.4, 6.1, 6.2_

## Notes
- Reutiliza requirePremium (ya existe) y el patron de requireBranchQuota para requireServiceQuota.
- No borrar branding en DB; getBranding solo lo oculta mientras free.
- Integraciones: solo se quita de la UI (enlace + ruta); backend Google intacto.
- El estado premium del frontend se cachea (usePremium); recargar tras cambiar suscripcion.
