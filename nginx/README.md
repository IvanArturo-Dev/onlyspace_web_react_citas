# Nginx (reverse proxy + SPA + HTTPS) — OnlySpace

Esta carpeta contiene la configuración de Nginx que actúa como único servicio
expuesto a Internet (puertos 80 y 443). Nginx sirve el frontend estático (build
de Vite) y hace de reverse proxy hacia el backend Express (`backend:3000`).

```
nginx/
  conf.d/
    onlyspace.conf   # server blocks 80 (ACME + redirect) y 443 (TLS + SPA + proxy)
  README.md
```

## Reemplazar el dominio (placeholder DOMAIN)

En `conf.d/onlyspace.conf` hay un placeholder **`DOMAIN`** que debes reemplazar
por tu dominio real (por ejemplo `onlyspace.app`). Aparece en:

- `server_name DOMAIN www.DOMAIN;` (en ambos server blocks, 80 y 443).
- `ssl_certificate     /etc/letsencrypt/live/DOMAIN/fullchain.pem;`
- `ssl_certificate_key /etc/letsencrypt/live/DOMAIN/privkey.pem;`

La carpeta `live/DOMAIN` que crea certbot coincide con el **primer `-d`** que le
pases al emitir el certificado. Usa el mismo nombre en las tres rutas.

## Rutas servidas

| Ruta            | Destino                          | Notas                                  |
|-----------------|----------------------------------|----------------------------------------|
| `/v1/...`       | `http://backend:3000`            | API (auth, me, webhooks/mercadopago…)  |
| `/health`       | `http://backend:3000/health`     | Health check                           |
| `/` (resto)     | `try_files … /index.html`        | Fallback SPA para React Router         |
| `/.well-known/acme-challenge/` | webroot `/var/www/certbot` | Retos ACME de Let's Encrypt (por HTTP) |

## Emitir el certificado la primera vez (certbot, modo webroot)

El webroot `/var/www/certbot` debe estar montado como volumen compartido entre
el contenedor de Nginx y el de certbot (se define en `docker-compose.prod.yml`),
de modo que certbot escriba el reto ahí y Nginx lo sirva por HTTP en
`/.well-known/acme-challenge/`.

Orden de emisión (una sola vez, tras apuntar el DNS a la IP del servidor):

1. Asegúrate de que el dominio ya resuelve a la Elastic IP del servidor (el DNS
   debe haber propagado; ver la nota al final).
2. Levanta Nginx con el server block de 80 activo (el de 443 aún no puede
   arrancar sin certificado; comenta temporalmente el bloque 443 o usa una
   config mínima solo-HTTP hasta emitir el cert).
3. Ejecuta certbot en modo webroot. Ejemplo (reemplaza `DOMAIN` y el email):

   ```bash
   certbot certonly --webroot \
     -w /var/www/certbot \
     -d DOMAIN -d www.DOMAIN \
     --email tu-correo@ejemplo.com \
     --agree-tos --no-eff-email
   ```

   Con Docker Compose, lo habitual es correrlo dentro del contenedor certbot:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm certbot \
     certonly --webroot -w /var/www/certbot \
     -d DOMAIN -d www.DOMAIN \
     --email tu-correo@ejemplo.com --agree-tos --no-eff-email
   ```

4. Una vez emitido el certificado, activa el server block de 443 (descomenta si
   lo habías comentado) y recarga Nginx:

   ```bash
   docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
   ```

## Renovación automática

Let's Encrypt emite certificados válidos por 90 días. La renovación es
automática mediante `certbot renew` agendado (cron o systemd timer, o el propio
contenedor certbot en bucle). `certbot renew` solo renueva si faltan ~30 días.

**Nginx debe recargarse tras cada renovación** para tomar el certificado nuevo.
Ejemplo de hook de despliegue en `certbot renew`:

```bash
certbot renew --deploy-hook "docker compose -f docker-compose.prod.yml exec nginx nginx -s reload"
```

O bien un cron diario en el host que ejecute `certbot renew` y luego recargue
Nginx.

## Nota sobre DNS y HTTPS temporalmente sin certificado

Mientras el DNS no propague (el dominio aún no resuelve a la IP del servidor),
Let's Encrypt no puede validar el dominio y **el puerto 443 no tendrá
certificado**. El certificado se emite **después** de apuntar el dominio a la IP
(Elastic IP) y de que el DNS resuelva. Durante ese lapso, el servicio queda
disponible solo por HTTP (puerto 80) hasta completar la emisión.
