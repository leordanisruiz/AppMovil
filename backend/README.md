# Backend AppMovil

API REST con FastAPI y SQLAlchemy. El punto de entrada es `app.main:app` y
las rutas están bajo `/api/v1`.

## Login de empleados Kactus

`POST /api/v1/auth/login` recibe únicamente `identificacion` (cédula) y
`password`. Para operadores, `password` es el código asignado en Kactus; para
usuarios administrativos, es la contraseña creada durante el registro.
El backend busca a la persona en `"DW_SUMA"."DimEmpleados"` por identificación
y usa el tipo de documento devuelto por Kactus para verificar la cuenta
administrativa. Solo permite el acceso cuando `IndicadorActividad` es `A`.

Ejemplo:

```json
{
  "identificacion": "1080017116",
  "password": "23099412"
}
```

- Credenciales que no coinciden: `401` con `Credenciales incorrectas.`
- Empleado inactivo: `403` con `El empleado no está activo en Kactus.`
- Base de datos no disponible: `503` con un mensaje que no expone consultas ni
  credenciales.

### Registro de cuentas

- `POST /api/v1/auth/validate-registration`: recibe `tipo_documento` e
  `identificacion`, verifica que la persona exista y esté activa en SUMA, y
  determina si tiene `Codigo` asignado en Kactus. Si tiene código, es operador
  y no puede registrar contraseña administrativa.
- `POST /api/v1/auth/register-password`: vuelve a consultar SUMA antes de
  aceptar el alta. Acepta `tipo_documento`, `identificacion` y una contraseña
  de exactamente ocho dígitos ASCII. Rechaza empleados con código de operador
  Kactus y cuentas ya creadas.
- El alta guarda un hash bcrypt (nunca la contraseña en claro) y la fecha de
  creación en `"DW_CONFIG".usuarios_app`. `rol_id` se asigna a partir de
  `"DW_SUMA"."DimEmpleados"."Clasificacion"`: `ADMINISTRATIVO` o
  `ADMINISTRATIVA` se guarda como `1`; las demás clasificaciones, como `2`.
- El login de cuentas sin código de operador valida el hash registrado.
- El acceso administrativo solo se valida por tipo y número de identificación
  contra SUMA, como se solicitó; no demuestra control de esos datos. Quien
  conozca la identificación de un empleado activo podría registrar una clave
  en su nombre. Para producción debe añadirse un OTP por un canal de contacto
  previamente verificado, además de limitación de intentos.

Ejemplo de validación:

```json
{
  "tipo_documento": "CC",
  "identificacion": "5843452"
}
```

Ejemplo de alta de contraseña:

```json
{
  "tipo_documento": "CC",
  "identificacion": "5843452",
  "password": "12345678"
}
```

En el inicio de sesión, tanto operadores como usuarios administrativos envían
los mismos dos campos: `identificacion` y `password`. El backend determina el
método de autenticación según si Kactus tiene un `Codigo` asignado al empleado.

La respuesta exitosa contiene `access_token`, `token_type`, `expires_in` y el
objeto `empleado` con `Codigo`, `TipoDocumento`, `Identificacion`,
`NombreCompleto`, `FechaIngreso`, `Cargo` y `EstadoEmpleado`.

El JWT usa HS256 y contiene `sub` (la identificación), `TipoDocumento`,
`Identificacion`, `iat` y `exp`. **No incluye `Codigo`**: el código es también
la contraseña y los JWT firmados no están cifrados. Para los operadores, la
respuesta incluye `Codigo` según el contrato; para los administrativos es
nulo. El cliente no debería guardar el código ni escribirlo en logs.

Las demás rutas bajo `/api/v1` requieren
`Authorization: Bearer <access_token>`. El login es público.

### Seguimiento de tareas creadas

Los usuarios activos con `rol_id` 1 (administración) o 2 (operación) pueden
consultar exclusivamente las tareas que crearon:

- `GET /api/v1/tareas/creadas`: lista de tareas creadas por la identidad
  autenticada.
- `GET /api/v1/tareas/creadas/{id}`: detalle, novedades relacionadas y
  evidencias registradas.
- `PATCH /api/v1/tareas/creadas/{id}/cerrar`: marca como `CERRADO` el estado de
  una tarea
  creada por el usuario autenticado.

