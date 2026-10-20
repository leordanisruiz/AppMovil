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

### Registro administrativo

- `POST /api/v1/auth/validate-registration`: recibe `tipo_documento` e
  `identificacion`, verifica que la persona exista y esté activa en SUMA, y
  determina si tiene `Codigo` asignado en Kactus. Si tiene código, es operador
  y no puede registrar contraseña administrativa.
- `POST /api/v1/auth/register-password`: vuelve a consultar SUMA antes de
  aceptar el alta. Acepta `tipo_documento`, `identificacion` y una contraseña
  de exactamente ocho dígitos ASCII. Rechaza operadores y cuentas ya creadas.
- El alta guarda un hash bcrypt (nunca la contraseña en claro) y la fecha de
  creación en `"DW_CONFIG".usuarios_app`. El login administrativo valida ese hash.
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
   `sql/003_create_expo_push_notifications.sql`. Ejecutar los scripts con el
   proceso de despliegue/DBA; la API no aplica DDL al iniciar.
5. Configurar `DATABASE_URL` para la instancia PostgreSQL que contiene
   `"DW_SUMA"."DimEmpleados"`, `"DW_SUMA"."FactNovedadesSico"` y
   `"DW_CONFIG".usuarios_app` y las tablas Expo. La cuenta runtime debe tener
   `USAGE` en los esquemas `"DW_SUMA"` y `"DW_CONFIG"`, `SELECT` en las tablas
   SUMA, `SELECT`/`INSERT` en `"DW_CONFIG".usuarios_app` y
   `SELECT`/`INSERT`/`UPDATE` en las cuatro tablas `expo_push_*`; también
   requiere `USAGE`/`SELECT` en la secuencia
   `"DW_CONFIG".expo_push_outbox_id_seq`. La creación inicial requiere permisos
   DDL para DBA. Codifique los caracteres reservados de la URL.
6. Configurar `JWT_SECRET_KEY` con al menos 32 bytes aleatorios; por ejemplo:
   `python -c "import secrets; print(secrets.token_urlsafe(64))"`.
7. Iniciar localmente: `uvicorn app.main:app --reload`.
8. Para solicitudes desde el navegador, configure `CORS_ORIGINS` como una
   lista separada por comas de los orígenes exactos autorizados. El valor local
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
      "Descripcion": "Descripción de ejemplo",
      "Estado": "PROCESO"
    }
  ]
}
```

Se filtra por `"DW_SUMA"."FactNovedadesSico"."Codigo"` y se incluyen filas
cuyo estado sea nulo, `PEOCESO` o `PROCESO`, según la consulta acordada. Si
no hay novedades, `total` es `0` y `novedades` es una lista vacía.

### Registro de dispositivos y notificaciones Expo

El cliente obtiene el token mediante `expo-notifications` y usa los endpoints
autenticados siguientes. La identidad se extrae del JWT; no se acepta una
identificación ni código de operador del cliente para asociar el dispositivo.
Solo los operadores activos con código numérico positivo pueden registrar
tokens. Los perfiles administrativos reciben `403`.

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
- `EXPO_POLL_INTERVAL_SECONDS`: intervalo del worker; predeterminado `60`.
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
