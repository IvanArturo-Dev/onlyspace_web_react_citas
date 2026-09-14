# Design Document

## Overview

Funcionalidades del CLIENTE: ver lealtad (progreso + recompensas), reclamar recompensa
(genera codigo) que el negocio confirma como canje, dejar resenas en citas COMPLETED
(1 por cita, editable, promedio publico en el descubrimiento), marcar favoritos y un
panel "Mis cupones" por estado. Se reutiliza `GET /me/loyalty` y el redeem del staff
(extendido para CLAIMED). Cambios de schema: nuevo estado CLAIMED + campos de reclamo
en LoyaltyReward, y modelos Review y Favorite.

## Architecture

```
Backend (schema)
  enum LoyaltyRewardStatus: EARNED | CLAIMED | REDEEMED | EXPIRED   (+CLAIMED)
  LoyaltyReward: + claim_code String? (unico por tenant)  + claimed_at DateTime?
  model Review { id, tenant_id, appointment_id (unico), customer_id, rating Int(1-5),
    comment String?, created_at, updated_at }
  model Favorite { id, user_id, tenant_id, created_at ; unique(user_id, tenant_id) }

Backend (endpoints del cliente, cadena authenticated)
  GET   /me/loyalty                 (existe) progreso + recompensas del cliente
  POST  /me/rewards/:id/claim       cliente reclama EARNED -> CLAIMED + claim_code
  GET   /me/coupons                 recompensas del cliente con estado/expiracion
  POST  /me/reviews                 crea/edita resena de una cita COMPLETED propia
  GET   /me/reviews                 resenas del cliente
  GET   /me/favorites               lista de negocios favoritos
  POST  /me/favorites/:tenantId     toggle favorito (marca/desmarca)

Backend (staff, existente extendido)
  PATCH /loyalty/rewards/:id/redeem  ahora acepta EARNED o CLAIMED -> REDEEMED
    (valida claim_code cuando se envia; canje confirmado por el negocio)

Backend (publico, extendido)
  discoveryService.discover: cada item incluye rating_avg (number|null) y
    rating_count (number) del negocio.

Frontend (cliente)
  pages/client/MisCupones.tsx  panel de cupones por estado + reclamar (muestra codigo)
  pages/client/MyAppointments.tsx  + accesos a favoritos y a cercania + accion resena
  componente ReviewForm (rating 1-5 + comentario) en citas COMPLETED
  favoritos: boton en tarjetas del descubrimiento y en Mis Citas
  Landing/tarjetas: mostrar rating_avg (estrellas) y rating_count
```

## Components and Interfaces

### 1. Schema (Req 1,2,3,4,5)
- `LoyaltyRewardStatus`: agregar `CLAIMED` entre EARNED y REDEEMED.
- `LoyaltyReward`: `claim_code String? @unique` y `claimed_at DateTime?`. El resto igual.
- `Review`: por cita. `appointment_id String @unique` garantiza 1 resena por cita.
  Indices por tenant_id y por (tenant_id) para promedios. rating Int (validar 1-5 en
  servicio). comment String? @db.Text.
- `Favorite`: `@@unique([user_id, tenant_id])` (toggle idempotente por cliente-negocio).
- Aplicar con `prisma db push` (detener node antes en Windows para evitar EPERM).

### 2. Reclamo de recompensa (Req 2)
- Nuevo `loyaltyService.claim(tenantId, rewardId, customerId)`: valida que la reward es
  del cliente (customer del tenant) y esta EARNED y no vencida; genera `claim_code`
  (alfabeto legible, unico) y pasa a CLAIMED con claimed_at. EXPIRED/REDEEMED -> 409/400.
- `me.controller` resuelve el/los customer del usuario por email dentro del tenant (igual
  que getMyLoyalty) para autorizar el reclamo. Endpoint `POST /me/rewards/:id/claim`.
- `loyaltyService.redeem` (staff): aceptar tambien CLAIMED (hoy solo EARNED). Si se
  envia claim_code, validarlo. Marca REDEEMED + redeemed_at + redeemed_by.

### 3. Mis cupones (Req 5)
- `GET /me/coupons`: reutiliza la resolucion de customer del cliente y
  `loyaltyService.listRewards` (ya hace expiracion perezosa). Devuelve las recompensas
  con status, reward_text, expires_at y claim_code (solo al propio cliente).
- El panel del frontend agrupa por estado (EARNED/CLAIMED/REDEEMED/EXPIRED).

### 4. Resenas (Req 3)
- Nuevo `review.service.ts`: `upsertReview(tenantId, userEmail, appointmentId, rating,
  comment)`. Valida: la cita es del cliente (booked_by_email == email) y su status es
  COMPLETED; rating entero 1-5. Upsert por appointment_id (crea o edita). Aislado por
  tenant.
