# Requirements Document

## Introduction

Mejoras de UX en el modulo de Citas del panel del emprendedor (frontend), sin cambios
de backend:
1. Pago: reemplazar la captura de dos numeros por un selector "Pago completado" /
   "Pago parcial". En parcial se captura el monto del adelanto y se muestra el faltante
   (total - adelanto) en vivo. En completado, pagado = total.
2. Notas internas: moverlas del modal "Gestionar" al modal de "Detalle de cita", con
   una accion para agregar nota ahi mismo.
3. Acceso a "Gestionar": presentarlo como un icono de engrane en la barra de titulo del
   modal de Detalle, a la IZQUIERDA del icono de cerrar (la X), en lugar del boton con
   texto en la fila de acciones.

Contexto actual: el modal de gestion tiene un formulario de pago con inputs Total y
Pagado (el backend deriva payment_status via updatePayment). Las notas (listar/agregar/
eliminar) viven en el modal de gestion. El acceso a "Gestionar" es un boton con texto en
la fila de acciones del modal de detalle. El componente Modal solo acepta title y una X
de cerrar.

El backend `updatePayment(amount_total, amount_paid, currency)` NO cambia: sigue
recibiendo total y pagado y derivando el estado (unpaid/partial/paid).

## Glossary

- **Pago completado**: pagado = total (payment_status = paid).
- **Pago parcial**: 0 < adelanto < total (payment_status = partial); faltante = total - adelanto.
- **Adelanto**: monto pagado en un pago parcial (amount_paid).
- **Faltante**: total - adelanto, mostrado al usuario.
- **headerAction**: nodo opcional en la barra de titulo del Modal, a la izquierda de la X.

## Requirements

### Requirement 1: Selector de tipo de pago (completado / parcial)

**User Story:** Como emprendedor, quiero indicar si el pago fue completo o parcial y, si
es parcial, registrar el adelanto y ver el faltante.

#### Acceptance Criteria

1. EL formulario de pago DEBERA mostrar un selector con dos opciones: "Pago completado" y
   "Pago parcial".
2. CUANDO se elige "Pago completado" ENTONCES el sistema DEBERA enviar amount_paid = total
   (payment_status resultante = paid).
3. CUANDO se elige "Pago parcial" ENTONCES el sistema DEBERA permitir capturar el monto
   del adelanto (amount_paid) y DEBERA mostrar el faltante (total - adelanto) calculado en
   vivo.
4. EL sistema DEBERA validar que en parcial el adelanto sea >= 0 y <= total (si adelanto
   >= total, sugerir/forzar "completado" o mostrar faltante 0).
5. EL total DEBERA seguir siendo capturable; el envio DEBERA usar el endpoint existente
   updatePayment(amount_total, amount_paid, currency) sin cambios de backend.
6. AL abrir el formulario con un pago existente, el selector DEBERA reflejar el estado
   actual (paid -> completado; partial/unpaid -> parcial con el adelanto actual).

### Requirement 2: Notas en el detalle de la cita

**User Story:** Como emprendedor, quiero ver y agregar notas desde el detalle de la cita.

#### Acceptance Criteria

1. EL modal de Detalle de cita DEBERA mostrar la lista de notas internas de esa cita.
2. EL modal de Detalle DEBERA incluir una accion para agregar una nota (campo + boton).
3. AL agregar una nota desde el detalle, la lista DEBERA actualizarse sin cerrar el modal.
4. LAS notas DEBERAN poder eliminarse desde el detalle (como hoy en gestion).
5. LAS notas DEBERAN dejar de mostrarse en el modal de Gestionar (para no duplicar).
6. LAS notas DEBERAN seguir siendo internas (no se exponen al cliente).

### Requirement 3: Acceso a Gestionar como icono en la barra de titulo

**User Story:** Como emprendedor, quiero abrir la gestion avanzada desde un icono junto a
la X del detalle, para una barra de acciones mas limpia.

#### Acceptance Criteria

1. EL modal de Detalle DEBERA mostrar un icono de engrane (gestionar) en la barra de
   titulo, a la IZQUIERDA del icono de cerrar (X).
2. AL hacer clic en ese icono ENTONCES DEBERA abrirse el modal de Gestionar de la cita
   actual (misma funcion que hoy).
3. EL boton "Gestionar" con texto en la fila de acciones inferior DEBERA eliminarse (queda
   reemplazado por el icono del encabezado).
4. EL icono DEBERA tener aria-label/title accesible ("Gestionar cita").
5. EL componente Modal DEBERA soportar un nodo opcional en su barra de titulo (headerAction)
   sin romper los demas usos del Modal.

### Requirement 4: No regresion

**User Story:** Como usuario, quiero que el resto de la gestion de citas siga igual.

#### Acceptance Criteria

1. EL resto del modal de Gestionar (reprogramar, telefono, WhatsApp, modalidad, URL de
   videollamada) DEBERA seguir funcionando igual.
2. LA derivacion de payment_status en el backend DEBERA permanecer intacta.
3. EL sistema DEBERA compilar (tsc) y construir (vite build) sin errores.
