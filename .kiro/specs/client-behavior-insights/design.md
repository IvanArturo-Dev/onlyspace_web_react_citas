# Design Document

## Overview

Esta funcionalidad agrega metricas de comportamiento del cliente y reorganiza las vistas del panel del emprendedor, construyendo sobre lo existente. NO se crean modelos nuevos: se reutilizan los estados de cita (PENDING/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW), el campo Customer.status, CustomerCancellationState, el dashboard con conteos y series, el buscador de clientes (name/email/phone) y el sistema de lealtad.

El trabajo se reparte en:
- Backend: nuevos calculos agregados (metricas por cliente, rankings, series mensuales, conteo de cancelaciones) y una accion de bloqueo/desbloqueo. Enforcement de "cliente bloqueado no reserva".
- Frontend: buscador con debounce, panel de detalle de cliente con metricas, badge de "tendencia a no asistir" en el panel de citas, grafica mensual compacta y cancelaciones en el resumen del dashboard, rankings compactos, y reorganizacion del panel de citas con historial discreto.

## Decisiones de diseno

- **Sin tablas nuevas.** Las metricas se calculan on-demand con agregaciones (COUNT/GROUP BY) sobre appointments, scoped por tenant. Volumen esperado bajo (arranque chico), asi que el costo es aceptable y evita desnormalizar/duplicar datos.
- **Bloqueo via Customer.status.** El campo ya existe (default "active"). Se usa el valor "blocked" para suspension. Reversible a "active". No se borra historial.
- **Umbral de tendencia a no asistir (configurable en codigo, valor por defecto):** un cliente se marca "tiende a no asistir" si tiene >= 3 inasistencias (NO_SHOW) O si su proporcion de NO_SHOW sobre citas cerradas (COMPLETED+CANCELLED+NO_SHOW) es > 30% con un minimo de 4 citas cerradas (evita falsos positivos con pocas citas). Se centraliza en una constante para ajustarlo facil.
- **Bloqueo manual, con sugerencia visual.** El emprendedor decide bloquear; el sistema solo sugiere (badge). No hay bloqueo automatico, para no expulsar clientes sin intervencion humana.
- **Reutilizar componentes de grafica existentes** (DonutChart, DayBarChart) o agregar uno mensual pequeno (MiniMonthlyChart) siguiendo su estilo; nada a pantalla completa.

## Architecture

Flujo backend (todo scoped por tenant, sin modelos nuevos):

```
customer.service
  + getCustomerBehavior(tenantId, customerId) -> { attended, cancelled, no_show }
  + getBehaviorForCustomers(tenantId, customerIds[]) -> map (para listado/badges en lote)
  + setStatus(tenantId, customerId, status) -> bloquear/desbloquear ("active" | "blocked")

dashboard.service
  + getMonthlyBehavior(tenantId, months) -> [{ month, attended, cancelled, no_show }]
  + summary ya incluye cancelled_appointments (Requirement 6 ya cubierto en datos;
    solo falta exponerlo/mostrarlo en el resumen de la UI)
  + getClientRankings(tenantId) -> { topAttendance[], topNoShow[], topRewards[] } (top N corto)

booking / appointment (enforcement)
  + al crear cita (panel y publico): si Customer.status != "active" -> 409 CUSTOMER_BLOCKED
```

Flujo frontend:

```
Clientes (lista)  -> buscador con debounce (name/email; phone se mantiene)
Cliente (detalle) -> tarjeta de comportamiento (asistio/cancelo/no asistio) + boton Bloquear/Desbloquear
Citas (panel)     -> badge "riesgo de inasistencia" en citas de clientes con tendencia
                  -> seccion principal: ACTUALES + PROXIMAS
                  -> seccion secundaria/historial discreto: COMPLETED/CANCELLED/NO_SHOW o pasadas
Dashboard         -> resumen incluye "Cancelaciones"
                  -> grafica mensual COMPACTA (MiniMonthlyChart)
                  -> rankings compactos (top asistencias / inasistencias / recompensas)
```

## Components and Interfaces

### Backend

1. **customer.service.ts**
   - `getCustomerBehavior(tenantId, customerId)`: cuenta appointments del cliente por estado (COMPLETED, CANCELLED, NO_SHOW). Un solo groupBy por status.
   - `getBehaviorForCustomers(tenantId, ids)`: groupBy (customer_id, status) para resolver badges del listado en lote y evitar N+1.
   - `hasNoShowTendency(behavior)`: helper puro que aplica el umbral (constante NO_SHOW_TENDENCY).
   - `setStatus(tenantId, customerId, status)`: valida status en {"active","blocked"}, actualiza scoped por tenant (404 si ajeno).
   - Ajuste del buscador: el filtro OR ya cubre name/email/phone; se documenta que la mejora de UX (debounce) es de frontend. El backend mantiene contains insensible (MySQL collation por defecto es case-insensitive).

2. **customer.controller.ts + customer.routes.ts**
   - GET /v1/customers/:id/behavior -> metricas del cliente (requireAdmin, tenant-scoped).
   - PATCH /v1/customers/:id/status  body { status: "active" | "blocked" } -> bloquear/desbloquear.
   - (El listado existente puede incluir un flag `behavior`/`at_risk` opcional para badges, resuelto en lote.)

