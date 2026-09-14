# Requirements Document

## Introduction

Este documento define una landing page publica para clientes, un modulo de anuncios integrados al diseno (AdSense de terceros y anuncios/marca del propio emprendedor), y una SUSCRIPCION premium que el super admin activa/desactiva manualmente (para regalar mes de prueba). Cuando la suscripcion del emprendedor esta activa, su portal publico (el que abre el cliente al escanear el QR) muestra su marca y anuncios personalizados; si no, se muestra el portal estandar.

Amplia el sistema existente (multi-tenant, portal publico por codigo de sucursal, super admin que administra emprendedores, ModuleFlag, tema claro/oscuro).

Decisiones de negocio tomadas:
- La suscripcion es de activacion MANUAL por el super admin (sin pasarela de cobro). Tiene estado (activa/inactiva) y una vigencia opcional (fecha de expiracion) para el mes gratis.
- AdSense se integra pero queda INACTIVO hasta definir la variable de entorno VITE_ADSENSE_CLIENT (ca-pub-...). Sin ella no se cargan scripts de terceros; en desarrollo se muestra un placeholder estilizado.
- La personalizacion PREMIUM del emprendedor incluye: logo, color de marca, un banner promocional y anuncios propios estilizados en el portal del cliente. Solo se muestra cuando la suscripcion esta ACTIVA.
- Los anuncios (AdSense y propios) deben integrarse al diseno (no intrusivos): mismas tarjetas/tokens, claramente etiquetados como Publicidad/Promocion.
- La landing es publica (no requiere login) y es la nueva puerta de entrada del cliente hacia buscar/reservar.

## Glossary

- **Landing page:** pagina publica de inicio (ruta /) orientada al cliente, con acceso a buscar sucursal / ingresar codigo / iniciar sesion.
- **Suscripcion premium:** estado por emprendedor (tenant) que habilita marca + anuncios propios en su portal. Campos: estado (active|inactive), plan?, expires_at?.
- **Personalizacion (branding):** logo_url, brand_color, banner (titulo/texto/enlace) y anuncios propios del emprendedor.
- **AdSense:** publicidad de terceros de Google, configurable por VITE_ADSENSE_CLIENT; se muestra en zonas publicas no premium.
- **Anuncio del emprendedor:** promo propia (imagen/texto/enlace) mostrada en su portal cuando la suscripcion esta activa.
- **Portal del cliente:** la vista publica por codigo (BookingPortal) que se abre al escanear el QR.

## Requirements

### Requirement 1: Landing page publica para el cliente

**User Story:** Como cliente, quiero una pagina de inicio clara y atractiva, para entender el servicio y llegar rapido a reservar.

#### Acceptance Criteria

1. THE aplicacion SHALL exponer una landing publica en la ruta raiz para visitantes NO autenticados, sin requerir login.
2. THE landing SHALL ofrecer accesos claros a: buscar sucursal por nombre, ingresar codigo de 6 caracteres, e iniciar sesion.
3. THE landing SHALL presentar seccion hero, beneficios y un pie de pagina, respetando el tema claro/oscuro y los tokens de estilo.
4. WHERE el visitante ya esta autenticado THE la raiz SHALL redirigir a su destino por rol (super admin, emprendedor/colaborador, cliente) como hoy.
5. THE landing SHALL ser responsiva y accesible (texto + contraste, no solo color).

### Requirement 2: Suscripcion premium administrada por el super admin

**User Story:** Como super admin, quiero activar o desactivar la suscripcion premium de cada emprendedor, para dar meses de prueba o habilitar el plan.

#### Acceptance Criteria

1. THE cada emprendedor (tenant) SHALL tener un estado de suscripcion premium (active|inactive, por defecto inactive) con una fecha de expiracion opcional.
2. THE super admin SHALL poder activar la suscripcion (con o sin fecha de expiracion) y desactivarla.
3. WHEN la suscripcion tiene fecha de expiracion pasada THEN SHALL considerarse INACTIVA (vencida) aunque el estado guardado sea active.
4. THE cambios de suscripcion SHALL registrarse en auditoria y respetar el aislamiento por tenant.
5. THE solo el super admin SHALL poder cambiar la suscripcion; el emprendedor NO SHALL poder auto-activarsela.
6. THE el sistema SHALL exponer si un tenant es premium (efectivo = active y no vencida) para decidir que mostrar en el portal.

