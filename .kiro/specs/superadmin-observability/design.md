# Design Document

## Overview

Este documento describe el diseno tecnico del modulo de SuperAdmin y Observabilidad Global. El modulo agrega un rol global `SUPERADMIN` por encima del aislamiento multi-tenant, un conjunto de endpoints protegidos bajo `/v1/admin`, servicios de agregacion que reutilizan y extienden el `dashboard.service` existente, y una seccion de administracion global en la app web React.

El diseno se apoya en piezas ya existentes para minimizar riesgo:
- El JWT ya transporta `role` y `permissions` (ver `config/jwt.ts` y `middleware/auth.ts`).
- El rol de un usuario proviene de `user.role.name` (relacion `UserRole`).
- El modelo `AuditLog` ya existe en el esquema Prisma con los campos e indices necesarios.
- `auth.service.login` ya escribe registros de auditoria de LOGIN.
- El `dashboard.service` ya calcula metricas por tenant; se agregan variantes globales.
- La app web ya tiene cliente API con manejo de JWT/refresh, store de auth con `role`, y layout con navegacion.

Alcance: solo lectura y observabilidad. No se agregan operaciones destructivas de datos de negocio.

## Architecture

### Vista de alto nivel

```
[App Web React]
   |  (JWT Bearer)
   v
[/v1/admin/*]  --->  [requireSuperAdmin middleware]
   |                        |
   |                        v
   |                 verifica role === SUPERADMIN
   v
[admin.controller]  --->  [admin.service]  --->  [Prisma / MySQL]
                              |
                              +--> agregaciones cross-tenant (sin filtro tenant_id)
                              +--> consulta de AuditLog con filtros y paginacion
```

### Decision clave: rol global vs tenant

El esquema actual liga cada `UserRole` a un `tenant_id`. Introducir SUPERADMIN como un nuevo `UserRole` por tenant seria fragil (habria uno por tenant). En su lugar:

- SUPERADMIN se representa como un `UserRole` con `name = "SUPERADMIN"` asociado al tenant `default`, pero el sistema lo trata como **global** en la capa de autorizacion (el guard mira el `name`, no el tenant).
- El super usuario `xcode.arturo@gmail.com` es un `User` normal cuyo `role_id` apunta a ese rol SUPERADMIN.
- La autorizacion NO depende de la lista de `permissions`, sino de la comprobacion explicita `role === "SUPERADMIN"`. Esto evita que un ADMIN de tenant se auto-eleve editando permisos.

Rationale: mantiene el esquema sin migraciones estructurales (reutiliza `UserRole`), y centraliza la decision de "es global" en un unico punto (el guard), reduciendo superficie de error.

Alternativa considerada: agregar un campo booleano `is_superadmin` en `User`. Es mas explicito, pero requiere migracion del esquema y tocar el flujo de emision de JWT en varios puntos. Se descarta para esta iteracion por costo/beneficio; puede adoptarse luego sin romper el contrato del guard.

## Components and Interfaces

### 1. Middleware `requireSuperAdmin`

Ubicacion: `backend/src/middleware/requireSuperAdmin.ts`

Se ejecuta despues de `authMiddleware`. Lee `req.user.role` (ya poblado por el auth middleware desde el JWT) y:
- Si `role === "SUPERADMIN"`, llama `next()`.
- En caso contrario, responde 403 con codigo `FORBIDDEN`.

Interfaz:
```ts
export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => void;
```

No consulta la base de datos: confia en el rol firmado en el JWT, consistente con como operan los demas endpoints.

### 2. Rutas `/v1/admin`

Ubicacion: `backend/src/routes/v1/admin.routes.ts`, registradas en `routes/index.ts` como `router.use('/admin', adminRoutes)`.

