# Design Document

## Overview

Agrega un landing publico de descubrimiento sobre el portal existente. Backend: un
endpoint publico `GET /public/discover` que devuelve negocios reservables (via su
sucursal principal), con priorizacion premium, filtros por texto y categoria, orden
opcional por cercania (Haversine con lat/lng del cliente) y branding/banner solo para
premium. Emprendedor: puede capturar direccion + coordenadas por sucursal (nuevos
campos en Branch). Frontend: se mejora `pages/public/Landing.tsx` (hero, chips de
categoria, buscador, boton 'Cerca de mi', tarjetas destacadas premium vs simples, y
seccion 'Podria interesarte'). Reutiliza `isPremiumEffective` y el criterio de sucursal
principal (created_at asc) coherente con branch-premium-gating.

## Architecture

```
Backend
  Branch (schema): + address String?  + city String?  + latitude Decimal? + longitude Decimal?

  branchService.update(...): acepta address/city/latitude/longitude; valida rangos
    (lat [-90,90], lng [-180,180]); respeta gating (free solo su principal).

  discoveryService.discover({ q?, category?, lat?, lng?, radius_km? }):
    1. Carga tenants reservables (booking_enabled=true) con >=1 sucursal activa.
    2. Por tenant toma su sucursal PRINCIPAL (created_at asc). (free: solo principal;
       premium: principal como entrada del landing; el detalle de sucursales se ve al
       reservar.)
    3. Deriva is_premium (isPremiumEffective) por tenant.
    4. Adjunta categorias activas del negocio y, si premium, branding/banner.
    5. Aplica filtros q (nombre negocio/sucursal/categoria, contains ci) y category.
    6. Ordena: si lat/lng -> por distancia Haversine asc, con premium primero dentro
       de cercanos; sin coords de la sucursal van al final. Sin lat/lng -> premium
       primero, luego nombre asc.
    7. Nunca expone datos sensibles (clientes/citas/tokens).

  discoveryService.categories(): lista de categorias activas distintas de negocios
    reservables (para los chips).

  GET /public/discover  -> discover(...)
  GET /public/categories -> categories()

Frontend
  services/public.service.ts: + discover(params) + getCategories()
  pages/public/Landing.tsx: hero + buscador + chips + 'Cerca de mi' (geolocation) +
    grid de tarjetas (destacada premium / simple free) + seccion 'Podria interesarte'.
  Sucursales.tsx (emprendedor): campos address/city/lat/lng en el form de sucursal.
```

## Components and Interfaces

### 1. Schema: ubicacion de sucursal (Req 7)
- En `Branch` agregar: `address String?`, `city String?`, `latitude Decimal? @db.Decimal(10,7)`,
  `longitude Decimal? @db.Decimal(10,7)`. Aplicar con `prisma db push` (el proyecto usa
  db push, no migrate). Sin backfill: existentes quedan null.

### 2. branchService: guardar direccion/coordenadas (Req 7)
- Extender `UpdateBranchInput` con address/city/latitude/longitude (opcionales).
- Validacion: si latitude presente, -90<=lat<=90; si longitude presente, -180<=lng<=180;
  400 VALIDATION_ERROR si fuera de rango. Permitir null para limpiar.
- Reusar el gating de branch-premium-gating (free solo su principal). BranchView expone
  address/city/lat/lng para que el emprendedor los vea/edite.

### 3. discoveryService (Req 1,2,3,8)
- Nuevo servicio `discovery.service.ts`. Funcion pura `haversineKm(aLat,aLng,bLat,bLng)`
  (radio 6371 km) testeable de forma aislada.
- `discover(params)`: implementa el pipeline del diagrama. Devuelve items con forma:
  `{ business_name, code (sucursal principal), branch_name, city, address, is_premium,
    categories: string[], distance_km?: number|null, branding?: { logo_url, brand_color,
    banner_title, banner_text, banner_link } }`. branding SOLO si is_premium.
- Aislamiento: cada item pertenece a un tenant; nunca se mezclan datos de tenants.
- `categories()`: `SELECT DISTINCT name` de Category activas de negocios reservables.

### 4. Ordenamiento premium + cercania (Req 2,8)
- Sin lat/lng: comparador (is_premium desc, business_name asc).
- Con lat/lng: calcular distance_km por item (null si la sucursal no tiene coords).
  Comparador: items con coords antes que sin coords; dentro de con-coords ordenar por
  (is_premium desc, distance_km asc) para cumplir 'premium primero dentro de cercanos';
  los sin-coords al final con (is_premium desc, name asc). radius_km opcional filtra
  items con distancia > radius (los sin coords no se filtran por radio).

