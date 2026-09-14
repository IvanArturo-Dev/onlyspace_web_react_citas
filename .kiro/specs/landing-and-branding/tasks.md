# Implementation Plan

## Overview

Plan para landing publica, suscripcion premium (activada por super admin), personalizacion (branding + anuncios) del emprendedor que solo surte efecto si es premium, anuncios integrados (AdSense por env + PromoCards propias) y portal por codigo que aplica el branding. Se construye sobre el portal publico, el super admin y el tema existentes.

Estrategia incremental:
1. Esquema (suscripcion + branding en Tenant, modelo Advertisement).
2. Backend suscripcion (super admin) + isPremiumEffective + pruebas.
3. Backend branding + anuncios (emprendedor) + info publico ampliado + pruebas.
4. Frontend landing + componentes de anuncios (AdSlot/PromoCard).
5. Frontend personalizacion del emprendedor + control de suscripcion en super admin.
6. Frontend portal por codigo con branding.
7. Verificacion end-to-end.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["2.1", "3.1", "4"] },
    { "wave": 4, "tasks": ["5", "6"] },
    { "wave": 5, "tasks": ["7"] }
  ],
  "dependencies": {
    "2": ["1"],
    "2.1": ["2"],
    "3": ["1"],
    "3.1": ["3"],
    "4": ["1"],
    "5": ["2", "3"],
    "6": ["3", "4"],
    "7": ["5", "6"]
  }
}
```

## Tasks

- [x] 1. Esquema: suscripcion, branding y modelo Advertisement
  - En backend/prisma/schema.prisma: agregar a Tenant: subscription_status (String default "inactive"), subscription_expires_at (DateTime?), logo_url (String?), brand_color (String?), banner_title (String?), banner_text (String? @db.Text), banner_link (String?)
  - Crear modelo Advertisement (tenant_id, title, body? Text, image_url?, link_url?, is_active default true, timestamps, index [tenant_id, is_active], map "ads")
  - Aplicar con prisma db push + prisma generate sobre citas_dev
  - _Requirements: 2.1, 3.1, 3.2_

- [x] 2. Backend: suscripcion (super admin) + isPremiumEffective
  - subscriptionService: getForTenant(tenantId); setSubscription(tenantId, { status, expiresAt? }) auditado; isPremiumEffective(tenant) (active && no vencida)
  - Endpoints requireSuperAdmin: GET /v1/admin/tenants/:id/subscription, PATCH /v1/admin/tenants/:id/subscription { status, expires_at? }
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1_

- [x] 2.1 Pruebas de suscripcion (Property 1, 3)
  - isPremiumEffective (active vigente=true; active vencida=false; inactive=false); setSubscription solo super admin y auditado; emprendedor no puede
  - _Requirements: 2.1, 2.3, 2.5_
  - _Properties: Property 1 (premium efectivo), Property 3 (solo super admin)_

- [x] 3. Backend: branding + anuncios del emprendedor + info publico ampliado
  - brandingService: getBranding/updateBranding (tenant-scoped, ADMIN); ads CRUD (listAds/createAd/updateAd/deleteAd) tenant-scoped
  - Endpoints requireAdmin: GET/PATCH /v1/me/branding; GET/POST /v1/me/ads; PATCH/DELETE /v1/me/ads/:id
  - Ampliar GET /v1/public/:code/info: incluir is_premium y, SOLO si premium efectivo, branding { logo_url, brand_color, banner } y ads (activos)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 6.2, 6.3_

- [x] 3.1 Pruebas de branding/publico (Property 2, 4)
  - info incluye branding/ads solo si premium efectivo; ausentes si no; branding/ads scoped por tenant y solo ADMIN (colaborador/otro tenant -> 403/404)
  - _Requirements: 3.3, 3.4, 5.1, 5.3, 6.2_
  - _Properties: Property 2 (branding solo si premium), Property 4 (aislamiento y solo ADMIN)_

- [x] 4. Frontend: landing publica + componentes de anuncios
  - Pagina src/pages/public/Landing.tsx en ruta / para NO autenticados (hero, beneficios, footer, CTAs a /buscar, /codigo, /login), tema-aware y responsiva; autenticados siguen redirigidos por rol
  - Componentes src/components/ads/AdSlot.tsx (AdSense si VITE_ADSENSE_CLIENT; placeholder estilizado en dev; nada en prod sin env) y src/components/ads/PromoCard.tsx (anuncio del emprendedor, etiqueta Promocion)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4_

- [x] 5. Frontend: personalizacion del emprendedor + suscripcion en super admin
  - Emprendedor (ADMIN): seccion de personalizacion (branding: logo/color/banner + anuncios CRUD); si no es premium, aviso Requiere suscripcion; ocultar para ASSISTANT
  - Super admin: en AdminUsers, control por emprendedor para activar/desactivar suscripcion y fijar fecha de expiracion (mes gratis)
  - Servicios frontend: subscription.service, branding.service, ads.service
  - _Requirements: 2.2, 3.1, 3.2, 3.6, 6.2_

- [x] 6. Frontend: portal por codigo con branding + anuncios
  - BookingPortal aplica info.is_premium: si premium, muestra logo, aplica brand_color (variable local), banner y seccion Publicidad con PromoCards; si no, portal estandar y AdSlot opcional
  - public.service ampliado con is_premium/branding/ads
  - _Requirements: 4.1, 4.2, 4.5, 5.1, 5.4_

- [x] 7. Verificacion end-to-end
  - Super admin activa suscripcion (con y sin fecha) -> el portal del codigo muestra branding + promos; desactivar o vencer -> vuelve a estandar
  - Branding/anuncios solo ADMIN (colaborador no ve la seccion; otro tenant no accede); info publico expone branding solo si premium
  - Landing publica visible sin login con CTAs; AdSlot muestra placeholder sin env
  - _Requirements: 1.1, 2.2, 2.3, 3.3, 4.3, 5.1, 6.1_

## Notes

- La suscripcion es manual (super admin), sin pasarela; expires_at permite el mes gratis y el vencimiento automatico via isPremiumEffective.
- El branding solo surte efecto en el portal si el tenant es premium efectivo; los datos se guardan igual aunque este inactivo.
- AdSense solo se activa con VITE_ADSENSE_CLIENT; sin la variable no se cargan scripts de terceros.
- Anuncios etiquetados (Publicidad/Promocion) e integrados al diseno; sin modales intrusivos.
- Aplicar cambios de esquema con prisma db push en citas_dev; detener node antes por el DLL en Windows.
- Subtareas con _Properties: son candidatas a pruebas basadas en propiedades.
