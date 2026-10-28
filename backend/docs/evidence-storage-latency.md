# Latencia del almacenamiento de evidencias

## Diagnóstico de la arquitectura actual

El backend ve las evidencias a través de `/mnt/evidencias_appmovil`, un montaje
FUSE/SSHFS que reenvía operaciones al servidor remoto. Por ello, una lectura
puede sumar latencia de red, SSH/SFTP, FUSE y disco remoto. El montaje puede ser
un cuello de botella, pero el tiempo real depende de su red, opciones de SSHFS,
carga del servidor remoto, tamaño y estado de caché del archivo.

Hallazgos en el código:

| Camino | Lectura sobre SSHFS | Comportamiento actual |
| --- | --- | --- |
| Resolver evidencia | Metadatos del archivo | `get_evidence_path` comprueba la existencia de la ruta guardada y, como respaldo, las rutas organizadas y antiguas. |
| Primera miniatura | Sí, archivo original | La API abre y decodifica la imagen, reduce a 480 × 480 y guarda un JPEG. |
| Miniaturas posteriores | No para el contenido, si hay cache hit | Los bytes de la miniatura se sirven desde `/tmp/appmovil-evidence-thumbnails` dentro del contenedor. La resolución/validación de ruta y el fingerprint todavía consultan metadatos SSHFS. |
| Abrir imagen completa | Sí, en cada lectura de origen | `FileResponse` entrega el archivo original; el caché temporal del backend no sirve este camino. |
| Reproducir video | Sí, por rangos | La respuesta admite `206 Partial Content`; cada solicitud de rango puede leer el montaje. |

La caché de miniaturas ya existente evita la mayoría de lecturas repetidas para
la cuadrícula mientras sobreviva el contenedor. Está en `/tmp`, no en un volumen
persistente: se pierde cuando se reemplaza/recrea el contenedor. Además, una
miniatura fría requiere leer y decodificar el original remoto. El visor de imagen
completa y la reproducción de video siguen leyendo el SSHFS. La app web crea
URLs Blob para mostrar imágenes, por lo que el objeto Blob no es una caché local
persistente entre aperturas.

## Medición

No pude medir el servidor desde este equipo: el montaje SMB no está accesible,
WSL está bloqueado y `Suma-Asistencia-wiki-Lnx` no resuelve desde la estación de
trabajo. El operador ejecutó el benchmark en el servidor y compartió los
resultados siguientes (28/10/2026). No se deben interpretar como lecturas
frías garantizadas: el estado de caché de SSHFS/kernel no se vació ni se midió.

El script `scripts/benchmark_evidence_storage.py` mide los mismos archivos en
el servidor Linux. Para cada imagen y video registra:

- primera lectura observada por SSHFS y latencia al primer bloque;
- latencia de `stat` inicial y mediana/p95 de `stat` repetido en ambos caminos;
- mediana y p95 de siete lecturas secuenciales repetidas por SSHFS;
- mediana, p95 y latencia al primer bloque de una copia en disco local;
- rendimiento MiB/s y relación de velocidad de las lecturas repetidas;
- duración de la copia, que incluye lectura SSHFS más escritura local.

La primera lectura tiene estado de caché desconocido; no se vacía la caché del
kernel porque eso afecta a todo el servidor y requiere privilegios. Las lecturas
repetidas representan el caso caliente. `findmnt -T /var/tmp` identificó
`/dev/sda1 ext4`, pero la copia local recién escrita probablemente seguía en la
page cache del kernel. Por tanto, la relación de velocidad compara SSHFS
caliente con una copia local caliente y no con una lectura física fría del SSD.
Con siete muestras, el p95 de rango más cercano corresponde al máximo de la
muestra; se debe repetir con más archivos y rondas antes de tratarlo como un p95
estable de producción.

Antes de ejecutar, confirme que la primera ruta es FUSE/SSHFS y la segunda es
local:

```sh
findmnt -T /mnt/evidencias_appmovil
findmnt -T /var/tmp
```

Ejecute dentro del servidor Linux, desde el checkout desplegado:

