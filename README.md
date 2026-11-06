# Firefox Bookmark Dashboard

Dashboard visual de tus marcadores **reales** de Firefox, construido como WebExtension.
Lee el árbol de marcadores directamente con `browser.bookmarks`, se **actualiza en tiempo real**
cuando agregas, renombras, mueves o eliminas marcadores (desde cualquier ventana, la Biblioteca o Sync)
y funciona **100 % en local**: sin servidor, sin dependencias, sin frameworks y sin enviar datos a terceros.

> En el manifiesto la extensión se llama **«Bookmark Dashboard»** porque Mozilla no permite la palabra
> «Firefox» en el nombre de complementos que se envían a firmar.

---

## 1. Arquitectura

```
┌────────────────────────── Firefox ──────────────────────────┐
│                                                              │
│  Places (marcadores) ──getTree()──►  dashboard.js            │
│        │                              ┌──────────────────┐   │
│        └─ onCreated / onRemoved ────► │ Modelo en memoria│   │
│           onChanged / onMoved         │  Map<id, nodo>   │   │
│                                       └────────┬─────────┘   │
│  storage.local ◄── preferencias ──────┐        │ rAF         │
│  (tema, vista, orden, última carpeta, │        ▼             │
│   carpetas expandidas, destacados)    │   Render (DOM)       │
│                                       │   · sidebar (árbol)  │
│  background.js ── botón de barra ──►  │   · tarjetas por id  │
│                   abre dashboard.html └── · diálogos/menús   │
│  chrome_url_overrides ── nueva pestaña ─► dashboard.html     │
└──────────────────────────────────────────────────────────────┘
```

- **Lectura**: al arrancar se llama una vez a `browser.bookmarks.getTree()` y se construye un
  modelo en memoria (`Map id → nodo`) que conserva la jerarquía y el orden originales.
  La inicialización **solo lee**: nunca crea, edita ni borra nada.
- **Sincronización**: los listeners `onCreated`, `onRemoved`, `onChanged` y `onMoved` aplican
  cambios *incrementales* al modelo (insertar, eliminar subárbol, renombrar, mover entre padres
  con su índice). La interfaz se repinta en el siguiente `requestAnimationFrame`, lo que agrupa
  ráfagas de eventos (por ejemplo, cuando Sync descarga cientos de marcadores).
- **Render eficiente**: las tarjetas se reconcilian **por id**: una tarjeta existente reutiliza su
  nodo DOM y solo se reconstruye su contenido si cambió su título, URL o carpeta. Así, actualizar
  un marcador no recarga la página ni los favicons. Las listas grandes se pintan en lotes de 200
  conforme haces scroll (`IntersectionObserver`).
- **Red de seguridad**: si un evento hace referencia a un nodo desconocido, o si la pestaña estuvo
  oculta más de 15 s (restaurar una copia de seguridad puede hacer cambios masivos sin eventos
  individuales), se relee el árbol en silencio. También hay un botón «Releer marcadores» en Ajustes.
- **Seguridad**: todos los títulos y URLs se insertan en el DOM con `textContent` / nodos de texto;
  no se usa `innerHTML` en ningún punto. Solo se abren URLs `http(s)`; las `place:`, `javascript:`,
  `about:` o `file:` se muestran, pero al pulsarlas se copia la URL (Firefox no permite abrirlas desde
  una extensión).
- **Destacados locales**: la marca de «destacado» se guarda en `browser.storage.local` por id de
  marcador (los GUID de Firefox son estables). No altera la estructura ni los marcadores.
- **Varias pestañas**: `storage.onChanged` mantiene coherentes varios dashboards abiertos
  (tema, destacados, vista…).

### Permisos (mínimos)

| Permiso | Para qué |
|---|---|
| `bookmarks` | Leer y modificar marcadores (las modificaciones solo ocurren por acción explícita del usuario). |
| `storage` | Guardar preferencias y destacados en local. |

`tabs.create` (abrir en pestaña nueva) no requiere permiso. No se piden permisos de host y
`data_collection_permissions` declara `none`.

### Favicons y privacidad

La API de WebExtensions no da acceso a la caché de favicons de Firefox. El dashboard pide
`https://<sitio>/favicon.ico` **directamente a cada sitio marcado** (con `no-referrer`), nunca a
servicios de terceros como Google. Mientras carga o si falla, muestra una inicial con un color
derivado del dominio. Si prefieres que el dashboard **no haga ninguna conexión de red**, desactiva
«Mostrar favicons» en Ajustes.

---

## 2. Árbol de archivos

