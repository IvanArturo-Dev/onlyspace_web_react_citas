# Requirements Document

## Introduction

Este documento define mejoras de reglas de negocio, permisos y experiencia (UX) sobre la gestion de citas ya existente. Amplia el sistema (multi-tenant, sucursales, aforo por servicio, pago manual, notas, recordatorio manual por WhatsApp, lealtad) con:

1. Una regla que impide que un mismo cliente tenga mas de una reservacion de la MISMA categoria/servicio en el MISMO dia.
2. Un nuevo texto por defecto del mensaje de recordatorio de WhatsApp.
3. El renombrado de "Asistentes" a "Colaboradores" en toda la interfaz.
4. Un dashboard del emprendedor mas util y claro.
5. Un alcance de permisos explicito para colaboradores.
6. Controles mas intuitivos en Citas, con acciones rapidas (incluido el recordatorio).
7. Indicadores visuales para identificar rapidamente horarios disponibles y ocupados.
8. Separacion de las citas de HOY y las PROXIMAS en secciones bien distribuidas.
9. Mejora general de las vistas.

Decisiones de negocio tomadas:
- La regla "una por dia/categoria" identifica al cliente por su Customer (o su correo) dentro del tenant, considera solo citas NO canceladas, y aplica tanto en el portal publico del cliente como cuando el emprendedor/colaborador agenda desde el panel.
- "Asistente" pasa a llamarse "Colaborador" SOLO a nivel de interfaz/etiquetas; el rol tecnico interno y los modelos existentes se mantienen para no romper la logica ya probada.
- Los colaboradores (rol interno ASSISTANT) pueden: crear/editar/cancelar/reprogramar citas, agregar clientes, enviar recordatorios de WhatsApp y compartir el codigo/QR (solo lectura). NO pueden: configurar sucursales, horarios, categorias, asuetos, lealtad, modulos, usuarios, ni el WhatsApp del negocio.
- El colaborador ve "Mi Codigo" en modo solo-lectura (codigo + enlace + QR) sin la seccion de configuracion de WhatsApp del negocio.

Se reutiliza: modelos Appointment/Service/Customer/Branch/Tenant, availabilityService/bookingService, guards requireStaff/requireAdmin, y el frontend con tema claro/oscuro.

## Glossary

- **Colaborador:** usuario con rol interno ASSISTANT; personal del negocio con permisos limitados a la operacion de citas y clientes. Se muestra como "Colaborador" en la interfaz.
- **Categoria/servicio:** el Service de la cita (la reserva es de un servicio concreto).
- **Cita activa:** cita en estado distinto de CANCELLED.
- **Dia (para la regla):** el dia calendario de start_time de la cita.
- **Horario ocupado/disponible:** un slot esta ocupado cuando el numero de citas activas solapadas del servicio alcanza su capacidad; disponible mientras sea menor.

## Requirements

### Requirement 1: Una reservacion por cliente, dia y categoria

**User Story:** Como negocio, quiero impedir que un mismo cliente reserve dos veces la misma categoria el mismo dia, para evitar duplicados.

#### Acceptance Criteria

1. WHEN un cliente intenta reservar un servicio para un dia en el que ya tiene una cita ACTIVA (no cancelada) del MISMO servicio THEN el sistema SHALL rechazar la reserva con 409 DUPLICATE_BOOKING.
2. THE la verificacion SHALL identificar al cliente por su Customer dentro del tenant (o por su correo cuando aplique en el portal publico).
3. THE la regla SHALL aplicar tanto en el portal publico del cliente como cuando el emprendedor o un colaborador agenda desde el panel.
4. THE una cita CANCELADA NO SHALL contar para la regla.
5. THE la comparacion de "mismo dia" SHALL usar el dia calendario del start_time.
6. THE la verificacion SHALL ocurrir junto con la validacion de disponibilidad, sin permitir duplicados por concurrencia.
7. THE la regla SHALL respetar el aislamiento por tenant.

### Requirement 2: Nuevo mensaje por defecto de recordatorio

**User Story:** Como emprendedor, quiero un texto de recordatorio mas formal por defecto, para comunicarme mejor con mis clientes.

#### Acceptance Criteria

1. THE plantilla por defecto del recordatorio de WhatsApp SHALL ser: "Estimado/a {cliente}, le recordamos que tiene una cita programada para el dia {fecha} a las {hora} en {negocio}. Agradecemos llegar unos minutos antes. Quedamos a su disposicion si requiere algun cambio en su reserva."
2. THE las variables {cliente}, {fecha}, {hora}, {negocio} SHALL rellenarse con los datos reales de la cita.
3. WHERE el negocio configuro su propia plantilla THE se SHALL usar la del negocio en lugar de la de por defecto.
4. THE el texto por defecto mostrado como placeholder en la interfaz de configuracion SHALL coincidir con el nuevo texto.

### Requirement 3: Renombrar "Asistentes" a "Colaboradores"

**User Story:** Como usuario, quiero ver "Colaboradores" en la interfaz, para reflejar mejor el rol.

