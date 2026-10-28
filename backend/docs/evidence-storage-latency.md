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
trabajo. No se deben interpretar tiempos de otro host como si fueran medidas del
servidor de producción.

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
repetidas representan el caso caliente. La copia local recién escrita también
puede estar en la page cache del kernel. Registrar estas condiciones evita
presentar una lectura caliente como una medición fría.

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

| Archivo | Tamaño | SSHFS stat mediana / p95 | Local stat mediana / p95 | SSHFS primera lectura | SSHFS caliente mediana / p95 | Local caliente mediana / p95 | Aceleración caliente |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Imagen representativa | Pendiente de ejecutar en Linux | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| Video representativo | Pendiente de ejecutar en Linux | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

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

Esperamos que persistir las miniaturas reduzca a cero las lecturas de contenido
SSHFS de la cuadrícula después del primer llenado; seguirían las consultas de
metadatos necesarias para autorizar y validar la ruta. Generarlas en la subida
puede evitar también esa primera lectura de contenido adicional. No asigno
porcentajes de reducción de tiempo hasta obtener las mediciones de la tabla.