```
bookmarks/
├── manifest.json      # Manifiesto MV3: permisos, nueva pestaña, botón, id de gecko
├── background.js      # Botón de la barra / Alt+Shift+B → abre el dashboard
├── dashboard.html     # Estructura, sprite de iconos SVG y diálogos
├── dashboard.css      # Diseño claro/oscuro (light-dark()), responsive, animaciones
├── dashboard.js       # Modelo, sincronización, render, búsqueda, CRUD, arrastrar y soltar
├── theme-init.js      # Aplica el tema antes del primer pintado (evita el destello)
├── i18n.js            # Textos de la interfaz: inglés (por defecto) y español
├── _locales/          # Textos del manifiesto (descripción, botón, atajo) en en / es
│   ├── en/messages.json
│   └── es/messages.json
├── icons/
│   └── icon.svg       # Icono de la extensión
├── package.sh         # Genera dist/bookmark-dashboard-<versión>.zip para firmar
├── sign.sh            # Firma el paquete en AMO (canal privado) y deja el .xpi en dist/
└── README.md
```

---

## 3. Funcionalidades

- Barra lateral con las carpetas reales de Firefox (Menú de marcadores, Barra de marcadores,
  Otros marcadores, Marcadores del móvil si tiene contenido), con subcarpetas expandibles y
  contraíbles y contador recursivo por carpeta.
- Vistas especiales: **Todos**, **Destacados** y **Recientes** (los 60 últimos añadidos).
- Marcadores como tarjetas (vista de cuadrícula) o filas (vista de lista), con favicon, título,
  dominio, carpeta (clicable) y fecha de creación.
- **Búsqueda global** instantánea por título, URL y ruta de carpeta. No distingue mayúsculas ni
  tildes («javascrípt» encuentra «JavaScript») y resalta las coincidencias.
- Crear marcadores y carpetas, renombrar, editar URL, mover (diálogo o **arrastrando** a cualquier
  carpeta de la barra lateral o a un bloque de carpeta) y eliminar con confirmación (en carpetas
  se indica cuánto contenido se borrará).
- Arrastrar un enlace desde cualquier página web o la barra de direcciones a una carpeta lo guarda
  como marcador allí.
- Menú contextual (clic derecho o botón `⋯`) en tarjetas y carpetas.
- **Abrir todos en pestañas**: botón «Open all» junto al selector de orden (abre todos los
  marcadores de la vista actual: carpeta, búsqueda, destacados…) y opción «Open all in tabs» en el
  menú de cada carpeta (sus marcadores directos, como hace Firefox). También con **clic central**
  sobre cualquier carpeta (barra lateral, bloque de carpeta o ruta superior). Se abren en segundo plano, en
  orden, justo después de la pestaña del dashboard. Con más de 15 pide confirmación. Los enlaces
  que Firefox no deja abrir desde extensiones (`place:`, `javascript:`…) se omiten y se avisa.
- **Separadores** de Firefox en la **vista de lista** (con «Orden original» y sin «Incluir
  subcarpetas», que es cuando tienen sentido). Se actualizan en vivo y se pueden eliminar con
  clic derecho. No se muestran separadores al principio, al final ni repetidos.
- **Vista de tablero** (tercer botón junto a cuadrícula y lista): cada carpeta es una tarjeta con
  su nombre arriba y sus enlaces debajo, con el mismo formato que los grupos. En una carpeta se ve
  una tarjeta para sus propios marcadores y otra por cada subcarpeta (con accesos a sus
  sub-subcarpetas); en «Todos», «Destacados», «Recientes» y en la búsqueda, los marcadores se
  agrupan por carpeta mostrando su ruta. Cada tarjeta enseña 10 enlaces («Mostrar más» para el
  resto), se puede contraer (se recuerda), su cabecera abre la carpeta (clic central: todo en
  pestañas) y acepta marcadores arrastrados (los mueve a esa carpeta en Firefox).
- **Ocultar la barra lateral**: el botón de panel a la izquierda del buscador oculta o muestra el
  árbol de carpetas (el de la derecha hace lo mismo con los grupos); el contenido ocupa el espacio
  libre. Se recuerda y se aplica antes del primer pintado. En móvil la barra sigue siendo un cajón.