3. **dashboard.service.ts + dashboard.controller.ts**
   - getMonthlyBehavior: raw query GROUP BY mes (YEAR-MONTH) con SUM(CASE WHEN status...) para COMPLETED/CANCELLED/NO_SHOW, ultimos N meses.
   - getClientRankings: top N por asistencias (COMPLETED), por inasistencias (NO_SHOW) y por recompensas (loyalty_rewards). Consultas agregadas scoped por tenant.
   - El summary ya calcula cancelled_appointments; se expone tal cual (Requirement 6).

4. **Enforcement de bloqueo (booking.service / appointment.service / public.controller)**
   - Antes de crear una cita, verificar Customer.status. Si != "active" -> HttpError 409 CUSTOMER_BLOCKED con mensaje claro. Aplica en el panel (staff) y en el flujo publico. Reutiliza el punto donde ya se resuelve/valida el customer (mismo lugar del bloqueo por deuda CUSTOMER_HAS_DEBT).

### Frontend

1. **Clientes (lista)**: input de busqueda con debounce (~300ms) que llama al listado con `search`. Placeholder "Buscar por nombre o correo". Estado vacio claro.

2. **Cliente (detalle)**: tarjeta compacta "Comportamiento" con 3 cifras (Asistio / Cancelo / No asistio) y un boton Bloquear/Desbloquear (confirma con modal). Muestra el estado actual (badge "Bloqueado" si aplica).

3. **Citas (panel)**:
   - Badge discreto "Riesgo de inasistencia" en las citas cuyo cliente cumple el umbral (dato resuelto en lote por el backend).
   - Reorganizacion: vista principal = ACTUALES (hoy) + PROXIMAS. Historial (COMPLETED/CANCELLED/NO_SHOW o pasadas) en una seccion secundaria colapsable/discreta debajo, con titulos pequenos. Respeta el gating premium (free: [hoy-7, hoy+7]).

4. **Dashboard**:
   - Agregar "Cancelaciones" como MetricCard en el bloque Resumen.
   - MiniMonthlyChart: grafica de barras/lineas pequena (asistencias/cancelaciones/inasistencias por mes), en una chartCard de tamano reducido, sin dominar.
   - Rankings compactos: bloque pequeno con top 3-5 por asistencias, inasistencias y recompensas.

## Data Models

No se introducen modelos nuevos ni migraciones. Se usan:
- Appointment.status (enum ya existente con NO_SHOW/COMPLETED/CANCELLED).
- Customer.status (string; se usa "active"/"blocked").
- LoyaltyReward (para ranking de recompensas).

Si se decidiera persistir metricas para rendimiento a futuro, seria una mejora posterior; por ahora se calculan on-demand.

## Correctness Properties

### Property 1: Aislamiento por tenant
Toda metrica, ranking y accion de estado SHALL calcularse/aplicarse solo sobre datos del tenant actual; nunca expone ni modifica clientes/citas de otro tenant.

**Validates: Requirements 2.2, 4.1, 5.2, 7.3**

### Property 2: Bloqueo impide reservar
Si Customer.status != "active", NINGUNA cita nueva puede crearse para ese cliente (panel o publico); el intento retorna 409 CUSTOMER_BLOCKED.

**Validates: Requirements 4.2**

### Property 3: Reversibilidad sin perdida
Bloquear/desbloquear solo cambia Customer.status; el historial de citas y metricas del cliente permanece intacto.

**Validates: Requirements 4.3, 4.4**

### Property 4: Indicador confinado al panel de citas
El badge de tendencia a no asistir SHALL mostrarse unicamente en el panel de citas del emprendedor, nunca en el portal publico ni expuesto al cliente.

**Validates: Requirements 3.3**

### Property 5: Consistencia de conteos
Los conteos de asistio/cancelo/no asistio de un cliente SHALL derivarse exclusivamente de los estados reales de sus citas (COMPLETED/CANCELLED/NO_SHOW), sin doble conteo.

**Validates: Requirements 2.1, 2.3**

### Property 6: Compacidad de la UI
La grafica mensual y los rankings SHALL renderizarse en formato reducido y no ocupar la vista completa; el historial de citas SHALL quedar visualmente subordinado a las citas actuales/proximas.

**Validates: Requirements 5.1, 5.3, 7.2, 8.2**

## Error Handling

- Cliente ajeno al tenant -> 404 (setStatus/behavior).
- status invalido en PATCH -> 400 (solo "active"/"blocked").
- Reserva de cliente bloqueado -> 409 CUSTOMER_BLOCKED con mensaje claro en la UI.
- Fallos de agregacion en dashboard -> el endpoint degrada devolviendo ceros/vacios sin romper la vista (best-effort en las secciones no criticas).

## Testing Strategy

- Unit backend: getCustomerBehavior (conteos por estado), hasNoShowTendency (umbral: casos borde con pocas citas), setStatus (validacion + tenant scoping), enforcement de bloqueo en creacion de cita (409), getMonthlyBehavior y getClientRankings (agregacion correcta y scoping).
- Property-based (donde aplique): la tendencia y los conteos deben ser consistentes para cualquier combinacion de estados (Property 5).
- Frontend: build (tsc) verde; verificacion manual de que la grafica y rankings son compactos y el historial queda subordinado.
- Regresion: la suite existente (reserva, waitlist, gating premium) debe seguir verde; el gating de ventana [hoy-7,hoy+7] no se altera.
