# Implementation Plan

## Overview

Plan para las mejoras de reglas, permisos y UX de citas: regla anti-duplicado (cliente/dia/servicio), nuevo texto por defecto del recordatorio, renombrado Asistentes a Colaboradores, dashboard mejorado, permisos de colaborador, y reescritura de la vista de Citas (acciones rapidas, indicadores de ocupacion, secciones Hoy/Proximas).

Estrategia incremental:
1. Backend: regla anti-duplicado (booking + panel) + pruebas.
2. Backend: nuevo mensaje por defecto de recordatorio.
3. Backend: permisos (customers = requireStaff) + pruebas de roles.
4. Frontend: renombrar a Colaboradores + navegacion por rol.
5. Frontend: dashboard mejorado.
6. Frontend: Citas (acciones rapidas, Hoy/Proximas, indicadores) + Mi Codigo solo-lectura.
7. Verificacion end-to-end.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["1.1", "3.1", "4"] },
    { "wave": 3, "tasks": ["5", "6"] },
    { "wave": 4, "tasks": ["7"] }
  ],
  "dependencies": {
    "1.1": ["1"],
    "3.1": ["3"],
    "4": ["3"],
    "5": ["4"],
    "6": ["4"],
    "7": ["1", "2", "3", "5", "6"]
  }
}
```

## Tasks

- [x] 1. Regla anti-duplicado (cliente/dia/servicio)
  - En bookingService.createPublicBooking y createBranchBooking: dentro de la transaccion, antes del chequeo de aforo, rechazar con 409 DUPLICATE_BOOKING si el mismo customer_id ya tiene una cita status != CANCELLED del mismo service_id en el rango del dia de start_time
  - En appointmentService.createAppointment: misma verificacion con el customer_id recibido
  - En appointmentService.updateAppointment: si cambia service_id o el dia de start_time, verificar que no exista OTRA cita activa del mismo cliente/servicio ese dia (id != actual) -> 409 DUPLICATE_BOOKING, manteniendo el chequeo de aforo
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 1.1 Pruebas de anti-duplicado (Property 1, 2)
  - Segundo booking mismo cliente/servicio/dia -> 409 (publico, sucursal y panel); cancelada no cuenta; verificacion en la transaccion; scoped por tenant; update que generaria duplicado -> 409
  - _Requirements: 1.1, 1.4, 1.6, 1.7_
  - _Properties: Property 1 (anti-duplicado), Property 2 (consistente y aislado)_

- [x] 2. Nuevo mensaje por defecto de recordatorio
  - Cambiar DEFAULT_TEMPLATE en whatsapp.service.ts por el texto nuevo (Requirement 2.1); actualizar el placeholder por defecto en la interfaz (MiCodigo WhatsappCard) para que coincida
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Permisos: clientes solo para staff
  - customer.routes: anteponer requireStaff (ADMIN | ASSISTANT) en list/get/create/update/patch/delete (cadena authenticated + requireStaff coherente con appointments)
  - Confirmar que las rutas de configuracion siguen en requireAdmin (sucursales, horarios, categorias, asuetos, lealtad, modulos, usuarios, me/business)
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 3.1 Pruebas de permisos (Property 4)
  - Matriz de roles: ASSISTANT puede clientes (200) y citas; CLIENT en clientes -> 403; ASSISTANT en rutas de config -> 403
  - _Requirements: 5.2, 5.3, 5.5_
  - _Properties: Property 4 (permisos de colaborador)_

- [x] 4. Frontend: renombrar a Colaboradores + navegacion por rol
  - Reemplazar textos visibles Asistente(s) por Colaborador(es) (Layout nav, pagina de gestion, etiqueta de rol del super admin en AdminUsers)
  - Layout: para rol ASSISTANT mostrar solo Dashboard, Citas, Clientes, Mi Codigo; ocultar el resto
  - Mi Codigo: si el rol es ASSISTANT, ocultar la seccion de WhatsApp del negocio (solo-lectura)
  - _Requirements: 3.1, 3.2, 3.4, 5.4, 5.6_

- [x] 5. Frontend: dashboard del emprendedor mejorado
  - Metricas utiles (citas de hoy, proximas, pagos si disponibles), seccion destacada de citas de HOY con estado/hora, accesos rapidos, jerarquia visual y estados de carga/error; respeta el filtro de sucursal
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 9.1, 9.2, 9.3_

- [x] 6. Frontend: Citas (acciones rapidas, Hoy/Proximas, indicadores)
  - Separar secciones Hoy / Proximas (y opcional Pasadas) con contador y orden por hora
  - Acciones rapidas por cita (confirmar/completar/cancelar/no-show + Recordatorio WhatsApp) con icono + etiqueta; cancelar con confirmacion; gestion avanzada en el modal existente
  - Indicador de ocupacion al elegir sucursal+servicio+dia con cupo usado/total cuando capacity > 1 (color + texto)
  - Traducir 409 DUPLICATE_BOOKING y 409 SLOT_TAKEN a mensajes claros y distintos
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

- [x] 7. Verificacion end-to-end
  - Anti-duplicado: dos reservas misma categoria/dia/cliente (publico y panel) -> segunda 409; cancelar -> se permite; update que duplica -> 409
  - Recordatorio sin plantilla propia -> texto nuevo por defecto
  - Colaborador: ve solo citas/clientes/Mi Codigo (solo lectura); config -> 403; puede agendar/editar/cancelar/recordatorio/agregar cliente
  - Dashboard y Citas: metricas, Hoy/Proximas, acciones rapidas, indicadores; matriz de roles
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.2, 6.1, 7.1, 8.1_

## Notes

- El rol tecnico ASSISTANT y las rutas /v1/assistants no cambian; solo cambian textos visibles a Colaborador.
- DUPLICATE_BOOKING (regla por cliente/dia/categoria) es distinto de SLOT_TAKEN (aforo); mensajes separados.
- La regla anti-duplicado se verifica dentro de la misma transaccion que la reserva.
- Subtareas con _Properties: son candidatas a pruebas basadas en propiedades.
