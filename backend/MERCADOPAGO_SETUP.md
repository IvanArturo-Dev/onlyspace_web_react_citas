# Integración de pagos — Mercado Pago (Suscripciones)

Guía para conectar y probar la suscripción premium con Mercado Pago (API
`preapproval`, cobro recurrente mensual). Precio por defecto: **$299 MXN/mes**.

## 1. Modelo del flujo

1. Un negocio nuevo recibe **30 días de prueba premium** automáticos (al crear su
   tenant: `subscription_status='active'`, `subscription_expires_at = +30 días`).
2. Al vencer, cae a **free** automáticamente (`isPremiumEffective` respeta la fecha).
3. El emprendedor pulsa "Suscribirme" → el backend crea un `preapproval` en MP y
   devuelve `init_point` → el navegador redirige ahí para autorizar el pago.
4. Cada cobro exitoso, MP llama al **webhook** → el backend extiende
   `subscription_expires_at` **+1 mes** (idempotente por día) y registra el evento
   en `payment_records` (auditoría).

## 2. Variables de entorno (backend/.env)

```
MERCADOPAGO_ACCESS_TOKEN=   # Access Token de tu app en MP (PRUEBA primero, luego PRODUCCIÓN)
MERCADOPAGO_PUBLIC_KEY=     # opcional (no requerida para preapproval con redirect)
SUBSCRIPTION_PRICE_MXN=299  # precio mensual
SUBSCRIPTION_BACK_URL=https://TU-DOMINIO/suscripcion/retorno  # DEBE ser HTTPS público (MP rechaza localhost)
TRIAL_DAYS=30
```

- El Access Token **nunca** se escribe en el código; solo en `.env` (que está en
  `.gitignore`) o en el gestor de secretos del hosting en producción.
- Si falta el token, los endpoints responden **503 PAYMENTS_NOT_CONFIGURED** (no rompen).

## 3. Obtener credenciales

1. Entra a https://www.mercadopago.com.mx/developers → **Tus integraciones** → crea una app.
2. En **Credenciales** copia el **Access Token de prueba** (para sandbox) y ponlo en
   `MERCADOPAGO_ACCESS_TOKEN`. En producción usarás el de **producción**.

## 4. Usuarios de prueba (sandbox)

MP exige que el `payer_email` sea un **usuario de prueba del mismo país (MX / site_id MLM)**.
Crea usuarios de prueba con tu token:

```bash
# Comprador de prueba (México)
curl -X POST https://api.mercadopago.com/users/test_user \
  -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"site_id":"MLM"}'
```

Usa el `email` y `password` devueltos para pagar en el `init_point` con las
**tarjetas de prueba** de MP (ver su documentación de tarjetas de prueba: aprobada,
rechazada, etc.).

## 5. Webhook (necesario para que el premium se extienda)

MP notifica los cobros a: `POST /v1/webhooks/mercadopago` (ruta pública).

- En **local** MP NO puede alcanzar `localhost`. Usa un túnel:
  ```bash
  ngrok http 3000
  # copia la URL https que te da, p.ej. https://abc123.ngrok-free.app
  ```
- En el panel de MP → tu app → **Webhooks/Notificaciones**, registra:
  `https://<tu-url-publica>/v1/webhooks/mercadopago`
- Ajusta `SUBSCRIPTION_BACK_URL` a `https://<tu-url-publica-frontend>/suscripcion/retorno`
  (o la URL de tu frontend desplegado).

## 6. Probar el flujo completo

1. Backend con URL pública (deploy o ngrok) + `MERCADOPAGO_ACCESS_TOKEN` de prueba.
2. Login como emprendedor → banner de prueba / pantalla `/suscripcion` → "Suscribirme".
3. Te redirige al `init_point` de MP → paga con el usuario+tarjeta de prueba.
4. MP llama al webhook → el backend extiende el premium +1 mes y escribe una fila en
   `payment_records`.
5. Verifica en `/suscripcion/retorno` que el estado pase a premium.

## 7. Auditoría de pagos

- Tabla **`payment_records`** (append-only): una fila por cada notificación de MP,
  con `tenant_id`, `preapproval_id`, `status`, `amount`, `payer_email` y el payload
  crudo (`raw`) para trazabilidad. Nunca se borra.
- El super admin puede consultarla: `GET /v1/admin/payments?tenant_id=&page=&page_size=`.

## 8. Producción — checklist

- [ ] Regenerar credenciales y usar el **Access Token de PRODUCCIÓN** (nunca el de un chat).
- [ ] `SUBSCRIPTION_BACK_URL` con el dominio real (HTTPS).
- [ ] Webhook registrado con la URL pública del backend en producción.
- [ ] Secreto del token en el gestor de secretos del hosting (no en el repo).