El cierre administrativo marca la tarea `CERRADO`. El operador asignado puede
marcarla `COMPLETADA` después de cargar evidencias; esa acción muestra un aviso
de que Operaciones validará la evidencia antes de cerrar la novedad en SICO.

## Configuración y ejecución

1. Instalar dependencias: `pip install -r requirements.txt`.
2. Copiar `.env.example` a `.env`.
3. Los logs se guardan en `logs/YYYY-MM-DD.log`; configure `LOG_DIR` para
   cambiar la carpeta. Se agrega al archivo de la fecha local del servidor,
   incluso después de reiniciar la aplicación. Se guardan los logs de la API,
   incluyendo los accesos y errores de Uvicorn. No se registran los valores
   enviados como cédula ni código en los intentos de login.
4. Para una instalación nueva, aplicar `sql/001_create_usuarios_app.sql`. Si
   `public.usuarios_app` ya fue creada con la versión anterior, aplicar
   `sql/002_add_usuario_app_id.sql`; migra la tabla existente al esquema
   `"DW_CONFIG"`, añade el consecutivo y mantiene la unicidad de tipo/número
   de identificación. Para notificaciones Expo, aplicar además
   `sql/003_create_expo_push_notifications.sql`. Para habilitar tareas,
   aplicar `sql/004_create_tareas_operador.sql` y luego
   `sql/005_task_assignment_roles.sql`, `sql/006_add_closed_task_state.sql` y
   `sql/007_task_status_push_events.sql` para notificar cambios de estado.
   Aplicar `sql/008_backfill_usuario_roles.sql` para completar roles de
   usuarios ya registrados.
   Ejecutar los scripts con el
   proceso de despliegue/DBA; la API no aplica DDL al iniciar.
5. Configurar `DATABASE_URL` para la instancia PostgreSQL que contiene
   `"DW_SUMA"."DimEmpleados"`, `"DW_SUMA"."FactNovedadesSico"` y
   `"DW_CONFIG".usuarios_app` y las tablas Expo. La cuenta runtime debe tener
   `USAGE` en los esquemas `"DW_SUMA"` y `"DW_CONFIG"`, `SELECT` en las tablas
   SUMA, `SELECT`/`INSERT` en `"DW_CONFIG".usuarios_app` y
   `SELECT`/`INSERT`/`UPDATE` en las tablas `expo_push_*`; también
   requiere `USAGE`/`SELECT` en la secuencia
   `"DW_CONFIG".expo_push_outbox_id_seq`. La creación inicial requiere permisos
   DDL para DBA. Codifique los caracteres reservados de la URL.
6. Configurar `JWT_SECRET_KEY` con al menos 32 bytes aleatorios; por ejemplo:
   `python -c "import secrets; print(secrets.token_urlsafe(64))"`.
7. Para permitir conexiones desde un teléfono en la misma red Wi-Fi, iniciar
   localmente con `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.
   Autorice el puerto TCP 8000 en el Firewall de Windows para la red privada.
   La URL configurada en la app debe usar la IPv4 del computador, no
   `localhost`.
8. Para solicitudes desde el navegador, configure `CORS_ORIGINS` como una
   lista separada por comas de los orígenes autorizados (dominio y puerto, sin
   rutas como `/api-movil`). El valor local
   predeterminado permite `http://localhost:8081` y
   `http://127.0.0.1:8081`; en producción, agregue el origen HTTPS del frontend
   publicado. No use `*` para una app que envía credenciales o tokens.

En Docker Compose, `DATABASE_URL` debe apuntar a una dirección alcanzable desde
el contenedor (no `localhost` para una base que se ejecuta en el host). Compose
no crea una base PostgreSQL local: conecta la API a la base Kactus existente.
El directorio `logs` del proyecto se monta en el contenedor para conservar los
archivos. Inicie con `docker compose up --build`.

En producción, use HTTPS, limite la frecuencia de intentos de login en el
proxy/API gateway y use una cuenta de base de datos con permisos mínimos:
`SELECT` sobre `"DW_SUMA"."DimEmpleados"` y
`"DW_SUMA"."FactNovedadesSico"`, `USAGE` en `"DW_CONFIG"` y
`SELECT`/`INSERT` sobre `"DW_CONFIG".usuarios_app`, y los permisos sobre las
tablas Expo indicados arriba. La cuenta que aplica las migraciones debe estar
separada y tener el permiso DDL requerido.
El código de acceso se devuelve en el perfil de operadores porque así lo
requiere el contrato; la aplicación móvil no debe persistirlo ni escribirlo
en logs.