### 5. Rutas backend (Req 1)
- En `public.routes.ts` (antes de las rutas `/:code/...`): `GET /discover` y
  `GET /categories`, sin authMiddleware. Reutilizan el rate limiter global.

### 6. Frontend: Landing (Req 4,5,8)
- `Landing.tsx`: hero llamativo; buscador de texto (debounce); fila de chips de
  categoria (toggle); boton 'Cerca de mi' que usa `navigator.geolocation.getCurrentPosition`.
  En exito, pasa lat/lng a discover; en error/negacion, muestra aviso y usa orden normal.
- Tarjetas: premium -> destacada con banner/logo/brand_color; free -> simple. Cada
  tarjeta enlaza a `/reservar/<code>`. Mostrar city/address y distancia si viene.
- Seccion 'Podria interesarte': cuando hay categoria/q activa, segunda consulta discover
  con la misma categoria (o similar) excluyendo los ya mostrados; premium primero.
- Accesibilidad: chips como botones focusables, alt en imagenes, contraste; estado
  vacio con CTA para limpiar filtros. Responsive (grid adaptable).

### 7. Frontend: Sucursales del emprendedor (Req 7)
- `Sucursales.tsx`: agregar inputs address, city, latitude, longitude al crear/editar.
  Ayuda breve: 'Pega tu latitud/longitud desde Google Maps (clic derecho > coordenadas)'.
  Validacion basica en cliente; el backend valida rangos. Manejar 403 si free intenta
  editar una extra (gating).

## Data Models

- `Branch`: nuevos campos opcionales `address`, `city`, `latitude`, `longitude`.
  Sin otros modelos nuevos. La 'sucursal principal' se sigue derivando por created_at
  asc (sin columna).

## Error Handling

- discover/categories: solo lectura publica; ante error interno responden 500 con el
  patron { success:false, error }. Parametros invalidos (lat/lng no numericos) se
  ignoran de forma segura (se tratan como ausentes) en vez de romper.
- Guardar coordenadas fuera de rango -> 400 VALIDATION_ERROR.
- Aislamiento por tenant en todo el pipeline; el free nunca expone extras ni banner.

## Testing Strategy

- Unit `haversineKm`: distancias conocidas (0 en el mismo punto; simetria; valores de
  referencia aproximados).
- Unit `discoveryService.discover`: premium primero sin coords; con coords premium
  primero dentro de cercanos; sin-coords al final; filtros q/category; branding solo
  premium; free solo su principal; aislamiento por tenant.
- Unit `branchService.update`: acepta y valida address/city/lat/lng; rangos invalidos
  -> 400; gating free extra -> 403.
- Regresion: tsc backend/frontend 0 errores; vite build; suites existentes verdes
  (salvo fallos preexistentes ajenos).

## Correctness Properties

### Property 1: Premium primero (sin cercania)
Sin lat/lng, discover devuelve todos los items PREMIUM antes que cualquier FREE, y
dentro de cada grupo ordenados por nombre ascendente.

**Validates: Requirements 2.1, 2.3**

### Property 2: Banner solo premium
Para cualquier item FREE, la respuesta NO incluye branding/banner; para premium, si
lo tiene configurado, lo incluye.

**Validates: Requirements 2.2, 6.1**

### Property 3: Free solo su sucursal principal
Un negocio FREE aparece en discover con exactamente su sucursal principal (created_at
asc); nunca con una sucursal extra.

**Validates: Requirements 1.4, 6.1**

### Property 4: Filtros consistentes
Al aplicar q y/o category, todo item del resultado satisface el filtro (nombre de
negocio/sucursal/categoria contiene q; ofrece la categoria pedida), y la priorizacion
premium se mantiene dentro del subconjunto filtrado.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

### Property 5: Cercania con premium dentro de cercanos
Con lat/lng, los items con coordenadas se ordenan por (premium primero, distancia asc)
y los items sin coordenadas quedan al final; ningun item sin coords precede a uno con
coords.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 6: Degradacion sin ubicacion
Sin lat/lng (o invalidos), discover no falla y aplica el orden normal (premium
primero); parametros lat/lng no numericos se tratan como ausentes.

**Validates: Requirements 8.4, 8.5**

### Property 7: Validacion de coordenadas
branchService.update acepta latitude solo en [-90,90] y longitude solo en [-180,180];
fuera de rango lanza 400 y no persiste; null limpia el valor.

**Validates: Requirements 7.3**

### Property 8: Haversine correcta
haversineKm devuelve 0 para el mismo punto, es simetrica (a,b)=(b,a) y crece de forma
monotona con la separacion geografica.

**Validates: Requirements 8.1**

### Property 9: Aislamiento por tenant
Cada item de discover corresponde a un unico tenant; jamas se combinan sucursales,
categorias o branding de tenants distintos.

**Validates: Requirements 6.1, 7.5**

