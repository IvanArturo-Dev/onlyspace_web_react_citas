# Requirements Document

## Introduction

Gating de funciones premium para el emprendedor (ADMIN). La suscripcion premium ya
existe (super admin la administra; `isPremiumEffective` deriva el estado). Hoy el
premium solo controla el branding/ads del PORTAL PUBLICO. Este spec aplica el gating a
las capacidades internas y comunica el estado al emprendedor.

Reglas (confirmadas):
- Plan FREE (no premium): 1 sucursal, 0 colaboradores, 0 programas de lealtad,
  personalizacion DEFAULT (sin marca propia en el portal ni en anuncios).
- Plan PREMIUM: multiples sucursales, colaboradores, programas de lealtad, marca
  propia en el portal/anuncios, y un badge "Premium" visible en la parte superior.
- Ver proximas y anteriores citas es para TODOS (no se gatea).
- Al PERDER premium (vencer o desactivar): NO se borra nada de lo ya creado; solo se
  bloquea crear nuevo y se muestra la leyenda "solo premium". Lo existente sigue
  visible y funcional (salvo el branding del portal publico, que ya cae a default por
  el gating existente).

Estado actual relevante:
- `subscription.service.isPremiumEffective(tenant)` y `branding.service.isPremiumEffective`.
- `POST /v1/branches`, `POST /v1/assistants`, `POST /v1/loyalty/programs` existen con requireAdmin.
- `GET /v1/me/tenant` (meController.getTenant) NO devuelve is_premium.
- El portal publico ya oculta branding/ads si el tenant no es premium.

## Glossary

- **Premium efectivo**: subscription_status = active Y (sin expiracion O expiracion futura).
- **requirePremium**: middleware que exige premium efectivo del tenant; si no, 403 PREMIUM_REQUIRED.
- **Free**: tenant no premium.
- **Solo premium**: leyenda/estado que marca una funcion bloqueada para free.

## Requirements

### Requirement 1: Exponer el estado premium al emprendedor

**User Story:** Como emprendedor, quiero saber si mi cuenta es premium, para entender
que funciones tengo disponibles.

#### Acceptance Criteria

1. `GET /v1/me/tenant` DEBERA incluir `is_premium: boolean` (premium efectivo del tenant).
2. EL frontend del emprendedor DEBERA mostrar un badge "Premium" en la parte superior
   (dashboard/encabezado) cuando is_premium es true.
3. CUANDO is_premium es false EL frontend DEBERA mostrar las funciones premium con una
   leyenda "Solo premium" (deshabilitadas o con aviso), sin ocultarlas por completo.

### Requirement 2: Gating de sucursales

**User Story:** Como sistema, quiero permitir mas de una sucursal solo a premium.

#### Acceptance Criteria

1. CUANDO un tenant FREE ya tiene 1 sucursal e intenta crear otra ENTONCES el backend
   DEBERA responder 403 PREMIUM_REQUIRED sin crearla.
2. UN tenant FREE con 0 sucursales SI DEBERA poder crear su primera sucursal.
3. UN tenant PREMIUM DEBERA poder crear sucursales sin ese limite.
4. EL frontend DEBERA mostrar "Solo premium" en el boton/accion de agregar sucursal
   cuando el free ya tiene una.

### Requirement 3: Gating de colaboradores

**User Story:** Como sistema, quiero permitir colaboradores solo a premium.

#### Acceptance Criteria

1. CUANDO un tenant FREE intenta invitar/crear un colaborador ENTONCES el backend
   DEBERA responder 403 PREMIUM_REQUIRED sin crearlo.
2. UN tenant PREMIUM DEBERA poder invitar colaboradores.
3. EL frontend DEBERA marcar la accion de agregar colaborador como "Solo premium" para free.

### Requirement 4: Gating de programas de lealtad

**User Story:** Como sistema, quiero permitir crear programas de lealtad solo a premium.

#### Acceptance Criteria

1. CUANDO un tenant FREE intenta crear un programa de lealtad ENTONCES el backend
   DEBERA responder 403 PREMIUM_REQUIRED sin crearlo.
2. UN tenant PREMIUM DEBERA poder crear programas de lealtad.
3. EL frontend DEBERA marcar la creacion de programas como "Solo premium" para free.

### Requirement 5: Personalizacion default para free

**User Story:** Como sistema, quiero que un free use la personalizacion default.

#### Acceptance Criteria

1. CUANDO un tenant NO es premium ENTONCES el portal publico DEBERA mostrar la
   personalizacion DEFAULT (sin logo/color/banner propios ni anuncios propios). Este
   comportamiento ya existe y DEBERA preservarse.
2. LA seccion de personalizacion/anuncios del panel DEBERA indicar "Solo premium"
   cuando el tenant es free (puede permitir editar y guardar, pero avisando que no se
   mostrara al cliente hasta ser premium), sin borrar datos.
3. AL recuperar premium, la personalizacion previamente guardada DEBERA volver a surtir
   efecto en el portal (sin re-capturar).

### Requirement 6: Conservacion al perder premium + no regresion

**User Story:** Como emprendedor, no quiero perder lo que ya cree si mi premium vence.

#### Acceptance Criteria

1. AL perder premium, las sucursales, colaboradores y programas ya existentes NO
   DEBERAN borrarse ni desactivarse; solo se bloquea crear NUEVOS.
2. VER proximas y anteriores citas DEBERA seguir disponible para todos (free y premium).
3. EL guard premium DEBERA basarse en el premium efectivo (active + no vencido) del
   tenant del JWT (aislamiento por tenant).
4. EL sistema DEBERA compilar (tsc) y construir (vite build); las suites existentes
   DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
