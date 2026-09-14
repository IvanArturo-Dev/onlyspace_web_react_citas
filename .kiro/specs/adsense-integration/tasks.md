# Implementation Plan

## Overview

Integracion de configuracion de Google AdSense (Publisher ID `ca-pub-5010212627777538`)
en el frontend: variable de entorno, meta de verificacion y `ads.txt`. Sin logica
nueva de runtime; `AdSlot` ya implementa el render condicional.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4"] },
    { "wave": 3, "tasks": ["5"] }
  ]
}
```

```
1 (env var)     3 (ads.txt)     2 (meta)
      \        |        /
            4 (verificar build)
                 |
            5 (no-regresion UI)
```

- Tareas 1, 2 y 3 son independientes entre si.
- Tarea 4 depende de 1, 2 y 3.
- Tarea 5 depende de 4.

## Tasks

- [ ] 1. Agregar VITE_ADSENSE_CLIENT al entorno del frontend
  - Anadir `VITE_ADSENSE_CLIENT=ca-pub-5010212627777538` en `frontend-web/.env`.
  - Documentar la clave en `frontend-web/.env.example` con placeholder `ca-pub-XXXXXXXXXXXXXXXX`.
  - Confirmar que `AdSlot.tsx` la consume via `import.meta.env.VITE_ADSENSE_CLIENT` (sin cambios de codigo).
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Insertar el meta de verificacion en index.html
  - Agregar `<meta name="google-adsense-account" content="ca-pub-5010212627777538" />` dentro del `<head>` de `frontend-web/index.html`, despues del `<title>`.
  - No agregar el `<script>` de adsbygoogle al HTML (lo inyecta AdSlot).
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 3. Crear el archivo ads.txt en la carpeta publica
  - Crear `frontend-web/public/ads.txt` con la linea exacta `google.com, pub-5010212627777538, DIRECT, f08c47fec0942fa0`.
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Verificar build y contenido servido
  - Ejecutar `npx tsc --noEmit` en `frontend-web` (0 errores).
  - Ejecutar `npx vite build` en `frontend-web` (build exitoso).
  - Confirmar que `dist/ads.txt` existe con el contenido esperado y que `dist/index.html` contiene el `<meta google-adsense-account>`.
  - Verificar en dev que `http://localhost:5173/ads.txt` responde el texto.
  - _Requirements: 2.2, 3.2, 3.3, 4.3_

- [ ] 5. Verificar no-regresion de la UI de anuncios
  - Con la variable presente, confirmar que AdSlot renderiza el contenedor en Landing/Login.
  - Documentar que la aprobacion real de AdSense requiere el dominio publico `onlyspace.site` y cuenta aprobada (localhost no sirve anuncios reales).
  - _Requirements: 4.1, 4.2_

## Notes

- Vite copia `public/ads.txt` a la raiz del build; se sirve en `/ads.txt`.
- El `<script>` de AdSense lo inyecta `AdSlot`; no duplicarlo en el HTML.
- La aprobacion y el servicio real de anuncios dependen del despliegue del dominio publico (fuera del alcance de codigo).
