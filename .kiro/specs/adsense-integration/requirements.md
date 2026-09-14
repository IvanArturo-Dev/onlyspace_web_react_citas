# Requirements Document

## Introduction

El frontend ya cuenta con el componente `AdSlot` que inyecta el script de AdSense
y renderiza unidades publicitarias solo cuando existe la variable
`VITE_ADSENSE_CLIENT`. Falta la configuracion de cuenta que Google exige para
reconocer y aprobar el sitio como editor: el Publisher ID en el entorno, la
etiqueta `<meta>` de verificacion en el `index.html`, y el archivo `ads.txt`
servido en la raiz del dominio publico.

El Publisher ID del usuario es `ca-pub-5010212627777538`.

Restriccion de negocio ya acordada (no cambia): un espacio publicitario nunca se
muestra vacio ni con placeholder. `AdSlot` solo renderiza si AdSense esta
configurado; sin la variable no se ve nada. Los anuncios propios del emprendedor
(PromoCard) son independientes de AdSense.

Dependencia externa: la aprobacion y el servicio real de anuncios requieren un
dominio publico (`onlyspace.site`) con la cuenta de AdSense aprobada. En
`localhost` no se muestran anuncios reales; esta integracion deja el sitio listo
para la revision de Google.

## Glossary

- **Publisher ID**: identificador de editor de AdSense con formato `ca-pub-XXXX`.
- **ads.txt**: archivo de texto en la raiz del dominio que autoriza vendedores de anuncios.
- **AdSlot**: componente del frontend que inyecta el script de AdSense y renderiza una unidad publicitaria.
- **PromoCard**: anuncio propio del emprendedor, independiente de AdSense.

## Requirements

### Requisito 1: Configurar el Publisher ID en el entorno

**Historia de usuario:** Como duenio del sitio, quiero que el Publisher ID de
AdSense este definido en el entorno del frontend, para que `AdSlot` inyecte el
script y sirva anuncios sin tocar codigo.

#### Criterios de aceptacion

1. CUANDO el frontend se construye o arranca ENTONCES el sistema DEBERA leer
   `VITE_ADSENSE_CLIENT` con el valor `ca-pub-5010212627777538` desde `.env`.
2. CUANDO `VITE_ADSENSE_CLIENT` esta presente ENTONCES `AdSlot` DEBERA inyectar el
   script `adsbygoogle.js` con ese `client` una sola vez en toda la app.
3. CUANDO `VITE_ADSENSE_CLIENT` NO esta definido ENTONCES `AdSlot` DEBERA renderizar
   `null` y NO inyectar ningun script (comportamiento actual, se preserva).
4. EL sistema DEBERA documentar la variable en `.env.example` (si existe) para que
   otros entornos la configuren.

### Requisito 2: Verificacion de la cuenta en index.html

**Historia de usuario:** Como duenio del sitio, quiero incluir la etiqueta meta de
verificacion de AdSense en el HTML, para que Google confirme la propiedad del sitio
durante la revision.

#### Criterios de aceptacion

1. EL `index.html` DEBERA incluir en el `<head>` la etiqueta
   `<meta name="google-adsense-account" content="ca-pub-5010212627777538">`.
2. LA etiqueta DEBERA estar presente en el HTML servido tanto en desarrollo como en
   el build de produccion.
3. LA insercion NO DEBERA romper el arranque de la app ni el resto del `<head>`.

### Requisito 3: Archivo ads.txt en la raiz publica

**Historia de usuario:** Como duenio del sitio, quiero servir un `ads.txt` valido en
la raiz del dominio, para autorizar a Google como vendedor y cumplir el requisito de
AdSense.

#### Criterios de aceptacion

1. EL sistema DEBERA incluir un archivo `ads.txt` cuyo contenido sea exactamente:
   `google.com, pub-5010212627777538, DIRECT, f08c47fec0942fa0`.
2. EL archivo DEBERA colocarse en `frontend-web/public/` para que Vite lo copie a la
   raiz del build y quede accesible en `/ads.txt`.
3. CUANDO se solicita `https://<dominio>/ads.txt` ENTONCES el servidor DEBERA
   responder el contenido de texto plano sin redirecciones.

### Requisito 4: No regresion del comportamiento sin AdSense

**Historia de usuario:** Como usuario, no quiero ver espacios publicitarios vacios
cuando AdSense no esta activo, para mantener la interfaz limpia.

#### Criterios de aceptacion

1. CUANDO `VITE_ADSENSE_CLIENT` no esta definido ENTONCES Landing, Login y el portal
   del cliente NO DEBERAN mostrar ninguna seccion de anuncios (comportamiento actual).
2. LA presencia del `<meta>` y del `ads.txt` NO DEBERA provocar que se muestren
   espacios vacios en la UI.
3. EL sistema DEBERA compilar sin errores (`tsc --noEmit`) y construir con exito
   (`vite build`) tras los cambios.
