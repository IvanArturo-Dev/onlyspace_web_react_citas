# Requirements Document

## Introduction

Este documento define los requisitos para migrar el frontend de la aplicacion de citas desde React Native/Expo (aplicacion movil nativa) hacia una aplicacion web construida con React. El objetivo es eliminar por completo la dependencia de compilacion nativa (Android/iOS, Gradle, JDK, Firebase nativo) que ha causado bloqueos recurrentes de build (falta de RAM, incompatibilidades de Java 21 con Android SDK 34, transformaciones jlink, storage del emulador).

La nueva aplicacion web reutilizara el backend REST existente (Express + Prisma + MySQL, endpoints bajo `/v1`) sin cambios y ofrecera las mismas funcionalidades de negocio: autenticacion (email/password y Google), dashboard, citas, clientes y servicios. Firebase se integrara mediante el SDK web de JavaScript para login con Google, analytics y remote config.

El backend NO se modifica en esta migracion. El alcance es exclusivamente el reemplazo del frontend.

## Glossary

- **App web**: la nueva aplicacion React que corre en el navegador, servida por Vite en desarrollo.
- **Backend**: la API REST existente en `backend/` (Express, puerto 3000, rutas bajo `/v1`).
- **Firebase web SDK**: la libreria JavaScript de Firebase (`firebase` en npm), no los modulos nativos `@react-native-firebase/*`.
- **Sesion**: estado autenticado del usuario, respaldado por un JWT (access token) y refresh token.

## Requirements

### Requirement 1: Reemplazo del stack por React web

**User Story:** Como desarrollador, quiero una aplicacion web React que corra en el navegador sin compilacion nativa, para poder desarrollar y desplegar sin los bloqueos de build de Android.

#### Acceptance Criteria

1. WHEN el desarrollador ejecuta el comando de desarrollo THEN el sistema SHALL iniciar un servidor de desarrollo web (Vite) accesible en el navegador sin requerir Gradle, JDK, Android SDK ni emulador.
2. WHEN se construye la app para produccion THEN el sistema SHALL generar artefactos estaticos (HTML, JS, CSS) sin invocar herramientas nativas.
3. THE app web SHALL estar escrita en React con TypeScript.
4. THE app web SHALL vivir en el repositorio sin eliminar todavia el codigo React Native existente, para permitir reuso de logica de negocio y tipos durante la migracion.
5. WHERE existan tipos de dominio reutilizables en el frontend actual (por ejemplo interfaces User, Customer, Service, Appointment) THE app web SHALL reutilizarlos o portarlos sin cambios de contrato.

### Requirement 2: Integracion con el backend REST existente

**User Story:** Como usuario, quiero que la app web consuma la misma API del backend, para tener los mismos datos y logica de negocio que la version movil.

#### Acceptance Criteria

1. THE app web SHALL comunicarse con el backend mediante HTTP hacia la base URL configurable por variable de entorno (por defecto `http://localhost:3000/v1`).
2. WHEN una peticion autenticada se envia THEN el sistema SHALL incluir el access token en el encabezado Authorization como `Bearer <token>`.
3. WHEN el backend responde 401 en una peticion autenticada AND existe un refresh token THEN el sistema SHALL intentar refrescar el token una vez y reintentar la peticion original.
4. IF el refresh de token falla THEN el sistema SHALL limpiar la sesion y redirigir al usuario a la pantalla de login.
5. THE app web SHALL persistir tokens de sesion usando almacenamiento del navegador (por ejemplo localStorage) en lugar de AsyncStorage.
6. THE backend NO SHALL ser modificado como parte de esta migracion.

### Requirement 3: Autenticacion con email y contrasena

**User Story:** Como usuario, quiero iniciar sesion y registrarme con email y contrasena, para acceder a mi cuenta.

#### Acceptance Criteria

1. WHEN el usuario envia credenciales validas en la pantalla de login THEN el sistema SHALL llamar a `POST /v1/auth/login` y almacenar access token, refresh token y datos de usuario.
2. WHEN el usuario completa el registro con datos validos THEN el sistema SHALL llamar a `POST /v1/auth/register` e iniciar sesion.
3. IF las credenciales son invalidas o el backend devuelve error THEN el sistema SHALL mostrar un mensaje de error legible sin exponer detalles internos.
4. WHEN el usuario cierra sesion THEN el sistema SHALL llamar a `POST /v1/auth/logout`, limpiar los tokens locales y redirigir al login.
5. WHILE el estado de autenticacion se esta cargando THE app web SHALL mostrar un indicador de carga.

