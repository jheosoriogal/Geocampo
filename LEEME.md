# GeoCampo 0.2: app Android (APK)

Este es el mismo GeoCampo de la versión web, ahora empaquetado como app Android con Capacitor. Lo nuevo:

- **El GPS sigue grabando con la pantalla apagada.** Al iniciar un track o un polígono con GPS aparece la notificación "GeoCampo está grabando", y mientras esté visible puedes guardar el celular.
- **Exportar → Descargar** guarda el archivo en **Documentos/GeoCampo**. **Compartir** lo envía por WhatsApp, correo o Drive, en cualquier formato (KML, KMZ, GPX…).
- El botón **Atrás** de Android cierra ventanas y no la app.
- La carpeta `docs/` sigue siendo la versión web, que se puede publicar en GitHub Pages.

## Cómo se obtiene el APK

GitHub compila el APK gratis en la nube cada vez que subes cambios (`.github/workflows/compilar-apk.yml`).

1. Crea en github.com un repositorio **público** llamado `geocampo`, vacío.
2. Sube **todo el contenido** de esta carpeta. GitHub solo acepta 100 archivos por carga; este proyecto tiene unos 75.
   - La carpeta `.github` empieza con punto y a veces el navegador no la sube. Si después de subir no la ves en el repositorio, créala a mano: **Add file → Create new file**, nombre `.github/workflows/compilar-apk.yml`, y pega el contenido de ese archivo.
3. Entra a la pestaña **Actions**. Verás "Compilar APK" en ejecución (tarda unos 5 a 8 minutos). Cuando quede en verde ✔:
4. Desde el celular abre `https://github.com/TU-USUARIO/geocampo/releases/latest`, toca **GeoCampo.apk** e instálalo. Android pedirá permitir "instalar apps de origen desconocido" para Chrome o para Archivos.
5. Cada vez que subas un cambio se genera un APK nuevo, y se instala encima del anterior **sin perder los datos**.

## Primer uso en el celular
- Acepta **Ubicación → Mientras se usa la app** y **Notificaciones**.
- En celulares con ahorro de batería agresivo (Xiaomi, Huawei, Samsung…): Ajustes ▸ Apps ▸ GeoCampo ▸ Batería ▸ **Sin restricciones**. Si no, el sistema puede cortar la grabación en segundo plano.

## Notas técnicas
- Capacitor 7 con estos plugins: background-geolocation 1.3, filesystem, share, app y local-notifications.
- El APK se firma con `android/app/geocampo.keystore` (clave `geocampo123`). Sirve para uso interno. Si algún día se publica en Play Store, hay que generar una clave privada nueva y no subirla al repositorio.
- Si cambias la app web, edita `docs/index.html`. El APK toma esa misma carpeta.