Todas las rutas aplican `authMiddleware` seguido de `requireSuperAdmin`.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/v1/admin/overview` | Metricas agregadas globales (tenants, usuarios, clientes, servicios, citas por estado). |
| GET | `/v1/admin/metrics` | Ingresos, ocupacion y tasa de no-show en un rango de fechas; filtro opcional `tenant_id`. |
| GET | `/v1/admin/tenants` | Lista de tenants con contadores basicos. |
| GET | `/v1/admin/audit` | Audit trail global con filtros y paginacion. |
| GET | `/v1/admin/health` | Salud del backend y contadores de actividad reciente (24h). |

### 3. `admin.service`

Ubicacion: `backend/src/services/admin.service.ts`

Metodos:
```ts
getOverview(): Promise<GlobalOverview>
getMetrics(params: { start_date?: string; end_date?: string; tenant_id?: string }): Promise<GlobalMetrics>
listTenants(): Promise<TenantSummary[]>
getAuditTrail(filters: AuditFilters): Promise<Paginated<AuditEntry>>
getHealth(): Promise<HealthReport>
```

Reutiliza patrones del `dashboard.service` pero omitiendo el filtro obligatorio por `tenant_id`. Las agregaciones usan `prisma.appointment.groupBy`, `prisma.count`, y sumas de `price` para ingresos.

### 4. Registro de auditoria ampliado

Se centraliza la escritura en un helper `writeAudit` (util o servicio) para que controllers de citas, clientes y servicios registren CREATE/UPDATE/DELETE/CONFIRM/CANCEL. La escritura es best-effort: envuelta en try/catch que loguea el error sin interrumpir la operacion principal (Requirement 5.4).

```ts
writeAudit(input: {
  tenant_id: string;
  user_id?: string;
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  result?: 'success' | 'failure';
  ip_address?: string;
  user_agent?: string;
  details?: string;
}): Promise<void>
```

### 5. Seed del super usuario

Ubicacion: `backend/src/database/seed-superadmin.ts` (script idempotente, ejecutable por separado).

Logica:
1. `upsert` del rol SUPERADMIN (`id = "superadmin-role"`, `tenant_id = "default"`, `name = "SUPERADMIN"`).
2. Leer `SUPERADMIN_EMAIL` (default `xcode.arturo@gmail.com`) y `SUPERADMIN_PASSWORD` de variables de entorno.
3. Buscar el usuario por email:
   - Si existe: actualizar su `role_id` al rol SUPERADMIN.
   - Si no existe: crearlo con password hasheado (bcrypt) y el rol SUPERADMIN.
4. Idempotente: correr multiples veces deja un unico super usuario consistente.

La contrasena NO se embebe en el codigo; proviene de env. Si no se define, el script aborta con mensaje claro.

### 6. Frontend: seccion de administracion global

Reutiliza la app web existente (`frontend-web`).

- `store/useAuthStore`: ya expone `user.role`. Se agrega un selector derivado `isSuperAdmin = user?.role === "SUPERADMIN"`.
- `components/Layout`: muestra el enlace "Admin Global" solo si `isSuperAdmin`.
- `components/ProtectedRoute` + nueva `SuperAdminRoute`: protege las rutas `/admin/*` en el cliente (defensa en profundidad; la autoridad real es el backend).
- Nuevas paginas:
  - `pages/admin/AdminOverview.tsx` — tarjetas de metricas globales.
  - `pages/admin/AdminMetrics.tsx` — ingresos/ocupacion/no-show con selector de rango y de tenant.
  - `pages/admin/AdminAudit.tsx` — tabla del audit trail con filtros y paginacion.
- `services/admin.service.ts` — llamadas a `/admin/*` usando el `api` axios existente.

## Data Models

No se requieren migraciones estructurales. Se reutilizan:

- `UserRole` — se agrega una fila con `name = "SUPERADMIN"`.
- `User` — el super usuario apunta su `role_id` a ese rol.
- `AuditLog` — ya modela `action`, `resource_type`, `resource_id`, `result`, `ip_address`, `user_agent`, `details`, `created_at`, con indices por `tenant_id, created_at` y `user_id, created_at` que soportan la consulta paginada y filtrada.

Tipos de respuesta (definidos en el backend y portados al frontend):

```ts
interface GlobalOverview {
  tenants: number;
  users: number;
  customers: number;
  services: number;
  appointments_by_status: Record<AppointmentStatus, number>;
}

interface GlobalMetrics {
  income_total: number;
  income_by_tenant: { tenant_id: string; tenant_name: string; income: number }[];
  occupancy_rate: number;
  no_show_rate: number;
  range: { start_date: string; end_date: string };
}

interface AuditEntry {
  id: string;
  created_at: string;
  user_id: string | null;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  result: string;
}

interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}
```

## Error Handling

- Autorizacion: `authMiddleware` maneja 401 (token invalido/expirado/bloqueado). `requireSuperAdmin` maneja 403.
- Endpoints admin: siguen el mismo patron de los controllers existentes (`{ success: false, error: { code, message } }` con status apropiado). Errores no controlados devuelven 500 con `INTERNAL_ERROR`.
- Auditoria best-effort: fallos al escribir en `AuditLog` se loguean con pino y NO propagan al flujo principal (Requirement 5.4).
- Frontend: cada pagina admin maneja estados de carga, error y reintento (reutilizando el patron de `DataList`). Si `/admin/health` no responde, la UI muestra estado no disponible sin romperse (Requirement 7.4).

## Security Considerations

- La elevacion a SUPERADMIN solo ocurre por el seed/script con credencial de entorno; los endpoints de gestion de usuarios de tenant no pueden asignar ese rol (Requirement 1.4). Se debe validar en el servicio de usuarios que un ADMIN de tenant no pueda setear `role = SUPERADMIN`.
- El guard decide por `role` firmado en el JWT; como el JWT lo emite el backend a partir de `user.role.name`, un cliente no puede falsificarlo sin el `JWT_SECRET`.
- Solo lectura: los endpoints admin no exponen mutaciones de negocio en esta iteracion (Requirement 3.5).
- El audit trail es inmutable: no se exponen endpoints de edicion/borrado (Requirement 5.3).
- La app web oculta la seccion admin a no-superadmins, pero la autoridad real es el backend (defensa en profundidad).


## Correctness Properties

Estas propiedades deben mantenerse siempre y son candidatas a pruebas basadas en propiedades:

### Property 1: Aislamiento por defecto
 para cualquier peticion cuyo `role` no sea SUPERADMIN dirigida a `/v1/admin/*`, el sistema SIEMPRE responde 401 o 403 y NUNCA retorna datos cross-tenant. Ningun input de request puede eludir el guard.

**Validates: Requirements 1.3, 1.5, 3.2, 3.3**

### Property 2: Autoridad exclusiva del rol firmado
 la decision de autorizacion depende unicamente del `role` contenido en el JWT valido. Ningun encabezado, query o body puede otorgar acceso SUPERADMIN si el JWT no lo contiene.

**Validates: Requirements 3.2, 3.3**

### Property 3: No elevacion desde tenant
 para cualquier operacion de gestion de usuarios ejecutada por un rol distinto de SUPERADMIN, el rol resultante del usuario objetivo NUNCA es SUPERADMIN. La unica via de asignacion es el seed/script con credencial de entorno.

**Validates: Requirements 1.4, 2.4**

### Property 4: Auditoria no bloqueante
 para cualquier operacion de negocio, un fallo al escribir en AuditLog NUNCA cambia el resultado de la operacion principal (exito/fallo) ni lanza un error propagado al cliente.

**Validates: Requirements 5.4**

### Property 5: Inmutabilidad del audit trail
 no existe ninguna secuencia de peticiones de la API que modifique o elimine un registro de AuditLog existente.

**Validates: Requirements 5.3**

### Property 6: Idempotencia del seed
 ejecutar el seed del super usuario N veces (N >= 1) produce exactamente un usuario con email `SUPERADMIN_EMAIL` y rol SUPERADMIN; el estado final es identico independientemente de N.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 7: Consistencia de agregaciones
 la suma de una metrica global (por ejemplo citas por estado) es igual a la suma de esa misma metrica calculada por tenant sobre el conjunto de todos los tenants, para cualquier rango de fechas.

**Validates: Requirements 4.1, 4.2, 4.5**

### Property 8: Paginacion total
 para cualquier conjunto de filtros del audit trail, recorrer todas las paginas devuelve exactamente `total` registros sin duplicados ni omisiones.

**Validates: Requirements 6.1, 6.3**
## Testing Strategy

- Unit (backend):
  - `requireSuperAdmin`: permite con role SUPERADMIN; 403 con cualquier otro rol; 401 delegado al auth middleware.
  - `admin.service`: agregaciones correctas con datos de multiples tenants (overview, metrics, audit con filtros y paginacion).
  - `writeAudit`: no lanza cuando la escritura falla (mock de Prisma que rechaza).
  - Regla de seguridad: el servicio de usuarios rechaza asignar SUPERADMIN desde flujos de tenant.
- Integracion (backend): peticiones a `/v1/admin/*` con token SUPERADMIN (200), con token de otro rol (403), sin token (401).
- Seed: idempotencia (ejecutar dos veces produce un unico super usuario), creacion cuando no existe, actualizacion cuando existe.
- Frontend: `isSuperAdmin` habilita/oculta la navegacion; `SuperAdminRoute` redirige a no-superadmins; paginas muestran carga/error/datos con datos simulados.
- Verificacion end-to-end manual: login con `xcode.arturo@gmail.com`, acceso al panel global, verificacion de metricas agregadas y del audit trail.



