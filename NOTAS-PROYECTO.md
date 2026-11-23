# GeoCampo: notas para retomar el proyecto

**Dueño:** Jhon (GitHub `jheosoriogal`). App tipo Avenza Maps para uso personal en campo (Android).

## Dos versiones en este repositorio
| | GeoCampo (original) | GeoCampo 2 |
|---|---|---|
| Rama | `main`, **no se modifica** | `geocampo2` |
| App Android | `co.geocampo.app`, nombre "GeoCampo" | `co.geocampo.app2`, nombre "GeoCampo 2" |
| Descarga | Releases → la marcada como *Latest* (v0.2.x) | Releases → *Pre-release* v2.0.x |

Las dos se instalan a la vez en el celular y sus datos están separados. Para pasar datos de una a otra: exportar en una (KML/GeoJSON) e importar en la otra.

## Arquitectura (GeoCampo 2)
- `docs/index.html` es la interfaz. El código está en `docs/js/`, en archivos de script normales que comparten variables globales y se cargan en este orden:
  - `app.js` (núcleo: mapa, GPS, captura, capas, importar y exportar)
  - `offline.js` (mapas sin conexión)
  - `photos.js` (fotos)
  - `nav.js` (ir a, coordenada, medir)
  - `edit.js` (vértices, huecos, buffer)
  - `georef.js` (PDF, GeoTIFF, world file, KMZ con imagen, shapefile)
  - `report.js` (reporte PDF)
  - `main.js` (arranque)
- Puntos de extensión del núcleo, donde los módulos se registran: `INFO_ACTIONS`, `INFO_EXTRA`, `IMPORTERS`, `EXPORTERS`, `MORE_ITEMS`, `LAYER_TOOLS`, `KML_EXTRA` e `INIT_HOOKS`. También `S.tapHook` y `S.backHook`.
- Modelo de cada elemento: `{id, layer, type: point|line|polygon, name, desc, coords: [[lat, lon, alt, t]], holes?: [ring], props?: {}, photos?: [id], acc?}`.
- IndexedDB `geocampo`, versión 2, con los almacenes `features`, `layers`, `kv`, `photos` (imagen + miniatura), `tiles` (mosaicos sin conexión, clave `base/z/x/y`) y `overlays` (mapas georreferenciados: imagen + 4 esquinas).
- Librerías en `docs/vendor/`: Leaflet, proj4, JSZip, Turf, piexif, shpjs, shp-write (compilado con esbuild desde `@mapbox/shp-write` 0.4.3 porque el bundle publicado no admite `.prj`), jsPDF, geotiff.js y pdf.js 3.11.
- Capacitor 7 con estos plugins: background-geolocation, filesystem, share, app, local-notifications y camera.
- Compilación: `.github/workflows/compilar-apk.yml` en la rama `geocampo2` publica `GeoCampo2.apk` como pre-release.

## Funciones de GeoCampo 2 (además de las de la original)
- **Mapas sin conexión:** descarga por vista o alrededor de una capa, con rango de zoom y máximo de 30.000 mosaicos. Sin internet, si falta un nivel de zoom amplía el mosaico guardado de un nivel menor.
- **Fotos:** sello visible con fecha, hora, lat/lon y E/N 9377, más EXIF GPS. Se guardan como punto o adjuntas a un elemento. Se exportan como "KMZ con fotos" o "ZIP de JPG + índice CSV".
- **Ir a un punto:** brújula, o rumbo por movimiento si no hay brújula. También ir a una coordenada (WGS84, GMS, 9377, 3116) y medición rápida.
- **Edición de geometría:** arrastrar, insertar y borrar vértices, mover un vértice a la posición GPS y simplificar. Además, recortar huecos y crear buffer (completo, anillo o retiro interno).
- **Mapas georreferenciados:** GeoPDF (ISO/OGC, incluso con object streams comprimidos), GeoTIFF (lee el EPSG o lo pregunta), JPG/PNG/TIF con world file (+ `.prj` opcional) y KMZ GroundOverlay. Se muestran con una homografía de 4 esquinas y transparencia ajustable.
- **Shapefile:** se importa desde `.zip` o desde `.shp` + `.dbf` + `.prj` seleccionados juntos. Se exporta en `.zip` en 9377 o WGS84.
- **Capas por proyecto:** capa activa ★, etiquetas, colores por atributo (escala de 5 rangos si el campo es numérico, por categoría si es texto) y mover elementos entre capas.
- **Reporte PDF:** mapa con vértices numerados, escala y norte, resumen, atributos, tabla de vértices en 9377 y registro fotográfico (incluye las fotos tomadas dentro del lote).

## Pendientes / ideas
- Play Store, aplazado. Requiere target API 36 (Capacitor 8), AAB con clave privada, aviso de ubicación y declaraciones.
- No se incluyeron (decisión de Jhon): grilla de muestreo, respaldo automático, formularios personalizados y notas de voz.

## Cómo probar
- Servir `docs/` con `python3 -m http.server` y usar Playwright + Chrome con geolocalización simulada.
- Los mosaicos del mapa base se simulan con `context.route`.
- Para generar archivos de prueba (GeoTIFF, GeoPDF con el driver PDF de GDAL, shapefile) sirven `rasterio`, `pyshp` y `pikepdf` (este último para el PDF con object streams).