- **Modo minimalista / página de inicio**: el botón de las cuatro esquinas (barra superior) deja
  solo el tablero de la carpeta (o vista) en la que estás, con «Volver a …» para ir a la **carpeta
  de inicio**; al salir, el dashboard se queda en la carpeta que estabas viendo. Las pestañas nuevas
  y la dirección `?home` empiezan en la carpeta de inicio. Se ocultan buscador, paneles laterales, cabecera y
  botones. Para salir, usa el botón fijo de la esquina superior derecha.
  La carpeta de inicio se elige en Ajustes → Página de inicio (también vale «Todos», «Destacados»
  o «Recientes») o con clic derecho en una carpeta → «Usar como página de inicio». Dentro del modo,
  al abrir una subcarpeta aparece «Volver a …» (o `Esc`); se conserva al recargar la pestaña, las
  pestañas nuevas empiezan en la carpeta de inicio y no cambia la carpeta del dashboard normal.
  El modo se recuerda (también en las pestañas nuevas) y se aplica antes del primer pintado.
  La dirección `moz-extension://…/dashboard.html?home` abre siempre el modo minimalista sin
  cambiar el ajuste: está en Ajustes → Página de inicio, con botón «Copiar».
- **Ajustes rediseñados**: diálogo con pestañas a la izquierda (Apariencia, General, Página de
  inicio, Copia de seguridad, Atajos) y opciones en filas agrupadas; en móvil las pestañas pasan
  arriba. Se navega también con el teclado (flechas, Inicio, Fin).
- **Borde izquierdo de las tarjetas** (Ajustes → Apariencia → Borde de las tarjetas): la franja de
  color de las tarjetas del tablero y de los grupos se puede ocultar, cambiar de grosor (ninguno,
  fino, normal, grueso, extra; «Ninguno» equivale a apagar el interruptor) y de color general. El color general tiñe las tarjetas de carpeta que
  no tienen color propio (las que sí lo tienen lo conservan; los grupos mantienen el suyo). Con
  vista previa en vivo; se aplica antes del primer pintado y entra en la copia de seguridad.
- **Estilo de bordes** (Ajustes → Bordes): esquinas redondeadas, semi o rectas en toda la
  interfaz (tarjetas, botones, menús, diálogos, buscador…). Se aplica antes del primer pintado,
  como el tema, y se sincroniza entre pestañas.
- **Copia de seguridad** (Ajustes → Backup / Copia de seguridad): «Exportar…» guarda en un `.json`
  los grupos, colores de carpeta, destacados y ajustes; «Importar…» los restaura tras confirmar
  (sustituye los actuales). Como los ids internos de los marcadores pueden cambiar entre perfiles,
  la copia guarda también la URL de cada marcador y la ruta de cada carpeta: al restaurar en otro
  ordenador se reconocen por URL/ruta y se avisa de los que no existen. No incluye ni modifica los
  marcadores de Firefox. Conviene exportar antes de reinstalar o de cambiar de versión firmada.
- **Color por carpeta**: menú de cualquier carpeta (clic derecho o `⋯`) → «Color…» → uno de los 10
  colores o «Predeterminado». Se aplica al icono de la barra lateral, al bloque de carpeta, a la
  tarjeta del tablero (franja, cabecera y contador), a los accesos de subcarpeta y a la cabecera de
  la vista. Se guarda solo en `browser.storage.local` (Firefox no admite colores en carpetas) y se
  sincroniza entre pestañas del dashboard.
- **Grupos** (columna derecha): crea grupos con nombre y un color característico (10 colores) y
  **arrastra marcadores** sobre ellos para añadirlos. Un marcador puede estar en varios grupos y
  sus tarjetas muestran un punto del color de cada grupo. Arrastrar un elemento de un grupo a otro
  lo mueve; soltar sobre «New group» crea un grupo con ese marcador. También hay «Add to group…»
  en el menú de cada marcador. Cada grupo se puede contraer, renombrar, cambiar de color,
  reordenar, abrir entero en pestañas (menú o clic central en su cabecera) y eliminar (con
  confirmación). Los grupos se guardan solo en `browser.storage.local`: **no crean, mueven ni
  borran marcadores de Firefox**. Por debajo de 1200 px el panel flota sobre el contenido y se
  abre con el botón de panel de la barra superior.
- **Idioma**: inglés por defecto; español opcional en Ajustes → Language / Idioma. Se aplica al
  instante, se guarda en `browser.storage.local` y se sincroniza entre pestañas del dashboard.
- Tema claro / oscuro / del sistema, vista cuadrícula/lista, orden (original, nombre A→Z / Z→A,
  más recientes / más antiguos), última carpeta recordada y carpetas expandidas, todo guardado en
  `browser.storage.local`.
- Responsive: por debajo de 900 px la barra lateral pasa a ser un panel deslizable.
- Atajos: `/` o `Ctrl+K` buscar · `Intro` abre el primer resultado · `↓` pasa a los resultados ·
  `Supr` elimina el elemento enfocado · `Esc` limpia / cierra · flechas para navegar el árbol ·
  `Alt+Shift+B` abre el dashboard.
