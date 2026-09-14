# Implementation Plan

## Overview

Funcionalidades del cliente: ver lealtad y reclamar recompensas (negocio confirma el
canje), resenas en citas COMPLETED (1 por cita, editable, promedio publico en discover),
favoritos y panel "Mis cupones". Cambios de schema aditivos (CLAIMED + claim_code en
LoyaltyReward; modelos Review y Favorite). Reutiliza /me/loyalty y el redeem del staff.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4"] },
    { "wave": 3, "tasks": ["5", "6"] },
    { "wave": 4, "tasks": ["7", "8"] }
  ]
}
```

## Tasks

- [x] 1. Schema: CLAIMED + claim_code/claimed_at, modelos Review y Favorite
  - `schema.prisma`: en enum `LoyaltyRewardStatus` agregar `CLAIMED`. En `LoyaltyReward`
    agregar `claim_code String? @unique` y `claimed_at DateTime?`.
  - Nuevo modelo `Review { id, tenant_id, appointment_id String @unique, customer_id,
    rating Int, comment String? @db.Text, created_at, updated_at }` con @@index([tenant_id]).
  - Nuevo modelo `Favorite { id, user_id, tenant_id, created_at }` con
    `@@unique([user_id, tenant_id])` e @@index([user_id]).
  - Aplicar con `prisma db push` (Windows: detener node antes para evitar EPERM). Aditivo,
    sin backfill.
  - `tsc --noEmit` backend en verde (el client se regenera con db push).
  - _Requirements: 2.1, 3.1, 3.3, 4.1_

- [x] 2. Backend: reclamo y canje de recompensas (loyaltyService)
  - `loyaltyService.claim(tenantId, rewardId, customerId)`: valida reward del cliente,
    EARNED y no vencida; genera claim_code unico (alfabeto legible); pasa a CLAIMED +
    claimed_at. EXPIRED->400, REDEEMED->409, ya CLAIMED->409 (o idempotente devolviendo
    el code). Aislamiento por tenant/cliente.
  - `loyaltyService.redeem`: aceptar tambien estado CLAIMED (hoy solo EARNED). Si llega
    claim_code, validarlo contra el de la reward. Marca REDEEMED + redeemed_at/by.
  - Pruebas unitarias (Property 1,2): EARNED->CLAIMED+code; EXPIRED/REDEEMED rechazados;
    redeem desde CLAIMED ok y desde estado terminal falla; aislamiento.
  - `tsc` + `jest --testPathPattern="loyalty"` en verde.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 3. Backend: review.service (resenas + promedio)
  - Nuevo `review.service.ts`: `upsertReview(tenantId, userEmail, appointmentId, rating,
    comment)` valida cita propia (booked_by_email==email) y COMPLETED, rating entero 1-5;
    upsert por appointment_id. `getMyReviews(userEmail)`, `getReview(appointmentId,email)`.
    `ratingsForTenants(tenantIds)` -> mapa tenant_id -> { avg, count }.
  - Pruebas unitarias (Property 3,4,5,6,8): solo COMPLETED propia; upsert 1 por cita;
    rating 1-5 (400 fuera); promedio correcto y sin resenas avg null/count 0; aislamiento.
  - `tsc` + `jest --testPathPattern="review"` en verde.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 4. Backend: favorite.service (favoritos)
  - Nuevo `favorite.service.ts`: `toggle(userId, tenantId)` crea/borra (idempotente por
    par); `list(userId)` -> favoritos con nombre del negocio y code de su sucursal
    principal (para reservar). Valida tenant existente en toggle (404 si no).
  - Pruebas unitarias (Property 7,8): toggle alterna sin duplicar; list solo del usuario.
  - `tsc` + `jest --testPathPattern="favorite"` en verde.
  - _Requirements: 4.1, 4.2, 4.4_

- [ ] 5. Backend: endpoints /me/* + integrar rating en discover
  - `me.routes` + `me.controller`: `POST /me/rewards/:id/claim`, `GET /me/coupons`,
    `POST /me/reviews`, `GET /me/reviews`, `GET /me/favorites`, `POST /me/favorites/:tenantId`.
    Todos en la cadena `authenticated` (cualquier usuario logueado), resolviendo el/los
    customer del usuario por email dentro del tenant (patron de getMyLoyalty) donde aplique.
  - `discoveryService.discover`: consumir `reviewService.ratingsForTenants` y agregar
    `rating_avg: number|null` y `rating_count: number` a cada DiscoverItem.
  - Pruebas: integracion ligera de los endpoints (mock de services) + unit de discover con
    ratings (avg/count por negocio; sin resenas -> null/0).
  - `tsc` + `jest --testPathPattern="me|discovery|loyalty|review|favorite"` en verde.
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.5, 4.2, 5.1, 5.2, 7.1_

- [ ] 6. Frontend: servicios y tipos del cliente
  - `services`: metodos para claim, getCoupons, upsertReview, getMyReviews, listFavorites,
    toggleFavorite (usando `api`, patron unwrap). Tipos Coupon/Review/Favorite. Extender
    DiscoverItem con rating_avg/rating_count.
  - `tsc --noEmit` frontend.
  - _Requirements: 1.2, 2.1, 3.1, 4.1, 5.1_

- [ ] 7. Frontend: pantalla Mis Cupones + progreso de lealtad
  - `pages/client/MisCupones.tsx` (ruta cliente con AuthRoute): muestra progreso por
    programa (barra conteo/meta) desde /me/loyalty y cupones por estado (EARNED/CLAIMED/
    REDEEMED/EXPIRED) desde /me/coupons; boton Reclamar (claim) que muestra el codigo.
    Estados vacios claros. Enlace en el menu/acceso del cliente.
  - `App.tsx`: agregar la ruta protegida.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 5.1, 5.2, 5.3, 5.4_

- [ ] 8. Frontend: Mis Citas (favoritos, cercania, resenas) + rating en descubrimiento
  - `MyAppointments.tsx`: acceso a Favoritos (/me/favorites, reservar en ellos) y a la
    busqueda por cercania (navega al landing); en cada cita COMPLETED, boton Calificar
    que abre ReviewForm (rating 1-5 + comentario, POST /me/reviews; precarga si ya existe).
  - Tarjetas del Landing (descubrimiento): mostrar estrellas (rating_avg) + (rating_count)
    y boton de favorito (toggle) para usuarios autenticados.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 3.1, 3.4, 3.5, 4.3, 6.1, 6.2, 6.3_

## Notes
- Cambios de schema aditivos; `prisma db push` (no migrate). En Windows detener node antes.
- Reutiliza la resolucion de customer por email dentro del tenant (patron getMyLoyalty).
- El redeem del staff se EXTIENDE (acepta CLAIMED); no romper el flujo actual EARNED.
- discover ya existe (spec discovery-landing); aqui solo se agregan rating_avg/rating_count.
- Ver/reclamar lealtad del cliente NO requiere premium; el gating premium de PROGRAMAS
  del emprendedor se mantiene igual.
- Fallos de tests preexistentes y ajenos (auth.service, customer.service, adminUsersModules)
  se ignoran; no son regresiones de esta spec.
