# Implementation Plan

## Overview

Plan para implementar el portal de reservas de tres actores (Super Admin, Dueno de negocio/ADMIN, Cliente) sobre la arquitectura existente. Solo el Super Admin registra duenos de negocio; los demas son clientes que agendan y ven disponibilidad.

Estrategia incremental de menor a mayor riesgo:
1. Modelo de datos y utilidades base (codigo, migracion).
2. Autorizacion de duenos por el Super Admin.
3. Asignacion de rol en login (SUPERADMIN / ADMIN / CLIENT).
4. Configuracion del dueno: categorias (Services) y horarios (Schedule).
5. Disponibilidad y reserva publica (con no-doble-reserva).
6. Citas del cliente y notificacion in-app.
7. Frontend por rol: Super Admin (autorizaciones), Admin (categorias/horarios/citas/codigo+QR), Cliente (portal por codigo/QR, mis citas).
8. Verificacion end-to-end.

Reutiliza login Google/Firebase, JWT con `role`, multi-tenant Prisma/MySQL, modelos `Tenant`/`Service`/`Schedule`/`ScheduleDay`/`Appointment`/`Customer`/`AuditLog`, `writeAudit`, `requireSuperAdmin`, y el Layout/guards ya rediseniados.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["1.1", "2.1", "3", "4"] },
    { "wave": 3, "tasks": ["3.1", "4.1", "5", "6"] },
    { "wave": 4, "tasks": ["5.1", "6.1", "7"] },
    { "wave": 5, "tasks": ["7.1", "8", "9"] },
    { "wave": 6, "tasks": ["10", "11", "12"] },
    { "wave": 7, "tasks": ["13"] }
  ],
  "dependencies": {
    "1.1": ["1"],
    "2": ["1"],
    "2.1": ["2"],
    "3": ["1", "2"],
    "3.1": ["3"],
    "4": ["1"],
    "4.1": ["4"],
    "5": ["1", "4"],
    "5.1": ["5"],
    "6": ["3", "5"],
    "6.1": ["6"],
    "7": ["5", "6"],
    "7.1": ["7"],
    "8": ["2"],
    "9": ["3"],
    "10": ["4"],
    "11": ["5", "6"],
    "12": ["6"],
    "13": ["8", "9", "10", "11", "12"]
  }
}
```

## Tasks

- [x] 1. Modelo de datos: codigo de negocio, autorizaciones y rol CLIENT
  - En `backend/prisma/schema.prisma`: agregar `booking_code String? @unique` y `booking_enabled Boolean @default(true)` a `Tenant`
  - Agregar `CLIENT` al enum `Role`
  - Agregar `booked_by_email String?` y `booked_by_name String?` a `Appointment`
  - Crear modelo `AuthorizedAdmin` (email unico, status, tenant_id?, created_by?, timestamps, map "authorized_admins")
  - Aplicar con `prisma db push` y `prisma generate` sobre `citas_dev`
  - _Requirements: 1.1, 2.1, 10.1_

- [x] 2. Utilidad de codigo de negocio (6 chars, sin ambiguos)
  - Crear `backend/src/utils/bookingCode.ts` con `generateBookingCode()` usando alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  - `assignUniqueBookingCode(prisma)` que reintenta ante colision consultando `Tenant.booking_code`
  - Normalizacion a mayusculas para guardar/resolver (case-insensitive)
  - _Requirements: 2.1, 2.2_

- [x] 2.1 Pruebas de la utilidad de codigo
  - Formato: siempre 6 chars del alfabeto permitido; sin caracteres ambiguos
  - Unicidad: ante colision simulada reintenta hasta obtener uno libre
  - Normalizacion case-insensitive
  - _Requirements: 2.1, 2.2, 10.4_
  - _Properties: Property 3 (Unicidad y formato del codigo)_

- [x] 3. Servicio y endpoints de autorizacion (Super Admin)
  - Crear `authorizationService` en `backend/src/services/authorization.service.ts`: `list()`, `authorize(email, superAdminId)` (crea/asocia Tenant + booking_code y registro AuthorizedAdmin activo), `setStatus(id, status)`
  - Crear metodos en `admin.controller.ts` (o nuevo `authorization.controller.ts`) y rutas bajo `/v1/admin`: `GET /authorized`, `POST /authorized`, `PATCH /authorized/:id`
  - Proteger con `authMiddleware + requireSuperAdmin`
  - Auditar autorizar/revocar con `writeAudit`
  - _Requirements: 1.1, 1.5, 1.7, 2.1_

- [x] 3.1 Pruebas de autorizacion (Super Admin)
  - Autorizar crea tenant + booking_code y registro activo; idempotente si el email ya existe
  - Revocar cambia status a revoked
  - Endpoints exigen SUPERADMIN (401 sin token, 403 con otro rol, 200 con SUPERADMIN)
  - _Requirements: 1.1, 1.3, 1.5, 9.5_
  - _Properties: Property 2 (Revocacion efectiva)_

- [x] 4. Configuracion del dueno: categorias y horarios (aislamiento por tenant)
  - Middleware `requireAdmin` en `backend/src/middleware/requireAdmin.ts` (403 si `role !== 'ADMIN'`)
  - Garantizar aislamiento por `tenant_id` en `/v1/services` (categorias) y `/v1/availability/schedule` (horarios) — revisar controllers/servicios y forzar el tenant del token
  - `GET /v1/me/tenant` que devuelve datos del negocio del admin: `booking_code`, y URL del portal
  - _Requirements: 3.1, 3.2, 3.5, 4.1, 4.2, 4.5, 2.3, 2.4_

- [x] 4.1 Pruebas de aislamiento por tenant
  - Un admin no puede leer/escribir categorias ni horarios de otro tenant
  - `/v1/me/tenant` devuelve el booking_code correcto del admin autenticado
  - _Requirements: 3.5, 4.5, 10.1, 10.3_
  - _Properties: Property 7 (Aislamiento por tenant)_

- [x] 5. Algoritmo de disponibilidad publica
  - Extender `availabilityService` con `getPublicAvailability(tenantId, serviceId, dateISO)` que genera slots desde `ScheduleDay` del dia + `service.duration_mins`, excluye solapamientos con citas no CANCELLED y horas pasadas
  - Resolucion de tenant por `booking_code` (util `resolveTenantByCode`)
  - Endpoints publicos (sin auth, solo lectura, datos no sensibles): `GET /v1/public/:code/info`, `GET /v1/public/:code/availability?service_id=&date=`
  - Codigo invalido/negocio deshabilitado -> 404 INVALID_CODE
  - _Requirements: 2.4, 2.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 5.1 Pruebas de disponibilidad
  - Slots contenidos en el horario, longitud = duracion, sin solape con ocupados, sin pasado; dia cerrado -> vacio
  - Resolucion de codigo: valido -> un tenant; invalido/deshabilitado -> 404
  - _Requirements: 5.2, 5.3, 5.4, 2.5_
  - _Properties: Property 4 (Resolucion inequivoca), Property 5 (Disponibilidad consistente)_

- [x] 6. Reserva publica con no-doble-reserva
  - `bookingService.createPublicBooking(code, { service_id, start_time, user })`: resuelve tenant, valida slot dentro de una transaccion (re-chequeo de solape), crea Appointment PENDING, asocia/crea Customer por email, guarda `booked_by_email/name`, audita
  - Endpoint `POST /v1/public/:code/appointments` con `authMiddleware` (rol CLIENT o ADMIN); slot ocupado -> 409 SLOT_TAKEN
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 10.2_

- [x] 6.1 Pruebas de reserva
  - Crea PENDING asociada al tenant del codigo y registra quien agendo
  - Reserva sobre slot ocupado -> 409; no se crean dos citas solapadas
  - _Requirements: 6.2, 6.3, 6.4, 10.2_
  - _Properties: Property 6 (No doble reserva), Property 7 (Aislamiento por tenant)_

- [x] 7. Citas del cliente y asignacion de rol en login
  - En `firebaseGoogleLogin`: determinar rol -> SUPERADMIN si es el email del super admin; ADMIN si el email esta en AuthorizedAdmin activo (asegurar su tenant + booking_code); si no, CLIENT. Emitir JWT con ese rol y tenant correspondiente
  - Endpoint `GET /v1/me/appointments`: devuelve las citas del usuario autenticado por su email (a traves de tenants), solo las suyas
  - _Requirements: 1.2, 1.4, 6.6, 6.7, 7.2, 7.3, 9.5_

- [x] 7.1 Pruebas de rol en login y citas del cliente
  - Email autorizado -> ADMIN; email no autorizado -> CLIENT; super admin -> SUPERADMIN
  - `/v1/me/appointments` devuelve solo las citas del usuario, no de otros
  - _Requirements: 1.2, 1.4, 6.6, 6.7_
  - _Properties: Property 1 (Autorizacion unica via a ADMIN), Property 8 (Privacidad del cliente)_

- [x] 8. Frontend Super Admin: pantalla de autorizaciones
  - Nueva pagina `frontend-web/src/pages/admin/AdminAuthorizations.tsx`: input de email para autorizar, tabla de autorizados (email, status, booking_code), acciones revocar/reactivar
  - Servicio `frontend-web/src/services/authorization.service.ts` que consume `/v1/admin/authorized`
  - Agregar item de navegacion en el sidebar admin y ruta bajo `/admin/authorizations`
  - _Requirements: 1.1, 1.5_

- [x] 9. Frontend Admin: gestion de citas con seguimiento
  - Ajustar `Appointments.tsx` (gestion) para mostrar quien agendo (`booked_by_name/email`), y acciones confirmar/cancelar/eliminar/completar/no-show con filtros por estado y fecha
  - Asegurar que el admin ve solo su tenant
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 10. Frontend Admin: categorias, horarios y codigo/QR
  - `Categorias` (reusa Services con etiqueta "Categorias"): crear/editar/desactivar con duracion
  - `Horarios`: editor de `Schedule`/`ScheduleDay` por dia (rangos, dia cerrado)
  - `MiCodigo`: muestra `booking_code`, link del portal y un QR (genera QR en cliente); boton copiar link
  - Navegacion en el sidebar de gestion y rutas correspondientes
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 2.3_

- [x] 11. Frontend Cliente: portal publico por codigo/QR
  - Pagina publica `frontend-web/src/pages/public/BookingPortal.tsx` en ruta `/reservar/:code`: carga info del negocio y categorias, selector de fecha, lista de slots; boton login Google; confirmar reserva (POST); confirmacion in-app
  - Pagina `/codigo` con input para escribir el codigo y navegar al portal
  - Servicio `frontend-web/src/services/public.service.ts` para `/v1/public/*`
  - Rutas publicas en `App.tsx` (no requieren estar logueado para ver info/slots; requieren login para confirmar)
  - _Requirements: 2.4, 5.1, 5.5, 6.1, 6.2, 6.5_

- [x] 12. Frontend Cliente: mis citas y confirmacion
  - Pagina `frontend-web/src/pages/client/MyAppointments.tsx` en `/mis-citas`: lista de citas del cliente con estado; mensaje de confirmacion tras agendar
  - Guard: usuarios CLIENT al iniciar sesion van a `/mis-citas` (o al portal si venian de un codigo)
  - _Requirements: 6.6, 7.1, 7.2, 7.3_

- [x] 13. Verificacion end-to-end
  - Aplicar migracion y reiniciar backend; asegurar que el super admin puede autorizar un email
  - E2E: super admin autoriza a un dueno -> ese usuario entra como ADMIN, crea categoria + horario, obtiene su codigo/QR -> un cliente entra por el codigo, ve slots, agenda tras login, recibe confirmacion in-app -> el admin ve la cita con quien agendo y cambia su estado -> el cliente ve el estado actualizado
  - Confirmar redirecciones por rol y aislamiento de datos
  - _Requirements: 1.2, 5.1, 6.2, 7.2, 8.1, 9.1, 9.2, 9.3_

## Notes

- Solo el Super Admin puede convertir a alguien en dueno de negocio (ADMIN); todos los demas quedan como CLIENT por defecto.
- Categoria se implementa sobre el modelo `Service` existente (tiene `duration_mins`).
- El codigo de negocio se guarda normalizado en mayusculas y se resuelve case-insensitive.
- La reserva valida el slot dentro de una transaccion para evitar doble reserva.
- Notificacion es in-app en esta version (sin email/SMS).
- Las subtareas con `_Properties:` son candidatas a pruebas basadas en propiedades sobre las Correctness Properties del diseno.
- Aplicar cambios de esquema con `prisma db push` en `citas_dev` (no hay carpeta de migraciones formal en el proyecto).