### Requirement 4: Login con Google (Firebase web)

**User Story:** Como usuario, quiero iniciar sesion con mi cuenta de Google, para acceder rapido sin recordar una contrasena.

#### Acceptance Criteria

1. THE app web SHALL inicializar Firebase usando la configuracion web del proyecto (apiKey, authDomain, projectId, etc.) provista por variables de entorno.
2. WHEN el usuario elige iniciar sesion con Google THEN el sistema SHALL usar Firebase Authentication (signInWithPopup con GoogleAuthProvider) para obtener un ID token de Google.
3. WHEN se obtiene el ID token de Google THEN el sistema SHALL enviarlo al backend a `POST /v1/auth/google/login` para establecer la sesion de la aplicacion.
4. IF el usuario cancela el popup o Google devuelve error THEN el sistema SHALL mostrar un mensaje claro y permanecer en la pantalla de login.
5. THE configuracion de Firebase SHALL usar el proyecto existente (project_id `citas-e86bb`) para el SDK web.

### Requirement 5: Navegacion y pantallas principales

**User Story:** Como usuario, quiero navegar entre dashboard, citas, clientes, servicios y perfil, para gestionar mi negocio de citas.

#### Acceptance Criteria

1. THE app web SHALL proveer enrutamiento del lado del cliente con rutas para Login, Registro, Dashboard, Citas, Clientes, Servicios y Perfil.
2. WHERE el usuario no esta autenticado THE app web SHALL restringir el acceso a las rutas protegidas y redirigir a Login.
3. WHERE el usuario esta autenticado THE app web SHALL mostrar una navegacion principal para moverse entre Dashboard, Citas, Clientes, Servicios y Perfil.
4. WHEN el usuario accede al Dashboard THEN el sistema SHALL mostrar informacion del usuario autenticado.
5. THE app web SHALL ser responsive para funcionar en navegadores de escritorio y moviles.

### Requirement 6: Gestion de citas, clientes y servicios

**User Story:** Como usuario, quiero ver y gestionar mis citas, clientes y servicios, para operar mi agenda.

#### Acceptance Criteria

1. WHEN el usuario abre la seccion Citas THEN el sistema SHALL obtener la lista desde `GET /v1/appointments` y mostrarla.
2. WHEN el usuario abre la seccion Clientes THEN el sistema SHALL obtener la lista desde `GET /v1/customers` y mostrarla.
3. WHEN el usuario abre la seccion Servicios THEN el sistema SHALL obtener la lista desde `GET /v1/services` y mostrarla.
4. IF una peticion de datos falla THEN el sistema SHALL mostrar un estado de error con opcion de reintentar.
5. WHILE los datos se estan cargando THE app web SHALL mostrar un estado de carga.

### Requirement 7: Analytics y Remote Config (Firebase web)

**User Story:** Como responsable del producto, quiero recolectar analytics y controlar configuracion remota, para medir uso y ajustar comportamiento sin redesplegar.

#### Acceptance Criteria

1. THE app web SHALL inicializar Firebase Analytics cuando el entorno lo soporte (navegador con medicion habilitada).
2. WHEN ocurre un evento de navegacion entre pantallas principales THEN el sistema SHALL registrar un evento de analytics.
3. THE app web SHALL inicializar Firebase Remote Config con valores por defecto y obtener valores remotos al iniciar.
4. WHERE Crashlytics no esta disponible en el SDK web THE app web SHALL usar el mecanismo de reporte de errores soportado por Firebase web (por ejemplo captura de errores hacia Analytics) en lugar de Crashlytics nativo.
5. IF la inicializacion de Firebase falla THEN el sistema SHALL continuar funcionando (degradacion elegante) sin bloquear la app.

### Requirement 8: Configuracion por entorno y ejecucion local

**User Story:** Como desarrollador, quiero configurar la app mediante variables de entorno y correrla localmente contra el backend, para desarrollar de forma reproducible.

#### Acceptance Criteria

1. THE app web SHALL leer la URL base del backend y la configuracion de Firebase desde variables de entorno con prefijo compatible con Vite (`VITE_`).
2. THE repositorio SHALL incluir un archivo de ejemplo de variables de entorno documentando las claves requeridas sin exponer secretos reales.
3. WHEN el desarrollador ejecuta el comando de desarrollo con el backend corriendo en el puerto 3000 THEN la app web SHALL autenticar y cargar datos correctamente.
4. THE app web SHALL documentar en un README los pasos para instalar dependencias, configurar variables de entorno y ejecutar en desarrollo y produccion.
