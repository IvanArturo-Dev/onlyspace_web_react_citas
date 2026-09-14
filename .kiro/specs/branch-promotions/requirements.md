# Requirements Document

## Introduction

Modulo de PROMOCIONES por SUCURSAL: el emprendedor premium crea promociones
informativas (titulo, descripcion, imagen opcional, vigencia desde/hasta, activa) por
cada sucursal. Al cliente se le muestran las promociones ACTIVAS y VIGENTES (dentro de
fechas) en el portal de reserva de la sucursal y en su tarjeta del descubrimiento. Es
informativo: sin logica de precios, descuentos ni codigos. Coherente con el gating
premium existente (free no puede crear/gestionar).

Decisiones de producto (confirmadas con el usuario):
1. Promocion = { title, description?, image_url?, starts_at?, ends_at?, is_active } por
   sucursal (branch_id). Solo informativa.
2. Crear/editar/eliminar es PREMIUM-only (free -> 403 PREMIUM_REQUIRED), como el resto
   del gating. Bajo impersonacion del super admin se puede gestionar aunque sea free.
3. El cliente ve SOLO promociones activas y vigentes: is_active=true y (starts_at nulo o
   <= ahora) y (ends_at nulo o >= ahora).
4. Visible en el portal publico de la sucursal (`/public/:code/info`) y en la tarjeta
   del negocio en el descubrimiento (`/public/discover`).

## Glossary

- **Promocion**: aviso informativo de una sucursal (title/description/image/vigencia).
- **Vigente**: is_active=true y la fecha actual esta dentro de [starts_at, ends_at]
  (limites nulos = sin restriccion por ese lado).
- **Premium efectivo**: subscription active y no vencida (isPremiumEffective).
- **Sucursal**: Branch del tenant; las promos se asocian por branch_id.

## Requirements

### Requirement 1: Modelo y CRUD de promociones por sucursal (emprendedor)

**User Story:** Como emprendedor, quiero crear y gestionar promociones de cada sucursal,
para comunicar ofertas a mis clientes.

#### Acceptance Criteria

1. EL emprendedor DEBERA poder listar, crear, editar y eliminar promociones de una
   sucursal propia (scoped por tenant y branch).
2. UNA promocion DEBERA tener title (requerido), description (opcional), image_url
   (opcional), starts_at (opcional), ends_at (opcional) e is_active (default true).
3. CREAR con title vacio DEBERA responder 400 VALIDATION_ERROR.
4. SI ends_at y starts_at se proveen y ends_at < starts_at ENTONCES 400 VALIDATION_ERROR.
5. TODA operacion DEBERA validar que la sucursal pertenece al tenant (404 si no) y estar
   aislada por tenant.

### Requirement 2: Gating premium

**User Story:** Como sistema, quiero que las promociones sean una funcion premium.

#### Acceptance Criteria

1. CUANDO un tenant FREE intenta crear/editar/eliminar una promocion ENTONCES el backend
   DEBERA responder 403 PREMIUM_REQUIRED sin modificar datos.
2. UN tenant PREMIUM DEBERA poder gestionar promociones sin restriccion.
3. BAJO impersonacion del super admin (claim impersonated_by) el gating se salta (soporte).
4. LISTAR promociones (gestion) para un free NO expone datos de otros tenants; si se
   decide permitir listar en free sin poder crear, DEBERA seguir aislado por tenant.

### Requirement 3: Exposicion publica al cliente

**User Story:** Como cliente, quiero ver las promociones vigentes de una sucursal.

#### Acceptance Criteria

1. `GET /public/:code/info` DEBERA incluir las promociones ACTIVAS y VIGENTES de la
   sucursal (title, description, image_url, starts_at, ends_at), solo si el negocio es
   premium efectivo.
2. `GET /public/discover` DEBERA incluir, por negocio premium, sus promociones vigentes
   de la sucursal principal (o al menos un indicador/lista breve), sin datos sensibles.
3. UNA promocion NO vigente (inactiva o fuera de fechas) NO DEBERA mostrarse al cliente.
4. NEGOCIOS free NO exponen promociones al cliente.

### Requirement 4: Frontend del emprendedor

**User Story:** Como emprendedor, quiero una pantalla para gestionar las promociones de
mis sucursales.

#### Acceptance Criteria

1. EL emprendedor premium DEBERA poder ver la lista de promociones de una sucursal y
   crear/editar/eliminar con un formulario (title, description, image_url, fechas,
   activa).
2. UN free DEBERA ver la seccion con leyenda 'Solo premium' y manejar el 403 sin romperse.
3. LA UI DEBERA indicar el estado (activa/inactiva, vigente/expirada) de cada promocion.

### Requirement 5: Frontend del cliente

**User Story:** Como cliente, quiero ver las promociones vigentes al reservar o explorar.

#### Acceptance Criteria

1. EL portal de reserva de la sucursal DEBERA mostrar las promociones vigentes recibidas
   de `/public/:code/info`.
2. LA tarjeta del negocio en el descubrimiento PUEDE mostrar un indicador de promociones
   vigentes (p.ej. 'Promos' o el titulo de una).
3. SI no hay promociones vigentes NO se muestra nada (sin hueco).

### Requirement 6: No regresion y aislamiento

**User Story:** Como usuario, quiero que el resto siga funcionando y sin fugas.

#### Acceptance Criteria

1. TODAS las operaciones estan scoped por tenant y sucursal; nunca se exponen promos de
   otro tenant.
2. LAS rutas y flujos existentes DEBERAN seguir funcionando.
3. EL sistema DEBERA compilar (tsc backend/frontend) y construir (vite build); las suites
   existentes DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
