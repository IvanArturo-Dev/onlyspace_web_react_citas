# Requirements Document

## Introduction

Dos funcionalidades: (1) un CARRUSEL de banners animado en el landing publico que
rota los banners de los negocios PREMIUM (los que pagan), y (2) un modo de SOPORTE
del super admin ("actuar como") que le permite operar CUALQUIER negocio como si fuera
su dueno (crear/editar/eliminar sucursales, servicios, citas, branding, lealtad), para
dar soporte a los emprendedores. El super admin es el "gran patriarca": puede
administrar todo.

Decisiones de producto (confirmadas con el usuario):
1. El carrusel muestra banners de negocios PREMIUM (banner_title, banner_text,
   brand_color, logo). Rota automaticamente y cada slide enlaza a reservar en ese
   negocio. Solo premium (coherente con premium-gating-v2).
2. El super admin usa IMPERSONACION ("Actuar como"): elige un negocio y obtiene un
   contexto de ese tenant que reutiliza TODAS las pantallas/endpoints del emprendedor.
3. Mientras impersona, el super admin tiene contexto completo de emprendedor y SALTA el
   gating premium (puede gestionar todo aunque el negocio sea free), porque es soporte.
4. Toda accion durante la impersonacion queda AUDITADA como realizada por el super
   admin (se registra quien impersona).
5. La UI muestra un banner persistente "Actuando como: <negocio>" con boton para salir.

## Glossary

- **Super admin (patriarca)**: rol SUPERADMIN; puede administrar toda la plataforma.
- **Impersonacion / actuar como**: el super admin opera en el contexto de un tenant
  objetivo, con permisos de ADMIN de ese negocio.
- **Token de impersonacion**: JWT de corta duracion con role=ADMIN, tenant_id=objetivo
  y un claim `impersonated_by`=userId del super admin (para auditoria).
- **Banner premium**: personalizacion de marca (banner_title/text, brand_color, logo)
  de un negocio premium.
- **Carrusel**: componente animado que rota banners premium en el landing.

## Requirements

### Requirement 1: Carrusel de banners premium en el landing

**User Story:** Como visitante, quiero ver un carrusel atractivo con los negocios
destacados, para descubrirlos y reservar rapido.

#### Acceptance Criteria

1. EL landing DEBERA mostrar un carrusel que rota automaticamente los banners de
   negocios PREMIUM (con banner configurado).
2. CADA slide DEBERA mostrar la marca del negocio (banner_title/text, brand_color,
   logo) y enlazar a reservar en su sucursal principal (`/reservar/<code>`).
3. EL carrusel DEBERA ser animado (transicion entre slides), pausar al pasar el cursor
   o al enfocar, y permitir navegacion manual (anterior/siguiente, indicadores).
4. SOLO negocios PREMIUM con banner aparecen en el carrusel; los free no.
5. SI no hay banners premium ENTONCES el carrusel no se muestra (sin hueco vacio).
6. EL carrusel DEBERA ser accesible (controles con teclado, aria-labels, respeta
   prefers-reduced-motion) y responsive.

### Requirement 2: Backend expone datos del carrusel

**User Story:** Como frontend, necesito una fuente de banners premium para el carrusel.

#### Acceptance Criteria

1. EL backend DEBERA exponer los banners premium para el carrusel, ya sea via el
   endpoint de descubrimiento existente (items premium con branding) o un endpoint
   dedicado publico.
2. LOS datos DEBERAN incluir lo necesario para el slide: nombre, banner_title,
   banner_text, brand_color, logo_url y el code de reserva de la sucursal principal.
3. NO DEBERA exponer datos sensibles ni banners de negocios free.

### Requirement 3: Iniciar/terminar impersonacion (super admin)

**User Story:** Como super admin, quiero "actuar como" un negocio para darle soporte.

#### Acceptance Criteria

1. EL super admin DEBERA poder iniciar impersonacion de un tenant: el backend emite un
   token de impersonacion (role=ADMIN, tenant_id=objetivo, impersonated_by=super admin,
   corta duracion). Endpoint SUPERADMIN-only.
2. CON ese token, el super admin DEBERA poder usar los endpoints del emprendedor del
   tenant objetivo (gestion de sucursales, servicios, citas, branding, lealtad).
3. EL super admin DEBERA poder terminar la impersonacion y volver a su contexto normal.
4. UN token de impersonacion SOLO lo puede emitir un SUPERADMIN; ningun otro rol.
5. INICIAR y TERMINAR impersonacion DEBERAN auditarse (quien, sobre que tenant).

### Requirement 4: Poder total durante la impersonacion (salta gating)

**User Story:** Como super admin en soporte, quiero gestionar todo del negocio aunque
sea free, para resolver cualquier problema.

#### Acceptance Criteria

1. DURANTE la impersonacion, las operaciones gateadas por premium (crear 2a sucursal,
   branding/ads, lealtad, gestionar sucursal extra, etc.) DEBERAN permitirse aunque el
   tenant objetivo sea free (el guard premium reconoce el token de impersonacion).
2. LAS operaciones DEBERAN seguir acotadas al tenant objetivo (no puede tocar OTRO
   tenant con el mismo token).
3. CADA operacion realizada durante la impersonacion DEBERA quedar auditada indicando
   el super admin que la ejecuto (impersonated_by).

### Requirement 5: UI de soporte del super admin

**User Story:** Como super admin, quiero una UI clara para elegir un negocio, actuar
como el, y saber en todo momento que estoy impersonando.

#### Acceptance Criteria

1. EL panel del super admin DEBERA listar los negocios (tenants) y ofrecer "Actuar
   como" en cada uno.
2. AL activar, la app DEBERA guardar el token de impersonacion y entrar al area de
   gestion del emprendedor con el contexto del tenant objetivo.
3. UN banner persistente DEBERA indicar "Actuando como: <negocio>" con un boton
   "Salir" que termina la impersonacion y restaura el contexto del super admin.
4. AL salir, el super admin DEBERA volver a su panel /admin con su sesion original.

### Requirement 6: No regresion y seguridad

**User Story:** Como plataforma, quiero que esto no rompa nada ni abra huecos de
seguridad.

#### Acceptance Criteria

1. SOLo un SUPERADMIN puede emitir un token de impersonacion; un usuario normal no
   puede fabricarse permisos de otro tenant (la emision valida el rol firmado).
2. EL token de impersonacion DEBERA ser de corta duracion y distinguible (claim
   impersonated_by) para auditoria.
3. LAS pantallas y flujos existentes (cliente, emprendedor, super admin) DEBERAN
   seguir funcionando.
4. EL sistema DEBERA compilar (tsc backend/frontend) y construir (vite build); las
   suites existentes DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
