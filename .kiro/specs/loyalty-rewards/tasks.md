# Implementation Plan

## Overview

Plan para implementar el sistema de retencion y lealtad: modelos, motor de acumulacion/otorgamiento enganchado al completado de citas, canje y expiracion, endpoints por rol y frontend (emprendedor, cliente, super admin). Se construye sobre el flujo de citas y la infraestructura existentes.

Estrategia incremental de menor a mayor riesgo:
1. Modelo de datos (programas, progreso, conteo idempotente, recompensas).
2. Servicio de programas (CRUD) y validaciones.
3. Motor de lealtad (acumulacion, otorgamiento, reversa) con idempotencia y transacciones.
4. Enganche al cambio de estado de cita.
5. Canje y expiracion.
6. Endpoints por rol (emprendedor, cliente, super admin).
7. Frontend por rol.
8. Verificacion end-to-end.

Reutiliza: Prisma/MySQL multi-tenant, estados de Appointment, Customer, writeAudit, Notification, guards requireAdmin/requireStaff/requireSuperAdmin, usePolling y componentes SVG de charts, tema y guards del frontend.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["2.1", "3.1", "4"] },
    { "wave": 4, "tasks": ["4.1", "5"] },
    { "wave": 5, "tasks": ["5.1", "6"] },
    { "wave": 6, "tasks": ["6.1", "7", "8", "9"] },
    { "wave": 7, "tasks": ["10"] }
  ],
  "dependencies": {
    "2": ["1"],
    "2.1": ["2"],
    "3": ["1"],
    "3.1": ["3"],
    "4": ["3"],
    "4.1": ["4"],
    "5": ["3"],
    "5.1": ["5"],
    "6": ["2", "5"],
    "6.1": ["6"],
    "7": ["6"],
    "8": ["6"],
    "9": ["6"],
    "10": ["6.1", "7", "8", "9"]
  }
}
```

## Tasks

- [x] 1. Modelo de datos de lealtad
  - En `backend/prisma/schema.prisma`: agregar enums `LoyaltyProgramType` (ACCUMULATION|PERIODIC) y `LoyaltyRewardStatus` (EARNED|REDEEMED|EXPIRED)
  - Crear modelos `LoyaltyProgram`, `LoyaltyProgress` (unique [program_id, customer_id]), `LoyaltyCountedAppointment` (unique [program_id, appointment_id]) y `LoyaltyReward` con indices por tenant/estado/cliente y `@@map`
  - Aplicar con `prisma db push` + `prisma generate` sobre citas_dev (detener node antes por el DLL en Windows)
  - _Requirements: 1.2, 2.5, 3.3_

- [x] 2. Servicio de programas (CRUD)
  - `loyaltyProgramService`: list/get/create/update/setActive scoped por tenant
  - Validaciones: goal >= 1; PERIODIC requiere window_days >= 1; validity_days nulo o >= 1 -> VALIDATION_ERROR
  - Auditar creacion/edicion/activacion
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2.1 Pruebas de programas (Property 4)
  - Validaciones de goal/window/validity; aislamiento por tenant (no ver/editar de otro tenant)
  - _Requirements: 1.5, 1.6_
  - _Properties: Property 4 (aislamiento)_

- [x] 3. Motor de lealtad: acumulacion y otorgamiento
  - `loyaltyService.onAppointmentCompleted`: por cada programa activo del tenant, inserta LoyaltyCountedAppointment (idempotente por unicidad), incrementa LoyaltyProgress, evalua meta y otorga LoyaltyReward(EARNED) en transaccion
  - ACCUMULATION: al otorgar, count -= goal. PERIODIC: contar dentro de la ventana (counted_at >= now - window_days)
  - Fijar expires_at si hay validity_days; writeAudit + Notification best-effort
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1_

- [x] 3.1 Pruebas del motor (Property 1, 2, 3, 7)
  - Idempotencia por cita; solo COMPLETED acumula; cruce de meta crea 1 recompensa y ACCUMULATION reinicia; ventana PERIODIC
  - _Requirements: 2.3, 2.5, 3.1, 3.2, 3.6_
  - _Properties: Property 1 (idempotencia), Property 2 (solo COMPLETED), Property 3 (meta/reinicio), Property 7 (ventana PERIODIC)_

- [x] 4. Reversa de completado
  - `loyaltyService.onAppointmentUncompleted`: elimina LoyaltyCountedAppointment y decrementa progreso de forma consistente; no revoca recompensas canjeadas
  - _Requirements: 2.4, 8.3_

- [x] 4.1 Pruebas de reversa (Property 5)
  - COMPLETED -> otro decrementa y no deja conteos huerfanos
  - _Requirements: 2.4, 8.3_
  - _Properties: Property 5 (reversa consistente)_

- [x] 5. Canje y expiracion de recompensas
  - `loyaltyService.redeem` (EARNED -> REDEEMED, 409 si ya canjeada, rechazo si expirada); `expireDue` (marca EXPIRED vencidas), tambien expiracion perezosa al listar
  - Auditar canje/expiracion
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5.1 Pruebas de canje/expiracion (Property 6)
  - EARNED -> REDEEMED una sola vez; segundo canje 409; expirada no canjeable
  - _Requirements: 4.2, 4.3_
  - _Properties: Property 6 (canje unico)_

- [x] 6. Enganche al cambio de estado de cita
  - Invocar onAppointmentCompleted / onAppointmentUncompleted desde el punto unico de actualizacion de estado de la cita, en try/catch (la lealtad no bloquea el flujo)
  - Detectar transiciones -> COMPLETED y COMPLETED -> otro
  - _Requirements: 2.1, 2.4, 8.1, 8.2_

- [x] 6.1 Endpoints de lealtad por rol
  - Emprendedor (requireAdmin): programas CRUD, GET rewards con filtros, stats; canje via requireStaff (ADMIN o ASSISTANT)
  - Cliente (auth): GET /v1/me/loyalty (progreso + recompensas propias)
  - Super admin (requireSuperAdmin): GET /v1/admin/loyalty/stats
  - _Requirements: 4.1, 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Frontend emprendedor: seccion Lealtad
  - Pagina `Lealtad` (ruta + nav): administrar programas (tabla + modal crear/editar, activar/desactivar) y recompensas por canjear (filtro por estado, busqueda por cliente, marcar canjeada); metricas arriba; estados de carga/error
  - `loyalty.service.ts` con programas/recompensas/stats
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. Frontend cliente: progreso y recompensas
  - Bloque en `MyAppointments`: barras "N de M" por programa activo y lista de recompensas con estado/vencimiento; estado vacio claro
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 9. Frontend super admin: metricas de lealtad
  - Tarjetas/grafica de metricas agregadas (programas, recompensas ganadas/canjeadas) reutilizando charts SVG
  - _Requirements: 7.4_

- [x] 10. Verificacion end-to-end
  - Programa ACCUMULATION goal=2: completar 2 citas del mismo cliente en 2 sucursales -> 1 recompensa EARNED; progreso reinicia; canjear; segundo canje 409
  - Programa PERIODIC goal=3/30 dias: completar 3 en ventana -> recompensa; fuera de ventana no otorga
  - Cliente ve progreso y recompensas; aislamiento entre dos negocios; matriz de roles en endpoints
  - _Requirements: 2.2, 3.1, 3.2, 4.2, 4.3, 5.1, 7.2_

## Notes

- Acumulacion por tenant (negocio); solo cuentan citas COMPLETED.
- Idempotencia por (program_id, appointment_id); transacciones en el cruce de meta.
- La lealtad nunca bloquea el cambio de estado de la cita (hook en try/catch).
- Aplicar cambios de esquema con `prisma db push` en citas_dev (sin carpeta de migraciones formal).
- Subtareas con `_Properties:` son candidatas a pruebas basadas en propiedades.
