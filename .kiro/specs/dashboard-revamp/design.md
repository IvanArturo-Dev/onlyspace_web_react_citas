# Design Document

## Overview

Rediseno de Dashboard.tsx (solo frontend) con filtro de rango, KPIs mas claros, y
graficas SVG propias (dona por estado + barras por dia). Sin dependencias nuevas ni
cambios de backend: todo se calcula en cliente desde `listAppointments`.

## Architecture

```
listAppointments({ branch_id }) -> appointments[]
   -> filtrar por rango (hoy | 7d | 30d) sobre start_time
   -> derivar: KPIs, conteo por estado, serie por dia
   -> render: filtros, KPIs, DonutChart, BarChart, listas Hoy/Proximas
```

## Components and Interfaces

### 1. Estado y filtros
- Nuevo estado `range: "today" | "7d" | "30d"` (default "7d").
- Selector de rango junto al selector de sucursal existente.
- `rangeBounds(range)` -> { start, end } en ms (dia local): hoy = [inicio hoy, fin hoy);
  7d = [inicio hace 6 dias, fin hoy); 30d = [inicio hace 29 dias, fin hoy).
- Las metricas y graficas se derivan de las citas cuyo start_time cae en el rango.

### 2. Derivaciones (useMemo)
- `byStatus`: conteo por estado dentro del rango.
- `series`: array por dia { dayLabel, total, porEstado } dentro del rango (para barras).
- KPIs: hoy, proximas, por confirmar, cobrado, por cobrar (reusar logica actual,
  acotada al rango donde tenga sentido; hoy/proximas se mantienen como ahora).

### 3. Graficas SVG propias (nuevos componentes en el mismo archivo o components/charts)
- `DonutChart({ segments: {label, value, color}[] })`: anillo SVG con leyenda que
  muestra label + value (no solo color). Estado vacio si todos 0.
- `BarChart({ bars: {label, value}[] })`: barras verticales SVG con eje simple y
  valores; responsivo (viewBox + width 100%). Colores desde tokens var(--...).
- Accesibilidad: role/aria-label en el SVG y leyenda textual.

### 4. Layout
- Secciones: BrandHeader (existente) -> Filtros (sucursal + rango) -> KPIs (grid) ->
  Graficas (dona + barras, grid responsivo) -> Hoy -> Proximas.
- Usa tokens de estilo existentes; grids con minmax para responsividad.

## Data Models
- Ninguno. Solo frontend; sin cambios de backend ni schema.

## Error Handling
- Carga: spinner (existente). Error: caja con reintentar (existente).
- Rango sin datos: estado vacio claro en las graficas.

## Correctness Properties

### Property 1: Metricas dentro del rango
Todas las metricas y graficas cuentan solo citas con start_time en el rango seleccionado.

**Validates: Requirements 1.2, 2.3, 3.3**

### Property 2: Combinacion con sucursal
El filtro de rango se combina con el de sucursal; ambos acotan el mismo conjunto de citas.

**Validates: Requirements 1.3, 5.1**

### Property 3: Accesibilidad de graficas
Cada grafica expone etiquetas y valores textuales, no depende solo del color.

**Validates: Requirements 2.2**

### Property 4: Sin dependencias nuevas
Las graficas se implementan con SVG propio; no se agregan librerias de terceros.

**Validates: Requirements 5.2**

### Property 5: Estado vacio
Si no hay citas en el rango, las graficas muestran un estado vacio claro en vez de romperse.

**Validates: Requirements 2.4**

## Testing Strategy
1. Verificacion manual con datos reales del tenant de pruebas en los 3 rangos.
2. `tsc --noEmit` 0 errores y `vite build` exitoso.
3. Revisar responsividad (apilado en pantallas chicas) y estado vacio.
4. Confirmar que no se agrego ninguna dependencia (package.json sin cambios de deps).