```sh
cd ~/proyecto-data_asistencia/web/AppMovil/backend
python3 scripts/benchmark_evidence_storage.py --local-dir /var/tmp \
  /mnt/evidencias_appmovil/79767413/Tarea-15-Novedad.523477/24ea08ef_af58b25d-a426-4bfe-981c-f1f674c878ea.jpeg.jpg \
  /mnt/evidencias_appmovil/79767413/Tarea-15-Novedad.523477/1e66b8bc_6121B593-AF64-4156-8286-E9D53E504D10.mp4
```

Si esos nombres ya no están disponibles, sustituya las rutas por archivos
actuales representativos. El script solo lee los archivos fuente y elimina sus
copias temporales al terminar. Guarde su JSON junto con la revisión del backend,
fecha, salida de `findmnt` y estado de carga del servidor.

| Archivo | Tamaño | SSHFS: primera lectura | SSHFS: caliente mediana / p95 | Local: caliente mediana / p95 | Aceleración caliente | SSHFS caliente |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JPG `24ea08ef…jpg` | 1,343,793 B | 345.73 ms | 117.59 / 155.58 ms | 0.78 / 1.15 ms | 150.76× | 10.90 MiB/s |
| MP4 `1e66b8bc…mp4` | 1,758,347 B | 162.33 ms | 132.46 / 356.14 ms | 1.17 / 1.60 ms | 113.21× | 12.66 MiB/s |

Latencias de primer byte observadas: JPG 10.32 ms en la primera lectura, 7.73
ms mediana caliente en SSHFS y 0.02 ms local; MP4 10.17 ms primera lectura,
8.12 ms mediana SSHFS caliente y 0.03 ms local. `stat` inicial SSHFS dio 0.01
ms; en SSHFS caliente mediana/p95 fue 0.01/0.10 ms para el JPG y 0.01/0.16 ms
para el MP4. El `stat` local caliente fue 0.01/0.01 ms para ambos. Los tiempos
SSHFS tan bajos probablemente reflejan caché de atributos y no un viaje SFTP
independiente por cada llamada.

La copia SSHFS→local tardó 106.76 ms para el JPG y 116.71 ms para el MP4; esas
cifras incluyen lectura y escritura local y ocurrieron después de la primera
lectura, por lo que no representan una lectura remota fría.

El `findmnt` compartido muestra dos entradas idénticas para
`/mnt/evidencias_appmovil`. Esto merece revisión en el host y en el namespace
del contenedor: puede ser un montaje duplicado/apilado, pero este resultado por
sí solo no demuestra impacto de rendimiento. No desmontar ninguna entrada sin
confirmar qué proceso y servicio la utilizan.

### Impacto medido sobre la visualización

Para estos archivos, leer el original por SSHFS costó alrededor de 0.12–0.35 s
en las muestras observadas; la variabilidad del MP4 llegó a 0.36 s en siete
lecturas. Una copia local caliente leyó ambos en alrededor de 1 ms. Esto
confirma que SSHFS añade latencia material a las lecturas, aunque estos archivos
pequeños por sí solos no explican una espera infinita o una pantalla negra: ese
comportamiento requiere además revisar errores HTTP/CORS, transferencia hacia
el dispositivo, decodificación y eventos de carga de la UI. Los tiempos no
incluyen consulta PostgreSQL, generación de miniatura, transferencia móvil ni
renderizado. Tampoco permiten extrapolar linealmente a seis imágenes
concurrentes.

## Impacto y estrategia recomendada

1. **Persistir miniaturas fuera del SSHFS.** Configurar una ruta local del
   servidor, por ejemplo `/var/cache/appmovil/evidence-thumbnails`, y montarla
   en el contenedor. Mantener claves basadas en ruta, tamaño y `mtime_ns` para
   invalidar una miniatura cuando cambie el original. Esto elimina la pérdida de
   caché al recrear `api`; no sustituye la primera lectura.
2. **Generar miniatura durante la subida.** Crear el JPEG reducido desde el
   temporal local de la subida y guardarlo en la caché local, sin volver a abrir
   el original SSHFS. Para evidencias antiguas, conservar la generación lazy
   actual y almacenar el resultado persistentemente.