### Consulta de novedades

`POST /api/v1/novedades/consultar` requiere un token Bearer de un operador y
recibe su código en el cuerpo (no en la URL, ya que el código también
se usa como contraseña):

```json
{
  "codigo_operador": "809772"
}
```

El código debe corresponder al usuario identificado por el token. La respuesta
incluye las novedades y su cantidad para que el frontend pueda mostrar el
contador sin recalcularlo:

```json
{
  "total": 1,
  "novedades": [
    {
      "IdNovedad": 123,
      "FechaNovedad": "2026-10-19T08:30:00",
      "Codigo": 809772,
      "TipoNovedad": "OPERATIVA",
      "Grupo": "OPERACIÓN",
      "Subgrupo": "VEHÍCULO",
      "Novedad": "EJEMPLO",
      "Descripcion": "Descripción de ejemplo",
      "Estado": "PROCESO"
    }
  ]
}
```

Se filtra por `"DW_SUMA"."FactNovedadesSico"."Codigo"` y se incluyen filas
cuyo estado sea nulo, `PEOCESO` o `PROCESO`, según la consulta acordada. Si
no hay novedades, `total` es `0` y `novedades` es una lista vacía.

### Tareas asignadas y evidencias

Las tareas las crea y asigna personal con rol administrativo/de operaciones.
Antes de habilitar esta función, aplique `sql/004_create_tareas_operador.sql`
y `sql/005_task_assignment_roles.sql`. La tabla queda en
`"DW_OPERACIONAL".tareas_operador` y filtra `operador_id` por el código
numérico (`Codigo`) del operador autenticado. El token del cliente no permite
elegir otro operador.

Endpoints autenticados:

- `GET /api/v1/tareas/asignacion/operadores?buscar=...`: busca operadores
  activos por código o identificación (roles 1 y 2).
- `GET /api/v1/tareas/asignacion/operadores/{codigo}/novedades`: lista sus
  novedades abiertas.
- `GET /api/v1/tareas/asignacion/novedades/{id}`: busca una novedad abierta y
  devuelve también el operador al que pertenece.
- `GET /api/v1/tareas/asignacion/tipos`: lista los tipos activos.
- `POST /api/v1/tareas/asignacion`: crea la tarea para un operador y una o
  varias novedades abiertas.
- `GET /api/v1/tareas`: lista las tareas asignadas al operador autenticado.
- `GET /api/v1/tareas/resumen/activas`: cuenta las tareas del operador cuyo estado
  no sea `CERRADA` ni `CERRADO`; se usa en el mensaje de bienvenida.
- `GET /api/v1/tareas/{id}`: devuelve detalle y metadatos de evidencias.
- `GET /api/v1/tareas/{id}/evidencias/{nombre}`: entrega un archivo solo si
  pertenece a una tarea del operador autenticado.
- `POST /api/v1/tareas/{id}/evidencias`: recibe archivos multipart en el campo
  `files` y fechas opcionales en los campos `captured_at` correspondientes. Acepta
  JPG, PNG, WebP, HEIC, MP4 y MOV; máximo 12 fotos y 2 videos por tarea, con 100 MB
  combinados por solicitud. Valida extensión, tipo declarado, firma y duración.
- `PATCH /api/v1/tareas/{id}/estado`: permite pasar a `EN_PROCESO` o
  `COMPLETADA`. Subir evidencia cambia automáticamente una tarea
  `PENDIENTE` a `EN_PROCESO`; completarla exige al menos una evidencia y no
  permite reabrirla.

Las evidencias se guardan en archivos, nunca en PostgreSQL. Configure
`EVIDENCIAS_PATH` con la raíz accesible por la cuenta del servidor; la API crea
`EvidenciasAppMovil/{identificacion_operador}/Tarea-{id}-Novedad.{ids}/` y escribe nombres únicos
seguros. Si hay varias novedades, sus números se separan con puntos, por ejemplo
`Tarea-3-Novedad.543424.543425`. Las evidencias anteriores siguen disponibles en
su carpeta original. En ejecución directa sobre Windows, el valor de `.env` puede ser
`EVIDENCIAS_PATH=\\172.20.10.32\web`. La cuenta del proceso necesita permisos
de lectura/escritura sobre el recurso compartido.

