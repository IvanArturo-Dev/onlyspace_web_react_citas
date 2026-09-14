# Requirements Document

## Introduction

Crea un LANDING PUBLICO de descubrimiento de negocios para el cliente final. Hoy el
portal publico solo permite entrar por un codigo directo (`/reservar/<codigo>`) y una
busqueda basica por texto (`GET /public/search`) que devuelve nombre de negocio/
sucursal sin priorizacion ni categorias. Esta spec agrega una capa de descubrimiento
atractiva e interactiva: buscar por categoria (chips) y texto, ver primero los
negocios PREMIUM (los que pagaron) con su banner/marca, luego el resto, y una seccion
"Podria interesarte" basada en la busqueda/categoria actual. Desde una tarjeta el
cliente entra a reservar en la sucursal.

Reglas de negocio (confirmadas con el usuario):
1. El landing lista TODOS los negocios con reserva habilitada (booking_enabled).
2. Orden: primero los PREMIUM (con banner/marca destacada), luego los FREE (tarjeta
   simple sin banner). Dentro de cada grupo, orden estable (p.ej. nombre asc).
3. Solo los PREMIUM exponen banner/branding (coherente con premium-gating-v2: el free
   usa branding default y no muestra banner).
4. Filtro por CATEGORIA mediante chips (categorias disponibles) combinable con
   busqueda de TEXTO libre (nombre de negocio/sucursal/categoria).
5. Seccion "Podria interesarte": al buscar/filtrar, sugiere otros negocios de la misma
   categoria o similares (premium primero), sin requerir login ni historial.
6. Coherencia con branch-premium-gating: un negocio FREE expone en descubrimiento SOLO
   su sucursal principal; las extra no aparecen.
7. El emprendedor puede configurar la DIRECCION de cada sucursal (texto) y sus
   COORDENADAS (latitud/longitud, capturadas manualmente desde un mapa como Google
   Maps). Sin servicio externo de geocoding.
8. El cliente puede ordenar por CERCANIA ("Cerca de mi") usando la geolocalizacion del
   navegador; dentro de las sucursales cercanas se prioriza premium. Si no hay permiso
   o faltan coordenadas, cae al orden normal (premium primero).

## Glossary

- **Premium efectivo**: subscription_status=active y no vencido (isPremiumEffective).
- **Free**: negocio no premium.
- **Negocio reservable**: tenant con booking_enabled=true y al menos una sucursal activa.
- **Sucursal principal**: la sucursal mas antigua del tenant (menor created_at).
- **Tarjeta destacada**: tarjeta con banner/marca del negocio premium.
- **Categoria**: categoria de servicios del negocio (Category), p.ej. Cortes, Masajes.
- **Coordenadas**: latitud/longitud (Decimal) de una sucursal, capturadas manualmente.
- **Cercania**: orden por distancia geografica (Haversine) entre el cliente y la
  sucursal; no usa servicios externos.

## Requirements

### Requirement 1: Endpoint de descubrimiento

**User Story:** Como cliente, quiero explorar negocios disponibles con sus marcas y
categorias, para encontrar donde reservar.

#### Acceptance Criteria

1. EL backend DEBERA exponer un endpoint publico (p.ej. `GET /public/discover`) que
   devuelva negocios reservables con: nombre, sucursal principal (code para reservar),
   is_premium, categorias, y (solo si premium) branding/banner.
2. EL endpoint NO DEBERA requerir autenticacion ni exponer datos sensibles (clientes,
   citas, tokens).
3. EL endpoint DEBERA aceptar filtros opcionales: `q` (texto) y `category` (nombre o
   id de categoria).
4. LOS negocios FREE DEBERAN exponer SOLO su sucursal principal; las extra no aparecen.

### Requirement 2: Priorizacion premium

**User Story:** Como negocio premium, quiero aparecer primero y con mi marca, para
destacar frente a los gratuitos.

#### Acceptance Criteria

1. EL resultado DEBERA ordenar los negocios PREMIUM antes que los FREE.
2. LOS negocios PREMIUM DEBERAN incluir su banner/branding en la respuesta; los FREE
   NO DEBERAN incluir banner (branding default/omitido).
3. DENTRO de cada grupo (premium/free) el orden DEBERA ser estable y predecible
   (p.ej. nombre ascendente).

### Requirement 3: Busqueda por categoria y texto

**User Story:** Como cliente, quiero filtrar por categoria y por texto, para acotar la
busqueda a lo que necesito.

#### Acceptance Criteria

1. CUANDO el cliente selecciona una categoria (chip) ENTONCES el listado DEBERA
   mostrar solo negocios que ofrecen esa categoria.
2. CUANDO el cliente escribe texto ENTONCES DEBERA filtrar por nombre de negocio,
   nombre de sucursal o nombre de categoria (case-insensitive, contains).
