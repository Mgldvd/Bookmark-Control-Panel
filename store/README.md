# Publicación en Mozilla Add-ons

Material de la versión 1.17.0 para Firefox de escritorio, desde Firefox 142.

- `listing.json`: nombre, descripción, resumen, categoría y enlaces en español e inglés.
- `privacy-en.md` y `privacy-es.md`: políticas de privacidad; `privacy.json` es el contenido para AMO.
- `reviewer-notes.txt`: instrucciones de revisión, permisos y reproducción del paquete.
- `release-notes.json`: novedades bilingües.
- `previews.json`: orden y leyendas bilingües de las once capturas.
- `media/`: capturas PNG de 1280×800, icono PNG de 128×128 y presentación MP4 de 15 segundos.

Las capturas muestran la interfaz real, con una API simulada que contiene 67 marcadores ficticios y dominios
reservados `.example`. No utilizan el perfil ni los marcadores del usuario. El fixture es exclusivo de desarrollo
y no se incluye en el paquete de la extensión. El video es una presentación silenciosa en español, H.264,
1280×800, 30 fps. AMO no proporciona un campo para subir MP4 a la galería de capturas; el video se distribuye aparte.

La ficha conserva el GUID existente y utiliza All Rights Reserved porque el repositorio no tenía una licencia
de código abierto. La extensión no necesita cuentas ni pagos; la función opcional de Unsplash requiere una clave
gratuita del propio usuario.

## Reproducción

```sh
npm ci
npm run check
./package.sh
node scripts/create-demo.mjs
python3 scripts/media_server.py
```

El servidor de demostración solo sirve los archivos permitidos de la interfaz y el fixture: nunca `.env`, `.git`
ni el resto del repositorio. Las escenas se seleccionan con `http://localhost:8765/demo?scene=board`; también hay
`grid`, `list`, `strip`, `masonry`, `minimal`, `groups`, `light`, `spanish` y `settings`.
Para la búsqueda, escribe `design` en el buscador. Espera a que finalicen las animaciones antes de capturar.
En la escena `settings`, abre Ajustes. Las capturas originales no llevan texto promocional sobrepuesto.

`python3 scripts/create-video.py` recompone el video a partir de las capturas, con Pillow y FFmpeg.
`inkscape icons/icon.svg --export-type=png --export-filename=store/media/icon-128.png --export-width=128 --export-height=128`
exporta el icono existente para la ficha.

## Envío

Las credenciales de AMO se leen del entorno o del `.env` ignorado, sin ejecutarlo. Nunca forman parte del ZIP.
`scripts/amo_api.py` utiliza la biblioteca estándar de Python 3 y JWT de corta duración.

1. Valida y sube el ZIP al canal `listed` mediante `addons/upload/`.
2. Guarda la respuesta en `store/upload-result.json` y verifica `processed` y `valid`.
3. Ejecuta `python3 scripts/publish_amo.py prepare` para preparar ficha, privacidad, icono y capturas.
4. Ejecuta `python3 scripts/publish_amo.py submit` para enviar la versión pública.
   `continue` comprueba primero si ya fue enviada y después completa las imágenes que faltan, sin duplicarlas.
   `prepare-images` permite subir las capturas con una sola escritura por imagen; las leyendas traducidas son opcionales.
5. Consulta `python3 scripts/publish_amo.py status` para comprobar el resultado.

La acción `submit` crea una versión nueva y no debe repetirse si ya se envió. Las publicaciones posteriores
deben aumentar la versión del manifiesto. El estado de revisión y la firma dependen de Mozilla.
Los archivos locales `upload-result.json` y `publication-result.json` guardan recibos y progreso, no credenciales.

El código del ZIP es legible y no se compila ni minimiza. El paquete reproducible contiene diez archivos
originales de ejecución, con tiempos y permisos normalizados; no contiene herramientas, datos de demostración,
capturas, video ni dependencias de desarrollo. Para recrearlo solo se necesitan un shell POSIX y Python 3.

AMO limita las escrituras a 3 por minuto, 10 por hora y 24 por día. Ante un HTTP 429 el script sale con
código 75 y guarda `retry_at` en el recibo local. La continuación debe respetar esa fecha; no reintentes antes.
Las llamadas de lectura para comprobar el estado no modifican la ficha.