El servidor incrusta la fecha y hora en el contenido antes de guardar: procesa
fotografías con Pillow (incluyendo HEIC/HEIF mediante pillow-heif) y videos con
FFmpeg. Las fotos se normalizan a JPEG y los videos a MP4; los originales no se
conservan. Docker instala FFmpeg y la fuente DejaVu. En ejecución directa fuera
de Docker también deben instalarse FFmpeg con el filtro `drawtext`, fuentes
DejaVu y las dependencias Python de `requirements.txt`. Las capturas hechas en
la app mandan la hora del dispositivo; para galería se usa EXIF si está presente,
para archivos la última modificación si está disponible, y como último recurso
la hora de recepción del servidor (zona `America/Bogota`). La hora queda visible
en la evidencia descargada o compartida.

Expo solicita un máximo de 120 segundos a la cámara nativa. El comportamiento de
auto-detención depende de la cámara del sistema; por ello el cliente y el backend
también rechazan cualquier archivo que supere dos minutos.

Docker corre Linux y no puede usar directamente una ruta UNC de Windows. Monte
el recurso SMB en el host/container y configure, por ejemplo,
`EVIDENCIAS_HOST_PATH=/ruta/montada/en/el/host` y
`EVIDENCIAS_CONTAINER_PATH=/mnt/evidencias`; Compose monta esa raíz en la API.
`EVIDENCIAS_HOST_PATH` es la ruta del host para el bind mount y tiene prioridad;
si no se define, Compose usa `EVIDENCIAS_PATH` como ruta de origen del montaje.
La ruta del host debe ser accesible por Docker. En Windows, comparta/mapee el
recurso SMB para Docker Desktop o ejecute la API directamente con una cuenta que
tenga permiso de escritura en `\\172.20.10.32\web`.
La ruta dentro del contenedor debe existir y tener permisos para el usuario
del proceso.

La migración de tareas agrega `rol_id` a `"DW_CONFIG".usuarios_app`: `1`
corresponde a administración y `2` a operaciones. El valor queda nulo al
registrar una cuenta y debe ser asignado por un administrador de base de datos.
La API vuelve a consultar el rol en cada operación de asignación; el ocultamiento
del menú en el cliente no es el control de acceso.

Ejemplo para habilitar una cuenta administrativa en operaciones:

```sql
UPDATE "DW_CONFIG".usuarios_app
SET rol_id = 2
WHERE tipo_documento = 'CC'
  AND identificacion = '<identificacion>';
```

`sql/005_task_assignment_roles.sql` crea `"DW_CONFIG".tipos_tareas` y carga
Capacitación, Actividad recreativa y Exposición. La tabla de tareas usa su
`id` identity como consecutivo y `novedades_ids` JSONB para relacionar una o
varias novedades. El outbox Expo existente también recibe los avisos de tareas.
La cuenta runtime requiere `USAGE` en `"DW_OPERACIONAL"` y
`SELECT`/`INSERT`/`UPDATE` en `"DW_OPERACIONAL".tareas_operador`; además,
`USAGE`/`SELECT` en la secuencia
`"DW_OPERACIONAL".tareas_operador_id_seq`,
`SELECT` en `"DW_CONFIG".tipos_tareas`, `SELECT`/`UPDATE` en
`"DW_CONFIG".usuarios_app` y `SELECT`/`INSERT`/`UPDATE` en las tablas Expo
afectadas. Mantenga los permisos DDL en la cuenta DBA separada. La aplicación
no aplica migraciones al iniciar.

La pantalla **Asignación de tareas** está disponible para cuentas con `rol_id`
1 o 2. Permite buscar operadores por código/identificación o una novedad por
ID, asociar una o varias novedades abiertas, elegir el tipo de tarea y crearla
en estado `PENDIENTE`. Si el operador tiene tokens Expo activos, el envío se
encola en `expo_push_outbox`; el proceso worker del perfil `push` debe estar
ejecutándose para entregarlo. Los datos de la notificación abren la sección
Tareas de la app.
Cuando el operador completa una tarea, el aviso se envía al usuario creador
con rol `1` o `2` y solicita revisar las evidencias y cerrar en SICO las
novedades relacionadas. Al cerrar la tarea, el aviso se envía al operador.