3. LOS filtros de categoria y texto DEBERAN ser combinables.
4. EL backend DEBERA exponer las categorias disponibles para pintar los chips (p.ej.
   distintas categorias activas de negocios reservables).
5. LA priorizacion premium DEBERA mantenerse dentro de los resultados filtrados.

### Requirement 4: Seccion "Podria interesarte"

**User Story:** Como cliente, quiero ver sugerencias relacionadas con lo que busco,
para descubrir otras opciones.

#### Acceptance Criteria

1. CUANDO hay una categoria/busqueda activa ENTONCES el landing DEBERA mostrar una
   seccion de sugerencias con otros negocios de la misma categoria o similares.
2. LAS sugerencias DEBERAN priorizar negocios PREMIUM.
3. LAS sugerencias NO DEBERAN requerir login ni historial del cliente.
4. CUANDO no hay busqueda activa ENTONCES la seccion PUEDE mostrar destacados premium
   (o no mostrarse), sin romper la pagina.

### Requirement 5: Landing atractivo e interactivo

**User Story:** Como cliente, quiero un landing lindo y facil de usar, para explorar
con gusto y llegar rapido a reservar.

#### Acceptance Criteria

1. EL landing DEBERA presentar un hero/encabezado atractivo, buscador visible y chips
   de categoria interactivos.
2. LOS negocios premium DEBERAN mostrarse como tarjetas destacadas con banner/marca;
   los free como tarjetas simples.
3. CADA tarjeta DEBERA permitir ir a reservar (a `/reservar/<code>` de la sucursal
   principal) con un clic.
4. LA pagina DEBERA ser responsive y accesible (navegable por teclado, textos
   alternativos en imagenes, contraste adecuado).
5. ESTADOS vacios (sin resultados) DEBERAN mostrarse con un mensaje claro y una via
   para limpiar filtros.

### Requirement 7: Configuracion de direccion y ubicacion por sucursal

**User Story:** Como emprendedor, quiero capturar la direccion y las coordenadas de
cada sucursal, para que los clientes puedan ubicarme y buscar por cercania.

#### Acceptance Criteria

1. EL emprendedor DEBERA poder guardar por sucursal: direccion (texto libre), y
   opcionalmente ciudad, y coordenadas latitud/longitud.
2. LAS coordenadas se capturan MANUALMENTE (el emprendedor las pega desde un mapa
   externo como Google Maps); el sistema NO hace geocoding automatico.
3. EL backend DEBERA validar que latitud este en [-90, 90] y longitud en [-180, 180]
   cuando se envien; ambas son opcionales (una sucursal puede no tener coordenadas).
4. LA direccion (texto) DEBERA poder mostrarse al cliente en el portal/tarjeta.
5. GUARDAR direccion/coordenadas de una sucursal DEBERA respetar el aislamiento por
   tenant y el gating de sucursales (free solo su principal).

### Requirement 8: Busqueda por cercania

**User Story:** Como cliente, quiero ver las sucursales cerca de mi ubicacion, para
elegir la mas conveniente.

#### Acceptance Criteria

1. CUANDO el cliente activa "Cerca de mi" y concede la geolocalizacion del navegador
   ENTONCES el landing DEBERA enviar sus coordenadas (lat/lng) al endpoint de
   descubrimiento y este DEBERA ordenar por distancia (Haversine) ascendente.
2. DENTRO de las sucursales cercanas, la priorizacion PREMIUM DEBERA mantenerse (los
   premium cercanos por encima de los free a distancia comparable, segun regla
   confirmada: premium primero dentro de cercanos).
3. LAS sucursales SIN coordenadas DEBERAN seguir apareciendo, pero al final del orden
   por cercania (no se excluyen).
4. SI el cliente NIEGA el permiso o el navegador no soporta geolocalizacion ENTONCES
   el landing DEBERA caer al orden normal (premium primero) sin errores.
5. EL endpoint DEBERA aceptar parametros opcionales `lat` y `lng`; sin ellos, el orden
   por cercania no aplica.
6. OPCIONAL: el endpoint PUEDE aceptar un `radius_km` para acotar resultados; por
   defecto no filtra por radio (muestra todos, ordenados por distancia).

### Requirement 9: No regresion y aislamiento

**User Story:** Como usuario, quiero que el resto siga funcionando y sin fugas de
datos entre negocios.

#### Acceptance Criteria

1. EL descubrimiento DEBERA exponer solo datos no sensibles y respetar el gating
   premium (banner solo premium; free solo sucursal principal).
2. LAS rutas y flujos existentes (`/public/:code/info`, availability, book) DEBERAN
   seguir funcionando.
3. EL sistema DEBERA compilar (tsc backend/frontend) y construir (vite build); las
   suites existentes DEBERAN seguir en verde (salvo fallos preexistentes ajenos).