- Estados vacíos (carpeta vacía, sin resultados, sin destacados, sin marcadores) y de error
  (API no disponible, fallo de lectura con botón «Reintentar»).

---

## 4. Guardar los archivos

El proyecto ya está en esta carpeta. Si quieres copiarlo a otro sitio, basta con los archivos del
árbol anterior respetando la estructura (`manifest.json` debe quedar en la raíz de la carpeta que
cargues en Firefox, e `icon.svg` dentro de `icons/`).

---

## 5. Instalación para pruebas (`about:debugging`)

1. Abre `about:debugging#/runtime/this-firefox` en Firefox.
2. Pulsa **«Cargar complemento temporal…»**.
3. Selecciona el archivo `manifest.json` del proyecto.
4. Aparecerá el icono de la extensión en la barra (si no lo ves, abre el menú de extensiones 🧩
   y fíjalo). Púlsalo, abre una pestaña nueva o usa `Alt+Shift+B`.

Notas:
- Un complemento temporal **se descarga al cerrar Firefox**; hay que volver a cargarlo en la
  siguiente sesión. Tus marcadores no se ven afectados; las preferencias locales del dashboard
  (destacados, tema…) pueden perderse al desinstalarlo.
- Tras cambiar el código, pulsa **«Recargar»** en `about:debugging`.
- Para ver errores: botón **«Inspeccionar»** en `about:debugging` (abre la consola de la extensión).

---

## 6. Usarlo como página de nueva pestaña

Ya viene activado: `manifest.json` incluye

```json
"chrome_url_overrides": { "newtab": "dashboard.html" }
```

- La primera vez que abras una pestaña nueva, Firefox mostrará un aviso *«Una extensión ha cambiado
  la página que ves al abrir una pestaña nueva»*. Elige **«Mantener cambios»**.
- En **Ajustes → Inicio → Nuevas pestañas** verás que Bookmark Dashboard controla esa página.
- **Si no lo quieres como nueva pestaña**, borra el bloque `"chrome_url_overrides"` (3 líneas) de
  `manifest.json` y recarga la extensión. El dashboard seguirá disponible desde el botón de la barra
  y con `Alt+Shift+B`.
- Para que también aparezca en **ventanas privadas**: `about:addons` → Bookmark Dashboard →
  «Ejecutar en ventanas privadas» → Permitir.
- Para que la **nueva pestaña** sea solo la carpeta de inicio, activa el modo minimalista
  (botón de las cuatro esquinas o Ajustes → Página de inicio → «Modo minimalista»).
- Opcional, como **página de inicio** de Firefox: en Ajustes del dashboard → Página de inicio,
  pulsa «Copiar» (copia `moz-extension://…/dashboard.html?home`, que abre siempre el modo
  minimalista) y pégala en Ajustes de Firefox → Inicio → «Página de inicio y nuevas ventanas» →
  Direcciones personalizadas. El UUID es estable mientras la extensión conserve el mismo `id`.

---

## 7. Instalación permanente y firma

Firefox **Release y Beta** (como tu versión 159) solo instalan de forma permanente extensiones
**firmadas por Mozilla**. Copiar los archivos dentro de la carpeta del perfil no sirve: Firefox
desactivaría el complemento sin firmar. La firma es gratuita y puede ser **privada** (sin listar,
no se publica en la tienda):

### Opción A: firma «sin listar» en AMO (recomendada)

1. Empaqueta la extensión:
   ```sh
   ./package.sh            # crea dist/bookmark-dashboard-<versión>.zip
   ```
   (o a mano: `zip -r -X bookmark-dashboard.zip manifest.json background.js dashboard.* theme-init.js i18n.js _locales icons`).
2. Crea una cuenta o inicia sesión en <https://addons.mozilla.org/developers/>.
3. **«Enviar un nuevo complemento»** → elige **«Por tu cuenta»** (*On your own*, distribución propia, sin listar).
4. Sube el `.zip`. La validación y firma automáticas suelen tardar unos minutos; no se publica ni
   lo ve nadie.
5. Descarga el `.xpi` firmado e instálalo desde `about:addons` → ⚙️ → **«Instalar complemento desde
   archivo…»** (o arrastra el `.xpi` a Firefox).
6. Para cada nueva versión, sube `"version"` en `manifest.json` y repite.

