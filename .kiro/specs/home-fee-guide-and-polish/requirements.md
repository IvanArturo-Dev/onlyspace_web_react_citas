# Requirements Document

## Introduction

Cinco mejoras para onlyspace: (1) costo adicional configurable por servicio a domicilio a nivel de negocio (o leyenda "sin costo adicional"), mostrado al cliente al reservar; (2) detalle de la cita del cliente al dar clic, con ubicacion de la sucursal; (3) cambio del precio de suscripcion a 99 MXN/mes; (4) guia de uso para emprendedores con barra de progreso de configuracion; (5) mejora visual del QR y de la pagina Mi Codigo. Todo scoped por tenant y sin romper flujos existentes.

## Requirements

### Requirement 1: Costo adicional a domicilio

**User Story:** Como emprendedor que ofrece servicio a domicilio, quiero definir un recargo por desplazamiento (o indicar que no cobro extra), para que el cliente lo vea antes de reservar.

#### Acceptance Criteria
1. WHEN el emprendedor abre la configuracion del negocio THEN el sistema SHALL permitir capturar un monto de recargo a domicilio (>= 0) a nivel de negocio.
2. WHEN el recargo es 0 o esta vacio THEN el sistema SHALL tratarlo como "sin costo adicional".
3. WHEN el cliente elige la modalidad a domicilio al reservar THEN el sistema SHALL mostrar el recargo aplicable, o la leyenda "Sin costo adicional a domicilio" si es 0.
4. WHEN el negocio no ofrece la modalidad a domicilio THEN el sistema SHALL NOT mostrar el recargo.
5. WHEN se persiste la configuracion THEN el sistema SHALL guardar el recargo por tenant.

### Requirement 2: Detalle de la cita del cliente con ubicacion

**User Story:** Como cliente, quiero dar clic en mi cita y ver sus detalles y la ubicacion de la sucursal, para saber a donde ir.

#### Acceptance Criteria
1. WHEN el cliente da clic en una de sus citas THEN el sistema SHALL abrir un detalle con servicio, negocio, sucursal, fecha/hora, modalidad y estado.
2. IF la cita tiene sucursal con enlace de mapa THEN el sistema SHALL mostrar un boton "Como llegar" que abre la ubicacion.
3. IF la cita es a domicilio THEN el sistema SHALL mostrar la direccion capturada y su enlace de mapa.
4. IF la cita es en linea y tiene enlace de videollamada THEN el sistema SHALL mostrar el enlace para unirse.
5. WHEN el detalle se abre THEN el sistema SHALL conservar las acciones existentes (calificar cita completada) sin romperlas.

### Requirement 3: Precio de suscripcion 99 MXN

**User Story:** Como negocio, quiero ver el precio correcto de la suscripcion (99 MXN/mes), para decidir con informacion veraz.

#### Acceptance Criteria
1. WHEN el emprendedor ve la pagina de suscripcion THEN el sistema SHALL mostrar 99 MXN/mes.
2. WHEN se inicia el flujo de suscripcion THEN el sistema SHALL usar 99 como monto (variable de entorno SUBSCRIPTION_PRICE_MXN).
3. WHEN exista texto de precio en la UI THEN el sistema SHALL reflejar 99 de forma consistente.

### Requirement 4: Guia de uso con progreso

**User Story:** Como emprendedor nuevo, quiero una guia que me diga que configurar y cuanto llevo, para dejar mi negocio listo para recibir reservas.

#### Acceptance Criteria
1. WHEN el emprendedor abre la guia THEN el sistema SHALL mostrar los pasos: crear sucursal, crear servicio/categoria, configurar horarios, elegir modalidades, configurar WhatsApp, personalizar marca (opcional) y compartir el codigo/QR.
2. WHEN un paso ya esta cumplido segun los datos reales del negocio THEN el sistema SHALL marcarlo como completado.
3. WHEN se calcula el avance THEN el sistema SHALL mostrar una barra de progreso con el porcentaje de pasos obligatorios completados (los opcionales no penalizan).
4. WHEN el emprendedor pulsa un paso THEN el sistema SHALL llevarlo a la seccion correspondiente para configurarlo.
5. WHEN todos los pasos obligatorios esten completos THEN el sistema SHALL indicar que el negocio esta listo para recibir reservas.

### Requirement 5: Mejora visual del QR y de Mi Codigo

**User Story:** Como emprendedor, quiero que mi QR y la pantalla para compartirlo se vean mejor, para dar una imagen profesional.

#### Acceptance Criteria
1. WHEN el emprendedor abre Mi Codigo THEN el sistema SHALL mostrar el QR en una tarjeta con mejor jerarquia visual (marco/encuadre, contraste y espaciado).
2. WHEN se genera el QR THEN el sistema SHALL conservar su escaneabilidad (nivel de correccion alto y logo centrado en premium).
3. WHEN se descarga o comparte THEN el sistema SHALL conservar la funcionalidad existente (descargar PNG, compartir, copiar link).
4. WHEN cambie el estilo THEN el sistema SHALL respetar el tema claro/oscuro y la accesibilidad.