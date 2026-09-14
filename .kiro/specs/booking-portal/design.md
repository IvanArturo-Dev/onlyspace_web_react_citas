# Design Document

## Overview

Este documento describe el diseno tecnico para transformar el sistema en una plataforma de reservas de tres actores (Super Admin, Administrador de citas, Cliente) con un portal publico de reservas accesible por codigo de 6 caracteres o QR.

Decisiones de diseno tomadas:
- **Categoria = modelo `Service` existente**: `Service` ya tiene `duration_mins`, `is_active`, `tenant_id`. Se usa como "tipo de cita/categoria" en la UI. No se crea un modelo nuevo para evitar duplicidad; el modelo `Category` existente sigue disponible como agrupador opcional pero no es obligatorio para este flujo.
- **QR apunta a URL publica** del portal: `/{code}` (por ejemplo `/reservar/AB3K9P`).
- **Codigo de acceso = campo en `Tenant`**: cada administrador es un tenant; el codigo se guarda en el tenant y resuelve inequivocamente a el.
- **Roles por JWT**: el rol viaja firmado en el token (`SUPERADMIN`, `ADMIN`, `CLIENT`). La autorizacion de acceso de administradores se decide en el login con Google segun una lista de autorizaciones.

Se reutiliza: login Google/Firebase, JWT con `role`, multi-tenant Prisma/MySQL, modelos `Schedule`/`ScheduleDay`, `Service`, `Appointment`, `Customer`, `AuditLog`, y el helper `writeAudit`.

## Architecture

### Actores y roles

```
Super Admin (SUPERADMIN)
  -> autoriza emails -> tabla AuthorizedAdmin
  -> ve observabilidad (modulo previo)

Administrador (ADMIN)  [= 1 Tenant con code de 6 chars]
  -> configura Services (categorias) y Schedule (horarios)
  -> gestiona Appointments de su tenant

Cliente (CLIENT)
  -> entra a /reservar/:code -> resuelve tenant
  -> login Google -> ve categorias + disponibilidad -> agenda
  -> ve "mis citas"
```

### Flujo de login y asignacion de rol (Google)

```
signInWithGoogle -> idToken -> POST /v1/auth/firebase/login
  backend verifica idToken (firebase-admin) -> email
  determina rol:
    if email == SUPERADMIN_EMAIL           -> role SUPERADMIN
    else if email en AuthorizedAdmin activo -> role ADMIN (asegura su tenant + code)
    else                                    -> role CLIENT (tenant nulo/none)
  emite JWT { user_id, tenant_id, role, permissions }
```

El `tenant_id` del cliente no lo ata a un administrador; la relacion cliente-administrador se establece por cada reserva (la cita pertenece al tenant del codigo usado).

### Flujo de reserva publica

```
Cliente abre /reservar/:code (QR o input)
  GET /v1/public/:code/info        -> nombre del negocio + categorias activas
  Cliente elige categoria + fecha
  GET /v1/public/:code/availability?service_id=&date=  -> slots libres
  Cliente hace login Google (si no lo hizo)
  POST /v1/public/:code/appointments { service_id, start_time }  (requiere JWT CLIENT)
     -> valida slot aun libre (transaccion) -> crea Appointment PENDING
     -> responde confirmacion (notificacion in-app)
  GET /v1/me/appointments   -> lista de citas del cliente
```

## Components and Interfaces

### Data model (Prisma) — cambios

Cambios minimos y aditivos, sin romper lo existente:

1. **Enum `Role`**: agregar `CLIENT`. (Ya existe ADMIN, PROFESSIONAL, RECEPTION; SUPERADMIN se maneja por `UserRole.name`.)
2. **`Tenant`**: agregar `booking_code String? @unique` (6 chars) y opcional `booking_enabled Boolean @default(true)`.
3. **Nuevo modelo `AuthorizedAdmin`**:
   ```
   model AuthorizedAdmin {
     id          String   @id @default(cuid())
     email       String   @unique
     status      String   @default("active") // active | revoked
     tenant_id   String?  // tenant creado para este admin
     created_by  String?  // super admin user id
     created_at  DateTime @default(now())
     updated_at  DateTime @updatedAt
     @@map("authorized_admins")
   }
   ```
