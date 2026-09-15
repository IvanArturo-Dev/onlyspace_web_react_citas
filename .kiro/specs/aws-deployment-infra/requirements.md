# Requirements Document

## Introduction

Esta spec define la infraestructura en AWS para publicar OnlySpace (backend Node/Express + Prisma, frontend web React/Vite, base de datos MySQL, cache Redis) en produccion, con el menor costo posible mientras la base de usuarios es pequena. El objetivo es un presupuesto aproximado de 500 MXN/mes, aprovechando la capa gratuita (Free Tier) de una cuenta AWS nueva.

La arquitectura elegida es un unico servidor EC2 que corre todos los servicios con Docker Compose (backend, Nginx sirviendo el frontend estatico y actuando como reverse proxy con HTTPS, MySQL y Redis), con backups automaticos a S3, certificado HTTPS gratuito (Let's Encrypt), despliegue automatico via GitHub Actions, dominio propio (comprado en HostGator) apuntando al servidor, y alertas de costo para no exceder el presupuesto.

El sistema en local ya esta completo y probado. Esta spec cubre exclusivamente la capa de infraestructura y despliegue; no modifica la logica de la aplicacion salvo ajustes menores de configuracion para produccion (variables de entorno, webhook de Mercado Pago, back_url).

## Glossary

- Instancia: servidor virtual EC2.
- Free Tier: capa gratuita de AWS durante los primeros 12 meses de una cuenta nueva.
- Reverse proxy: Nginx recibe el trafico HTTPS y lo enruta al backend o sirve el frontend estatico.
- Webhook: notificacion HTTP que Mercado Pago envia al backend cuando cambia el estado de un pago.

## Requirements

### Requirement 1: Servidor unico de computo (EC2) de bajo costo

**User Story:** Como duenno del sistema, quiero un unico servidor EC2 que corra toda la aplicacion, para minimizar el costo mensual mientras hay pocos usuarios.

#### Acceptance Criteria

1. WHEN se aprovisiona la infraestructura THEN el sistema SHALL crear una unica instancia EC2 de tipo t3.micro (elegible para Free Tier) en la region us-east-1.
2. WHERE la cuenta AWS es nueva (menos de 12 meses) THE sistema SHALL usar un tipo de instancia y volumen que califiquen para la capa gratuita.
3. IF la memoria disponible resulta insuficiente para todos los contenedores THEN el sistema SHALL contar con un archivo de swap configurado en la instancia para evitar fallos por falta de memoria.
4. THE tipo de instancia SHALL ser parametrizable para poder escalar a t3.small con un unico cambio de configuracion.
5. THE instancia SHALL tener asignada una direccion IP publica estable (Elastic IP) para que el dominio apunte a una IP fija.

### Requirement 2: Orquestacion de servicios con Docker Compose

**User Story:** Como operador, quiero que todos los servicios corran en contenedores gestionados por Docker Compose en la instancia, para desplegar y reiniciar el stack de forma consistente.

#### Acceptance Criteria

1. THE instancia SHALL ejecutar backend, Nginx, MySQL y Redis como contenedores definidos en un archivo docker-compose de produccion.
2. WHEN la instancia se reinicia THEN los contenedores SHALL reiniciarse automaticamente (politica restart unless-stopped).
3. THE datos de MySQL SHALL persistir en un volumen que sobreviva a reinicios y recreaciones de contenedor.
4. THE contenedores de MySQL y Redis SHALL tener limites de memoria configurados para caber en la instancia.
5. THE backend SHALL leer su configuracion (secretos incluidos) desde variables de entorno inyectadas en tiempo de despliegue, nunca hardcodeadas ni commiteadas.

### Requirement 3: HTTPS y reverse proxy

**User Story:** Como usuario final, quiero acceder al sistema por HTTPS con un dominio propio, para que la conexion sea segura y confiable.

#### Acceptance Criteria

1. THE Nginx SHALL servir el frontend estatico (build de Vite) y actuar como reverse proxy hacia el backend en la ruta de la API.
2. THE sistema SHALL obtener y renovar automaticamente un certificado TLS gratuito (Let's Encrypt) para el dominio.
3. WHEN un usuario accede por HTTP THEN el sistema SHALL redirigir a HTTPS.
4. THE webhook publico de Mercado Pago SHALL ser accesible por HTTPS en la ruta correspondiente del backend.

### Requirement 4: Base de datos y migraciones en produccion

**User Story:** Como operador, quiero que la base de datos MySQL de produccion se inicialice y migre de forma controlada, para que el esquema este siempre correcto tras cada despliegue.

#### Acceptance Criteria

1. WHEN se despliega una nueva version THEN el sistema SHALL aplicar las migraciones de Prisma con prisma migrate deploy antes de poner en linea el backend.
2. IF una migracion falla THEN el despliegue SHALL detenerse y conservar la version anterior en ejecucion.
3. THE credenciales de la base de datos SHALL provenir de variables de entorno seguras, no de valores por defecto.

### Requirement 5: Backups automaticos

**User Story:** Como duenno del sistema, quiero backups automaticos de la base de datos, para poder recuperar la informacion ante un fallo del servidor.

#### Acceptance Criteria

1. THE sistema SHALL ejecutar un respaldo diario de la base de datos MySQL.
2. THE respaldos SHALL almacenarse en un bucket S3 privado.
3. THE respaldos SHALL tener una politica de retencion que elimine los mas antiguos para controlar el costo de almacenamiento.
4. WHEN se genera un respaldo THEN el sistema SHALL registrar exito o fallo de forma consultable.

### Requirement 6: Despliegue automatico (CI/CD)

**User Story:** Como desarrollador, quiero que al hacer push a la rama principal se construya y despliegue automaticamente, para no desplegar manualmente.

#### Acceptance Criteria

1. WHEN se hace push a la rama main THEN el pipeline SHALL construir el backend y el frontend y ejecutar las pruebas antes de desplegar.
2. IF las pruebas o el build fallan THEN el pipeline SHALL abortar el despliegue.
3. WHEN el build es exitoso THEN el pipeline SHALL publicar la nueva version en la instancia EC2 y reiniciar los contenedores afectados.
4. THE credenciales de AWS y demas secretos del pipeline SHALL almacenarse como secretos del repositorio, nunca en el codigo.
5. THE despliegue SHALL ser idempotente y permitir volver a ejecutarse sin dejar el sistema en un estado inconsistente.

### Requirement 7: Dominio propio (HostGator)

**User Story:** Como duenno del sistema, quiero conectar el dominio que compre en HostGator al servidor, para que los usuarios accedan por una URL de marca.

#### Acceptance Criteria

1. THE spec SHALL documentar los pasos exactos para apuntar el dominio de HostGator a la infraestructura (cambio de nameservers a Route 53 o registro A hacia la Elastic IP).
2. WHERE se use Route 53 THE sistema SHALL crear la zona hospedada y los registros necesarios.
3. THE certificado HTTPS SHALL emitirse para el dominio final una vez que el DNS resuelva a la instancia.

### Requirement 8: Control de costos

**User Story:** Como duenno del sistema, quiero alertas de costo, para no exceder mi presupuesto de aproximadamente 500 MXN mensuales.

#### Acceptance Criteria

1. THE sistema SHALL configurar un presupuesto (AWS Budgets) con un tope mensual definido.
2. WHEN el gasto proyectado alcanza el 50, 80 y 100 por ciento del tope THEN el sistema SHALL enviar una alerta por correo.
3. THE spec SHALL incluir una estimacion de costo mensual desglosada por recurso.

### Requirement 9: Configuracion de produccion de Mercado Pago

**User Story:** Como duenno del sistema, quiero que la integracion de pagos quede operativa en produccion, para cobrar suscripciones reales.

#### Acceptance Criteria

1. WHEN el sistema esta en produccion THEN el back_url de Mercado Pago SHALL apuntar al dominio real por HTTPS.
2. THE webhook de Mercado Pago SHALL configurarse en el panel de MP apuntando a la ruta publica HTTPS del backend.
3. WHERE el entorno es produccion THE variable MERCADOPAGO_TEST_PAYER_EMAIL SHALL estar ausente, de modo que se use el email real del emprendedor.
4. THE Access Token de produccion de Mercado Pago SHALL inyectarse como secreto, nunca commitearse.

### Requirement 10: Seguridad de red minima

**User Story:** Como duenno del sistema, quiero exponer solo lo necesario, para reducir la superficie de ataque.

#### Acceptance Criteria

1. THE grupo de seguridad de la instancia SHALL permitir trafico entrante solo en los puertos 80, 443 y el puerto de administracion (SSH) restringido.
2. THE MySQL y Redis NO SHALL exponerse a Internet; solo seran accesibles dentro de la red de contenedores del host.
3. WHERE sea posible THE acceso administrativo (SSH) SHALL restringirse por IP o gestionarse por un mecanismo seguro.


### Requirement 11: Gestion de secretos en AWS (SSM Parameter Store)

**User Story:** Como duenno del sistema, quiero que los secretos de la aplicacion vivan en AWS y no en GitHub, para reducir la superficie de exposicion y no depender del repositorio para las credenciales de produccion.

#### Acceptance Criteria

1. THE secretos de la aplicacion (credenciales de base de datos, JWT, Mercado Pago, Google, superadmin, etc.) SHALL almacenarse en AWS SSM Parameter Store como parametros cifrados (SecureString) bajo un prefijo del proyecto (ej. /onlyspace/).
2. THE instancia EC2 SHALL tener un IAM role (instance profile) con permiso de solo lectura sobre los parametros SSM del proyecto, sin claves de acceso estaticas.
3. WHEN se despliega o arranca el stack THEN el servidor SHALL leer los parametros desde SSM y generar el archivo .env de produccion localmente.
4. THE GitHub Secrets SHALL contener unicamente lo necesario para la conexion y el build: la clave SSH (EC2_SSH_KEY), el host (EC2_HOST), el dominio (PROD_DOMAIN) y las variables VITE_ del frontend (que no son secretas: se incrustan en el bundle publico).
5. THE secretos de la aplicacion NO SHALL transitar por GitHub Actions ni quedar en logs.
