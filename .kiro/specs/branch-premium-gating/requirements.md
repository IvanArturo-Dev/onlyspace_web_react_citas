# Requirements Document

## Introduction

Extiende el gating premium a las SUCURSALES. Hoy `premium-gating`/`premium-gating-v2`
solo bloquean CREAR una segunda sucursal (free: max 1), pero al perder premium las
sucursales extra siguen visibles y operables, y sus enlaces publicos siguen activos.
Esta spec cierra ese hueco: un tenant FREE debe operar SOLO sobre su sucursal
principal; las sucursales extra quedan ocultas (no borradas) y su reserva publica se
bloquea, hasta que reactive premium.

Reglas nuevas (confirmadas con el usuario):
1. Siempre existe una sucursal PRINCIPAL. Es la mas antigua del tenant (la que se
   creo como "Principal"). No se agrega campo nuevo; se deriva por created_at asc.
2. Un tenant PREMIUM gestiona multiples sucursales (como hoy).
3. Un tenant FREE solo puede dar seguimiento/gestionar la sucursal principal.
4. Un tenant FREE: las sucursales extra quedan OCULTAS al emprendedor y NO visibles
   para clientes (reserva publica bloqueada), hasta reactivar la suscripcion.
5. Las citas existentes de sucursales extra NO se borran; el emprendedor puede darles
   seguimiento. Solo se bloquea agendar nuevas en esas sucursales mientras es free.
6. Al reactivar premium, todas las sucursales y sus enlaces publicos vuelven a
   aparecer sin recapturar nada.

## Glossary

- **Premium efectivo**: subscription_status=active y no vencido (isPremiumEffective).
- **Free**: tenant no premium.
- **Sucursal principal**: la sucursal mas antigua del tenant (menor created_at). Es la
  unica gestionable/reservable mientras el tenant es free.
- **Sucursal extra**: cualquier sucursal del tenant que no sea la principal.
- **PREMIUM_REQUIRED**: codigo 403 que devuelven los endpoints gateados.
- **Reserva publica**: flujo del cliente en `/reservar/<booking_code>` (por sucursal).

## Requirements

### Requirement 1: Sucursal principal siempre determinable

**User Story:** Como sistema, quiero identificar de forma estable la sucursal principal
de un tenant, para saber cual sigue activa cuando pierde premium.

#### Acceptance Criteria

1. EL sistema DEBERA considerar principal a la sucursal del tenant con menor
   created_at (la primera creada, tipicamente "Principal").
2. CUANDO un tenant tiene una sola sucursal ENTONCES esa es la principal.
3. LA determinacion de principal DEBERA ser consistente en backend (gestion y reserva
   publica) usando el mismo criterio (created_at asc).

### Requirement 2: Free solo gestiona la sucursal principal

**User Story:** Como emprendedor free, solo debo poder ver y gestionar mi sucursal
principal, no las extra que cree cuando era premium.

#### Acceptance Criteria

1. CUANDO un tenant FREE lista sus sucursales (`GET /branches`) ENTONCES la respuesta
   DEBERA incluir SOLO la sucursal principal.
2. CUANDO un tenant FREE intenta ver/editar una sucursal extra (`GET/PATCH
   /branches/:id` de una extra) ENTONCES el backend DEBERA responder 403
   PREMIUM_REQUIRED (o 404) sin modificar datos.
3. CUANDO un tenant FREE intenta crear una sucursal ENTONCES sigue aplicando el limite
   existente (403 PREMIUM_REQUIRED si ya tiene >=1).
4. UN tenant PREMIUM DEBERA ver y gestionar todas sus sucursales como hoy.

### Requirement 3: Reserva publica de sucursales extra bloqueada en free

**User Story:** Como cliente, no debo poder reservar en una sucursal extra de un
negocio que ya no es premium; solo en su principal.

#### Acceptance Criteria

1. CUANDO se resuelve un booking_code de una sucursal EXTRA cuyo tenant es FREE
   ENTONCES el backend DEBERA responder 404 INVALID_CODE (como si no estuviera
   disponible), sin exponer la sucursal.
2. CUANDO se resuelve el booking_code de la sucursal PRINCIPAL de un tenant FREE
   ENTONCES DEBERA funcionar normalmente.
3. CUANDO se listan las sucursales reservables de un negocio FREE ENTONCES DEBERA
   incluirse SOLO la principal.
4. UN tenant PREMIUM DEBERA exponer todas sus sucursales activas a reserva publica.

### Requirement 4: Conservacion de citas y datos de sucursales extra

**User Story:** Como emprendedor, al perder premium no quiero perder las citas ni las
sucursales extra; solo que queden en pausa.

#### Acceptance Criteria

1. AL pasar a free, las sucursales extra y sus citas NO DEBERAN borrarse.
2. LAS citas existentes de sucursales extra DEBERAN seguir consultables por el
   emprendedor (seguimiento), aunque la sucursal no aparezca en la gestion de
   sucursales.
3. NO DEBERA poderse crear una nueva cita asociada a una sucursal extra mientras el
   tenant es free.
4. AL reactivar premium, sucursales extra y su reserva publica DEBERAN volver a
   aparecer sin recapturar.

### Requirement 5: Frontend refleja el gating de sucursales

**User Story:** Como emprendedor free, la UI debe mostrarme solo la principal y marcar
claramente que agregar/gestionar mas sucursales es premium.

#### Acceptance Criteria

1. LA pantalla de sucursales del emprendedor FREE DEBERA listar solo la principal y
   mostrar leyenda "Solo premium" para gestionar mas.
2. EL frontend DEBERA manejar el 403 PREMIUM_REQUIRED de los endpoints de sucursal sin
   romperse (mensaje claro).
3. UN tenant PREMIUM DEBERA ver la gestion de multiples sucursales como hoy.

### Requirement 6: No regresion

**User Story:** Como usuario, quiero que el resto siga funcionando.

#### Acceptance Criteria

1. LOS guards/filtros se basan en el premium EFECTIVO del tenant (aislamiento por
   tenant; nunca se filtran sucursales de otro tenant).
2. AL perder premium no se borra nada; solo se oculta/bloquea el uso premium.
3. EL sistema DEBERA compilar (tsc backend y frontend) y construir (vite build); las
   suites existentes DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