#### Acceptance Criteria

1. THE toda etiqueta visible de "Asistente(s)" en la interfaz SHALL mostrarse como "Colaborador(es)".
2. THE la navegacion, titulos, botones y textos de ayuda SHALL usar "Colaboradores".
3. THE el rol tecnico interno y los identificadores de codigo/API NO SHALL cambiar.
4. WHERE el super admin muestra el rol del usuario THE SHALL mostrarse como "Colaborador".

### Requirement 4: Dashboard del emprendedor mejorado

**User Story:** Como emprendedor, quiero un dashboard claro y accionable, para entender mi operacion de un vistazo.

#### Acceptance Criteria

1. THE dashboard SHALL mostrar metricas utiles del negocio/sucursal seleccionada: citas de hoy, proximas, e ingresos/pagos si estan disponibles.
2. THE dashboard SHALL resaltar las citas de HOY con su estado y hora.
3. THE dashboard SHALL presentar la informacion con una jerarquia visual clara y estados de carga/error.
4. THE dashboard SHALL ofrecer accesos rapidos a las acciones comunes.
5. THE dashboard SHALL respetar el filtro por sucursal existente.

### Requirement 5: Permisos de colaboradores

**User Story:** Como emprendedor, quiero que mis colaboradores solo operen citas y clientes, para proteger la configuracion.

#### Acceptance Criteria

1. THE colaborador SHALL poder crear citas, reprogramar/modificar citas, cancelar citas, agregar/editar clientes, enviar recordatorios de WhatsApp y compartir el codigo/QR.
2. THE colaborador NO SHALL poder configurar sucursales, horarios, categorias, dias de asueto, programas de lealtad, modulos, usuarios ni el WhatsApp del negocio.
3. WHERE un colaborador intenta una accion de configuracion THE el backend SHALL responder 403 y la interfaz NO SHALL ofrecer esos accesos.
4. THE la navegacion del colaborador SHALL mostrar solo las secciones permitidas (citas, clientes, y "Mi Codigo" en solo-lectura).
5. THE la creacion/edicion de clientes SHALL requerir rol de staff (emprendedor o colaborador), no un cliente final.
6. THE el colaborador SHALL ver "Mi Codigo" en solo-lectura: codigo, enlace y QR, sin la configuracion de WhatsApp del negocio.

### Requirement 6: Controles intuitivos y acciones rapidas en Citas

**User Story:** Como usuario del panel, quiero acciones rapidas en cada cita, para operar mas rapido.

#### Acceptance Criteria

1. THE cada cita SHALL exponer acciones rapidas segun su estado (confirmar, completar, cancelar, no asistio) y una accion rapida de "Recordatorio WhatsApp".
2. THE la accion de recordatorio SHALL abrir el enlace de WhatsApp prellenado con el menor numero de pasos posible.
3. THE las acciones SHALL ser claras (iconos/etiquetas), accesibles y coherentes con el tema.
4. THE las acciones destructivas (cancelar) SHALL pedir confirmacion.
5. THE la gestion avanzada (pago, notas, reprogramar, telefono) SHALL seguir disponible sin saturar la vista principal.

### Requirement 7: Indicadores de disponibilidad/ocupacion

**User Story:** Como usuario del panel, quiero ver rapidamente que horarios estan libres u ocupados, para agendar mejor.

#### Acceptance Criteria

1. THE la interfaz de Citas SHALL mostrar de forma visual los horarios ocupados y disponibles de un dia/sucursal/servicio.
2. WHERE un servicio tiene aforo > 1 THE el indicador SHALL reflejar el cupo usado vs total (p. ej. 2/3).
3. THE los indicadores SHALL usar color y texto (no solo color) para ser accesibles.
4. THE al agendar THE la interfaz SHALL ayudar a elegir un horario disponible mostrando slots libres.

### Requirement 8: Citas de hoy y proximas separadas

**User Story:** Como usuario del panel, quiero ver primero las de hoy y luego las proximas, para enfocarme en lo inmediato.

#### Acceptance Criteria

1. THE la vista de Citas SHALL separar claramente las citas de HOY de las PROXIMAS (y opcionalmente pasadas) en secciones distintas.
2. THE las secciones SHALL tener una buena distribucion visual y contador por seccion.
3. THE dentro de cada seccion las citas SHALL ordenarse por hora de inicio.
4. THE los filtros existentes (sucursal, estado, fechas) SHALL seguir funcionando junto con esta separacion.

### Requirement 9: Mejora general de vistas

**User Story:** Como usuario, quiero vistas mas cuidadas y profesionales, para una mejor experiencia.

#### Acceptance Criteria

1. THE las vistas afectadas (Dashboard, Citas, Mi Codigo, Colaboradores) SHALL tener una presentacion consistente, ordenada y responsiva.
2. THE se SHALL respetar el tema claro/oscuro y los tokens de estilo existentes.
3. THE los estados vacios, de carga y de error SHALL ser claros y consistentes.
4. THE los cambios NO SHALL romper funcionalidades existentes ni el aislamiento por rol/tenant.
