# Requirements Document

## Introduction

Esta spec agrupa mejoras del panel del emprendedor centradas en el COMPORTAMIENTO del cliente (asistencias, inasistencias, cancelaciones) y en reorganizar las vistas para que el emprendedor mantenga el foco en sus citas actuales y proximas. Construye sobre lo que ya existe en el sistema: los estados de cita PENDING/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW, el campo Customer.status (active/inactive), el modelo CustomerCancellationState (contador de cancelaciones y deuda), el dashboard con conteos y series por fecha, el buscador de clientes por name/email/phone, y el sistema de lealtad/recompensas.

Objetivos:
1. Dar visibilidad del comportamiento de cada cliente (cuantas veces asistio, cancelo, no asistio).
2. Alertar al emprendedor sobre clientes con tendencia a no asistir, en el propio panel de citas.
3. Permitir suspender/bloquear clientes con mal comportamiento de inasistencias.
4. Mostrar rankings y una grafica mensual de forma COMPACTA (sin robar la atencion).
5. Mejorar el buscador de clientes (por nombre o correo).
6. Mover las citas ya finalizadas (completadas/canceladas/inasistidas) a un historial discreto, dejando el foco en actuales/proximas.

No se cambian los flujos de reserva ni el modelo multi-tenant. Todas las metricas se calculan scoped por tenant.

## Glossary

- Asistencia: cita en estado COMPLETED.
- Inasistencia (no-show): cita en estado NO_SHOW.
- Cancelacion: cita en estado CANCELLED.
- Tendencia a no asistir: proporcion/umbral de NO_SHOW respecto al total de citas cerradas del cliente.
- Cliente bloqueado/suspendido: Customer.status distinto de "active" (p. ej. "blocked"), que impide nuevas reservas.
- Historial de citas: citas cuyo estado es final (COMPLETED, CANCELLED, NO_SHOW) o cuya fecha ya paso.

## Requirements

### Requirement 1: Buscador de clientes amigable (nombre o correo)

**User Story:** Como emprendedor, quiero buscar clientes facilmente por nombre o correo, para encontrarlos rapido sin recordar el telefono.

#### Acceptance Criteria

1. WHEN el emprendedor escribe en el buscador de clientes THEN el sistema SHALL filtrar por coincidencia parcial en nombre O correo (insensible a mayusculas/minusculas).
2. THE busqueda SHALL seguir soportando telefono como criterio adicional, sin romper el filtro actual.
3. WHILE el emprendedor escribe THE resultados SHALL actualizarse de forma responsiva (con debounce para no saturar el backend).
4. WHERE no hay coincidencias THE UI SHALL mostrar un estado vacio claro.

### Requirement 2: Metricas de comportamiento por cliente

**User Story:** Como emprendedor, quiero ver cuantas veces un cliente asistio, cancelo y no asistio, para conocer su comportamiento.

#### Acceptance Criteria

1. WHEN el emprendedor abre el detalle de un cliente THEN el sistema SHALL mostrar los conteos de asistencias (COMPLETED), cancelaciones (CANCELLED) e inasistencias (NO_SHOW) de ese cliente.
2. THE conteos SHALL calcularse scoped por tenant (solo citas del negocio actual).
3. THE calculo SHALL basarse en los estados reales de las citas del cliente, sin duplicar datos.

### Requirement 3: Indicador de tendencia a no asistir (solo en panel de citas)

**User Story:** Como emprendedor, quiero ver en el panel de citas si un cliente tiende a no asistir, para tomar precauciones.

#### Acceptance Criteria

1. WHERE una cita en el panel pertenece a un cliente con tendencia a no asistir THE UI SHALL mostrar un indicador discreto (badge) en esa cita.
2. THE tendencia SHALL determinarse por un umbral configurable/razonable (p. ej. NO_SHOW >= N o proporcion de inasistencias sobre citas cerradas por encima de un porcentaje), con un minimo de citas para evitar falsos positivos.
3. THE indicador SHALL aparecer UNICAMENTE en el panel de citas (no en el portal publico ni en otras vistas del cliente).

### Requirement 4: Suspender o bloquear clientes por mal comportamiento

**User Story:** Como emprendedor, quiero suspender/bloquear a clientes con muchas inasistencias, para evitar que sigan reservando.

#### Acceptance Criteria

1. WHEN el emprendedor bloquea a un cliente THEN el sistema SHALL marcar Customer.status como bloqueado (p. ej. "blocked") de forma scoped por tenant.
2. IF un cliente esta bloqueado THEN el sistema SHALL impedir que se cree una nueva cita para ese cliente (en el panel y en el portal publico), devolviendo un error claro.
3. WHEN el emprendedor desbloquea a un cliente THEN el sistema SHALL restaurar Customer.status a "active".
4. THE bloqueo SHALL ser reversible y no destruir el historial del cliente.

### Requirement 5: Grafica de comportamiento por mes (compacta en el dashboard)

**User Story:** Como emprendedor, quiero ver una grafica pequena de comportamiento por mes en el dashboard, para tener una vision general sin que ocupe toda la pantalla.

#### Acceptance Criteria

1. THE dashboard SHALL incluir una grafica mensual (asistencias/cancelaciones/inasistencias) en un formato COMPACTO (tamano reducido, no a pantalla completa).
2. THE grafica SHALL usar datos agregados por mes scoped por tenant.
3. THE grafica NO SHALL dominar la vista: debe convivir con el resto del resumen sin robar el foco.

### Requirement 6: Cancelaciones en el resumen del dashboard

**User Story:** Como emprendedor, quiero ver las cancelaciones en el resumen del dashboard, para monitorear ese indicador.

#### Acceptance Criteria

1. THE resumen del dashboard SHALL mostrar el conteo de cancelaciones (CANCELLED) del periodo, junto a los demas indicadores.
2. THE conteo SHALL respetar el rango de fechas del dashboard cuando aplique.

### Requirement 7: Rankings compactos de clientes

**User Story:** Como emprendedor, quiero ver clientes destacados (mas asistencias, mas inasistencias, mas recompensas) en un bloque pequeno, para reconocerlos sin saturar la pantalla.

#### Acceptance Criteria

1. THE seccion de usuarios/clientes SHALL mostrar rankings compactos: top por asistencias, top por inasistencias y top por recompensas.
2. THE rankings SHALL ser breves (top N corto) y ocupar poco espacio visual.
3. THE datos SHALL calcularse scoped por tenant.

### Requirement 8: Historial de citas discreto (foco en actuales/proximas)

**User Story:** Como emprendedor, quiero que las citas ya finalizadas se muevan a un historial discreto, para no perder el foco de mis citas actuales y proximas.

#### Acceptance Criteria

1. THE panel de citas SHALL destacar las citas ACTUALES y PROXIMAS (PENDING/CONFIRMED futuras) como vista principal.
2. THE citas finalizadas (COMPLETED, CANCELLED, NO_SHOW) o pasadas SHALL mostrarse en un modulo/historial secundario, visualmente discreto (debajo, con titulos pequenos), sin dominar la vista.
3. THE historial SHALL seguir siendo accesible y consultable, solo que sin robar la atencion principal.
4. THE reorganizacion NO SHALL alterar la ventana de gating premium existente (free ve [hoy-7, hoy+7]; premium ve todo/filtra).
