# Design Document

## Overview

Landing publica para clientes + modulo de anuncios integrados (AdSense de terceros y anuncios/marca del emprendedor) + suscripcion premium activada manualmente por el super admin. Cuando el tenant es premium efectivo, su portal por codigo muestra branding (logo/color/banner) y sus anuncios propios; si no, portal estandar y (en zonas publicas no premium) AdSense opcional.

Piezas nuevas:
- Backend: campos de suscripcion y branding en Tenant; modelo Advertisement (anuncios del emprendedor); endpoints super admin (suscripcion), emprendedor (branding + anuncios) y ampliacion del endpoint publico de info; helper isPremiumEffective.
- Frontend: pagina Landing publica en /; componentes de anuncios (AdSlot para AdSense, PromoCard para anuncios del emprendedor) integrados al diseno; seccion de personalizacion del emprendedor; panel de suscripcion en el super admin; portal por codigo que aplica branding.

Principios: la personalizacion solo surte efecto si isPremiumEffective(tenant) es true; AdSense solo si VITE_ADSENSE_CLIENT esta definido; aislamiento por tenant; anuncios etiquetados y no intrusivos.

## Architecture

### Suscripcion premium (estado efectivo)

isPremiumEffective(tenant) = tenant.subscription_status === active && (subscription_expires_at == null || subscription_expires_at > now). Un estado active con fecha vencida se considera inactivo (Req 2.3). El super admin activa (con expires_at opcional para el mes gratis) o desactiva. El flag efectivo decide si el portal muestra branding/anuncios propios.

### Flujo del portal por codigo (QR)

GET /v1/public/:code/info -> resuelve la sucursal/tenant. La respuesta incluye siempre business/branch/services; y SOLO si el tenant es premium efectivo, agrega branding { logo_url, brand_color, banner } y ads (anuncios propios activos). El BookingPortal aplica el color de marca (variable CSS local), muestra el logo y el banner arriba, y renderiza las PromoCards en una seccion Publicidad no intrusiva. Sin premium, el portal se ve estandar y puede mostrar un AdSlot de AdSense si esta configurado.

### Anuncios integrados

- AdSlot (AdSense): componente que, si existe VITE_ADSENSE_CLIENT, inyecta el script/ins de AdSense una sola vez; si no, en dev muestra un placeholder estilizado y en prod no renderiza nada. Se usa en la landing y en portales no premium. Etiqueta visible Publicidad.
- PromoCard (anuncio del emprendedor): tarjeta con imagen/titulo/texto/enlace usando tokens del diseno; etiqueta Promocion. Solo en portales premium.

## Components and Interfaces

### Backend
- Prisma Tenant: agregar subscription_status (String default inactive), subscription_expires_at (DateTime?), logo_url (String?), brand_color (String?), banner_title (String?), banner_text (String? @db.Text), banner_link (String?).
- Prisma Advertisement: id, tenant_id, title, body?(Text), image_url?, link_url?, is_active(bool), created_at, updated_at; index [tenant_id, is_active]; map ads.
- subscriptionService: getForTenant, setSubscription(tenantId, { status, expiresAt? }); isPremiumEffective(tenant). Auditado.
- brandingService: getBranding(tenantId), updateBranding(tenantId, data); ads CRUD (listAds/createAd/updateAd/deleteAd) tenant-scoped.
- publicService/controller info(): incluir branding + ads SOLO si isPremiumEffective; agregar is_premium al payload.
- Endpoints:
  - Super admin (requireSuperAdmin): GET /v1/admin/tenants/:id/subscription, PATCH /v1/admin/tenants/:id/subscription { status, expires_at? }. (O bajo /v1/admin/users si resulta mas simple resolver el tenant del emprendedor.)
  - Emprendedor (requireAdmin): GET/PATCH /v1/me/branding; GET/POST /v1/me/ads, PATCH/DELETE /v1/me/ads/:id.
  - Publico: GET /v1/public/:code/info ampliado (sin auth).