4. **`Appointment`**: agregar `booked_by_email String?` y `booked_by_name String?` para registrar quien agendo desde el portal (ademas del `customer_id` que se crea/asocia). Alternativamente, se crea/asocia un `Customer` por email dentro del tenant.

Estos cambios se aplican con `prisma db push` en el entorno de desarrollo (la base `citas_dev`).

### Backend endpoints

**Super Admin (autorizacion de acceso)** — bajo `/v1/admin`, protegido por `authMiddleware + requireSuperAdmin`:
- `GET  /v1/admin/authorized` — lista de administradores autorizados (email, status, tenant, booking_code).
- `POST /v1/admin/authorized` `{ email }` — autoriza un email; crea/asocia tenant y genera `booking_code`.
- `PATCH /v1/admin/authorized/:id` `{ status }` — revoca/reactiva.

**Administrador (ADMIN)** — protegido por `authMiddleware + requireAdmin`:
- Reutiliza `/v1/services` (categorias) y `/v1/availability/schedule` (horarios) ya existentes, ahora garantizando aislamiento por `tenant_id`.
- `GET  /v1/me/tenant` — datos del negocio del admin, incluido `booking_code` y URL/QR del portal.
- Reutiliza `/v1/appointments` (listar, cambiar estado, cancelar, eliminar) para gestion.

**Portal publico (Cliente)** — bajo `/v1/public`:
- `GET  /v1/public/:code/info` — publico (sin auth): nombre del negocio y categorias activas. Solo datos no sensibles.
- `GET  /v1/public/:code/availability?service_id=&date=` — publico: slots disponibles.
- `POST /v1/public/:code/appointments` — requiere `authMiddleware` con rol CLIENT: crea la reserva.

**Cliente (sus citas)** — protegido por `authMiddleware`:
- `GET  /v1/me/appointments` — citas del usuario autenticado (por su email), a traves de tenants.

### Middlewares de autorizacion

- `requireSuperAdmin` (ya existe).
- Nuevo `requireAdmin`: permite si `req.user.role === 'ADMIN'` (o SUPERADMIN si se decidiera), si no 403.
- Nuevo `requireClient` / o simplemente `authMiddleware` para endpoints `/me` y de reserva; la creacion de cita valida que el rol sea CLIENT o ADMIN.
- Los endpoints `/v1/public/:code/info` y `/availability` NO usan authMiddleware (son publicos de solo lectura), pero SOLO exponen datos no sensibles del tenant resuelto por el codigo.

### Servicios (backend)

