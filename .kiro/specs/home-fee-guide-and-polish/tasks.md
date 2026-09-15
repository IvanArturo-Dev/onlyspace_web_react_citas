# Implementation Plan

## Overview

Recargo a domicilio por negocio + detalle de cita del cliente con ubicacion + precio 99 + guia de uso con progreso + pulido visual del QR. Migracion primero (home_service_fee), luego backend (settings, public info, mis-citas enriquecido, setup-progress, precio 99), luego frontend (config recargo, portal recargo, detalle cita, suscripcion 99, guia, QR), y verificacion.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "wave": 4, "tasks": ["4.1"] }
  ],
  "dependencies": {
    "1.1": [],
    "2.1": ["1.1"],
    "2.2": ["1.1"],
    "2.3": [],
    "2.4": [],
    "3.1": ["2.1"],
    "3.2": ["2.2"],
    "3.3": ["2.2"],
    "3.4": [],
    "3.5": ["2.3"],
    "3.6": [],
    "4.1": ["2.1","2.2","2.3","2.4","3.1","3.2","3.3","3.4","3.5","3.6"]
  }
}
```

## Tasks

- [x] 1. Migracion
- [x] 1.1 Campo home_service_fee en Tenant
  - schema.prisma: Tenant + home_service_fee Decimal @default(0) @db.Decimal(10,2). Migracion (prisma migrate dev --name home_service_fee); en Windows detener node antes (EPERM); regenerar cliente.
  - _Requirements: 1.1, 1.5_

- [x] 2. Backend
- [x] 2.1 Settings: home_service_fee + info publica
  - me.controller GET/PATCH /v1/me/settings: exponer/aceptar home_service_fee (number >= 0; invalido -> 400 VALIDATION_ERROR). public.controller info: exponer home_service_fee (para portal cuando ofrece 'home').
  - _Requirements: 1.1, 1.2, 1.3, 1.5_
- [x] 2.2 mis-citas enriquecido para el detalle
  - me.controller getMyAppointments: incluir por cita modality, home_address, maps_url (de la cita) y branch_maps_url + branch_address (de la sucursal; agregar al select del batch de branches).
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
- [x] 2.3 Endpoint de progreso de configuracion
  - Nuevo GET /v1/me/setup-progress (ADMIN, tenant-scoped): calcular pasos (branch activa, servicio activo, horario, offered_modalities no vacio, whatsapp_number, logo_url [opcional], booking_code para compartir). Devolver steps[], required_done/total, percent, ready. Servicio setupProgress.service.
  - _Requirements: 4.1, 4.2, 4.3, 4.5_
- [x] 2.4 Precio de suscripcion 99
  - Cambiar SUBSCRIPTION_PRICE_MXN a 99 (env local + doc; en prod via SSM). Asegurar que el preapproval de Mercado Pago usa esa variable. Exponer el precio efectivo en el status de suscripcion (mySubscription) para que el front no lo tenga hardcodeado.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Frontend
- [x] 3.1 Config del negocio: recargo a domicilio
  - Profile.tsx BusinessSettingsCard: campo numerico "Recargo a domicilio" con ayuda "0 = sin costo adicional"; enviar home_service_fee en updateBusinessSettings. Tipos en data.service (BusinessSettings + home_service_fee).
  - _Requirements: 1.1, 1.2, 1.5_
- [x] 3.2 Portal: mostrar recargo a domicilio
  - BookingPortal.tsx: al elegir modalidad 'home', mostrar el recargo (home_service_fee) o "Sin costo adicional a domicilio". Tipo en public.service (PublicInfo + home_service_fee).
  - _Requirements: 1.3, 1.4_
- [x] 3.3 Detalle de la cita del cliente con ubicacion
  - MyAppointments.tsx: tarjeta clicable -> modal de detalle (servicio, negocio, sucursal, fecha/hora, modalidad, estado). Boton "Como llegar" (branch_maps_url). Si home: direccion + maps. Si online: enlace videollamada. Conservar resena. Tipos en client.service (MyAppointment + nuevos campos).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
- [x] 3.4 Suscripcion 99
  - Suscripcion.tsx: mostrar 99 MXN/mes (leer del status si esta disponible; fallback 99). Actualizar PRICE_LABEL y priceValue.
  - _Requirements: 3.1, 3.3_
- [x] 3.5 Guia de uso con progreso
  - Nueva pagina GuiaUso.tsx (ruta /guia en el Layout de gestion): consume /me/setup-progress, barra de progreso con percent, lista de pasos con check/estado y CTA que navega a cada seccion (sucursales, services, horarios, profile, mi-codigo, marketing). Mensaje "listo para recibir reservas" cuando ready. Item "Guia" en Layout.managementNav. Servicio en data.service (getSetupProgress).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
- [x] 3.6 Pulido visual del QR / Mi Codigo
  - MiCodigo.tsx: mejorar la tarjeta del QR (encuadre/marco, contraste, espaciado, jerarquia) respetando tema y accesibilidad. No cambiar la logica de generacion/descarga/compartir ni la escaneabilidad.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 4. Verificacion
- [x] 4.1 Tests backend + build frontend
  - Unit: validacion home_service_fee; setup-progress (done/optional/percent/ready); getMyAppointments incluye nuevos campos; preapproval usa 99. tsc backend/frontend verdes. Suite jest sin regresiones. vite build OK.
  - _Requirements: 1.2, 2.2, 3.2, 4.3_

## Notes

- Migraciones con prisma migrate (no db push). En Windows detener node antes (EPERM). En prod migrate deploy corre al arrancar el contenedor.
- El precio en prod se ajusta tambien en SSM (SUBSCRIPTION_PRICE_MXN=99) al desplegar.
- Mercado Pago sigue en sandbox hasta configurar el webhook de produccion; el cambio de precio no altera esa condicion.
- Deploy a produccion tras verificar: build frontend + tar + scp + docker compose up -d --build (hay migracion, requiere rebuild backend).
- No romper: gating premium, flujo reserva/waitlist, aislamiento por tenant, modalidades.