### Frontend
- Landing: nueva pagina src/pages/public/Landing.tsx en ruta /. RoleHome se conserva para autenticados; para NO autenticados la raiz muestra Landing (con CTAs a /buscar, /codigo, /login). Hero + beneficios + footer, tema-aware. Puede incluir un AdSlot discreto.
- Componentes: src/components/ads/AdSlot.tsx (AdSense por env, placeholder en dev) y src/components/ads/PromoCard.tsx (anuncio del emprendedor).
- Portal (BookingPortal): leer info.is_premium + info.branding + info.ads; aplicar brand_color a un contenedor via style, mostrar logo/banner y una seccion Publicidad con PromoCards; si no premium, opcional AdSlot.
- Emprendedor: pagina Marketing/Personalizacion (o ampliar MiCodigo) con branding + gestion de anuncios; si no es premium, mostrar aviso Requiere suscripcion y CTA. Solo ADMIN (oculto para ASSISTANT).
- Super admin: en AdminUsers, por cada emprendedor, control de suscripcion (activar/desactivar + fecha de expiracion) llamando a los endpoints admin.
- Servicios frontend: subscription.service / branding.service / ads.service; public.service ampliado con branding/ads/is_premium.

## Data Models

```prisma
// Tenant (campos agregados)
// subscription_status    String    @default("inactive") // active | inactive
// subscription_expires_at DateTime?
// logo_url      String?
// brand_color   String?
// banner_title  String?
// banner_text   String?  @db.Text
// banner_link   String?

model Advertisement {
  id         String   @id @default(cuid())
  tenant_id  String
  title      String
  body       String?  @db.Text
  image_url  String?
  link_url   String?
  is_active  Boolean  @default(true)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@index([tenant_id, is_active])
  @@map("ads")
}
```

Se aplica con prisma db push + prisma generate sobre citas_dev (detener node antes por el DLL en Windows).

## Correctness Properties

### Property 1: Premium efectivo
isPremiumEffective devuelve true solo si el estado es active y no esta vencida; un active con expires_at pasada devuelve false.

**Validates: Requirements 2.1, 2.3, 2.6**

### Property 2: Branding solo si premium
El endpoint publico de info incluye branding y anuncios propios si y solo si el tenant es premium efectivo; si no, no los expone.

**Validates: Requirements 3.3, 3.4, 5.1, 5.3**

### Property 3: Solo super admin cambia la suscripcion
Un emprendedor/colaborador no puede activar su propia suscripcion; solo requireSuperAdmin puede; los cambios se auditan.

**Validates: Requirements 2.5, 6.1**

### Property 4: Branding/anuncios aislados por tenant y solo ADMIN
La configuracion de branding/anuncios es exclusiva del ADMIN del tenant y aislada; otro tenant o un colaborador no la modifica.

**Validates: Requirements 3.5, 6.2**

### Property 5: AdSense solo con configuracion
El AdSlot inyecta scripts de AdSense solo si VITE_ADSENSE_CLIENT esta definido; sin la variable no hay scripts de terceros.

**Validates: Requirements 4.3, 4.4**

## Error Handling

- Contrato uniforme HttpError(message, status, code) -> objeto { success:false, error:{ code, message } }.
- Codigos: VALIDATION_ERROR (400) para color/urls/estado invalidos; TENANT_NOT_FOUND (404); AD_NOT_FOUND (404); FORBIDDEN (403) fuera de rol/tenant.
- El endpoint publico nunca falla por branding: si el tenant no es premium simplemente omite esos campos.
- AdSlot es defensivo: si el script de AdSense falla o no esta configurado, no rompe la pagina (muestra placeholder en dev o nada en prod).

## Testing Strategy

Unit / property-based (backend, Jest):
- Property 1: isPremiumEffective (active vigente=true; active vencida=false; inactive=false).
- Property 2: public info incluye branding/ads solo si premium; si no, ausentes.
- Property 3: setSubscription requiere super admin; auditoria; emprendedor no puede.
- Property 4: branding/ads scoped por tenant; colaborador/otro tenant -> 403/404.
- No romper suites existentes (booking, capacity, whatsapp, duplicateBooking, etc.).

Frontend: npx tsc --noEmit + npx vite build. Verificacion manual: landing publica; portal premium con logo/color/banner/promos; portal no premium estandar; AdSlot placeholder sin env; super admin activa mes gratis y el portal cambia.

Verificacion E2E manual: activar suscripcion (super admin) -> el portal del codigo muestra branding; desactivar/vencer -> vuelve a estandar; branding solo ADMIN; colaborador no ve la seccion premium.