### Requirement 3: Personalizacion (branding) del emprendedor (premium)

**User Story:** Como emprendedor con suscripcion activa, quiero personalizar mi portal con mi marca y una promo, para que el cliente vea mi identidad al escanear el QR.

#### Acceptance Criteria

1. THE emprendedor SHALL poder configurar: logo (url), color de marca, y un banner promocional (titulo, texto, enlace opcional).
2. THE emprendedor SHALL poder registrar anuncios/promos propios (titulo, texto, imagen url opcional, enlace opcional, activo).
3. WHERE la suscripcion del tenant esta ACTIVA THE el portal publico del cliente SHALL mostrar el logo, color de marca, banner y anuncios propios activos.
4. WHERE la suscripcion esta INACTIVA THE el portal SHALL mostrarse estandar (sin branding ni anuncios propios), aunque los datos de branding sigan guardados.
5. THE la configuracion de branding/anuncios SHALL ser exclusiva del emprendedor (ADMIN) y aislada por tenant; el colaborador (ASSISTANT) NO la configura.
6. WHERE la suscripcion esta inactiva y el emprendedor entra a la seccion premium THE la interfaz SHALL indicar que requiere suscripcion (sin permitir que surta efecto en el portal).

### Requirement 4: Anuncios integrados al diseno (no intrusivos)

**User Story:** Como usuario, quiero que los anuncios se integren visualmente, para que no sean molestos.

#### Acceptance Criteria

1. THE los anuncios (propios del emprendedor y de AdSense) SHALL usar las tarjetas/tokens del diseno y estar claramente etiquetados como Publicidad o Promocion.
2. THE los anuncios NO SHALL bloquear el flujo de reserva ni usar modales intrusivos; se ubican en secciones dedicadas.
3. THE AdSense SHALL cargarse solo si VITE_ADSENSE_CLIENT esta definido; sin la variable, no se inyectan scripts de terceros.
4. WHERE AdSense no esta configurado y el entorno es desarrollo THE SHALL mostrarse un placeholder estilizado (marcador de anuncio) en lugar del anuncio real.
5. THE en el portal de un emprendedor PREMIUM SHALL priorizarse sus anuncios propios; AdSense se reserva para la landing y portales no premium.

### Requirement 5: Integracion con QR y portal por codigo

**User Story:** Como cliente, al escanear el QR de un negocio premium, quiero ver su marca, para reconocer que es el negocio correcto.

#### Acceptance Criteria

1. WHEN el cliente abre el portal por codigo (QR) de un tenant PREMIUM THEN el portal SHALL renderizar el branding (logo, color, banner) y sus anuncios propios activos.
2. THE la respuesta publica de info del portal SHALL incluir los datos de branding y el flag premium efectivo, sin exponer datos sensibles.
3. WHERE el tenant NO es premium THE la respuesta publica NO SHALL incluir branding/anuncios (o el portal los ignora).
4. THE el flujo de reserva (categorias, fecha, slots, confirmar) SHALL seguir funcionando igual con o sin branding.

### Requirement 6: Roles, aislamiento y consistencia

**User Story:** Como responsable del sistema, quiero que estas funciones respeten roles y aislamiento.

#### Acceptance Criteria

1. THE la suscripcion SHALL cambiarla unicamente el super admin (requireSuperAdmin).
2. THE branding/anuncios del emprendedor SHALL configurarlos solo el ADMIN de ese tenant (requireAdmin), aislado por tenant.
3. THE los endpoints publicos SHALL exponer branding/anuncios solo cuando el tenant sea premium efectivo.
4. THE todas las escrituras (suscripcion, branding, anuncios) SHALL registrarse en auditoria.
5. THE los cambios NO SHALL romper el portal, la busqueda ni el flujo de reserva existentes.