Requisitos: el `browser_specific_settings.gecko.id` (`bookmark-dashboard@local-extension`) debe
ser único en AMO. Si lo rechaza por duplicado, cámbialo por uno propio (p. ej.
`bookmark-dashboard@tu-dominio.example`) **antes** de la primera firma y mantenlo después
(el almacenamiento y la URL `moz-extension://` dependen de él).

### Opción A bis: firmar desde la terminal con `sign.sh`

1. En <https://addons.mozilla.org/developers/addon/api/key/> genera tus credenciales de API
   («Emisor JWT» y «Secreto JWT»).
2. Guárdalas una sola vez en un archivo `.env` en la raíz del proyecto (está en `.gitignore`, así
   que nunca se sube al repositorio; usa `.env.example` como plantilla):
   ```sh
   cp .env.example .env && chmod 600 .env   # y edita los dos valores
   ./sign.sh --check                        # comprueba que se cargan, sin firmar nada
   ./sign.sh                                # empaqueta y firma
   ```
   También puedes exportarlas en la terminal (`export WEB_EXT_API_KEY=…`); si lo haces, tienen
   prioridad sobre `.env`.
   El script empaqueta, firma exactamente el contenido del `.zip` por el canal *unlisted* con la
   herramienta oficial `web-ext` de Mozilla (vía `npx`, no forma parte de la extensión) y deja el
   `.xpi` firmado en `dist/`.
3. Instálalo: `about:addons` → ⚙️ → «Instalar complemento desde archivo…».

**Antes de pasar de la versión temporal a la firmada**, exporta tus datos (Ajustes → Copia de
seguridad → Exportar…) y, ya con la firmada instalada, impórtalos. Los grupos, colores y destacados
viven en el almacenamiento de la extensión y no van incluidos en el `.xpi`.

### Opción B: sin firma (solo Developer Edition, Nightly o ESR)

En **Firefox Developer Edition, Nightly, ESR** o compilaciones sin marca puedes poner
`xpinstall.signatures.required = false` en `about:config` e instalar el `.zip` (renombrado a `.xpi`)
desde `about:addons`. **En Firefox normal esta preferencia se ignora.**

---

## 8. Probar la sincronización

Con el dashboard abierto (mejor en una ventana propia, al lado de una ventana normal):

| Prueba | Qué hacer | Resultado esperado en el dashboard |
|---|---|---|
| Crear | `Ctrl+D` en cualquier página y guardarla en la barra de marcadores | La tarjeta aparece al instante con un breve resaltado; los contadores suben. |
| Renombrar | Biblioteca (`Ctrl+Shift+O`) → editar el nombre de un marcador | La tarjeta cambia de título sin recargar. |
| Cambiar URL | Cambiar la URL en la Biblioteca | Se actualizan el dominio y el favicon. |
| Mover | Arrastrar un marcador a otra carpeta en la Biblioteca o en la barra | Desaparece de la carpeta antigua y aparece en la nueva; ambos contadores cambian. |
| Reordenar | Arrastrar un marcador dentro de la misma carpeta (barra) | Con «Orden original», cambia su posición. |
| Eliminar | Borrar un marcador o carpeta desde la Biblioteca | Desaparece; si estabas dentro de la carpeta borrada, pasas a la carpeta padre. |
| Deshacer | `Ctrl+Z` en la Biblioteca tras borrar | El marcador vuelve a aparecer. |
| Varios dashboards | Abrir dos pestañas del dashboard y destacar algo en una | La otra actualiza la estrella y el contador. |
| Desde el dashboard | Crear / editar / mover / eliminar desde el dashboard | El cambio se ve en la barra y en la Biblioteca de Firefox. |
| Arrastrar enlace | Arrastrar un enlace de una web a una carpeta de la barra lateral | Se guarda como marcador en esa carpeta. |
| Separador | Biblioteca → clic derecho → «Nuevo separador» (con el dashboard en vista de lista) | Aparece una línea divisoria en la misma posición. |

El punto verde de la esquina inferior izquierda pulsa cada vez que llega un evento de Firefox.

---

## Solución de problemas

- **La interfaz sale en inglés**: es el idioma por defecto. Cámbialo en Ajustes (icono de
  controles) → *Language* → Español.
- **«Open this page from the extension» / «Abre esta página desde la extensión»**: abriste `dashboard.html` como archivo local; debe
  cargarse como extensión (sección 5).
- **Algunos favicons no aparecen**: el sitio no sirve `/favicon.ico` (declara el icono solo en su
  HTML). Se usa la inicial en su lugar.
- **Un marcador de «Más visitados» o un bookmarklet no se abre**: son URLs `place:` / `javascript:`,
  que Firefox bloquea desde extensiones; se copia la URL al portapapeles.
