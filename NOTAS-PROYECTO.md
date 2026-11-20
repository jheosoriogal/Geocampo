# GeoCampo: notas para retomar el proyecto

**Dueño:** Jhon (GitHub `jheosoriogal`). App tipo Avenza Maps para uso personal en campo (Android).
**Descarga del APK:** https://github.com/jheosoriogal/Geocampo/releases/latest
**Estado:** versión 0.2.3 (20-nov-2026), probada en campo con un polígono pequeño. Funciona bien.

## Arquitectura
- `docs/index.html` contiene **toda la app**: HTML, CSS y JS en un solo archivo, con Leaflet, proj4 y JSZip en `docs/vendor/`.
  - La misma carpeta sirve como app web (PWA, `sw.js`) y como contenido del APK.
- Capacitor 7 (`capacitor.config.json`, webDir `docs`, `useLegacyBridge: true`). Plugins:
  - `@capacitor-community/background-geolocation` 1.3.1: GPS con servicio en primer plano para grabar con la pantalla apagada.
  - `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/app` (botón Atrás) y `@capacitor/local-notifications` (permiso de notificaciones).
- El JS detecta la APK con `CAP` (`capacitorExports.Capacitor.isNativePlatform()`) y obtiene los plugins con `registerPlugin`.
- `.github/workflows/compilar-apk.yml` hace `npm ci`, `cap sync` y `gradlew assembleRelease`, y publica el resultado en Releases.
  - El número de versión sale de `GITHUB_RUN_NUMBER`.
  - El APK se firma con `android/app/geocampo.keystore` (clave `geocampo123`), una clave fija que permite instalar cada versión encima de la anterior. Solo sirve para uso personal; **no** sirve para Play Store.
- Datos guardados en IndexedDB (`geocampo`: features, layers, kv) **solo en el celular**.

## Funciones actuales
- **Puntos:** GPS directo, GPS promediado N segundos o centro del mapa (cruz).
- **Track y polígono**, en tres modos:
  - GPS automático, con criterio de distancia, tiempo o ambos (`settings.captureBy`) y botón ⚙ en el panel de grabación.
  - Vértice a vértice con GPS.
  - Dibujando sobre el mapa.
- **Área** geodésica (proyección TM local) en ha y m², perímetro y longitud.
- **Coordenadas:** WGS84 (decimal o GMS) y MAGNA-SIRGAS Origen-Nacional / CTM12 (EPSG:9377).
- **Importar:** KML, KMZ, GPX y GeoJSON. CSV con asistente de columnas: separador `;` o `,`, coma decimal, GMS, sistemas 4326, 9377 y 3116, y polígonos agrupados por columna.
- **Exportar:** KML, KMZ, GPX, GeoJSON, CSV para QGIS y CSV para Excel en español.
  - En la APK, **Descargar** guarda en Documentos/GeoCampo y **Compartir** abre el menú de compartir de Android.
- **Capas por archivo:** color, visibilidad, zoom y suma de hectáreas. Un registro sin terminar se recupera si la app se cierra.

## Pendientes ofrecidos (Jhon no ha decidido el orden)
1. Editar vértices de polígonos ya guardados.
2. Cargar PDF o imágenes georreferenciadas (como Avenza).
3. Descargar el mapa base de una zona para usarlo sin señal.
4. Cambiar la etiqueta "CTM12" por "Origen Nacional" (opcional).
5. Play Store, aplazado. Requiere target API 36 (migrar a Capacitor 8), AAB firmado con clave privada, aviso de ubicación dentro de la app, política de privacidad, declaraciones de ubicación y de servicio en primer plano (con video) y 12 testers durante 14 días si la cuenta es personal.

## Cómo probar
Servir `docs/` con `python3 -m http.server` y probar con Playwright + Chrome, simulando la geolocalización.
Para probar la APK sin un celular se puede reemplazar `vendor/capacitor.js` por un simulacro de los plugins.
