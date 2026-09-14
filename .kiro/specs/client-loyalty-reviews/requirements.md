# Requirements Document

## Introduction

Habilita funcionalidades del CLIENTE final: ver su lealtad (visitas acumuladas y
recompensas) y reclamar/canjear; dejar resenas (calificacion + comentario) solo en
citas realizadas; marcar negocios como favoritos; y un panel de "Mis cupones" con sus
estados. Hoy el backend ya expone `GET /me/loyalty` (progreso + recompensas del
cliente) y `GET /me/appointments`, pero el frontend del cliente no los muestra, el
canje solo lo hace el negocio, y no existen resenas ni favoritos.

Decisiones de producto (confirmadas con el usuario):
1. Recompensas: el cliente RECLAMA una recompensa ganada (se genera un codigo/QR); el
   NEGOCIO confirma el canje (marca REDEEMED) al validar el codigo. El cliente no se
   auto-canjea (anti-fraude).
2. Resenas: calificacion 1-5 + comentario, permitida SOLO si el cliente tiene una cita
   COMPLETED en ese negocio. Una resena por cita, EDITABLE. El promedio de estrellas
   del negocio se muestra en el descubrimiento (publico).
3. Favoritos: el cliente marca negocios como favoritos; accesibles desde "Mis citas".
4. Mis cupones: panel del cliente con recompensas y su estado (activo/ganado,
   reclamado, canjeado, expirado) y expiracion si aplica.

## Glossary

- **Cliente**: usuario final (rol CLIENT) que reserva citas.
- **Progreso de lealtad**: visitas acumuladas del cliente hacia la meta de un programa.
- **Recompensa (cupon)**: LoyaltyReward del cliente; estados: EARNED (ganada/activa),
  CLAIMED (reclamada, con codigo, pendiente de que el negocio la canjee), REDEEMED
  (canjeada), EXPIRED (vencida).
- **Resena**: calificacion 1-5 + comentario que un cliente deja sobre una cita COMPLETED.
- **Favorito**: relacion cliente-negocio marcada por el cliente.
- **COMPLETED**: estado de cita que indica que el servicio se realizo.

## Requirements

### Requirement 1: Cliente ve su progreso de lealtad y recompensas

**User Story:** Como cliente, quiero ver mis visitas acumuladas y mis recompensas, para
saber cuanto me falta y que tengo disponible.

#### Acceptance Criteria

1. EL cliente autenticado DEBERA poder ver, por cada programa de lealtad en el que
   participa, su progreso (conteo actual y meta) via `GET /me/loyalty` (ya existe).
2. EL cliente DEBERA ver la lista de sus recompensas con su estado y expiracion (si
   aplica).
3. EL frontend del cliente DEBERA mostrar el progreso y las recompensas en una pantalla
   accesible (perfil/mis cupones), sin exponer datos de otros clientes ni tenants.

### Requirement 2: Reclamar recompensa (cliente) y confirmar canje (negocio)

**User Story:** Como cliente, quiero reclamar mi recompensa ganada y mostrar un codigo
al negocio; como negocio, quiero confirmar el canje al validar ese codigo.

#### Acceptance Criteria

1. CUANDO una recompensa esta EARNED (ganada y no vencida) ENTONCES el cliente DEBERA
   poder RECLAMARLA, lo que genera un codigo de reclamo y pasa la recompensa a CLAIMED.
2. EL cliente DEBERA poder ver el codigo de reclamo de una recompensa CLAIMED.
3. EL negocio (staff: ADMIN/ASSISTANT) DEBERA poder confirmar el canje (marcar
   REDEEMED) de una recompensa CLAIMED, validando el codigo (endpoint existente de
   redeem, extendido para aceptar CLAIMED).
4. UNA recompensa EXPIRED o ya REDEEMED NO DEBERA poder reclamarse ni canjearse (409/400).
5. EL reclamo/canje DEBERA respetar el aislamiento por tenant y por cliente (un cliente
   solo reclama SUS recompensas).

### Requirement 3: Resenas en citas realizadas

**User Story:** Como cliente, quiero calificar y comentar una cita que ya se realizo,
para compartir mi experiencia.

#### Acceptance Criteria

1. EL cliente DEBERA poder crear una resena (rating 1-5 entero + comentario opcional)
   SOLO para una cita PROPIA cuyo estado sea COMPLETED.
2. SI la cita no es COMPLETED o no es del cliente ENTONCES el backend DEBERA responder
   403/400 sin crear la resena.
3. DEBERA existir como maximo UNA resena por cita; volver a enviarla EDITA la existente.
4. EL cliente DEBERA poder ver/editar su resena de una cita realizada.
5. EL promedio de calificacion y el numero de resenas del negocio DEBERAN calcularse y
   exponerse en el descubrimiento publico (por negocio).
6. LAS resenas DEBERAN respetar aislamiento por tenant; el rating es 1-5 (validado).

### Requirement 4: Favoritos del cliente

**User Story:** Como cliente, quiero marcar negocios como favoritos para volver a
reservar rapido.

#### Acceptance Criteria

1. EL cliente DEBERA poder marcar/desmarcar un negocio como favorito (toggle).
2. EL cliente DEBERA poder listar sus negocios favoritos.
3. DESDE "Mis citas" el cliente DEBERA poder acceder a sus favoritos y reservar en
   ellos, y a la busqueda por cercania del descubrimiento.
4. LOS favoritos son por cliente; nunca se exponen los de otros clientes.

### Requirement 5: Panel "Mis cupones"

**User Story:** Como cliente, quiero un panel con mis cupones/recompensas y su estado,
para saber cuales puedo usar.

#### Acceptance Criteria

1. EL panel DEBERA listar las recompensas del cliente agrupadas o filtrables por estado:
   activas (EARNED), reclamadas (CLAIMED), canjeadas (REDEEMED) y expiradas (EXPIRED).
2. CADA cupon DEBERA mostrar su texto de recompensa, estado y fecha de expiracion si
   aplica (validity_days del programa).
3. DESDE un cupon activo el cliente DEBERA poder reclamarlo (Requirement 2).
4. EL panel NO DEBERA mostrar cupones de otros clientes ni de otros tenants.

### Requirement 6: Mis citas con favoritos y accesos

**User Story:** Como cliente, desde Mis citas quiero llegar rapido a mis favoritos y a
descubrir por cercania.

#### Acceptance Criteria

1. LA pantalla "Mis citas" DEBERA mostrar el historial de citas del cliente (ya existe)
   y un acceso a sus negocios FAVORITOS.
2. DESDE "Mis citas" DEBERA haber un acceso a la busqueda por cercania (landing de
   descubrimiento).
3. EN una cita COMPLETED, "Mis citas" DEBERA ofrecer la accion de dejar/editar resena.

### Requirement 7: No regresion y aislamiento

**User Story:** Como usuario, quiero que el resto siga funcionando y sin fugas de datos.

#### Acceptance Criteria

1. TODAS las lecturas/escrituras del cliente DEBERAN estar scoped por su identidad y
   tenant; nunca se exponen datos de otros clientes/tenants.
2. LAS funcionalidades de lealtad del cliente (ver/reclamar) NO DEBERAN requerir premium
   del cliente; el gating premium del emprendedor sobre PROGRAMAS se mantiene como esta.
3. EL sistema DEBERA compilar (tsc backend/frontend) y construir (vite build); las
   suites existentes DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
