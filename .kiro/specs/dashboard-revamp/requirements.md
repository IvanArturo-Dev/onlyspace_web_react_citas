# Requirements Document

## Introduction

Rediseno del dashboard del emprendedor para hacerlo mas claro y mejor distribuido, y
agregar graficas de citas por estado (confirmadas, pendientes, canceladas,
completadas, no-asistio) con un filtro de rango de tiempo (hoy / 7 dias / 30 dias).

Contexto actual: el dashboard ya calcula metricas en cliente a partir de
`listAppointments`, muestra tarjetas de resumen y un bloque "Citas por estado" con
numeros, mas listas de Hoy y Proximas. No hay graficas visuales ni filtro de rango.
El proyecto no tiene libreria de graficas; se usaran graficas SVG ligeras propias
(sin dependencias nuevas), consistentes con el estilo inline del proyecto.

## Glossary

- **Rango**: ventana temporal para las metricas: hoy | 7 dias | 30 dias.
- **Grafica de dona**: distribucion de citas por estado en un anillo SVG.
- **Grafica de barras**: citas por dia (o por estado) en barras SVG.
- **Estado**: PENDING, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW.

## Requirements

### Requirement 1: Filtro de rango temporal

**User Story:** Como emprendedor, quiero elegir el rango (hoy / 7 / 30 dias) para ver
mis metricas en ese periodo.

#### Acceptance Criteria

1. EL dashboard DEBERA ofrecer un selector de rango con opciones: Hoy, 7 dias, 30 dias.
2. CUANDO se cambia el rango ENTONCES las metricas y graficas DEBERAN recalcularse
   para citas cuyo start_time cae en ese rango.
3. EL filtro de rango DEBERA combinarse con el filtro de sucursal existente.
4. EL rango por defecto DEBERA ser 7 dias.

### Requirement 2: Grafica de citas por estado

**User Story:** Como emprendedor, quiero ver de un vistazo la distribucion de mis
citas por estado.

#### Acceptance Criteria

1. EL dashboard DEBERA mostrar una grafica (dona o barras) con el conteo por estado:
   pendientes, confirmadas, completadas, canceladas, no-asistio.
2. CADA segmento/barra DEBERA tener etiqueta y valor legibles (no depender solo del
   color, por accesibilidad).
3. LA grafica DEBERA reflejar el rango y la sucursal seleccionados.
4. SI no hay citas en el rango ENTONCES DEBERA mostrar un estado vacio claro.

### Requirement 3: Grafica de tendencia (citas por dia)

**User Story:** Como emprendedor, quiero ver como se distribuyen mis citas en el
tiempo dentro del rango.

#### Acceptance Criteria

1. PARA rangos de 7 y 30 dias EL dashboard DEBERA mostrar una grafica de barras de
   citas por dia.
2. LAS barras DEBERAN indicar el dia y el total; opcionalmente segmentar por estado.
3. LA grafica DEBERA reflejar el rango y la sucursal seleccionados.

### Requirement 4: Rediseno y distribucion

**User Story:** Como emprendedor, quiero un dashboard mas entendible y ordenado.

#### Acceptance Criteria

1. EL dashboard DEBERA organizar el contenido en secciones claras: encabezado con
   branding, filtros (sucursal + rango), KPIs principales, graficas, y listas de Hoy/
   Proximas.
2. LOS KPIs principales (hoy, proximas, por confirmar, cobrado, por cobrar) DEBERAN
   presentarse de forma clara y responsiva.
3. LA vista DEBERA ser responsiva (apilarse en pantallas chicas) y usar los tokens de
   estilo existentes (var(--...)).
4. EL branding del emprendedor (logo/titulo/color) DEBERA seguir mostrandose como hoy.

### Requirement 5: No regresion

**User Story:** Como usuario, quiero que el dashboard siga cargando datos reales sin
romperse.

#### Acceptance Criteria

1. LAS metricas DEBERAN calcularse desde datos reales del tenant (listAppointments),
   scoped por sucursal cuando aplique.
2. NO DEBERA introducir dependencias nuevas de terceros (graficas via SVG propio).
3. EL sistema DEBERA compilar (tsc) y construir (vite build) sin errores.
