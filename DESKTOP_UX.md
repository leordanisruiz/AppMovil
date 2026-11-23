# Experiencia web de escritorio

## Estado actual y objetivo

La interfaz original concentra la navegación, el inicio y las tareas en un flujo vertical pensado para móvil. En un monitor amplio ese flujo deja demasiado espacio sin uso y obliga a navegar con el menú hamburguesa y tarjetas apiladas. La app ahora mantiene ese flujo en móvil y presenta un portal separado cuando se abre en escritorio.

## Reglas responsive

- Móvil: menos de 768 px. Conserva el menú y las tarjetas existentes.
- Tablet: de 768 a 1199 px. Mantiene el contenido adaptable al ancho disponible.
- Escritorio: desde 1200 px. Usa sidebar persistente, header superior y área principal desplazable.

Las dimensiones se leen con `useWindowDimensions`, así que el layout responde a redimensionar la ventana y no solo a la carga inicial.

## Cambios implementados

- `src/constants/responsive.ts`: breakpoints compartidos.
- `src/components/ResponsiveLayouts.tsx`: layouts móvil, tablet y escritorio; el escritorio agrega navegación lateral fija, cabecera contextual y perfil/sesión.
- `src/components/ResponsiveLayouts.tsx`: sidebar oscuro con el logo corporativo rojo, contraíble por completo desde la cabecera; se elimina la etiqueta redundante “Operación”.
- `src/screens/HomeScreen.tsx`: dashboard de escritorio con métricas de tareas pendientes, en proceso, completadas, cerradas, novedades activas y evidencias. Cada métrica de estado abre la tabla ya filtrada. La pantalla móvil conserva el resumen previo.
- `src/components/DesktopTasksTable.tsx`: tabla compartida con búsqueda, filtro lateral por estado y orden por fecha para operadores y roles administradores. En móvil continúa la lista de tarjetas.
- `src/components/EvidenceLibrarySection.tsx`: galería de todas las evidencias visibles para el perfil, indicando la tarea y su descripción.
- `src/components/TasksSection.tsx`: escritorio admite arrastrar archivos a evidencias.
- `src/components/EvidenceGallery.tsx`: cuadrícula más densa y visor amplio con el detalle y las acciones en un panel lateral para web de escritorio. Las miniaturas se siguen usando en la galería global.
- `src/services/tareasService.ts`: la subida web envía `Blob`/`File` en `FormData` y deja que el navegador establezca el boundary multipart; React Native conserva su formato nativo.

## Beneficio esperado

La navegación principal siempre queda visible en escritorio, las tareas se pueden localizar y comparar en una tabla, y las evidencias se pueden inspeccionar sin perder el contexto del detalle. La rama móvil usa los componentes y flujos visuales actuales; los cambios a selección de archivos se ejecutan solo para web.

## Verificación realizada

- `npx tsc --noEmit`
- `npx expo lint`
- `npx expo export --platform web`

La exportación web se completó correctamente. Conviene revisar el portal con cuentas de operador y administrador para confirmar que las métricas coinciden con los permisos y datos que expone el backend en cada perfil.