- `authorizationService`: alta/lista/revoca de `AuthorizedAdmin`; creacion de tenant + `booking_code` unico.
- `bookingCode util`: genera codigos de 6 chars con alfabeto sin ambiguos `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; reintenta ante colision; resolucion case-insensitive (se normaliza a mayusculas al guardar y consultar).
- `availabilityService` (extiende el existente): dado tenant + service (duracion) + fecha, genera slots a partir de `Schedule`/`ScheduleDay`, resta citas no canceladas y horas pasadas.
- `bookingService`: crea la cita validando el slot dentro de una transaccion para evitar doble reserva; asocia/crea `Customer` por email en el tenant; escribe auditoria.

### Frontend (React web)

Estructura por rol, apoyada en los guards y el Layout ya rediseniados:

- **Super Admin** (`/admin/*`): nueva pantalla `AdminAuthorizations` (autorizar por email, listar, revocar, ver codigo). Se mantiene observabilidad.
- **Administrador** (`/*` gestion): 
  - `Categorias` (reusa Services con etiqueta "Categorias").
  - `Horarios` (editor de `Schedule` por dia).
  - `Citas` (gestion con ver quien agendo, confirmar/cancelar/eliminar/completar/no-show).
  - `MiCodigo` (muestra codigo + QR + link para compartir).
- **Cliente**:
  - `Portal publico` `/reservar/:code` (info del negocio, categorias, selector de fecha, slots, boton login Google, confirmar).
  - `Mis citas` `/mis-citas` (lista de sus reservas y estados).
  - Entrada por codigo: pantalla con input de codigo que navega a `/reservar/:code`, y soporte de QR (el QR simplemente codifica esa URL).
- **QR**: se genera en el cliente con una libreria de QR ligera (por ejemplo `qrcode` o render SVG propio). Se evalua en implementacion; si se evita dependencia, se genera un QR via API de imagen o componente SVG.

### Routing y guards (frontend)

- `/login` publico.
- `/reservar/:code` y `/codigo` (input) publicos (no requieren estar logueado para ver info/disponibilidad; requieren login Google para confirmar).
- `/mis-citas` requiere sesion (cualquier rol) y muestra las citas del usuario.
- Gestion (`/`, `/appointments`, `/categorias`, `/horarios`, `/mi-codigo`) requiere rol ADMIN.
- `/admin/*` requiere SUPERADMIN.
- Redirecciones: SUPERADMIN -> `/admin`; ADMIN -> `/` (gestion); CLIENT -> `/mis-citas` o al portal si venia de un codigo.

## Data Models

Resumen de entidades y su proposito en este modulo:

- `Tenant` (extendido): representa un administrador/negocio; `booking_code` unico.
- `AuthorizedAdmin` (nuevo): whitelist de emails autorizados por el Super Admin.
- `User`: la persona autenticada; su rol se decide en login.
- `Service`: categoria/tipo de cita (nombre, `duration_mins`, `is_active`, `tenant_id`).
- `Schedule` + `ScheduleDay`: horario de trabajo por dia del tenant.
- `Appointment`: la cita; pertenece al tenant del codigo; guarda quien agendo.
- `Customer`: representa al cliente dentro de un tenant (se crea/asocia por email al reservar).
- `AuditLog`: registro de acciones (crear/confirmar/cancelar/eliminar cita, autorizar/revocar admin).

## Availability Algorithm

Entrada: tenant, service (duracion D en minutos), fecha F, paso de slots (por defecto = D o un step configurable).

1. Obtener `ScheduleDay` del tenant para el dia de la semana de F. Si no hay rangos -> sin disponibilidad.
2. Para cada rango [open, close] del dia: generar candidatos start = open, open+step, ... mientras start + D <= close.
3. Descartar candidatos cuyo intervalo [start, start+D) se solape con alguna `Appointment` del tenant en F con estado != CANCELLED.
4. Descartar candidatos en el pasado (start <= ahora).
5. Devolver la lista de slots libres (hora de inicio y fin).

Para evitar doble reserva, la creacion (`POST /public/:code/appointments`) re-verifica el solapamiento dentro de una transaccion antes de insertar; si el slot ya no esta libre, responde 409.

## Error Handling

- Codigo invalido/inexistente/negocio deshabilitado -> 404 `INVALID_CODE`.
- Reserva sobre slot ocupado (carrera) -> 409 `SLOT_TAKEN`.
- Acceso a area incorrecta por rol -> 403 (backend) + redireccion (frontend).
- Login de email no autorizado -> se degrada a rol CLIENT (no es error).
- Endpoints publicos solo devuelven datos no sensibles; nunca listan clientes ni citas de otros.
- Auditoria best-effort: fallos al auditar no bloquean la operacion principal.

## Security Considerations

- El rol viaja firmado en el JWT; el backend valida rol/identidad en cada endpoint (no confia en la UI).
- La elevacion a ADMIN solo ocurre si el email esta en `AuthorizedAdmin` activo al momento del login; revocar impide accesos futuros.
- Endpoints publicos limitados a lectura de info no sensible y disponibilidad; la creacion de cita exige sesion (JWT) del cliente.
- Aislamiento por `tenant_id` en todas las consultas de admin; el codigo resuelve a un unico tenant.
- Codigos sin caracteres ambiguos y unicos; resolucion normalizada a mayusculas.
- Rate limiting ya presente aplica a endpoints publicos para mitigar abuso/fuerza bruta de codigos.

## Correctness Properties

### Property 1: Autorizacion como unica via de elevacion a ADMIN

Para cualquier inicio de sesion, un usuario obtiene rol ADMIN si y solo si su email esta en `AuthorizedAdmin` con estado activo (o es el Super Admin). Ningun input del cliente puede otorgar ADMIN.

**Validates: Requirements 1.2, 1.3, 1.4, 9.5**

### Property 2: Revocacion efectiva

Tras revocar una autorizacion, cualquier login posterior de ese email NO produce rol ADMIN.

**Validates: Requirements 1.3**

### Property 3: Unicidad y formato del codigo

Todo administrador activo tiene un `booking_code` de exactamente 6 caracteres del alfabeto permitido, y no existen dos administradores con el mismo codigo.

**Validates: Requirements 2.1, 2.2, 10.4**

### Property 4: Resolucion inequivoca del codigo

Resolver un codigo valido devuelve exactamente un tenant; resolver un codigo inexistente o de negocio deshabilitado no devuelve ningun tenant.

**Validates: Requirements 2.5, 10.4**

### Property 5: Disponibilidad consistente con horario y duracion

Todo slot ofrecido esta contenido dentro de algun rango del horario del dia, tiene longitud igual a la duracion de la categoria, no se solapa con citas no canceladas y no esta en el pasado.

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 6: No doble reserva

No existe ninguna secuencia de reservas concurrentes que produzca dos citas no canceladas del mismo tenant cuyos intervalos se solapen.

**Validates: Requirements 6.4**

### Property 7: Aislamiento por tenant

Ninguna consulta de un administrador devuelve datos (categorias, horarios, citas, clientes) de otro administrador, y una reserva por codigo se asocia al tenant dueno del codigo.

**Validates: Requirements 3.5, 4.5, 8.5, 10.1, 10.2, 10.3**

### Property 8: Privacidad del cliente

Un cliente solo puede ver y gestionar sus propias citas; no puede acceder a citas de otros clientes ni a datos de administracion.

**Validates: Requirements 6.6, 6.7, 9.3**

## Testing Strategy

- Unit (backend):
  - `bookingCode`: formato de 6 chars, alfabeto sin ambiguos, unicidad ante colision simulada, normalizacion case-insensitive.
  - `authorizationService`: autorizar crea/asocia tenant + code; revocar cambia estado; login mapea rol correcto segun whitelist.
  - `availabilityService`: genera slots correctos dado horario+duracion; excluye ocupados y pasados; dias cerrados sin slots.
  - `bookingService`: rechaza slot ocupado; crea PENDING; asocia customer por email; audita.
- Integracion (backend):
  - `/v1/admin/authorized` requiere SUPERADMIN (401/403/200).
  - `/v1/public/:code/info` y `/availability` publicos devuelven solo datos no sensibles; codigo invalido -> 404.
  - `POST /v1/public/:code/appointments` exige JWT; doble reserva -> 409.
  - `/v1/me/appointments` devuelve solo las del usuario.
- Frontend:
  - Guards por rol (SUPERADMIN/ADMIN/CLIENT) redirigen correctamente.
  - Portal publico: resolver codigo, listar categorias, ver slots, agendar tras login, confirmacion in-app.
  - Editor de horarios y categorias del admin.
- Property-based (candidatas): Property 3 (formato/unicidad de codigo), Property 5 (invariantes de slots), Property 6 (no solapamiento), Property 7 (aislamiento).
- Verificacion e2e manual: autorizar un email como Super Admin; ese usuario entra como ADMIN, configura categoria+horario, obtiene su codigo/QR; un cliente entra por el codigo, agenda, y ambos ven el estado.
