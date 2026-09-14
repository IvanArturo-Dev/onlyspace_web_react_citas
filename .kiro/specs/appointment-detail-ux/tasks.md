# Implementation Plan

## Overview

Mejoras UX de Citas (solo frontend): pago completado/parcial con faltante, notas en el
detalle, y acceso a Gestionar como icono en el header del detalle. Extension minima del
componente Modal. Sin cambios de backend.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "4"] }
  ]
}
```

## Tasks

- [ ] 1. Extender Modal con headerAction
  - En `frontend-web/src/components/Modal.tsx`, agregar prop opcional `headerAction?: ReactNode`.
  - Renderizarla en el header a la IZQUIERDA del boton de cerrar (contenedor flex con gap).
  - Sin headerAction, el header se ve igual que hoy (retrocompatible).
  - `tsc --noEmit`.
  - _Requirements: 3.5, 4.1_

- [ ] 2. Pago completado / parcial con faltante
  - En `Appointments.tsx`, seccion de pago del modal Gestionar: agregar selector `payKind` (Completado/Parcial).
  - Completado: ocultar adelanto; al guardar enviar amount_paid = total.
  - Parcial: input de adelanto (amount_paid) + mostrar faltante = max(0, total - adelanto) en vivo.
  - Precargar payKind desde payment_status (paid->completado; partial/unpaid->parcial con adelanto actual).
  - Validar montos en cliente; mantener llamada a updatePayment(total, paid, currency) y el mapeo de 400.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.2_

- [ ] 3. Notas en el detalle de la cita
  - Mover la carga de notas a openDetails (loadNotes(a.id)).
  - Agregar seccion "Notas internas" (lista + agregar + eliminar) en el cuerpo del modal de Detalle.
  - Quitar la seccion de Notas del modal de Gestionar.
  - Actualizar sin cerrar el modal al agregar/eliminar.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 4. Gestionar como icono en el header del Detalle
  - Pasar `headerAction` al Modal de Detalle: icono de engrane con title/aria-label "Gestionar cita" que cierra detalle y abre Gestionar.
  - Mostrarlo solo cuando la cita no es pasada y no esta cancelada (coherente con hoy).
  - Eliminar el boton "Gestionar" con texto de la fila de acciones inferior.
  - `tsc --noEmit` + `vite build`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

## Notes
- Sin cambios de backend: updatePayment y notas usan los endpoints existentes.
- El faltante se calcula y muestra en cliente; el backend solo recibe total y pagado.
- headerAction es opcional para no romper otros modales.
