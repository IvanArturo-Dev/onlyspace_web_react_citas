# Requirements Document

## Introduction

Endurece y amplia el gating premium del emprendedor, y elimina la seccion de
Integraciones. Continua el trabajo de `premium-gating` (que ya bloquea crear 2a
sucursal, colaboradores y programas de lealtad). El backend ya expone
`GET /me/tenant.is_premium` y tiene el middleware `requirePremium`.

Reglas nuevas (confirmadas):
1. Un tenant FREE solo ve las citas de HOY (se ocultan Proximas y Pasadas).
2. Un tenant FREE no puede personalizar (branding): ni editar ni guardar.
3. Un tenant FREE no puede acceder a Lealtad (seccion completa, no solo crear).
4. Un tenant FREE puede tener hasta 5 categorias/servicios; la 6a exige premium.
5. Mientras FREE, la personalizacion NO surte efecto en ningun lado (portal y panel
   usan la DEFAULT). No se borra en DB; vuelve a aplicar al reactivar premium.
6. Eliminar la seccion de Integraciones (Google) de la UI del emprendedor.

## Glossary

- **Premium efectivo**: subscription_status=active y no vencido (isPremiumEffective).
- **Free**: tenant no premium.
- **PREMIUM_REQUIRED**: codigo 403 que devuelven los endpoints gateados.
- **Personalizacion/branding**: logo, color de marca, banner del Tenant + anuncios propios.

## Requirements

### Requirement 1: Free solo ve citas de hoy

**User Story:** Como sistema, quiero que un free vea solo las citas de hoy, para
reservar el historial y las proximas a premium.

#### Acceptance Criteria

1. CUANDO el tenant es FREE ENTONCES la vista Citas del emprendedor DEBERA mostrar
   solo la columna/seccion de HOY; Proximas y Pasadas se ocultan o se muestran con
   leyenda "Solo premium".
2. CUANDO el tenant es FREE ENTONCES el Dashboard DEBERA ocultar (o marcar "Solo
   premium") la seccion de Proximas citas; las de HOY se mantienen.
3. CUANDO el tenant es PREMIUM ENTONCES ve Hoy, Proximas y Pasadas normalmente.

### Requirement 2: Free no puede personalizar

**User Story:** Como sistema, quiero impedir que un free edite/guarde su branding.

#### Acceptance Criteria

1. CUANDO un tenant FREE intenta guardar branding (`PATCH /me/branding`) o crear/
   editar/eliminar anuncios (`/me/ads`) ENTONCES el backend DEBERA responder 403
   PREMIUM_REQUIRED sin modificar datos.
2. EL panel de Personalizacion DEBERA mostrarse en modo solo-lectura con leyenda
   "Solo premium" para free (no permite guardar).
3. UN tenant PREMIUM DEBERA poder personalizar como hoy.

### Requirement 3: Free no accede a Lealtad

**User Story:** Como sistema, quiero bloquear la seccion de Lealtad para free.

#### Acceptance Criteria

1. CUANDO un tenant FREE consulta los endpoints de programas de lealtad (listar,
   crear, ver, editar, activar) ENTONCES el backend DEBERA responder 403
   PREMIUM_REQUIRED.
2. EL enlace "Lealtad" del menu DEBERA mostrarse con leyenda "Solo premium" o la
   pagina DEBERA mostrar un estado bloqueado para free (no listar programas).
3. UN tenant PREMIUM DEBERA acceder a Lealtad normalmente.

### Requirement 4: Limite de 5 categorias en free

**User Story:** Como sistema, quiero limitar a 5 las categorias de un free.

#### Acceptance Criteria

1. CUANDO un tenant FREE ya tiene 5 servicios/categorias e intenta crear otro
   ENTONCES el backend DEBERA responder 403 PREMIUM_REQUIRED sin crearlo.
2. UN tenant FREE con menos de 5 DEBERA poder crear hasta llegar a 5.
3. UN tenant PREMIUM DEBERA crear sin ese limite.
4. EL frontend DEBERA indicar "Solo premium" al llegar al limite y manejar el 403.

### Requirement 5: Personalizacion default mientras free (no conserva efecto)

**User Story:** Como sistema, quiero que un free use la personalizacion DEFAULT en
todos lados, conservando sus datos para cuando reactive premium.

#### Acceptance Criteria

1. CUANDO el tenant es FREE ENTONCES el portal publico DEBERA mostrar la
   personalizacion DEFAULT (ya ocurre) y el panel del emprendedor NO DEBERA aplicar
   su branding personalizado (usa default).
2. LOS datos de branding NO DEBERAN borrarse; permanecen en DB.
3. AL reactivar premium, su personalizacion previa DEBERA volver a aplicar sin
   recapturar.

### Requirement 6: Eliminar Integraciones de la UI

**User Story:** Como equipo, ya no usaremos Integraciones; quiero quitarla de la UI.

#### Acceptance Criteria

1. EL enlace "Integraciones" DEBERA eliminarse del menu del emprendedor.
2. LA ruta `/integraciones` DEBERA quitarse de la navegacion del frontend.
3. NO es necesario borrar el codigo backend de Google; solo dejar de exponer la UI.

### Requirement 7: No regresion

**User Story:** Como usuario, quiero que el resto siga funcionando.

#### Acceptance Criteria

1. LOS guards se basan en el premium EFECTIVO del tenant del JWT (aislamiento).
2. AL perder premium no se borra nada; solo se bloquea el uso premium.
3. EL sistema DEBERA compilar (tsc) y construir (vite build); las suites existentes
   DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
