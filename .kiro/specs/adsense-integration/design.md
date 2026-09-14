# Design Document

## Overview

La integracion de AdSense se completa con tres piezas de configuracion, sin logica
nueva de runtime: (1) el Publisher ID en el entorno del frontend, (2) la etiqueta
meta de verificacion en el HTML, y (3) el archivo `ads.txt` en la raiz publica. El
componente `AdSlot` ya implementa la inyeccion condicional del script y la regla de
no-placeholder; el diseño no lo modifica, solo lo alimenta con la variable.

Publisher ID: `ca-pub-5010212627777538`.

## Architecture

Flujo de activacion de anuncios:

```
.env (VITE_ADSENSE_CLIENT=ca-pub-5010212627777538)
        |
        v
import.meta.env.VITE_ADSENSE_CLIENT  --> AdSlot
        |                                   |
   presente?                          si: inyecta adsbygoogle.js + <ins>
        |                             no: return null (sin placeholder)
        v
Google AdSense <--- verificacion ---  index.html <meta google-adsense-account>
               <--- autorizacion ---  /ads.txt (public/ads.txt)
```

Puntos clave:

- Vite expone al cliente solo variables con prefijo `VITE_`, por eso el nombre
  `VITE_ADSENSE_CLIENT`.
- Vite copia el contenido de `public/` tal cual a la raiz del build, de modo que
  `public/ads.txt` se sirve como `/ads.txt` sin configuracion extra.
- El `<meta>` va estatico en `index.html`; se sirve igual en dev y en build.
- El `<script>` de AdSense NO se agrega al HTML: `AdSlot` ya lo inyecta una sola vez
  via `ensureAdSenseScript`. Duplicarlo causaria doble carga.

## Components and Interfaces

### 1. Variable de entorno

- Archivo: `frontend-web/.env` (local) y `frontend-web/.env.example` (plantilla).
- Clave nueva: `VITE_ADSENSE_CLIENT`.
- Valor real (solo en `.env`): `ca-pub-5010212627777538`.
- En `.env.example`: placeholder documentado, p.ej. `VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX`.
- Consumidor: `AdSlot.tsx` via `import.meta.env.VITE_ADSENSE_CLIENT` (ya existente).

### 2. Meta de verificacion

- Archivo: `frontend-web/index.html`.
- Insercion en `<head>`, despues del `<title>`:
``` html
<meta name="google-adsense-account" content="ca-pub-5010212627777538" />
```
- Sin dependencias de JS; no afecta el bundle.

### 3. ads.txt

- Archivo nuevo: `frontend-web/public/ads.txt`.
- Contenido exacto (una linea, texto plano):
```
google.com, pub-5010212627777538, DIRECT, f08c47fec0942fa0
```
- Servido por Vite en `/ads.txt` en dev y en build.

## Data Models

No hay modelos de datos ni cambios de base de datos. Toda la integracion es
configuracion estatica de frontend.

## Error Handling

- Variable ausente: `AdSlot` ya maneja el caso devolviendo `null`; no hay error.
- Script de AdSense no disponible: el `push({})` esta envuelto en `try/catch` en
  `AdSlot`, se ignora silenciosamente (comportamiento existente).
- `ads.txt` o `<meta>` no impactan runtime; su unico "error" posible es de
  configuracion del dominio (fuera de alcance del codigo, se documenta).

## Testing Strategy

Al ser configuracion estatica, la verificacion es de build y de contenido, no de
pruebas unitarias nuevas:

1. `npx tsc --noEmit` en `frontend-web` -> 0 errores.
2. `npx vite build` en `frontend-web` -> build exitoso.
3. Confirmar que `dist/ads.txt` existe tras el build y su contenido es la linea
   esperada.
4. Confirmar que `dist/index.html` contiene el `<meta google-adsense-account>`.
5. Verificacion manual en dev: `http://localhost:5173/ads.txt` responde el texto.
6. No-regresion: sin `VITE_ADSENSE_CLIENT`, `AdSlot` no renderiza (revision visual
   de Landing/Login); con la variable, aparece el contenedor del anuncio.

## Correctness Properties

### Property 1: Script inyectado una sola vez
Si `VITE_ADSENSE_CLIENT` esta definido, el script `adsbygoogle.js` se inyecta exactamente una vez en toda la app.

**Validates: Requirements 1.2**

### Property 2: Sin config, sin render
Si `VITE_ADSENSE_CLIENT` no esta definido, `AdSlot` renderiza `null` y no se inyecta ningun script.

**Validates: Requirements 1.3, 4.1**

### Property 3: ads.txt en el build
El build siempre produce `dist/ads.txt` con la linea de autorizacion exacta.

**Validates: Requirements 3.1, 3.2**

### Property 4: Meta de verificacion presente
El HTML servido (dev y build) contiene el `<meta google-adsense-account>` con el Publisher ID correcto.

**Validates: Requirements 2.1, 2.2**

### Property 5: Sin espacios vacios
Ningun cambio introduce espacios publicitarios vacios ni placeholders en la UI.

**Validates: Requirements 4.2, 4.3**

## Dependencias externas y despliegue

- La aprobacion de AdSense y el servicio de anuncios reales requieren el dominio
  publico `onlyspace.site` con la cuenta aprobada. En `localhost` no se muestran
  anuncios reales aunque la configuracion sea correcta.
- Tras desplegar, validar `https://onlyspace.site/ads.txt` y solicitar la revision
  en el panel de AdSense.