### Registro de dispositivos y notificaciones Expo

El cliente obtiene el token mediante `expo-notifications` y usa los endpoints
autenticados siguientes. La identidad se extrae del JWT; no se acepta una
identificación ni código de operador del cliente para asociar el dispositivo.
Solo los operadores activos con código numérico positivo pueden registrar
tokens. También pueden registrar dispositivos los usuarios activos con rol
administrativo `1` o `2`, para recibir avisos de las tareas que asignaron.

Registrar/actualizar el token del dispositivo:

```http
POST /api/v1/novedades/push-tokens
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "expo_push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "plataforma": "ios"
}
```

Respuesta `200`: `{"registrado": true}`. `plataforma` acepta `ios` o
`android`. El servidor valida el formato Expo, guarda el token cifrado con
Fernet y usa un hash SHA-256 para buscarlo/deduplicarlo; no escribe el token
en logs.

Al cerrar sesión, desactivar el token:

```http
DELETE /api/v1/novedades/push-tokens
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "expo_push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

Respuesta `200`: `{"desactivado": true}` si pertenecía a esa identidad y se
desactivó; `false` si no estaba activo. Las entregas pendientes de ese
dispositivo se cancelan.

Configure en API y worker:

- `EXPO_PUSH_TOKEN_ENCRYPTION_KEY`: clave Fernet generada con
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
  Guárdela como secreto, no en el repositorio. Cambiarla requiere que los
  dispositivos vuelvan a registrar sus tokens.
- `EXPO_ACCESS_TOKEN`: opcional; agréguelo si el proyecto Expo exige
  autenticación de servidor a Expo.
- `EXPO_POLL_INTERVAL_SECONDS`: intervalo del worker; predeterminado `5`.
- `EXPO_POLL_BATCH_SIZE`: máximo de entregas por ciclo, de `1` a `100`;
  predeterminado `100`.

En Docker Compose, iniciar el proceso durable independiente de la API con
`docker compose --profile push up --build`. Para otros despliegues, ejecutar
`python -m app.worker` como proceso worker supervisado. Puede haber varias
instancias: un advisory lock transaccional de PostgreSQL serializa la detección
y `FOR UPDATE SKIP LOCKED` más leases reclaman el outbox entre workers. El
estado de inicialización, las novedades vistas y cada entrega/reintento quedan
persistidos en `"DW_CONFIG"`; no se usa `BackgroundTasks` ni una tarea dentro
de cada proceso API.

El primer sondeo crea un snapshot de las novedades que ya estaban abiertas y
las marca históricas sin enviar push. Los sondeos posteriores detectan nuevas
filas abiertas, crean una entrega por novedad/dispositivo y reintentan fallos
transitorios con espera exponencial. El worker consulta los receipts de Expo y
desactiva tokens cuando Expo responde `DeviceNotRegistered`; consulta los
receipts a partir de los 15 minutos y deja la entrega como fallida tras 10
reintentos del receipt.

La tabla SUMA consultada no expone aquí un evento/CDC ni una marca de inserción
o actualización. El mecanismo escanea las novedades abiertas cada intervalo:
recupera tras reinicios las que sigan abiertas, pero una novedad que se abra y
cierre entre dos sondeos puede no notificarse. El primer sondeo también define
el límite histórico; cualquier fila abierta antes de ese snapshot se silencia.
Además, Expo no ofrece una clave de idempotencia para el envío: si Expo acepta
un push y el proceso cae antes de persistir el resultado, el reintento puede
duplicarlo (entrega al menos una vez). Para garantizar cada transición y
eliminar esa ventana de duplicación se necesitaría un evento/outbox en el
sistema que escribe SUMA y soporte de idempotencia del proveedor. El escaneo
periódico completo debe revisarse con DBA contra el volumen e índices de la
tabla Fact.

`GET /health` verifica que la API responde; `GET /health/database` verifica
que la conexión configurada puede ejecutar `SELECT 1`. Este último devuelve
`200` cuando la conexión funciona y `503` si no está configurada o no se puede
conectar. `GET /docs` publica OpenAPI.

## Pruebas

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests
```
