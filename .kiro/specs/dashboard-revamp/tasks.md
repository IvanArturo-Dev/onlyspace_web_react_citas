# Implementation Plan

## Overview

Rediseno del Dashboard del emprendedor (solo frontend): filtro de rango, KPIs mas
claros, y graficas SVG propias (dona por estado + barras por dia). Sin backend ni
dependencias nuevas.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Componentes de grafica SVG propios
  - Crear `frontend-web/src/components/charts/DonutChart.tsx` y `BarChart.tsx` (SVG, responsivos via viewBox, colores desde tokens var(--...), leyenda/valores textuales, aria-label).
  - Manejar estado vacio (todos los valores en 0).
  - Verificar `tsc --noEmit`.
  - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 5.2_

- [ ] 2. Filtro de rango + derivaciones en Dashboard
  - Agregar estado `range` ("today"|"7d"|"30d", default "7d") y selector junto al de sucursal.
  - `rangeBounds(range)` y filtrado de citas por start_time en el rango.
  - Derivar byStatus y serie por dia (useMemo) acotadas al rango + sucursal.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1_

- [ ] 3. Integrar graficas y rediseno de layout
  - Insertar DonutChart (por estado) y BarChart (por dia) alimentadas por las derivaciones.
  - Reordenar secciones: BrandHeader -> filtros -> KPIs -> graficas -> Hoy -> Proximas; grids responsivos con tokens existentes.
  - Estado vacio de graficas cuando no hay citas en el rango.
  - _Requirements: 2.3, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Verificacion
  - `npx tsc --noEmit` y `npx vite build` sin errores.
  - Revisar los 3 rangos con datos reales, responsividad y estado vacio.
  - Confirmar que package.json no gano dependencias.
  - _Requirements: 5.3_

## Notes
- Sin cambios de backend: todo se calcula en cliente desde listAppointments.
- Graficas SVG propias; NO agregar recharts/chart.js ni similares.
- Reusar el calculo de KPIs actual, acotandolo al rango donde aplique.
