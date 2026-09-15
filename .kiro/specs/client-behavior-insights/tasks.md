# Implementation Plan

## Overview

Plan para agregar metricas de comportamiento del cliente y reorganizar las vistas del panel del emprendedor. Sin modelos nuevos: se usan estados de cita existentes (COMPLETED/CANCELLED/NO_SHOW), Customer.status, dashboard, lealtad. Backend primero (calculos + bloqueo + enforcement), luego frontend (buscador, detalle, badges, dashboard, historial). Todo scoped por tenant.

## Task Dependency Graph

```
1.1 (behavior svc) ---> 1.2 (controller/routes behavior+status) ---> 3.x (frontend clientes)
1.3 (enforce bloqueo) depende de 1.1
2.1 (dashboard monthly+rankings) ---> 3.4 (dashboard UI)
3.1 (buscador) independiente de backend nuevo (usa listado existente)
3.2 (detalle cliente) depende de 1.2
3.3 (badge citas) depende de 1.2
3.4 (dashboard UI) depende de 2.1
3.5 (historial citas) independiente (reordena UI existente)
4.1 (tests backend) depende de 1.1,1.2,1.3,2.1
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "2.1", "3.1", "3.5"] },
    { "wave": 2, "tasks": ["1.2", "1.3"] },
    { "wave": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "wave": 4, "tasks": ["4.1"] }
  ],
  "dependencies": {
    "1.1": [],
    "2.1": [],
    "3.1": [],
    "3.5": [],
    "1.2": ["1.1"],
    "1.3": ["1.1"],
    "3.2": ["1.2"],
    "3.3": ["1.2"],
    "3.4": ["2.1"],
    "4.1": ["1.1", "1.2", "1.3", "2.1"]
  }
}
```

## Tasks

- [ ] 1. Backend: comportamiento del cliente y bloqueo
- [x] 1.1 Calculos de comportamiento del cliente (customer.service)
  - getCustomerBehavior(tenantId, customerId): conteos COMPLETED/CANCELLED/NO_SHOW (groupBy status).
  - getBehaviorForCustomers(tenantId, ids[]): groupBy (customer_id,status) en lote (evita N+1).
  - hasNoShowTendency(behavior): helper puro con umbral en constante (>=3 NO_SHOW o >30% con min 4 cerradas).
  - _Requirements: 2.1, 2.2, 2.3, 3.2_
- [x] 1.2 Endpoints de comportamiento y estado (customer.controller + routes)
  - GET /v1/customers/:id/behavior (requireAdmin, tenant-scoped).
  - PATCH /v1/customers/:id/status body { status: "active"|"blocked" } (valida, 400 si invalido, 404 si ajeno).
  - Opcional: incluir at_risk/behavior en el listado para badges (resuelto en lote).
  - _Requirements: 2.1, 4.1, 4.3_
- [x] 1.3 Enforcement: cliente bloqueado no reserva
  - En el punto donde se crea la cita (panel y publico, junto al bloqueo por deuda), si Customer.status != "active" -> 409 CUSTOMER_BLOCKED con mensaje claro.
  - _Requirements: 4.2_

- [ ] 2. Backend: dashboard (mensual, rankings, cancelaciones)
- [x] 2.1 Series mensuales y rankings (dashboard.service + controller)
  - getMonthlyBehavior(tenantId, months): GROUP BY mes con SUM(CASE status...) para COMPLETED/CANCELLED/NO_SHOW.
  - getClientRankings(tenantId): top N por asistencias (COMPLETED), inasistencias (NO_SHOW) y recompensas (loyalty_rewards).
  - Exponer cancelled_appointments en el summary (ya se calcula) para el resumen.
  - _Requirements: 5.1, 5.2, 6.1, 6.2, 7.1, 7.3_

- [ ] 3. Frontend: buscador, detalle, badges, dashboard, historial
- [x] 3.1 Buscador de clientes amigable (debounce, nombre/correo)
  - Input con debounce ~300ms que consulta el listado con search; placeholder "Buscar por nombre o correo"; estado vacio claro.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
- [x] 3.2 Detalle de cliente: comportamiento + bloquear/desbloquear
  - Tarjeta compacta con Asistio/Cancelo/No asistio (GET behavior); boton Bloquear/Desbloquear (PATCH status) con confirmacion; badge "Bloqueado" si aplica.
  - _Requirements: 2.1, 4.1, 4.3_
- [x] 3.3 Badge de riesgo de inasistencia en el panel de citas
  - Badge discreto en las citas cuyo cliente tiene tendencia (dato en lote). Solo en el panel de citas (no publico).
  - _Requirements: 3.1, 3.3_
- [x] 3.4 Dashboard: cancelaciones + grafica mensual compacta + rankings
  - MetricCard "Cancelaciones" en Resumen; MiniMonthlyChart compacto (asistencias/cancelaciones/inasistencias); bloque de rankings pequeno (top asistencias/inasistencias/recompensas).
  - _Requirements: 5.1, 5.3, 6.1, 7.1, 7.2_
- [x] 3.5 Panel de citas: historial discreto (foco en actuales/proximas)
  - Vista principal ACTUALES+PROXIMAS; historial (COMPLETED/CANCELLED/NO_SHOW o pasadas) en seccion secundaria discreta debajo con titulos pequenos. Respeta gating premium [hoy-7,hoy+7].
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 4. Verificacion
- [x] 4.1 Tests backend + build frontend
  - Unit: getCustomerBehavior, hasNoShowTendency (bordes), setStatus (validacion+scoping), enforcement 409 CUSTOMER_BLOCKED, getMonthlyBehavior/getClientRankings (agregacion+scoping). tsc backend y frontend verdes. Suite existente sin regresiones.
  - _Requirements: 2.3, 3.2, 4.2, 5.2, 7.3_

## Notes

- Sin migraciones: se reutiliza Customer.status ("active"/"blocked") y los estados de cita existentes.
- El bloqueo es MANUAL (el emprendedor decide); el sistema solo sugiere via badge. Umbral centralizado en una constante para ajuste facil.
- Deploy a produccion (EC2) tras verificar: rebuild backend + frontend, subir por SSH, docker compose up -d --build. No requiere cambios de infra.
- No alterar el gating premium de la ventana de citas ni los flujos de reserva/waitlist existentes.
