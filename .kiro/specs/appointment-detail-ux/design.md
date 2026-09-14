# Design Document

## Overview

Cambios solo de frontend en el modulo de Citas (Appointments.tsx) y una extension
minima del componente Modal. Sin cambios de backend: el pago sigue usando
updatePayment(amount_total, amount_paid, currency).

## Architecture

```
Modal (extendido): prop opcional headerAction (ReactNode) a la izquierda de la X.

Detalle de cita:
  - Header: icono engrane (headerAction) -> abre Gestionar.
  - Cuerpo: datos + SECCION Notas (listar + agregar + eliminar).
  - Fila de acciones: SIN boton Gestionar (movido al header).

Gestionar:
  - Pago: selector Completado/Parcial + total + (adelanto/faltante si parcial).
  - SIN seccion de Notas (movida al detalle).
```

## Components and Interfaces

### 1. Modal.tsx (extension)
- Nueva prop opcional `headerAction?: ReactNode`. Se renderiza en el header, ANTES del
  boton de cerrar (a su izquierda), dentro de un contenedor flex con gap. Si no se pasa,
  el header se ve igual que hoy. No rompe usos existentes.

### 2. Pago (dentro del modal Gestionar)
- Estado nuevo: `payKind: "completed" | "partial"`.
- Campos: `amountTotal` (input numerico, se conserva) y para parcial `amountPaid`
  (adelanto). Para completado, el adelanto no se muestra (se enviara = total).
- Faltante mostrado en vivo: `Math.max(0, Number(amountTotal) - Number(amountPaid))`,
  formateado con la moneda. Solo visible en parcial.
- Precarga al abrir gestion: si payment_status === "paid" -> payKind="completed"; si
  "partial" o "unpaid" -> payKind="partial" con amountPaid = amount_paid actual.
- Al guardar (handleSavePayment): si completed -> paid = total; si partial -> paid =
  adelanto capturado. Validaciones: total y paid finitos, >=0, paid<=total (ya existe la
  del backend; reforzar en cliente y mapear 400). Llama updatePayment sin cambios.
- Cuando payKind="partial" y adelanto >= total, el faltante se muestra 0 (o se sugiere
  cambiar a completado); no bloquear, pero evitar enviar paid>total.

### 3. Notas movidas al Detalle
- Mover el estado y handlers de notas (notes, notesLoading, notesError, newNote,
  noteSaving, loadNotes, handleAddNote, handleDeleteNote) para que se usen desde el modal
  de Detalle. Se cargan al abrir el detalle (openDetails llama loadNotes(a.id)).
- En el cuerpo del modal de Detalle, agregar una seccion "Notas internas": lista + form
  de agregar + eliminar por nota. Misma UI que hoy tiene el modal de gestion.
- Quitar la seccion de Notas del modal de Gestionar.

### 4. Gestionar como icono en el header del Detalle
- En el <Modal> del Detalle, pasar `headerAction={<button title="Gestionar cita" ...>engrane</button>}`
  que ejecute: cerrar detalle + openManage(detailsAppt). Solo mostrarlo cuando la cita NO
  es pasada (coherente con que las pasadas solo permiten archivar) y no esta cancelada,
  igual que hoy se mostraba el boton Gestionar.
- Eliminar el boton "Gestionar" con texto de la fila de acciones inferior.

## Data Models
- Ninguno. Sin cambios de backend ni tipos de API (updatePayment igual).

## Error Handling
- Pago: montos invalidos -> mensaje en el modal; 400 VALIDATION_ERROR (paid>total) ->
  mensaje claro (ya existe).
- Notas: errores de carga/agregar/eliminar -> mensaje en la seccion de notas del detalle.

## Correctness Properties

### Property 1: Completado envia paid=total
Con "Pago completado", updatePayment recibe amount_paid igual a amount_total.

**Validates: Requirements 1.2**

### Property 2: Parcial calcula faltante
Con "Pago parcial", el faltante mostrado es total - adelanto (>= 0) y se recalcula en vivo.

**Validates: Requirements 1.3, 1.4**

### Property 3: Notas en el detalle
El detalle lista, agrega y elimina notas; el modal de gestion ya no las muestra.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 4: Gestionar en el header
El detalle expone un icono de engrane a la izquierda de la X que abre Gestionar; el boton de texto se elimina.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Modal retrocompatible
headerAction es opcional; los demas usos del Modal se ven y funcionan igual.

**Validates: Requirements 3.5, 4.1**

## Testing Strategy
1. Verificacion manual: pago completado (paid=total, estado Pagado); parcial (adelanto +
   faltante en vivo, estado Parcial); precarga correcta al reabrir.
2. Notas: agregar/eliminar desde el detalle; confirmar que ya no estan en gestionar.
3. Icono de gestionar abre el modal correcto; boton de texto eliminado; Modal sin
   headerAction (otros modales) intacto.
4. `tsc --noEmit` 0 errores; `vite build` exitoso.