- `getMyReviews(userEmail)`: resenas del cliente. `getReview(appointmentId, email)`.
- Promedio publico: `reviewService.ratingsForTenants(tenantIds)` -> mapa tenant_id ->
  { avg, count }. `discoveryService.discover` lo consume y agrega rating_avg/rating_count
  a cada item. No expone comentarios individuales en discover (solo agregado).
- Endpoints: `POST /me/reviews` { appointment_id, rating, comment? }; `GET /me/reviews`.

### 5. Favoritos (Req 4,6)
- Nuevo `favorite.service.ts`: `toggle(userId, tenantId)` (crea o borra), `list(userId)`
  -> negocios favoritos (nombre + sucursal principal code para reservar).
- Endpoints: `POST /me/favorites/:tenantId` (toggle) y `GET /me/favorites`.

### 6. Frontend cliente (Req 1,5,6)
- `MisCupones.tsx` (nueva pantalla, ruta cliente): consume /me/coupons y /me/loyalty;
  muestra progreso por programa (barra) y cupones por estado; boton Reclamar (POST
  claim) que muestra el codigo resultante.
- `MyAppointments.tsx`: agrega acceso a Favoritos (/me/favorites) y a la busqueda por
  cercania (navega al landing), y en cada cita COMPLETED un boton "Calificar" que abre
  el ReviewForm (POST /me/reviews).
- Tarjetas del descubrimiento (Landing): muestran estrellas (rating_avg) y (rating_count)
  y un boton de favorito (toggle) si el usuario esta autenticado.
- Rutas cliente en App.tsx protegidas con AuthRoute (cualquier rol logueado).

## Data Models

- `LoyaltyReward` extendido (CLAIMED, claim_code, claimed_at).
- `Review` (1:1 con Appointment via appointment_id unico).
- `Favorite` (N:1 usuario, N:1 tenant; unique por par).
- Sin cambios destructivos; todo aditivo. `prisma db push`.

## Error Handling

- Reclamar reward no propia / de otro tenant -> 404. EARNED requerido -> 409 si CLAIMED
  ya, 400 si EXPIRED, 409 si REDEEMED.
- Resena sobre cita no COMPLETED o ajena -> 403/400. rating fuera de 1-5 -> 400.
- Favorito sobre tenant inexistente -> 404.
- Aislamiento por cliente/tenant en todos los endpoints /me/*.

## Testing Strategy

- Unit loyalty.claim: EARNED -> CLAIMED + code; EXPIRED/REDEEMED rechazados; aislamiento.
- Unit loyalty.redeem: acepta CLAIMED; valida claim_code; idempotencia de estados.
- Unit review.service: solo COMPLETED propia; upsert (1 por cita, edita); rating 1-5;
  promedio por tenant correcto; aislamiento.
- Unit favorite.service: toggle crea/borra; list solo del usuario.
- Unit discovery: rating_avg/rating_count agregados por negocio; negocios sin resenas
  -> avg null, count 0.
- Regresion: tsc backend/frontend; vite build; suites existentes verdes (salvo fallos
  preexistentes ajenos).

## Correctness Properties

### Property 1: Reclamo valido de recompensa
claim() solo transiciona EARNED -> CLAIMED (genera claim_code unico); EXPIRED, REDEEMED
o ya CLAIMED no vuelven a EARNED ni generan un nuevo code valido.

**Validates: Requirements 2.1, 2.4**

### Property 2: Canje confirmado por el negocio
redeem() marca REDEEMED solo desde EARNED o CLAIMED; una recompensa REDEEMED o EXPIRED
nunca pasa a REDEEMED de nuevo (idempotencia de estado terminal).

**Validates: Requirements 2.3, 2.4**

### Property 3: Resena solo en cita realizada
Una resena solo puede crearse/editarse para una cita del propio cliente en estado
COMPLETED; cualquier otro caso se rechaza sin escribir.

**Validates: Requirements 3.1, 3.2**

### Property 4: Una resena por cita (upsert)
Enviar dos veces una resena para la misma cita resulta en EXACTAMENTE una fila (la
segunda edita la primera), gracias a appointment_id unico.

**Validates: Requirements 3.3, 3.4**

### Property 5: Rating en rango
El rating persistido siempre es un entero en [1,5]; valores fuera de rango se rechazan
con 400.

**Validates: Requirements 3.6**

### Property 6: Promedio publico correcto
El rating_avg de un negocio es el promedio de los ratings de sus resenas y rating_count
su numero; un negocio sin resenas expone avg null y count 0.

**Validates: Requirements 3.5**

### Property 7: Favorito idempotente por par
toggle(userId, tenantId) alterna entre existir/no existir exactamente una fila para el
par (user_id, tenant_id); nunca duplica.

**Validates: Requirements 4.1, 4.2**

### Property 8: Aislamiento por cliente y tenant
Todo endpoint /me/* (loyalty, coupons, claim, reviews, favorites) opera solo sobre datos
del propio usuario y su tenant; jamas expone ni muta datos de otros clientes o tenants.

**Validates: Requirements 1.3, 2.5, 3.6, 4.4, 5.4, 7.1**