3. **Usar caché read-through local para originales calientes.** Tras autorizar
   la tarea y resolver la evidencia, copiar a un directorio local con clave de
   ruta/tamaño/mtime y reemplazo atómico. Aplicar un límite de espacio y
   expiración LRU; nunca escribir credenciales en URL ni exponer el directorio
   por HTTP estático. Esto reduce la latencia de apertura repetida de imágenes.
4. **Videos: mantener lectura por rangos y cachear solo si las medidas lo
   justifican.** Un caché de archivo completo puede consumir mucho disco y hacer
   lenta la primera reproducción. Si el SSHFS tiene latencia alta, evaluar un
   caché local acotado por tamaño o almacenamiento de objetos con soporte de
   Range.
5. **Medir cada tramo en producción.** Registrar por solicitud duración de
   consulta de tarea, resolución de ruta/stat SSHFS, generación/lectura de
   caché y transferencia. Separar cache hit/miss y tamaño de respuesta. Esto
   permite saber si el mayor retraso está en PostgreSQL, SSHFS, decodificación
   o red hacia el dispositivo.

La comparación observada da una mejora de 113–151× para lecturas repetidas
desde caché local caliente frente a SSHFS caliente en estos dos archivos. No es
una promesa de mejora de tiempo de pantalla: hay otros tramos y el estado de
caché de disco no se controló. Persistir las miniaturas en disco local evitaría
leer sus bytes desde SSHFS en los cache hits; generar miniaturas al subir puede
evitar también la lectura remota de contenido en el primer llenado. Seguirían
las consultas de metadatos necesarias para autorizar y validar la ruta.

## Cambios implementados

La arquitectura descrita arriba ya está conectada al backend y la app:

- `app/services/evidence_cache.py` mantiene miniaturas en
  `/var/cache/appmovil/evidence-thumbnails` y media en
  `/var/cache/appmovil/evidence-media`. Compose monta el volumen persistente
  `evidence-cache:/var/cache/appmovil` en el servicio `api`.
- Las claves combinan ruta canónica, tamaño y `mtime_ns`; el llenado es atómico
  y los archivos menos usados se eliminan cuando la caché llega al límite.
- El límite de miniaturas es 512 MiB; originales y videos comparten 2 GiB. Solo
  se cachean completos videos de hasta 16 MiB. Se puede configurar con
  `EVIDENCE_THUMBNAIL_CACHE_MAX_BYTES`, `EVIDENCE_MEDIA_CACHE_MAX_BYTES` y
  `EVIDENCE_VIDEO_CACHE_MAX_FILE_BYTES`.
- `upload_evidence()` prepara el temporal de subida en disco local y crea la
  miniatura desde la imagen marcada que ya está decodificada. Evidencias
  antiguas se miniaturizan una vez bajo demanda y luego la miniatura persiste.
- Las rutas autenticadas de miniatura, vista y descarga usan caché. Videos
  pequeños se copian completos antes de servir; los mayores permanecen en SSHFS.
  `FileResponse` conserva Range para ambos caminos.
- Cada respuesta emite `Evidence response metrics` con hit/miss/bypass, fuente,
  bytes, lectura SSHFS/local, escritura, preparación y duración total.
  `local_stream_ms` y `sshfs_stream_ms` incluyen la transferencia al cliente; no
  son tiempos puros de disco. `file_bytes` es el tamaño del archivo, también en
  una respuesta parcial Range.
- `EvidenceGallery.tsx` usa `expo-image` con caché `memory-disk`, autorización,
  precarga inicial, skeleton y carga progresiva. La cuadrícula solo solicita
  miniaturas; el original se solicita al abrir el visor. Se mantienen zoom,
  doble toque, swipe, descarga y compartir.

Para desplegar y crear o adjuntar el volumen persistente:

```sh
cd backend
docker compose up -d --build --force-recreate api
docker compose logs --tail=100 api
```

`docker compose down` conserva el volumen. Evitar `docker compose down -v` si se
quiere preservar la caché. El volumen solo se monta en `api`; `push-worker` no
sirve evidencias.

En las muestras aportadas, la copia local caliente superó a SSHFS entre 113× y
151×. La miniatura nueva evita la lectura SSHFS en el primer listado; para
archivos antiguos la primera generación aún lee el original una vez. La
autorización y resolución siguen consultando metadatos del origen.
