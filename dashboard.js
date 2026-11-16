'use strict';

/*
 * Bookmark Control Panel — lógica principal.
 *
 * Arquitectura:
 *   1. Modelo en memoria (Map id → nodo) construido con browser.bookmarks.getTree().
 *   2. Los eventos onCreated/onRemoved/onChanged/onMoved aplican cambios
 *      incrementales al modelo; la interfaz se repinta en el siguiente frame.
 *   3. El render reutiliza los nodos DOM de las tarjetas por id (reconciliación
 *      por clave), así un cambio no recarga la página ni los favicons.
 *   4. Todo texto procedente de los marcadores se inserta con textContent /
 *      nodos de texto. No se usa innerHTML en ningún punto.
 *   5. Las escrituras en marcadores solo ocurren por acción explícita del
 *      usuario (crear, editar, mover, eliminar). La inicialización solo lee.
 *   6. Textos de la interfaz en i18n.js (inglés por defecto, español opcional).
 */

(() => {
  const api = globalThis.browser;

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DND_TYPE = 'application/x-bookmark-control-panel-id';

  const VIEW_ALL = 'view:all';
  const VIEW_FAVORITES = 'view:favorites';
  const VIEW_RECENT = 'view:recent';
  // Tira: las carpetas elegidas, una tarjeta del tablero al lado de otra.
  const VIEW_STRIP = 'view:strip';
  const VIEWS = {
    [VIEW_ALL]: { label: 'view.all', icon: 'layers' },
    [VIEW_FAVORITES]: { label: 'view.favorites', icon: 'star' },
    [VIEW_RECENT]: { label: 'view.recent', icon: 'clock' },
    [VIEW_STRIP]: { label: 'view.strip', icon: 'strip' },
  };

  // Carpetas raíz de Firefox (ids fijos de Places).
  const BUILTIN_FOLDERS = {
    menu________: { label: 'builtin.menu', icon: 'book' },
    toolbar_____: { label: 'builtin.toolbar', icon: 'toolbar' },
    unfiled_____: { label: 'builtin.unfiled', icon: 'inbox' },
    mobile______: { label: 'builtin.mobile', icon: 'phone' },
  };
  const UNFILED_ID = 'unfiled_____';
  const TOOLBAR_ID = 'toolbar_____';
  const MOBILE_ID = 'mobile______';

  const RECENT_LIMIT = 60;
  const PAGE_SIZE = 200;
  const OPEN_ALL_CONFIRM = 15; // igual que el aviso de Firefox (browser.tabs.maxOpenBeforeWarn)
  const THEMES = ['auto', 'light', 'dark'];
  const LANGS = ['en', 'es'];
  const DEFAULT_LANG = 'en';
  const GROUP_COLORS = ['indigo', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet', 'slate'];
  const GROUP_NAME_MAX = 60;
  const VIEW_MODES = ['grid', 'list', 'board'];
  const CORNERS = ['round', 'semi', 'square'];
  // Color principal de la interfaz (botones, selección, foco…): 'indigo' es el de siempre.
  const ACCENT_COLORS = GROUP_COLORS;
  // Color general de las carpetas: 'default' es el amarillo de siempre.
  const FOLDER_COLORS = ['default', ...GROUP_COLORS];
  // Franja de color a la izquierda de las tarjetas: color general y grosor (px).
  const STRIPE_COLORS = ['auto', ...GROUP_COLORS];
  const STRIPE_WIDTHS = [2, 3, 5, 8];
  const BOARD_COLUMNS = ['auto', 1, 2, 3, 4, 5, 6]; // máximo de columnas del tablero
  const CONTENT_WIDTHS = ['normal', 'wide', 'full']; // ancho máximo del contenido
  const TAB_TITLE_MAX = 60; // caracteres del nombre propio de la pestaña
  const TAB_TITLE_KEY = 'bd-tab-title'; // copia rápida para theme-init.js
  const SETTINGS_TABS = ['appearance', 'general', 'home', 'backup', 'shortcuts'];
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const VT_MAX_CARDS = 60; // tarjetas que vuelan a su sitio en la transición (las visibles)
  const BOARD_ROWS = 10; // enlaces visibles por tarjeta antes de «Mostrar más»
  const BOARD_PAGE = 40; // tarjetas por página en la vista de tablero
  const HOME_NAV_KEY = 'bd-home-nav'; // subcarpeta abierta en el modo minimalista (por pestaña)
  function readHomeNav() {
    try {
      return sessionStorage.getItem(HOME_NAV_KEY) || null;
    } catch {
      return null;
    }
  }
  // Por debajo de este ancho el panel de grupos flota sobre el contenido.
  const GROUPS_OVERLAY = window.matchMedia('(max-width: 1200px)');
  const SORTS = ['manual', 'name-asc', 'name-desc', 'date-desc', 'date-asc'];
  const THEME_META = {
    auto: { icon: 'monitor', label: 'themeBtn.auto' },
    light: { icon: 'sun', label: 'themeBtn.light' },
    dark: { icon: 'moon', label: 'themeBtn.dark' },
  };

  const DEFAULT_PREFS = Object.freeze({
    lang: DEFAULT_LANG,
    corners: 'round',
    accentColor: 'indigo',
    folderColor: 'default',
    sidebarPanel: true,
    minimal: false,
    homeFolder: 'toolbar_____',
    stripe: true,
    stripeColor: 'auto',
    stripeWidth: 3,
    boardColumns: 'auto',
    contentWidth: 'normal',
    tabTitle: '', // nombre de la pestaña; vacío = el predeterminado («Bookmarks» / «Marcadores»)
    tabTitleFolder: true, // anteponer la carpeta o búsqueda actual al nombre
    theme: 'auto',
    view: 'grid',
    sort: 'manual',
    lastFolder: VIEW_ALL,
    openInNewTab: false,
    showFavicons: true,
    includeSubfolders: false,
    groupsPanel: true,
    groups: [],
    boardCollapsed: [],
    boardShowAll: [],
    stripFolders: [],
    stripOpen: [],
    stripProfiles: [],
    stripProfile: '',
    folderColors: {},
    separatorColors: {},
    expanded: ['menu________', 'toolbar_____', 'unfiled_____'],
    favorites: [],
  });

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  const state = {
    ready: false,
    rootId: 'root________',
    nodes: new Map(),
    prefs: {
      lang: DEFAULT_PREFS.lang,
      corners: DEFAULT_PREFS.corners,
      accentColor: DEFAULT_PREFS.accentColor,
      folderColor: DEFAULT_PREFS.folderColor,
      sidebarPanel: DEFAULT_PREFS.sidebarPanel,
      minimal: DEFAULT_PREFS.minimal,
      homeFolder: DEFAULT_PREFS.homeFolder,
      stripe: DEFAULT_PREFS.stripe,
      stripeColor: DEFAULT_PREFS.stripeColor,
      stripeWidth: DEFAULT_PREFS.stripeWidth,
      boardColumns: DEFAULT_PREFS.boardColumns,
      contentWidth: DEFAULT_PREFS.contentWidth,
      theme: DEFAULT_PREFS.theme,
      view: DEFAULT_PREFS.view,
      sort: DEFAULT_PREFS.sort,
      lastFolder: DEFAULT_PREFS.lastFolder,
      openInNewTab: DEFAULT_PREFS.openInNewTab,
      showFavicons: DEFAULT_PREFS.showFavicons,
      includeSubfolders: DEFAULT_PREFS.includeSubfolders,
      groupsPanel: DEFAULT_PREFS.groupsPanel,
    },
    expanded: new Set(DEFAULT_PREFS.expanded),
    favorites: new Set(),
    selected: VIEW_ALL,
    // Modo minimalista: ?home en la URL lo fuerza en esta pestaña (página de inicio);
    // homeNav es la subcarpeta abierta dentro de ese modo: se guarda por pestaña
    // (sessionStorage), así sobrevive a una recarga y las pestañas nuevas empiezan
    // en la carpeta de inicio.
    forceHome: new URLSearchParams(location.search).has('home'),
    homeNav: readHomeNav(),
    minimalOn: null,
    settingsTab: 'appearance',
    // Transición animada en curso: los renders se aplazan para no sustituir
    // las tarjetas que se están animando.
    vtActive: false,
    renderPending: false,
    query: '',
    terms: [],
    limit: PAGE_SIZE,
    eventSeq: 0,
    counts: null,
    searchCache: new Map(),
    pathCache: new Map(),
    newIds: new Set(),
    cardEls: new Map(),
    failedIcons: new Set(),
    renderQueued: false,
    lastViewKey: '',
    dragId: null,
    // Todo lo que se arrastra a la vez (la selección, si se arrastra uno de sus marcadores).
    dragIds: [],
    dropEl: null,
    dropTimer: 0,
    // Hueco de reordenación en la sección principal: { el, after, x }.
    dropSlot: null,
    reorderable: false,
    menuReturnFocus: null,
    editor: { mode: null, nodeId: null },
    groups: [],
    groupIndex: new Map(),
    groupsSig: '',
    groupEditor: { id: null, addBookmarkIds: [] },
    // Última acción que se puede deshacer: { run, at }.
    undo: null,
    // Selección múltiple de marcadores en la sección principal.
    selection: new Set(),
    selAnchor: null,
    viewItemIds: [],
    viewFolderId: null,
    newGroupItem: null,
    dragFromGroup: null,
    menuAnchor: null,
    rowEls: new Map(),
    boardCollapsed: new Set(),
    boardShowAll: new Set(),
    boardPages: 1,
    // Carpetas de la tira, en su orden (pueden quedar ids de carpetas borradas:
    // no se muestran, y «Deshacer» las vuelve a enlazar).
    stripFolders: [],
    // Perfiles de la tira: distintas selecciones de carpetas ({ id, name, folders }).
    // Las del activo son siempre las de stripFolders.
    stripProfiles: [],
    stripProfile: '',
    // Perfil cuyo nombre se está editando en la barra, y el que recibe el foco al repintar.
    profileRenaming: null,
    profileFocus: null,
    viewKind: null,
    treePicking: false,
    // Subcarpetas desplegadas dentro de las tarjetas de la tira.
    stripOpen: new Set(),
    folderColors: Object.create(null),
    separatorColors: Object.create(null),
  };

  // ---------------------------------------------------------------------------
  // Idioma (i18n.js) y formatos dependientes del idioma
  // ---------------------------------------------------------------------------

  const STRINGS = globalThis.BD_I18N || {};
  let lang = DEFAULT_LANG;
  let dict = STRINGS[DEFAULT_LANG] || {};
  let numberFmt;
  let dateFmt;
  let dateTimeFmt;
  let collator;
  let pluralRules;

  function setLocale(code) {
    lang = LANGS.includes(code) && STRINGS[code] ? code : DEFAULT_LANG;
    dict = STRINGS[lang] || {};
    numberFmt = new Intl.NumberFormat(lang);
    dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' });
    dateTimeFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short' });
    collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    pluralRules = new Intl.PluralRules(lang);
  }

  // Idioma inicial desde la copia rápida en localStorage (evita un destello en
  // inglés antes de leer browser.storage.local, que es la fuente de verdad).
  try {
    setLocale(localStorage.getItem('bd-lang') || DEFAULT_LANG);
  } catch {
    setLocale(DEFAULT_LANG);
  }

  function lookup(key) {
    return Object.hasOwn(dict, key) ? dict[key] : (STRINGS[DEFAULT_LANG]?.[key] ?? key);
  }

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, name) =>
      vars && Object.hasOwn(vars, name) ? String(vars[name]) : m,
    );
  }

  /** Texto traducido (siempre texto plano, nunca HTML). */
  function t(key, vars) {
    const value = lookup(key);
    return fill(typeof value === 'string' ? value : value.other, vars);
  }

  /** Texto traducido con plural; {n} recibe el número formateado. */
  function tn(key, n, vars) {
    const value = lookup(key);
    const template = typeof value === 'string' ? value : (value[pluralRules.select(n)] ?? value.other);
    return fill(template, { ...vars, n: numberFmt.format(n) });
  }

  /** Traduce los textos estáticos del HTML: data-i18n y data-i18n-attr="attr:clave;…". */
  function translateStatic(root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of node.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        if (attr && key) node.setAttribute(attr, t(key));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const $ = (selector, root = document) => root.querySelector(selector);
  const get = (id) => (id == null ? undefined : state.nodes.get(id));
  const isFolder = (n) => !!n && n.type === 'folder';
  const isBookmark = (n) => !!n && n.type === 'bookmark';
  const isView = (id) => Object.hasOwn(VIEWS, id);
  const builtinInfo = (id) => (Object.hasOwn(BUILTIN_FOLDERS, id) ? BUILTIN_FOLDERS[id] : null);
  const isBuiltin = (id) => id === state.rootId || builtinInfo(id) !== null;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const fold = (s) =>
    String(s)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  /** Nombre de la pestaña tal como se guarda: una línea, sin espacios sobrantes y con tope de longitud. */
  const cleanTabTitle = (v) =>
    typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, TAB_TITLE_MAX).join('').trim() : '';

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /** Crea un elemento de forma segura (textos siempre como nodos de texto). */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value)) if (v != null) node.dataset[k] = v;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...children.filter((c) => c != null && c !== false));
    return node;
  }

  function icon(name, extraClass = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', extraClass ? `icon ${extraClass}` : 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  /** Solo http(s) se puede abrir desde una página de extensión. */
  const isOpenable = (url) => /^https?:\/\//i.test(url || '');

  function prettyUrl(url) {
    const u = parseUrl(url);
    if (!u || !/^https?:$/.test(u.protocol)) return url || '';
    let s = u.hostname.replace(/^www\./, '') + (u.port ? `:${u.port}` : '') + u.pathname.replace(/\/$/, '') + u.search;
    try {
      s = decodeURI(s);
    } catch {
      /* se deja codificada */
    }
    return s;
  }

  function hostOf(url) {
    const u = parseUrl(url);
    return u ? u.hostname.replace(/^www\./, '') : '';
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  /** Normaliza lo que escribe el usuario: "ejemplo.com" → "https://ejemplo.com/". */
  function normalizeUrl(raw) {
    const input = String(raw || '').trim();
    if (!input) return '';
    const hasScheme = /^[a-z][a-z\d+.-]*:(\/\/|[^\d])/i.test(input);
    const candidate = hasScheme ? input : `https://${input}`;
    const u = parseUrl(candidate);
    if (!u) return '';
    if (/^https?:$/.test(u.protocol) && !u.hostname) return '';
    return u.href;
  }

  const folderName = (n) => {
    if (!n) return '';
    const builtin = builtinInfo(n.id);
    return builtin ? t(builtin.label) : n.title || t('folder.unnamed');
  };
  const folderIcon = (n) => builtinInfo(n?.id)?.icon || 'folder';
  const bookmarkTitle = (n) => n.title.trim() || prettyUrl(n.url) || t('bookmark.untitled');
  const isSeparator = (n) => !!n && n.type === 'separator';

  // ---------------------------------------------------------------------------
  // Modelo
  // ---------------------------------------------------------------------------

  function makeNode(raw, parentId) {
    return {
      id: raw.id,
      parentId: parentId ?? raw.parentId ?? null,
      type: raw.type || (raw.url ? 'bookmark' : 'folder'),
      title: raw.title || '',
      url: raw.url || '',
      dateAdded: raw.dateAdded || 0,
      children: [],
    };
  }

  /** Inserta un subárbol completo en el mapa (iterativo, sin límites de pila). */
  function addSubtree(map, rawRoot, parentId) {
    const stack = [[rawRoot, parentId]];
    while (stack.length) {
      const [raw, pid] = stack.pop();
      const node = makeNode(raw, pid);
      map.set(node.id, node);
      if (Array.isArray(raw.children)) {
        node.children = raw.children.map((c) => c.id);
        for (let i = raw.children.length - 1; i >= 0; i--) stack.push([raw.children[i], node.id]);
      }
    }
  }

  function buildModel(rootRaw) {
    const nodes = new Map();
    addSubtree(nodes, rootRaw, null);
    state.nodes = nodes;
    state.rootId = rootRaw.id;
    invalidate();
  }

  function invalidate() {
    state.counts = null;
    state.searchCache.clear();
    state.pathCache.clear();
  }

  /** Lee el árbol. Si llegan eventos mientras se lee, vuelve a leer (máx. 3). */
  async function loadTree() {
    for (let attempt = 0; ; attempt++) {
      const seq = state.eventSeq;
      // Reintento secuencial a propósito: hay que comparar eventSeq después de cada lectura.
      // oxlint-disable-next-line no-await-in-loop
      const tree = await api.bookmarks.getTree();
      if (!Array.isArray(tree) || !tree[0]) throw new Error('getTree() returned an empty tree');
      if (seq === state.eventSeq || attempt >= 2) {
        buildModel(tree[0]);
        return;
      }
    }
  }

  /** Recuento recursivo de marcadores por carpeta (cacheado hasta el siguiente cambio). */
  function getCounts() {
    if (state.counts) return state.counts;
    const counts = new Map();
    const order = [];
    const stack = [state.rootId];
    while (stack.length) {
      const f = get(stack.pop());
      if (!isFolder(f)) continue;
      order.push(f);
      for (const cid of f.children) stack.push(cid);
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const f = order[i];
      let total = 0;
      for (const cid of f.children) {
        const c = get(cid);
        if (isBookmark(c)) total++;
        else if (isFolder(c)) total += counts.get(cid) || 0;
      }
      counts.set(f.id, total);
    }
    state.counts = counts;
    return counts;
  }

  function collectBookmarks(folderId) {
    const out = [];
    const visit = (id) => {
      const f = get(id);
      if (!isFolder(f)) return;
      for (const cid of f.children) {
        const c = get(cid);
        if (isBookmark(c)) out.push(c);
        else if (isFolder(c)) visit(cid);
      }
    };
    visit(folderId);
    return out;
  }

  function collectFolders(folderId) {
    const out = [];
    const visit = (id) => {
      const f = get(id);
      if (!isFolder(f)) return;
      for (const cid of f.children) {
        const c = get(cid);
        if (isFolder(c)) {
          out.push(c);
          visit(cid);
        }
      }
    };
    visit(folderId);
    return out;
  }

  function subtreeIds(id) {
    const ids = new Set();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      ids.add(cur);
      const n = get(cur);
      if (n) for (const c of n.children) stack.push(c);
    }
    return ids;
  }

  function ancestors(id) {
    const out = [];
    let n = get(get(id)?.parentId);
    let guard = 0;
    while (n && n.id !== state.rootId && guard++ < 500) {
      out.push(n);
      n = get(n.parentId);
    }
    return out.toReversed();
  }

  function pathText(id) {
    let p = state.pathCache.get(id);
    if (p === undefined) {
      p = ancestors(id).map(folderName).join(' / ');
      state.pathCache.set(id, p);
    }
    return p;
  }

  /** ¿Es `id` igual a `ancestorId` o está dentro de él? */
  function isInside(id, ancestorId) {
    let n = get(id);
    let guard = 0;
    while (n && guard++ < 500) {
      if (n.id === ancestorId) return true;
      n = get(n.parentId);
    }
    return false;
  }

  function userFolderCount() {
    let n = 0;
    for (const node of state.nodes.values()) if (isFolder(node) && !isBuiltin(node.id)) n++;
    return n;
  }

  function countFavorites() {
    let n = 0;
    for (const id of state.favorites) if (isBookmark(get(id))) n++;
    return n;
  }

  function defaultParentId() {
    const sel = get(state.selected);
    if (isFolder(sel) && sel.id !== state.rootId) return sel.id;
    if (isFolder(get(UNFILED_ID))) return UNFILED_ID;
    if (isFolder(get(TOOLBAR_ID))) return TOOLBAR_ID;
    return get(state.rootId)?.children.find((id) => isFolder(get(id))) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Sincronización con Firefox (eventos de marcadores)
  // ---------------------------------------------------------------------------

  function removeFromArray(arr, value) {
    const i = arr.indexOf(value);
    if (i !== -1) arr.splice(i, 1);
  }

  function insertChild(parent, id, index) {
    removeFromArray(parent.children, id);
    if (Number.isInteger(index) && index >= 0 && index <= parent.children.length) {
      parent.children.splice(index, 0, id);
    } else {
      parent.children.push(id);
    }
  }

  function modelChanged() {
    invalidate();
    pulseLive();
    scheduleRender();
  }

  function handleCreated(id, raw) {
    state.eventSeq++;
    if (!state.ready) return;
    const parent = get(raw.parentId);
    if (!isFolder(parent)) {
      scheduleResync();
      return;
    }
    addSubtree(state.nodes, raw, raw.parentId);
    insertChild(parent, id, raw.index);
    state.newIds.add(id);
    modelChanged();
  }

  function handleRemoved(id, info) {
    state.eventSeq++;
    if (!state.ready) return;
    const node = get(id);
    const parent = get(info?.parentId ?? node?.parentId);
    if (parent) removeFromArray(parent.children, id);
    if (node) {
      const removed = subtreeIds(id);
      for (const rid of removed) {
        state.nodes.delete(rid);
        state.cardEls.delete(rid);
        state.rowEls.delete(rid);
      }
      if (removed.has(state.selected)) {
        state.selected = parent && parent.id !== state.rootId ? parent.id : VIEW_ALL;
        state.limit = PAGE_SIZE;
        persistSelection();
      }
    }
    modelChanged();
  }

  function handleChanged(id, info) {
    state.eventSeq++;
    if (!state.ready) return;
    const node = get(id);
    if (!node) {
      scheduleResync();
      return;
    }
    if (typeof info?.title === 'string') node.title = info.title;
    if (typeof info?.url === 'string') node.url = info.url;
    modelChanged();
  }

  function handleMoved(id, info) {
    state.eventSeq++;
    if (!state.ready) return;
    const node = get(id);
    const from = get(info?.oldParentId);
    const to = get(info?.parentId);
    if (!node || !isFolder(to)) {
      scheduleResync();
      return;
    }
    if (from) removeFromArray(from.children, id);
    node.parentId = to.id;
    insertChild(to, id, info.index);
    modelChanged();
  }

  function registerBookmarkListeners() {
    const b = api.bookmarks;
    b.onCreated.addListener(handleCreated);
    b.onRemoved.addListener(handleRemoved);
    b.onChanged.addListener(handleChanged);
    b.onMoved.addListener(handleMoved);
  }

  /** Relectura completa (solo lectura) como red de seguridad ante incoherencias. */
  async function resync({ notify = false } = {}) {
    try {
      await loadTree();
      validateSelection();
      $('#live').classList.remove('is-error');
      scheduleRender();
      if (notify) toast(t('toast.resynced'));
    } catch (err) {
      console.error('[Bookmark Control Panel] Error al releer los marcadores:', err);
      $('#live').classList.add('is-error');
      if (notify) toast(t('toast.resyncError', { error: err?.message || err }), 'error');
    }
  }
  const scheduleResync = debounce(() => resync(), 250);

  function pulseLive() {
    const dot = $('#live');
    dot.classList.remove('pulse');
    void dot.offsetWidth; // reinicia la animación
    dot.classList.add('pulse');
  }

  // ---------------------------------------------------------------------------
  // Preferencias (browser.storage.local)
  // ---------------------------------------------------------------------------

  function applyPrefs(p) {
    const prefs = state.prefs;
    if (LANGS.includes(p.lang)) prefs.lang = p.lang;
    if (THEMES.includes(p.theme)) prefs.theme = p.theme;
    if (CORNERS.includes(p.corners)) prefs.corners = p.corners;
    if (ACCENT_COLORS.includes(p.accentColor)) prefs.accentColor = p.accentColor;
    if (FOLDER_COLORS.includes(p.folderColor)) prefs.folderColor = p.folderColor;
    if (VIEW_MODES.includes(p.view)) prefs.view = p.view;
    if (Array.isArray(p.boardCollapsed))
      state.boardCollapsed = new Set(p.boardCollapsed.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.boardShowAll))
      state.boardShowAll = new Set(p.boardShowAll.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.stripOpen)) state.stripOpen = new Set(p.stripOpen.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.stripProfiles) || typeof p.stripProfile === 'string' || Array.isArray(p.stripFolders))
      applyStripProfiles(p);
    if (p.folderColors && typeof p.folderColors === 'object' && !Array.isArray(p.folderColors)) {
      const colors = Object.create(null);
      for (const [id, color] of Object.entries(p.folderColors)) if (GROUP_COLORS.includes(color)) colors[id] = color;
      state.folderColors = colors;
    }
    if (isColorMap(p.separatorColors)) state.separatorColors = cleanColors(p.separatorColors);
    if (SORTS.includes(p.sort)) prefs.sort = p.sort;
    if (typeof p.lastFolder === 'string') prefs.lastFolder = p.lastFolder;
    if (typeof p.homeFolder === 'string' && p.homeFolder) prefs.homeFolder = p.homeFolder;
    if (STRIPE_COLORS.includes(p.stripeColor)) prefs.stripeColor = p.stripeColor;
    if (STRIPE_WIDTHS.includes(p.stripeWidth)) prefs.stripeWidth = p.stripeWidth;
    if (BOARD_COLUMNS.includes(p.boardColumns)) prefs.boardColumns = p.boardColumns;
    if (CONTENT_WIDTHS.includes(p.contentWidth)) prefs.contentWidth = p.contentWidth;
    if (typeof p.tabTitle === 'string') prefs.tabTitle = cleanTabTitle(p.tabTitle);
    for (const key of [
      'openInNewTab',
      'showFavicons',
      'includeSubfolders',
      'groupsPanel',
      'sidebarPanel',
      'minimal',
      'stripe',
      'tabTitleFolder',
    ]) {
      if (typeof p[key] === 'boolean') prefs[key] = p[key];
    }
    if (Array.isArray(p.expanded)) state.expanded = new Set(p.expanded.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.favorites)) state.favorites = new Set(p.favorites.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.groups)) state.groups = sanitizeGroups(p.groups);
  }

  async function loadPrefs() {
    try {
      applyPrefs(await api.storage.local.get({ ...DEFAULT_PREFS }));
    } catch (err) {
      console.warn('[Bookmark Control Panel] No se pudieron leer las preferencias:', err);
    }
  }

  function savePrefs(partial) {
    return api.storage.local.set(partial).catch((err) => {
      console.error('[Bookmark Control Panel] Error al guardar preferencias:', err);
      toast(t('toast.prefsError'), 'error');
    });
  }

  const saveExpanded = debounce(() => savePrefs({ expanded: [...state.expanded] }), 300);
  const persistSelection = () => savePrefs({ lastFolder: state.selected });

  function setPref(key, value) {
    state.prefs[key] = value;
    savePrefs({ [key]: value });
    if (key === 'theme') applyTheme(true);
    if (key === 'corners') applyCorners();
    if (key === 'accentColor' || key === 'folderColor') applyAccent();
    if (key === 'sidebarPanel') applySidebar();
    if (key === 'minimal' || key === 'homeFolder') applyMinimal();
    if (key === 'stripe' || key === 'stripeColor' || key === 'stripeWidth') applyStripe();
    if (key === 'boardColumns' || key === 'contentWidth') applyBoardColumns();
    if (key === 'tabTitle' || key === 'tabTitleFolder') applyTabTitle();
    if (key === 'lang') applyLanguage();
    if (key === 'groupsPanel') applyGroupsPanel();
    if (key === 'includeSubfolders') state.limit = PAGE_SIZE;
    syncControls();
    scheduleRender();
  }

  /** Mantiene sincronizadas varias pestañas del panel abiertas a la vez. */
  function handleStorageChange(changes, area) {
    if (area !== 'local') return;
    const incoming = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key !== 'lastFolder' && change.newValue !== undefined) incoming[key] = change.newValue;
    }
    if (!Object.keys(incoming).length) return;
    applyPrefs(incoming);
    if (incoming.lang !== undefined) applyLanguage();
    applyCorners();
    applyAccent();
    applySidebar();
    applyMinimal();
    applyStripe();
    applyBoardColumns();
    applyTabTitle();
    applyGroupsPanel();
    applyTheme();
    syncControls();
    scheduleRender();
  }

  function applyTheme(animate = false) {
    const theme = state.prefs.theme;
    const root = document.documentElement;
    if (animate) {
      root.classList.add('theme-transition');
      setTimeout(() => root.classList.remove('theme-transition'), 350);
    }
    root.dataset.theme = theme;
    try {
      localStorage.setItem('bd-theme', theme);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
    const meta = THEME_META[theme];
    const label = t(meta.label);
    const btn = $('#theme-btn');
    btn.replaceChildren(icon(meta.icon));
    btn.title = t('themeBtn.hint', { label });
    btn.setAttribute('aria-label', label);
  }

  /** Aplica el idioma elegido a toda la interfaz (textos estáticos y dinámicos). */
  function applyLanguage() {
    setLocale(state.prefs.lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('bd-lang', lang);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
    translateStatic();
    applyTheme();
    applyTabTitle(); // el nombre predeterminado depende del idioma
    invalidate(); // las rutas de carpeta incluyen nombres traducidos
    if (!state.ready) {
      // Textos que el render todavía no ha sustituido.
      $('#stats').textContent = t('stats.loading');
      $('#view-title').textContent = t('view.loading');
    }
    scheduleRender();
  }

  /** Estilo de esquinas: redondeadas, semi o rectas (atributo en <html>, ver CSS). */
  function applyCorners() {
    const corners = state.prefs.corners;
    document.documentElement.dataset.corners = corners;
    try {
      localStorage.setItem('bd-corners', corners);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  /**
   * Color principal de la interfaz y color general de las carpetas (atributos en
   * <html>, ver CSS); sin atributo se usan los de siempre (índigo y amarillo).
   */
  function applyAccent() {
    const { accentColor, folderColor } = state.prefs;
    const root = document.documentElement;
    if (accentColor === DEFAULT_PREFS.accentColor) delete root.dataset.accent;
    else root.dataset.accent = accentColor;
    if (folderColor === DEFAULT_PREFS.folderColor) delete root.dataset.folderColor;
    else root.dataset.folderColor = folderColor;
    try {
      localStorage.setItem('bd-accent', accentColor);
      localStorage.setItem('bd-folder-color', folderColor);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  /** Franja de color de las tarjetas: visible u oculta, color general y grosor (ver CSS). */
  function applyStripe() {
    const { stripe, stripeColor, stripeWidth } = state.prefs;
    const root = document.documentElement;
    root.dataset.stripe = stripe ? 'on' : 'off';
    if (stripeColor === 'auto') delete root.dataset.stripeColor;
    else root.dataset.stripeColor = stripeColor;
    root.style.setProperty('--stripe-w', `${stripeWidth}px`);
    try {
      localStorage.setItem('bd-stripe', `${stripe ? 1 : 0}|${stripeColor}|${stripeWidth}`);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  /** Diseño: máximo de columnas del tablero ('auto' = según el ancho) y ancho del contenido. */
  function applyBoardColumns() {
    const cols = state.prefs.boardColumns;
    const width = state.prefs.contentWidth;
    const root = document.documentElement;
    if (width === 'normal') delete root.dataset.contentWidth;
    else root.dataset.contentWidth = width;
    if (cols === 'auto') {
      delete root.dataset.boardCols;
      root.style.removeProperty('--board-cols');
    } else {
      root.dataset.boardCols = String(cols);
      root.style.setProperty('--board-cols', String(cols));
    }
    try {
      localStorage.setItem('bd-board-cols', String(cols));
      localStorage.setItem('bd-content-width', width);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  /**
   * Título de la pestaña: el nombre elegido (o el predeterminado del idioma) y,
   * si está activado, delante la carpeta, vista o búsqueda que se está viendo.
   */
  function docTitle(view) {
    const name = state.prefs.tabTitle || t('app.title');
    if (!view || !state.prefs.tabTitleFolder) return name;
    return view.kind === 'search'
      ? t('doc.search', { q: state.query, name })
      : t('doc.view', { title: view.title, name });
  }

  /** Aplica el nombre de la pestaña y guarda la copia rápida para theme-init.js. */
  function applyTabTitle() {
    // Con el panel listo, renderHeader() pone el título completo (con la carpeta).
    if (!state.ready) document.title = docTitle(null);
    try {
      if (state.prefs.tabTitle) localStorage.setItem(TAB_TITLE_KEY, state.prefs.tabTitle);
      else localStorage.removeItem(TAB_TITLE_KEY);
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  /** Muestra u oculta la barra lateral de carpetas en escritorio (en móvil es un cajón). */
  function applySidebar() {
    const visible = state.prefs.sidebarPanel;
    document.documentElement.classList.toggle('sidebar-hidden', !visible);
    $('#sidebar-btn').setAttribute('aria-pressed', String(visible));
    try {
      localStorage.setItem('bd-sidebar', visible ? '1' : '0');
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  // ----- Modo minimalista: solo el tablero de la carpeta de inicio -----

  const isMinimal = () => state.forceHome || state.prefs.minimal;

  /** Algo que se puede mostrar en el modo minimalista: una carpeta o una vista (Todos, Destacados…). */
  const isShowable = (id) => isView(id) || isFolder(get(id));
  /** Lo que muestra el modo minimalista: la carpeta abierta en él o, si no hay, la de inicio. */
  const minimalSelection = () => (state.homeNav && isShowable(state.homeNav) ? state.homeNav : homeId());

  function setHomeNav(id) {
    state.homeNav = id;
    try {
      if (id) sessionStorage.setItem(HOME_NAV_KEY, id);
      else sessionStorage.removeItem(HOME_NAV_KEY);
    } catch {
      /* sin sessionStorage: la subcarpeta no sobrevive a una recarga */
    }
  }
  /** Tipo de vista efectivo: el modo minimalista siempre usa el tablero. */
  const viewMode = () => (isMinimal() ? 'board' : state.prefs.view);
  /** Carpeta (o vista) de inicio; si ya no existe, se usa «Todos los marcadores». */
  const homeId = () => resolveSelection(state.prefs.homeFolder);

  function selectionTitle(id) {
    if (isView(id)) return t(VIEWS[id].label);
    const n = get(id);
    return n ? folderName(n) : '';
  }

  /** Aplica el modo (clase en <html>, ver CSS) y guarda la copia rápida para theme-init.js. */
  function applyMinimal() {
    const on = isMinimal();
    const root = document.documentElement;
    // Al entrar o salir se vuelve a la carpeta de inicio; al arrancar (minimalOn
    // aún null) se conserva la subcarpeta guardada de esta pestaña.
    if (state.minimalOn !== null && on !== state.minimalOn) {
      setHomeNav(null);
      state.limit = PAGE_SIZE;
    }
    state.minimalOn = on;
    root.classList.toggle('minimal', on);
    if (on) {
      if (state.query) {
        $('#search').value = '';
        applyQuery('', false);
      }
      closeDrawer();
      closeGroupsOverlay();
    }
    if (state.ready && state.homeNav && !isShowable(state.homeNav)) setHomeNav(null);
    $('#opt-minimal').checked = state.prefs.minimal;
    try {
      localStorage.setItem('bd-minimal', state.prefs.minimal ? '1' : '0');
    } catch {
      /* sin localStorage: solo afecta al primer pintado */
    }
  }

  // ----- Transición animada entre el panel y el modo minimalista -----
  // View Transitions API: el navegador captura el estado anterior y el nuevo y
  // anima la diferencia. Los paneles salen por su borde, las tarjetas vuelan a
  // su nueva posición (escalonadas) y las que aparecen o desaparecen se funden.
  // Sin la API, o con «reducir movimiento», el cambio es instantáneo.

  /** Da un nombre de transición a cada tarjeta visible (hasta VT_MAX_CARDS). */
  function nameTransitionCards() {
    const names = [];
    const used = new Set();
    for (const card of document.querySelectorAll('#cards > .board-card, #cards > .card, #folder-grid > .folder-tile')) {
      card.style.viewTransitionName = '';
      const id = card.dataset.folderId || card.dataset.id;
      if (!id || names.length >= VT_MAX_CARDS) continue;
      const r = card.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
      // El mismo id en una baldosa de carpeta y en una tarjeta del tablero: una se transforma en la otra.
      const name = `bd-c-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
      if (used.has(name)) continue;
      used.add(name);
      names.push(name);
      card.style.viewTransitionName = name;
    }
    return names;
  }

  /** Retrasos escalonados y animaciones de entrada y salida para cada tarjeta. */
  function writeTransitionStyle(before, after) {
    const had = new Set(before);
    const has = new Set(after);
    const rules = [];
    after.forEach((name, i) => {
      const delay = Math.min(i * 22, 320);
      rules.push(`::view-transition-group(${name}) { animation-delay: ${delay}ms; }`);
      if (!had.has(name))
        rules.push(`::view-transition-new(${name}) { animation: bd-vt-card-in 0.5s var(--vt-ease) ${delay}ms both; }`);
    });
    for (const name of before) {
      if (!has.has(name)) rules.push(`::view-transition-old(${name}) { animation: bd-vt-card-out 0.28s ease both; }`);
    }
    let style = $('#vt-style');
    if (!style) {
      style = el('style', { id: 'vt-style' });
      document.head.append(style);
    }
    style.textContent = rules.join('\n');
  }

  function animateMinimalSwitch(update) {
    if (
      !state.ready ||
      state.vtActive ||
      typeof document.startViewTransition !== 'function' ||
      REDUCED_MOTION.matches
    ) {
      update();
      return;
    }
    const root = document.documentElement;
    root.classList.add('vt-minimal'); // nombra paneles, cabecera y botón de salida (ver CSS)
    const before = nameTransitionCards();
    state.vtActive = true;
    const finish = () => {
      root.classList.remove('vt-minimal');
      for (const node of document.querySelectorAll('#cards > *, #folder-grid > *')) node.style.viewTransitionName = '';
      $('#vt-style')?.remove();
      state.vtActive = false;
      if (state.renderPending) {
        state.renderPending = false;
        scheduleRender();
      }
    };
    let transition;
    try {
      transition = document.startViewTransition(() => {
        update();
        render(); // el estado nuevo tiene que estar en el DOM al terminar esta función
        writeTransitionStyle(before, nameTransitionCards());
      });
    } catch {
      finish();
      update();
      return;
    }
    transition.ready.catch(() => {}); // si se omite, el cambio ya está aplicado igualmente
    transition.finished.finally(finish);
  }

  function enterMinimal() {
    closeMenu();
    if ($('#settings-dialog').open) $('#settings-dialog').close();
    // Se entra mostrando la carpeta (o vista) en la que se estaba, no la de inicio.
    const from = state.ready ? state.selected : null;
    animateMinimalSwitch(() => {
      setPref('minimal', true);
      if (from && from !== homeId() && isShowable(from)) setHomeNav(from);
      $('#content').scrollTop = 0;
    });
    toast(t('toast.minimalOn'));
  }

  function exitMinimal() {
    // Al salir, el panel normal se queda en lo que se estaba viendo.
    const at = state.ready ? minimalSelection() : null;
    animateMinimalSwitch(() => {
      if (state.forceHome) {
        state.forceHome = false;
        const url = new URL(location.href);
        url.searchParams.delete('home');
        history.replaceState(history.state, '', url);
      }
      if (state.prefs.minimal) setPref('minimal', false);
      else {
        applyMinimal();
        scheduleRender();
      }
      if (at && at !== state.selected) selectView(at);
      $('#content').scrollTop = 0;
    });
  }

  /** Casa de la cabecera: marca lo que se ve como página de inicio (o indica que ya lo es). */
  function renderHomeSetBtn(view) {
    const btn = $('#home-set-btn');
    btn.hidden = view.kind === 'search';
    if (btn.hidden) return;
    const isHome = view.key === homeId();
    const label = t(isHome ? 'home.isHere' : 'home.setHere', { name: view.title });
    btn.setAttribute('aria-pressed', String(isHome));
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  /** Lo que muestra ahora el panel (carpeta o vista), o null en una búsqueda. */
  function currentShown() {
    if (isMinimal()) return minimalSelection();
    return state.query ? null : state.selected;
  }

  function setHomeHere() {
    const id = currentShown();
    if (!id || !isShowable(id)) return;
    if (id === homeId()) toast(t('home.isHere', { name: selectionTitle(id) }));
    else setHomeFolder(id);
  }

  /** Menú contextual de las vistas de la barra lateral (Todos, Destacados, Recientes, Tira). */
  function viewMenu(id) {
    return [
      { label: t('menu.open'), icon: VIEWS[id].icon, run: () => selectView(id) },
      homeId() !== id && { label: t('menu.setHome'), icon: 'home', run: () => setHomeFolder(id) },
      id === VIEW_STRIP && { label: t('strip.pick'), icon: 'folder-plus', run: revealTreePicker },
    ];
  }

  function setHomeFolder(id) {
    setPref('homeFolder', id);
    toast(t('toast.homeSet', { name: selectionTitle(id) }));
  }

  /** Lista de la carpeta de inicio en Ajustes: vistas y todas las carpetas. */
  function fillHomeSelect() {
    const select = $('#opt-home');
    fillFolderSelect(select, homeId());
    select.prepend(...Object.keys(VIEWS).map((id) => el('option', { value: id, text: t(VIEWS[id].label) })));
    select.value = homeId();
  }

  const homeUrl = () => api.runtime.getURL('dashboard.html?home');

  async function copyHomeUrl() {
    try {
      await navigator.clipboard.writeText(homeUrl());
      toast(t('toast.homeUrlCopied'));
    } catch {
      toast(t('toast.copyError'), 'error');
    }
  }

  /** Barra «Volver a …» cuando se abre una subcarpeta dentro del modo minimalista. */
  function renderHomeBar(view) {
    const bar = $('#home-bar');
    const away = isMinimal() && view.kind !== 'search' && minimalSelection() !== homeId();
    bar.hidden = !away;
    if (!away) return;
    $('#home-back-label').textContent = t('home.back', { name: selectionTitle(homeId()) });
    $('#home-here').textContent = view.title;
  }

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(state.prefs.theme) + 1) % THEMES.length];
    setPref('theme', next);
  }

  function syncControls() {
    $('#sort').value = state.prefs.sort;
    for (const btn of document.querySelectorAll('[data-view-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.viewMode === state.prefs.view));
    }
    $('#subfolders-toggle').checked = state.prefs.includeSubfolders;
    const form = $('#settings-form');
    for (const radio of form.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === state.prefs.theme;
    for (const radio of form.querySelectorAll('input[name="lang"]')) radio.checked = radio.value === state.prefs.lang;
    for (const radio of form.querySelectorAll('input[name="corners"]'))
      radio.checked = radio.value === state.prefs.corners;
    for (const radio of form.querySelectorAll('input[name="accent-color"]'))
      radio.checked = radio.value === state.prefs.accentColor;
    for (const radio of form.querySelectorAll('input[name="folder-color"]'))
      radio.checked = radio.value === state.prefs.folderColor;
    $('#opt-newtab').checked = state.prefs.openInNewTab;
    $('#opt-subfolders').checked = state.prefs.includeSubfolders;
    $('#opt-favicons').checked = state.prefs.showFavicons;
    $('#opt-tab-folder').checked = state.prefs.tabTitleFolder;
    // No se toca el campo mientras se escribe en él (se perderían los espacios finales).
    const tabTitleInput = $('#opt-tab-title');
    if (document.activeElement !== tabTitleInput) tabTitleInput.value = state.prefs.tabTitle;
    $('#opt-stripe').checked = state.prefs.stripe;
    for (const radio of form.querySelectorAll('input[name="board-cols"]'))
      radio.checked = radio.value === String(state.prefs.boardColumns);
    for (const radio of form.querySelectorAll('input[name="content-width"]'))
      radio.checked = radio.value === state.prefs.contentWidth;
    for (const radio of form.querySelectorAll('input[name="stripe-color"]'))
      radio.checked = radio.value === state.prefs.stripeColor;
    // «Ninguno» (0) equivale al interruptor apagado; el grosor elegido se conserva.
    const width = state.prefs.stripe ? state.prefs.stripeWidth : 0;
    for (const radio of form.querySelectorAll('input[name="stripe-width"]'))
      radio.checked = Number(radio.value) === width;
  }

  /** Grosor de la franja: 0 («Ninguno») la oculta; cualquier otro la muestra con ese grosor. */
  function setStripeWidth(width) {
    if (width === 0) {
      setPref('stripe', false);
      return;
    }
    if (!STRIPE_WIDTHS.includes(width)) return;
    state.prefs.stripe = true;
    state.prefs.stripeWidth = width;
    savePrefs({ stripe: true, stripeWidth: width });
    applyStripe();
    syncControls();
  }

  /** Muestras de color de Ajustes → Apariencia. Los textos se traducen con translateStatic. */
  function buildSwatches(container, name, colors) {
    container.replaceChildren(
      ...colors.map((c) => {
        const key = c === 'auto' ? 'stripe.auto' : `color.${c}`;
        return el(
          'label',
          { class: 'swatch', title: t(key), dataset: { color: c, i18nAttr: `title:${key}` } },
          el('input', {
            type: 'radio',
            name,
            value: c,
            'aria-label': t(key),
            dataset: { i18nAttr: `aria-label:${key}` },
          }),
          el('span', { class: 'swatch-dot' }, icon('check')),
        );
      }),
    );
  }

  /** Pestañas de Ajustes (patrón ARIA tabs: flechas, Inicio y Fin). */
  function showSettingsTab(name, focus = false) {
    const tab = SETTINGS_TABS.includes(name) ? name : SETTINGS_TABS[0];
    state.settingsTab = tab;
    for (const btn of document.querySelectorAll('#settings-tabs [role="tab"]')) {
      const active = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
      if (active && focus) btn.focus();
    }
    for (const panel of document.querySelectorAll('#settings-dialog .settings-panel')) {
      panel.hidden = panel.id !== `spanel-${tab}`;
    }
    $('#settings-dialog .settings-main').scrollTop = 0;
  }

  function handleSettingsTabKeys(event) {
    const i = SETTINGS_TABS.indexOf(state.settingsTab);
    const last = SETTINGS_TABS.length - 1;
    const next = {
      ArrowDown: i + 1,
      ArrowRight: i + 1,
      ArrowUp: i - 1,
      ArrowLeft: i - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showSettingsTab(SETTINGS_TABS[(next + SETTINGS_TABS.length) % SETTINGS_TABS.length], true);
  }

  // ---------------------------------------------------------------------------
  // Selección, búsqueda y orden
  // ---------------------------------------------------------------------------

  function resolveSelection(id) {
    if (isView(id)) return id;
    const n = get(id);
    return isFolder(n) && n.id !== state.rootId ? n.id : VIEW_ALL;
  }

  function validateSelection() {
    const resolved = resolveSelection(state.selected);
    if (resolved !== state.selected) {
      state.selected = resolved;
      persistSelection();
    }
  }

  function expandAncestors(id) {
    let changed = false;
    for (const a of ancestors(id)) {
      if (!state.expanded.has(a.id)) {
        state.expanded.add(a.id);
        changed = true;
      }
    }
    if (changed) saveExpanded();
    return changed;
  }

  function selectView(id) {
    if (!state.ready) return;
    clearSelection();
    const target = resolveSelection(id);
    if (isMinimal()) {
      // Dentro del modo minimalista se navega sin tocar la carpeta del panel normal.
      setHomeNav(target !== homeId() && isShowable(target) ? target : null);
      state.limit = PAGE_SIZE;
      renderMain();
      $('#content').scrollTop = 0;
      return;
    }
    if (state.query) {
      $('#search').value = '';
      applyQuery('', false);
    }
    state.selected = target;
    state.limit = PAGE_SIZE;
    persistSelection();
    closeDrawer();
    if (expandAncestors(target)) renderSidebar();
    else updateSidebarSelection();
    renderMain();
    $('#content').scrollTop = 0;
    scrollSelectedIntoView();
  }

  function applyQuery(value, rerender = true) {
    if (value.trim() !== state.query) clearSelection();
    state.query = value.trim();
    state.terms = fold(state.query).split(/\s+/).filter(Boolean);
    state.limit = PAGE_SIZE;
    if (rerender && state.ready) {
      updateSidebarSelection();
      renderMain();
      $('#content').scrollTop = 0;
    }
  }

  function clearSearch() {
    $('#search').value = '';
    applyQuery('');
  }

  function searchText(n) {
    let s = state.searchCache.get(n.id);
    if (s === undefined) {
      s = fold(`${n.title}\n${n.url}\n${pathText(n.id)}`);
      state.searchCache.set(n.id, s);
    }
    return s;
  }

  const matchesBookmark = (n) => {
    const hay = searchText(n);
    return state.terms.every((term) => hay.includes(term));
  };
  const matchesFolder = (f) => {
    const hay = fold(folderName(f));
    return state.terms.every((term) => hay.includes(term));
  };

  function sortNodes(list, nameFn) {
    switch (state.prefs.sort) {
      case 'name-asc':
        return list.toSorted((a, b) => collator.compare(nameFn(a), nameFn(b)));
      case 'name-desc':
        return list.toSorted((a, b) => collator.compare(nameFn(b), nameFn(a)));
      case 'date-desc':
        return list.toSorted((a, b) => b.dateAdded - a.dateAdded);
      case 'date-asc':
        return list.toSorted((a, b) => a.dateAdded - b.dateAdded);
      default:
        return list; // orden original de Firefox
    }
  }

  /** Resalta los términos buscados sin usar HTML (nodos de texto + <mark>). */
  function highlight(text) {
    const terms = state.terms;
    if (!terms.length || !text) return document.createTextNode(text);
    let folded = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i]);
      for (let j = 0; j < f.length; j++) map.push(i);
      folded += f;
    }
    const ranges = [];
    for (const term of terms) {
      let from = 0;
      let idx;
      while ((idx = folded.indexOf(term, from)) !== -1) {
        ranges.push([map[idx], map[idx + term.length - 1] + 1]);
        from = idx + term.length;
      }
    }
    if (!ranges.length) return document.createTextNode(text);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of merged) {
      if (s > pos) frag.append(text.slice(pos, s));
      frag.append(el('mark', { text: text.slice(s, e) }));
      pos = e;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    return frag;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function scheduleRender() {
    if (state.vtActive) {
      state.renderPending = true;
      return;
    }
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      if (state.vtActive) state.renderPending = true;
      else render();
    });
  }

  function render() {
    if (!state.ready) return;
    buildGroupIndex();
    renderSidebar();
    renderMain();
    renderGroups();
  }

  // ----- Sidebar -----

  function renderSidebar() {
    const counts = getCounts();
    const root = get(state.rootId);
    const total = counts.get(state.rootId) || 0;

    $('#count-all').textContent = numberFmt.format(total);
    $('#count-favorites').textContent = numberFmt.format(countFavorites());
    $('#count-strip').textContent = numberFmt.format(stripFolderNodes().length);

    const tree = $('#tree');
    state.treePicking = stripPicking();
    tree.classList.toggle('is-picking', state.treePicking);
    const hint = $('#tree-pick-hint');
    hint.hidden = !state.treePicking;
    if (state.treePicking) $('#tree-pick-count').textContent = tn('strip.selected', stripFolderNodes().length);
    const active = document.activeElement;
    const focusedId = tree.contains(active) ? active.closest('.tree-row')?.dataset.id : null;

    const frag = document.createDocumentFragment();
    for (const id of root?.children || []) {
      const f = get(id);
      if (!isFolder(f)) continue;
      if (id === MOBILE_ID && f.children.length === 0) continue; // oculta "móvil" si está vacía
      frag.append(treeItem(f, 0, counts));
    }
    tree.replaceChildren(frag);
    if (!tree.children.length) tree.append(el('li', { class: 'tree-empty', text: t('tree.empty') }));

    updateSidebarSelection();
    if (focusedId) {
      tree.querySelector(`.tree-row[data-id="${CSS.escape(focusedId)}"] .tree-label`)?.focus({ preventScroll: true });
    }

    $('#stats').textContent = `${tn('n.bookmark', total)} · ${tn('n.folder', userFolderCount())}`;
  }

  function treeItem(folder, depth, counts) {
    const subfolders = folder.children.map(get).filter(isFolder);
    const expanded = state.expanded.has(folder.id);
    const builtin = isBuiltin(folder.id);
    const li = el('li', { class: 'tree-item' });

    const row = el('div', {
      class: 'tree-row',
      draggable: builtin ? null : 'true',
      dataset: { id: folder.id, dropId: folder.id, dragId: builtin ? null : folder.id },
    });
    row.style.setProperty('--depth', depth);
    paintFolder(row, folder.id);

    const toggle = subfolders.length
      ? el(
          'button',
          {
            class: 'tree-toggle',
            type: 'button',
            tabindex: '-1',
            'aria-expanded': String(expanded),
            'aria-label': t(expanded ? 'tree.collapse' : 'tree.expand'),
            dataset: { action: 'toggle' },
          },
          icon('chevron'),
        )
      : el('span', { class: 'tree-spacer' });

    const picked = state.treePicking && inStrip(folder.id);
    row.classList.toggle('is-in-strip', picked);
    const label = el(
      'button',
      {
        class: 'tree-label',
        type: 'button',
        title: state.treePicking
          ? `${folderName(folder)} — ${t(picked ? 'menu.stripRemove' : 'menu.stripAdd')}`
          : folderName(folder),
        role: state.treePicking ? 'checkbox' : null,
        'aria-checked': state.treePicking ? String(picked) : null,
        dataset: { action: 'select' },
      },
      state.treePicking ? el('span', { class: 'tree-check', 'aria-hidden': 'true' }, icon('check')) : null,
      icon(folderIcon(folder)),
      el('span', { class: 'tree-name', text: folderName(folder) }),
      el('span', { class: 'count', text: numberFmt.format(counts.get(folder.id) || 0) }),
    );

    row.append(toggle, label);
    li.append(row);

    if (subfolders.length) {
      li.classList.toggle('is-expanded', expanded);
      const group = el('ul', { class: 'tree-group' });
      for (const sub of subfolders) group.append(treeItem(sub, depth + 1, counts));
      li.append(el('div', { class: 'tree-collapse' }, group));
    }
    return li;
  }

  function updateSidebarSelection() {
    // Entrar o salir de la tira cambia el árbol (casillas de selección).
    if (state.ready && state.treePicking !== stripPicking()) {
      renderSidebar();
      return;
    }
    const sel = state.query ? null : state.selected;
    for (const btn of document.querySelectorAll('#views .nav-item')) {
      const on = btn.dataset.view === sel;
      btn.classList.toggle('is-selected', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    for (const row of document.querySelectorAll('#tree .tree-row.is-selected')) {
      row.classList.remove('is-selected');
      row.querySelector('.tree-label')?.removeAttribute('aria-current');
    }
    if (sel && !isView(sel)) {
      const row = $(`#tree .tree-row[data-id="${CSS.escape(sel)}"]`);
      row?.classList.add('is-selected');
      row?.querySelector('.tree-label')?.setAttribute('aria-current', 'page');
    }
  }

  function scrollSelectedIntoView() {
    $('#tree .tree-row.is-selected')?.scrollIntoView({ block: 'nearest' });
  }

  function toggleExpanded(id, force) {
    const expand = force ?? !state.expanded.has(id);
    if (expand) state.expanded.add(id);
    else state.expanded.delete(id);
    const row = $(`#tree .tree-row[data-id="${CSS.escape(id)}"]`);
    const li = row?.parentElement;
    li?.classList.toggle('is-expanded', expand);
    const btn = row?.querySelector('.tree-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', String(expand));
      btn.setAttribute('aria-label', t(expand ? 'tree.collapse' : 'tree.expand'));
    }
    saveExpanded();
  }

  // ----- Contenido principal -----

  function computeView() {
    const sel = isMinimal() ? minimalSelection() : state.selected;
    const root = state.rootId;

    if (state.query && !isMinimal()) {
      const items = collectBookmarks(root).filter(matchesBookmark);
      const folders = collectFolders(root).filter((f) => !isBuiltin(f.id) && matchesFolder(f));
      return {
        kind: 'search',
        key: 'search',
        title: t('search.title'),
        icon: 'search',
        items: sortNodes(items, bookmarkTitle),
        folders: sortNodes(folders, folderName),
        showPath: true,
      };
    }

    if (sel === VIEW_ALL) {
      return {
        kind: 'view',
        key: sel,
        title: t(VIEWS[sel].label),
        icon: VIEWS[sel].icon,
        items: sortNodes(collectBookmarks(root), bookmarkTitle),
        folders: [],
        showPath: true,
      };
    }
    if (sel === VIEW_FAVORITES) {
      const items = collectBookmarks(root).filter((n) => state.favorites.has(n.id));
      return {
        kind: 'view',
        key: sel,
        title: t(VIEWS[sel].label),
        icon: VIEWS[sel].icon,
        items: sortNodes(items, bookmarkTitle),
        folders: [],
        showPath: true,
      };
    }
    if (sel === VIEW_RECENT) {
      const items = collectBookmarks(root)
        .toSorted((a, b) => b.dateAdded - a.dateAdded)
        .slice(0, RECENT_LIMIT);
      return {
        kind: 'view',
        key: sel,
        title: t(VIEWS[sel].label),
        icon: VIEWS[sel].icon,
        items,
        folders: [],
        showPath: true,
        fixedOrder: true,
      };
    }

    if (sel === VIEW_STRIP) {
      const folders = stripFolderNodes();
      return {
        kind: 'strip',
        key: sel,
        title: t(VIEWS[sel].label),
        icon: VIEWS[sel].icon,
        items: folders.flatMap((f) => directBookmarks(f)),
        folders,
        showPath: false,
      };
    }

    const folder = get(sel);
    const children = folder.children.map(get);
    const folders = children.filter(isFolder);
    const direct = children.filter(isBookmark);
    const items = sortNodes(state.prefs.includeSubfolders ? collectBookmarks(folder.id) : direct, bookmarkTitle);
    // Separadores de Firefox: solo en la vista de lista, con el orden original
    // y sin mezclar subcarpetas (fuera de ese contexto no tienen sentido).
    const showSeparators = viewMode() === 'list' && state.prefs.sort === 'manual' && !state.prefs.includeSubfolders;
    return {
      kind: 'folder',
      key: folder.id,
      folder,
      title: folderName(folder),
      icon: folderIcon(folder),
      items,
      rows: showSeparators ? withSeparators(children) : items,
      folders: sortNodes(folders, folderName),
      showPath: state.prefs.includeSubfolders,
      directCount: direct.length,
    };
  }

  /** Marcadores directos con sus separadores (sin separadores al principio, al final ni seguidos). */
  function withSeparators(children, keep = isBookmark) {
    const rows = [];
    for (const c of children) {
      if (keep(c)) rows.push(c);
      else if (isSeparator(c) && rows.length && !isSeparator(rows[rows.length - 1])) rows.push(c);
    }
    while (rows.length && isSeparator(rows[rows.length - 1])) rows.pop();
    return rows;
  }

  function subtitleFor(view) {
    if (view.kind === 'search') {
      const parts = [tn('n.found', view.items.length)];
      if (view.folders.length) parts.push(tn('n.folder', view.folders.length));
      return t('search.subtitle', { parts: parts.join(' · '), q: state.query });
    }
    if (view.key === VIEW_ALL) {
      return t('all.subtitle', {
        bookmarks: tn('n.bookmark', view.items.length),
        folders: tn('n.folder', userFolderCount()),
      });
    }
    if (view.key === VIEW_FAVORITES) return t('favorites.subtitle', { count: tn('n.starred', view.items.length) });
    if (view.key === VIEW_RECENT) return t('recent.subtitle', { n: numberFmt.format(RECENT_LIMIT) });
    if (view.kind === 'strip') {
      if (!view.folders.length) return t('strip.subtitleEmpty');
      return `${tn('n.folder', view.folders.length)} · ${tn('n.bookmark', view.items.length)}`;
    }
    const total = getCounts().get(view.folder.id) || 0;
    const parts = [tn('n.bookmark', total)];
    if (view.folders.length) parts.push(tn('n.subfolder', view.folders.length));
    if (total !== view.directCount && !state.prefs.includeSubfolders)
      parts.push(t('folder.atThisLevel', { n: numberFmt.format(view.directCount) }));
    return parts.join(' · ');
  }

  function renderHeader(view) {
    const crumbs = $('#breadcrumb');
    if (view.kind === 'folder') {
      const parts = ancestors(view.folder.id);
      crumbs.replaceChildren(
        ...parts.flatMap((p) => [
          el(
            'button',
            { class: 'crumb', type: 'button', title: folderName(p), dataset: { action: 'crumb', target: p.id } },
            folderName(p),
          ),
          icon('chevron', 'crumb-sep'),
        ]),
      );
      crumbs.hidden = parts.length === 0;
    } else {
      crumbs.replaceChildren();
      crumbs.hidden = true;
    }

    const viewIcon = $('#view-icon');
    viewIcon.replaceChildren(icon(view.icon));
    viewIcon.classList.toggle('is-folder', view.kind === 'folder');
    paintFolder(viewIcon, view.kind === 'folder' ? view.folder.id : null);
    $('#view-title').textContent = view.title;
    $('#view-subtitle').textContent = subtitleFor(view);

    $('#sort').disabled = !!view.fixedOrder;
    $('#subfolders-chip').hidden = view.kind !== 'folder';
    $('#strip-pick-btn').hidden = view.kind !== 'strip';
    renderStripExpandBtn(view.kind);
    renderHomeSetBtn(view);
    $('#view-modes').hidden = view.kind === 'strip';
    $('#open-all-btn').hidden = !view.items.some((n) => isOpenable(n.url));
    $('#controls').hidden = false;
    document.title = docTitle(view);
  }

  function renderMain() {
    if (!state.ready) return;
    $('#skeleton').hidden = true;
    const view = computeView();
    renderHeader(view);

    $('#content').dataset.dropId = view.kind === 'folder' ? view.folder.id : '';
    // Reordenar arrastrando solo tiene sentido si se ve el orden real de Firefox.
    state.reorderable = (view.kind === 'folder' || view.kind === 'strip') && state.prefs.sort === 'manual';
    state.viewFolderId = view.kind === 'folder' ? view.folder.id : null;
    state.viewItemIds = view.items.map((n) => n.id);
    state.viewKind = view.kind;

    // La tira siempre usa las tarjetas del tablero, pero en una sola fila.
    const strip = view.kind === 'strip';
    const board = strip || viewMode() === 'board';
    $('#content').classList.toggle('is-strip-view', strip);
    renderHomeBar(view);
    renderStripProfiles(view.kind);

    // Carpetas (en el tablero cada carpeta es una tarjeta propia)
    const folderGrid = $('#folder-grid');
    $('#folders-section').hidden = board || view.folders.length === 0;
    $('#folders-count').textContent = numberFmt.format(view.folders.length);
    folderGrid.replaceChildren(...(board ? [] : view.folders.map((f) => folderTile(f, view))));

    const cards = $('#cards');
    const section = $('#bookmarks-section');
    cards.classList.toggle('is-list', !board && viewMode() === 'list');
    cards.classList.toggle('is-board', board && !strip);
    cards.classList.toggle('is-strip', strip);
    section.classList.toggle('is-board-section', board);
    let remaining;

    if (board) {
      const sections = boardSections(view);
      const shown = sections.slice(0, Math.ceil(state.limit / PAGE_SIZE) * BOARD_PAGE);
      section.hidden = sections.length === 0;
      $('#bookmarks-count').textContent = numberFmt.format(view.items.length);
      state.cardEls.clear();
      const seen = new Set();
      // Cada tarjeta de la tira tiene su propio scroll vertical: se conserva al repintar.
      const scrolls = new Map();
      if (strip) {
        for (const card of cards.querySelectorAll(':scope > .board-card')) {
          const top = card.querySelector('.board-inner')?.scrollTop;
          if (top) scrolls.set(card.dataset.folderId, top);
        }
      }
      const cardEls = shown.map((s) => boardCard(s, view, seen));
      // Al final de la tira, un hueco para añadir (o soltar) carpetas.
      if (strip && shown.length === sections.length) cardEls.push(stripAddTile());
      cards.replaceChildren(...cardEls);
      for (const card of cardEls) {
        const top = scrolls.get(card.dataset.folderId);
        if (top) card.querySelector('.board-inner').scrollTop = top;
      }
      requestAnimationFrame(updateStripEdges);
      for (const id of state.rowEls.keys()) if (!seen.has(id)) state.rowEls.delete(id);
      remaining = sections.length - shown.length;
    } else {
      // Marcadores (y separadores, si la vista los incluye)
      const rows = view.rows || view.items;
      const visible = rows.slice(0, state.limit);
      section.hidden = view.items.length === 0;
      $('#bookmarks-count').textContent = numberFmt.format(view.items.length);
      state.rowEls.clear();
      reconcileCards(cards, visible, view);
      updateStripEdges();
      remaining = view.items.length - visible.filter(isBookmark).length;
    }

    // Paginación incremental
    const more = $('#load-more');
    loadMoreObserver.unobserve(more);
    more.hidden = remaining <= 0;
    if (remaining > 0) {
      more.textContent = t('loadMore.remaining', { n: numberFmt.format(remaining) });
      loadMoreObserver.observe(more);
    }

    // Animación al cambiar de vista
    const viewKey = `${view.key}|${viewMode()}`;
    if (viewKey !== state.lastViewKey) {
      state.lastViewKey = viewKey;
      // Durante la transición animada las tarjetas ya se mueven solas.
      if (!state.vtActive) {
        animateEntering(folderGrid);
        animateEntering(cards);
      }
    }

    renderEmpty(view);
    syncSelection();
    state.newIds.clear();
  }

  // ----- Vista de tablero: una tarjeta por carpeta con sus enlaces debajo -----

  /** Filas de una carpeta: marcadores directos (con separadores si el orden es el original). */
  function boardRowsOf(folder) {
    const children = folder.children.map(get);
    if (state.prefs.sort === 'manual') return withSeparators(children);
    return sortNodes(children.filter(isBookmark), bookmarkTitle);
  }

  /**
   * Subcarpetas de la tira. En orden manual van en el orden de Firefox y con los
   * separadores que hay entre ellas; si no, por nombre y sin separadores.
   */
  function stripSubsOf(folder) {
    const children = folder.children.map(get);
    if (state.prefs.sort === 'manual') return withSeparators(children, isFolder);
    return sortNodes(children.filter(isFolder), folderName);
  }

  function boardSections(view) {
    if (view.kind === 'strip') {
      return view.folders.map((f) => ({
        folder: f,
        rows: boardRowsOf(f),
        subfolders: stripSubsOf(f),
      }));
    }
    if (view.kind === 'folder') {
      const self = view.folder;
      const sections = [];
      const own = boardRowsOf(self);
      if (own.length) sections.push({ folder: self, rows: own, subfolders: [] });
      const folders = state.prefs.includeSubfolders ? sortNodes(collectFolders(self.id), folderName) : view.folders;
      for (const f of folders) {
        sections.push({
          folder: f,
          rows: boardRowsOf(f),
          // Las sub-subcarpetas se muestran como accesos dentro de la tarjeta.
          subfolders: state.prefs.includeSubfolders ? [] : f.children.map(get).filter(isFolder),
        });
      }
      return sections;
    }

    // Todos, destacados, recientes y búsqueda: los marcadores agrupados por carpeta.
    const byParent = new Map();
    for (const n of view.items) {
      if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
      byParent.get(n.parentId).push(n);
    }
    const sections = [];
    for (const [pid, rows] of byParent) {
      const folder = get(pid);
      if (isFolder(folder)) sections.push({ folder, rows, subfolders: [], showPath: true });
    }
    if (view.kind === 'search') {
      for (const f of view.folders) {
        if (!byParent.has(f.id)) sections.push({ folder: f, rows: boardRowsOf(f), subfolders: [], showPath: true });
      }
    }
    return sections;
  }

  /** Enlace de un marcador: abre http(s); el resto copia la URL (Firefox no deja abrirlos). */
  function bookmarkLink(n, className, title) {
    const openable = isOpenable(n.url);
    const link = el(
      'a',
      {
        class: openable ? className : `${className} is-blocked`,
        draggable: 'false',
        title: n.url ? `${title}\n${n.url}` : title,
      },
      highlight(title),
    );
    if (openable) {
      link.href = n.url;
      link.referrerPolicy = 'no-referrer';
      if (state.prefs.openInNewTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      link.href = '#';
      link.dataset.action = 'open-blocked';
    }
    return link;
  }

  function groupDots(n) {
    const groups = state.groupIndex.get(n.id);
    if (!groups?.length) return null;
    return el(
      'span',
      { class: 'card-groups', title: t('card.groups', { names: groups.map((g) => g.name).join(', ') }) },
      ...groups.slice(0, 6).map((g) => el('span', { class: 'group-dot', dataset: { color: g.color } })),
    );
  }

  /** Fila reutilizable por id (como las tarjetas): un cambio no recarga los favicons. */
  function boardRowEl(n) {
    if (isSeparator(n))
      return paintSeparator(
        el('li', {
          class: 'board-sep',
          role: 'separator',
          'aria-label': t('separator.label'),
          dataset: { id: n.id },
        }),
        n.id,
      );
    const groups = state.groupIndex.get(n.id) || [];
    const sig = [
      n.title,
      n.url,
      state.terms.join(' '),
      state.prefs.openInNewTab,
      state.prefs.showFavicons,
      lang,
      groups.map((g) => `${g.id}:${g.color}:${g.name}`).join(','),
    ].join('\u0001');
    let li = state.rowEls.get(n.id);
    if (li && li._sig === sig) return li;
    if (!li) {
      li = el('li', { class: 'board-row', draggable: 'true', dataset: { id: n.id, dragId: n.id } });
      state.rowEls.set(n.id, li);
    }
    li._sig = sig;
    const title = bookmarkTitle(n);
    const parts = [
      selectButton(title),
      faviconEl(n, title),
      bookmarkLink(n, 'board-link', title),
      groupDots(n),
      el(
        'button',
        {
          class: 'icon-btn icon-btn-sm',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'more' },
        },
        icon('more'),
      ),
    ];
    li.replaceChildren(...parts.filter(Boolean));
    if (state.newIds.has(n.id)) markNew(li);
    return li;
  }

  function boardCard(s, view, seen) {
    const f = s.folder;
    const bookmarks = s.rows.filter(isBookmark);
    const collapsed = view.kind !== 'search' && state.boardCollapsed.has(f.id);
    const showAll = state.boardShowAll.has(f.id);

    // Recorta a BOARD_ROWS enlaces (sin dejar un separador colgando al final).
    const rows = [];
    let count = 0;
    for (const row of s.rows) {
      if (isBookmark(row)) {
        if (!showAll && count >= BOARD_ROWS) break;
        count++;
      }
      rows.push(row);
    }
    while (rows.length && isSeparator(rows[rows.length - 1])) rows.pop();
    const hidden = bookmarks.length - count;

    const name = folderName(f);
    const path = s.showPath ? pathText(f.id) : '';
    // La cabecera arrastra la carpeta entera (para reordenarla o moverla a otra).
    // En la tira también las carpetas raíz: ahí solo se cambia su sitio en la tira.
    const movable = !isBuiltin(f.id) || view.kind === 'strip';
    // En la tira, cada columna con subcarpetas tiene su «Expandir / Contraer todo».
    let expandAll = null;
    if (view.kind === 'strip' && stripSubfolderIds([f]).length) {
      expandAll = el(
        'button',
        {
          class: 'icon-btn icon-btn-sm strip-card-expand',
          type: 'button',
          dataset: { action: 'strip-card-expand', target: f.id },
        },
        icon('expand-all'),
      );
      paintStripCardExpand(expandAll, stripCardExpanded(f.id));
    }
    const head = el(
      'div',
      {
        class: 'board-head',
        draggable: movable ? 'true' : null,
        dataset: { id: f.id, dragId: movable ? f.id : null },
      },
      el(
        'button',
        {
          class: 'board-toggle',
          type: 'button',
          'aria-expanded': String(!collapsed),
          title: t(collapsed ? 'board.expand' : 'board.collapse'),
          'aria-label': t(collapsed ? 'board.expand' : 'board.collapse'),
          dataset: { action: 'board-toggle' },
        },
        icon('chevron', 'group-chevron'),
      ),
      el(
        'button',
        { class: 'board-title', type: 'button', title: t('folder.open', { name }), dataset: { action: 'open-folder' } },
        el('span', { class: 'board-icon' }, icon(folderIcon(f))),
        el(
          'span',
          { class: 'board-name-wrap' },
          el('span', { class: 'board-name' }, highlight(name)),
          path ? el('span', { class: 'board-path', text: path }) : null,
        ),
      ),
      el('span', { class: 'board-count', text: numberFmt.format(bookmarks.length) }),
      expandAll,
      el(
        'button',
        {
          class: 'icon-btn icon-btn-sm',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'folder-more' },
        },
        icon('more'),
      ),
    );

    const inner = el('div', { class: 'board-inner' });
    if (rows.length) {
      inner.append(
        el(
          'ul',
          { class: 'board-rows' },
          ...rows.map((row) => {
            seen.add(row.id);
            return boardRowEl(row);
          }),
        ),
      );
    }
    if (hidden > 0 || (showAll && bookmarks.length > BOARD_ROWS)) {
      inner.append(
        el(
          'button',
          { class: 'board-more-rows', type: 'button', dataset: { action: 'board-rows', target: f.id } },
          showAll ? t('board.showLess') : tn('board.showMore', hidden),
        ),
      );
    }
    if (s.subfolders.length && view.kind === 'strip') {
      inner.append(stripSubList(s.subfolders, seen));
    } else if (s.subfolders.length) {
      inner.append(
        el(
          'div',
          { class: 'board-subs' },
          ...s.subfolders.map((sub) =>
            paintFolder(
              el(
                'button',
                {
                  class: 'board-sub',
                  type: 'button',
                  title: t('folder.open', { name: folderName(sub) }),
                  dataset: { action: 'goto', target: sub.id },
                },
                icon(folderIcon(sub)),
                el('span', { class: 'board-sub-name', text: folderName(sub) }),
                el('span', { class: 'board-sub-count', text: numberFmt.format(getCounts().get(sub.id) || 0) }),
              ),
              sub.id,
            ),
          ),
        ),
      );
    }
    if (!rows.length && !s.subfolders.length) inner.append(el('p', { class: 'board-empty', text: t('board.empty') }));

    const card = el(
      'article',
      { class: collapsed ? 'board-card is-collapsed' : 'board-card', dataset: { dropId: f.id, folderId: f.id } },
      head,
      el('div', { class: 'board-body' }, inner),
    );
    paintFolder(card, f.id);
    if (state.newIds.has(f.id)) markNew(card);
    return card;
  }

  // ----- Tira: subcarpetas desplegables dentro de cada tarjeta -----
  // En vez de accesos sueltos, las subcarpetas forman un árbol: al desplegar una
  // se ven sus enlaces (y sus propias subcarpetas) sin salir de la tira.

  const saveStripOpen = debounce(() => savePrefs({ stripOpen: [...state.stripOpen] }), 300);

  /** Recorta a BOARD_ROWS enlaces (sin dejar un separador colgando al final). */
  function trimRows(all, showAll) {
    const rows = [];
    let count = 0;
    for (const row of all) {
      if (isBookmark(row)) {
        if (!showAll && count >= BOARD_ROWS) break;
        count++;
      }
      rows.push(row);
    }
    while (rows.length && isSeparator(rows[rows.length - 1])) rows.pop();
    const total = all.filter(isBookmark).length;
    return { rows, hidden: total - count, total };
  }

  function stripSubList(subfolders, seen) {
    return el(
      'ul',
      { class: 'strip-subs' },
      ...subfolders.map((sub) => {
        if (!isSeparator(sub)) return stripSubItem(sub, seen);
        seen.add(sub.id);
        return boardRowEl(sub);
      }),
    );
  }

  function stripSubItem(sub, seen) {
    const open = state.stripOpen.has(sub.id);
    const name = folderName(sub);
    const movable = !isBuiltin(sub.id);
    const label = t(open ? 'board.collapse' : 'board.expand');
    const head = el(
      'div',
      {
        class: 'strip-sub-head',
        draggable: movable ? 'true' : null,
        dataset: { id: sub.id, dropId: sub.id, dragId: movable ? sub.id : null },
      },
      el(
        'button',
        {
          class: 'strip-sub-toggle',
          type: 'button',
          'aria-expanded': String(open),
          title: `${name} — ${label}`,
          dataset: { action: 'strip-sub', target: sub.id },
        },
        icon('chevron', 'strip-sub-chevron'),
        icon(folderIcon(sub), 'strip-sub-icon'),
        el('span', { class: 'strip-sub-name' }, highlight(name)),
        el('span', { class: 'strip-sub-count', text: numberFmt.format(getCounts().get(sub.id) || 0) }),
      ),
      el(
        'button',
        {
          class: 'icon-btn icon-btn-sm',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'folder-more' },
        },
        icon('more'),
      ),
    );
    const li = paintFolder(
      el('li', { class: open ? 'strip-sub is-open' : 'strip-sub', dataset: { folderId: sub.id } }, head),
      sub.id,
    );
    if (!open) return li;

    const body = el('div', { class: 'strip-sub-body' });
    const showAll = state.boardShowAll.has(sub.id);
    const { rows, hidden, total } = trimRows(boardRowsOf(sub), showAll);
    const subs = stripSubsOf(sub);
    if (rows.length) {
      body.append(
        el(
          'ul',
          { class: 'board-rows' },
          ...rows.map((row) => {
            seen.add(row.id);
            return boardRowEl(row);
          }),
        ),
      );
    }
    if (hidden > 0 || (showAll && total > BOARD_ROWS)) {
      body.append(
        el(
          'button',
          { class: 'board-more-rows', type: 'button', dataset: { action: 'board-rows', target: sub.id } },
          showAll ? t('board.showLess') : tn('board.showMore', hidden),
        ),
      );
    }
    if (subs.length) body.append(stripSubList(subs, seen));
    if (!rows.length && !subs.length) body.append(el('p', { class: 'strip-sub-empty', text: t('board.empty') }));
    li.append(body);
    return li;
  }

  /** Despliega o pliega una subcarpeta de la tira (y repinta solo esa rama). */
  function toggleStripSub(id, li) {
    if (state.stripOpen.has(id)) state.stripOpen.delete(id);
    else state.stripOpen.add(id);
    saveStripOpen();
    const sub = get(id);
    if (li && isFolder(sub)) li.replaceWith(stripSubItem(sub, new Set()));
    renderStripExpandBtn();
  }

  /** Todas las subcarpetas (a cualquier profundidad) de las tarjetas de la tira (o de `roots`). */
  function stripSubfolderIds(roots = stripFolderNodes()) {
    const ids = [];
    const walk = (folder) => {
      for (const child of folder.children.map(get)) {
        if (!isFolder(child)) continue;
        ids.push(child.id);
        walk(child);
      }
    };
    roots.forEach(walk);
    return ids;
  }

  /** ¿Está todo a la vista? Tarjetas sin plegar y cada subcarpeta desplegada. */
  function stripAllExpanded() {
    const cards = stripFolderNodes();
    if (!cards.length) return false;
    return (
      cards.every((f) => !state.boardCollapsed.has(f.id)) && stripSubfolderIds().every((id) => state.stripOpen.has(id))
    );
  }

  /**
   * «Expandir todo»: abre las tarjetas plegadas y despliega todas sus subcarpetas.
   * «Contraer todo»: pliega las subcarpetas (las tarjetas siguen abiertas).
   */
  function toggleStripExpandAll() {
    const ids = stripSubfolderIds();
    if (stripAllExpanded()) {
      ids.forEach((id) => state.stripOpen.delete(id));
    } else {
      ids.forEach((id) => state.stripOpen.add(id));
      stripFolderNodes().forEach((f) => state.boardCollapsed.delete(f.id));
      saveBoardCollapsed();
    }
    saveStripOpen();
    renderMain();
  }

  /** ¿Está toda la columna `id` de la tira a la vista? Tarjeta abierta y cada subcarpeta desplegada. */
  function stripCardExpanded(id) {
    const f = get(id);
    if (!isFolder(f) || state.boardCollapsed.has(id)) return false;
    const ids = stripSubfolderIds([f]);
    return ids.length > 0 && ids.every((sub) => state.stripOpen.has(sub));
  }

  /**
   * «Expandir / Contraer todo» de una sola columna de la tira: lo mismo que el
   * botón general, pero solo con esa tarjeta y sus subcarpetas.
   */
  function toggleStripCardExpand(id) {
    const f = get(id);
    if (!isFolder(f)) return;
    const ids = stripSubfolderIds([f]);
    if (stripCardExpanded(id)) {
      ids.forEach((sub) => state.stripOpen.delete(sub));
    } else {
      ids.forEach((sub) => state.stripOpen.add(sub));
      if (state.boardCollapsed.delete(id)) saveBoardCollapsed();
    }
    saveStripOpen();
    renderMain();
  }

  /** Icono, título y estado del botón «Expandir / Contraer todo» de una columna. */
  function paintStripCardExpand(btn, all) {
    const title = t(all ? 'strip.cardCollapseAllTitle' : 'strip.cardExpandAllTitle');
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(all));
    btn.querySelector('use')?.setAttribute('href', all ? '#i-collapse-all' : '#i-expand-all');
  }

  function renderStripExpandBtn(kind = state.viewKind) {
    // Los botones de cada columna siguen a los cambios hechos a mano (flechas, plegar).
    for (const btn of document.querySelectorAll('.strip-card-expand')) {
      paintStripCardExpand(btn, stripCardExpanded(btn.dataset.target));
    }
    // El general: en la cabecera y su copia en la barra de perfiles (la única a la
    // vista en el modo minimalista, que oculta la cabecera).
    const show = kind === 'strip' && stripFolderNodes().length > 0;
    const all = show && stripAllExpanded();
    const title = t(all ? 'strip.collapseAllTitle' : 'strip.expandAllTitle');
    for (const btn of [$('#strip-expand-btn'), $('#strip-profiles .strip-expand-tool')]) {
      if (!btn) continue;
      btn.hidden = !show;
      if (!show) continue;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.setAttribute('aria-pressed', String(all));
      btn.querySelector('use')?.setAttribute('href', all ? '#i-collapse-all' : '#i-expand-all');
      const label = btn.querySelector('.strip-expand-label');
      if (label) label.textContent = t(all ? 'strip.collapseAll' : 'strip.expandAll');
    }
  }

  const saveBoardCollapsed = debounce(() => savePrefs({ boardCollapsed: [...state.boardCollapsed] }), 300);
  // Tarjetas con «Mostrar N más» desplegado: se recuerda entre pestañas y sesiones.
  const saveBoardShowAll = debounce(() => savePrefs({ boardShowAll: [...state.boardShowAll] }), 300);

  function toggleBoardCollapsed(id, card) {
    const collapse = !state.boardCollapsed.has(id);
    if (collapse) state.boardCollapsed.add(id);
    else state.boardCollapsed.delete(id);
    // Se cambia el DOM directamente para que la animación se vea.
    card?.classList.toggle('is-collapsed', collapse);
    const btn = card?.querySelector('.board-toggle');
    if (btn) {
      const label = t(collapse ? 'board.expand' : 'board.collapse');
      btn.setAttribute('aria-expanded', String(!collapse));
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    saveBoardCollapsed();
    renderStripExpandBtn();
  }

  // ----- Tira: carpetas elegidas, una al lado de otra -----

  const saveStrip = () =>
    savePrefs({
      stripFolders: [...state.stripFolders],
      stripProfiles: serializeProfiles(),
      stripProfile: state.stripProfile,
    });
  const inStrip = (id) => state.stripFolders.includes(id);

  /** Carpetas de la tira que aún existen, en su orden. */
  function stripFolderNodes() {
    return state.stripFolders.map(get).filter((f) => isFolder(f) && f.id !== state.rootId);
  }

  function setStripFolders(list) {
    state.stripFolders = [...new Set(list)];
    saveStrip();
    scheduleRender();
  }

  // ----- Perfiles de la tira: varias selecciones de carpetas, una activa -----

  const PROFILE_NAME_MAX = 40;
  const cleanIds = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string'))];

  function sanitizeProfiles(list) {
    const out = [];
    const ids = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) continue;
      ids.add(raw.id);
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, PROFILE_NAME_MAX) : '';
      const color = GROUP_COLORS.includes(raw.color) ? raw.color : '';
      out.push({ id: raw.id, name, color, folders: cleanIds(raw.folders) });
    }
    return out;
  }

  /**
   * Aplica perfiles y perfil activo guardados. Siempre queda al menos uno (el primero
   * se crea a partir de la tira de antes de que existieran los perfiles), y si llega
   * stripFolders (otra pestaña, una copia antigua) son las carpetas del activo.
   */
  function applyStripProfiles(p) {
    if (Array.isArray(p.stripProfiles)) state.stripProfiles = sanitizeProfiles(p.stripProfiles);
    if (typeof p.stripProfile === 'string') state.stripProfile = p.stripProfile;
    if (!state.stripProfiles.length)
      state.stripProfiles = [{ id: 'default', name: '', color: '', folders: [...state.stripFolders] }];
    let active = state.stripProfiles.find((x) => x.id === state.stripProfile);
    if (!active) {
      active = state.stripProfiles[0];
      state.stripProfile = active.id;
    }
    if (Array.isArray(p.stripFolders)) active.folders = cleanIds(p.stripFolders);
    state.stripFolders = [...active.folders];
  }

  const activeProfile = () => state.stripProfiles.find((x) => x.id === state.stripProfile) || state.stripProfiles[0];
  const profileName = (pr) => pr?.name || t('strip.profileDefault');

  /** Copia de los perfiles para guardar (el activo, con las carpetas de la tira). */
  function serializeProfiles() {
    return state.stripProfiles.map((pr) => ({
      id: pr.id,
      name: pr.name,
      color: pr.color || '',
      folders: pr.id === state.stripProfile ? [...state.stripFolders] : [...pr.folders],
    }));
  }

  /** Activa un perfil (sin guardar): su selección pasa a ser la tira. */
  function activateProfile(pr) {
    // Solo si el activo sigue en la lista (al eliminarlo ya no está).
    const current = state.stripProfiles.find((x) => x.id === state.stripProfile);
    if (current) current.folders = [...state.stripFolders];
    state.stripProfile = pr.id;
    state.stripFolders = [...pr.folders];
    // Otra selección de carpetas: la tira empieza desde el principio.
    if (momentum.raf) stopMomentum();
    if (wheelScroll.raf) stopWheelScroll();
    $('#cards').scrollLeft = 0;
  }

  function commitProfiles() {
    saveStrip();
    scheduleRender();
  }

  function switchStripProfile(id) {
    const pr = state.stripProfiles.find((x) => x.id === id);
    if (!pr || id === state.stripProfile) return;
    activateProfile(pr);
    state.profileFocus = id;
    commitProfiles();
  }

  const newProfileId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** Perfil nuevo (vacío, o copia de `fromId`) justo después del de origen; queda activo. */
  function addStripProfile(fromId = null) {
    const from = fromId ? state.stripProfiles.find((x) => x.id === fromId) : null;
    if (from) activeProfile().folders = [...state.stripFolders];
    const names = new Set(state.stripProfiles.map(profileName));
    let name;
    if (from) name = t('strip.profileCopy', { name: profileName(from) });
    else {
      let n = state.stripProfiles.length + 1;
      while (names.has(t('strip.profileNew', { n }))) n++;
      name = t('strip.profileNew', { n });
    }
    const pr = {
      id: newProfileId(),
      name: name.slice(0, PROFILE_NAME_MAX),
      color: from?.color || '',
      folders: from ? [...from.folders] : [],
    };
    const at = from ? state.stripProfiles.indexOf(from) + 1 : state.stripProfiles.length;
    state.stripProfiles.splice(at, 0, pr);
    activateProfile(pr);
    // Se le pone nombre nada más crearlo.
    state.profileRenaming = pr.id;
    commitProfiles();
    return pr.id;
  }

  function renameStripProfile(id, name) {
    const pr = state.stripProfiles.find((x) => x.id === id);
    const clean = String(name ?? '')
      .trim()
      .slice(0, PROFILE_NAME_MAX);
    // Vacío: se queda como estaba.
    if (!pr || !clean || clean === pr.name) return;
    pr.name = clean;
    commitProfiles();
  }

  function setProfileColor(id, color) {
    const pr = state.stripProfiles.find((x) => x.id === id);
    if (!pr) return;
    pr.color = GROUP_COLORS.includes(color) ? color : '';
    commitProfiles();
  }

  function moveStripProfile(id, step) {
    const list = state.stripProfiles;
    const from = list.findIndex((x) => x.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(to, 0, ...list.splice(from, 1));
    state.profileFocus = id;
    commitProfiles();
  }

  function deleteStripProfile(id) {
    const list = state.stripProfiles;
    const index = list.findIndex((x) => x.id === id);
    if (index < 0 || list.length < 2) return;
    activeProfile().folders = [...state.stripFolders];
    const before = list.map((x) => ({ ...x, folders: [...x.folders] }));
    const beforeActive = state.stripProfile;
    const [removed] = list.splice(index, 1);
    if (id === beforeActive) activateProfile(list[Math.min(index, list.length - 1)]);
    commitProfiles();
    toast(t('toast.profileDeleted', { name: profileName(removed) }), 'info', {
      label: t('action.undo'),
      run: () => {
        state.stripProfiles = before;
        state.stripProfile = '';
        activateProfile(before.find((x) => x.id === beforeActive) || before[0]);
        commitProfiles();
      },
    });
  }

  function profileMenu(id) {
    const list = state.stripProfiles;
    const index = list.findIndex((x) => x.id === id);
    if (index < 0) return [];
    return [
      id !== state.stripProfile && { label: t('strip.profileOpen'), icon: 'strip', run: () => switchStripProfile(id) },
      { label: t('menu.rename'), icon: 'edit', run: () => startProfileRename(id) },
      { label: t('strip.profileDuplicate'), icon: 'copy', run: () => addStripProfile(id) },
      '-',
      colorRow(list[index].color, (c) => setProfileColor(id, c)),
      list.length > 1 && '-',
      index > 0 && { label: t('strip.profileMoveLeft'), icon: 'arrow-left', run: () => moveStripProfile(id, -1) },
      index < list.length - 1 && {
        label: t('strip.profileMoveRight'),
        icon: 'arrow-right',
        run: () => moveStripProfile(id, 1),
      },
      list.length > 1 && '-',
      list.length > 1 && {
        label: t('strip.profileDelete'),
        icon: 'trash',
        danger: true,
        run: () => deleteStripProfile(id),
      },
    ];
  }

  function startProfileRename(id) {
    if (!state.stripProfiles.some((x) => x.id === id)) return;
    state.profileRenaming = id;
    renderStripProfiles();
  }

  function finishProfileRename(input, save) {
    const id = input.dataset.profileId;
    if (state.profileRenaming !== id) return;
    state.profileRenaming = null;
    state.profileFocus = id;
    if (save) renameStripProfile(id, input.value);
    renderStripProfiles();
  }

  /** Barra de perfiles, sobre la tira (también en el modo minimalista). */
  function renderStripProfiles(kind = state.viewKind) {
    const bar = $('#strip-profiles');
    const show = kind === 'strip';
    bar.hidden = !show;
    if (!show) return;
    // No se rehace mientras se escribe un nombre (un repintado se llevaría lo escrito).
    const editing = bar.querySelector('.strip-profile-input');
    if (editing && editing.dataset.profileId === state.profileRenaming) return;
    const live = (ids) => ids.filter((id) => id !== state.rootId && isFolder(get(id))).length;
    const chips = state.stripProfiles.map((pr) => {
      const active = pr.id === state.stripProfile;
      const color = pr.color || null;
      if (pr.id === state.profileRenaming) {
        return el('input', {
          class: 'strip-profile-input',
          type: 'text',
          value: pr.name || profileName(pr),
          maxlength: PROFILE_NAME_MAX,
          'aria-label': t('strip.profileName'),
          dataset: { profileId: pr.id, color },
        });
      }
      const folders = tn('strip.profileFolders', live(active ? state.stripFolders : pr.folders));
      return el(
        'button',
        {
          class: 'strip-profile',
          type: 'button',
          'aria-pressed': String(active),
          title: `${profileName(pr)} · ${folders}\n${t('strip.profileHint')}`,
          dataset: { action: 'profile', profileId: pr.id, color },
        },
        color && el('span', { class: 'strip-profile-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'strip-profile-name', text: profileName(pr) }),
      );
    });
    const tool = (action, iconName, label) =>
      el(
        'button',
        { class: 'strip-profile-tool', type: 'button', title: label, 'aria-label': label, dataset: { action } },
        icon(iconName),
      );
    const more = t('strip.profileMore', { name: profileName(activeProfile()) });
    // Expandir / contraer TODA la tira: en la cabecera ya hay un botón; aquí solo se
    // ve en el modo minimalista (ver CSS). renderStripExpandBtn() pone icono y título.
    const expand = tool('strip-expand-all', 'expand-all', t('strip.expandAllTitle'));
    expand.classList.add('strip-expand-tool');
    bar.replaceChildren(
      el(
        'div',
        { class: 'strip-profile-pill' },
        el('div', { class: 'strip-profile-list', role: 'group', 'aria-label': t('strip.profiles') }, ...chips),
        el('span', { class: 'strip-profile-sep', 'aria-hidden': 'true' }),
        expand,
        tool('profile-add', 'plus', t('strip.profileAddTitle')),
        tool('profile-more', 'more', more),
      ),
    );
    renderStripExpandBtn(kind);
    const input = bar.querySelector('.strip-profile-input');
    if (input) {
      input.focus();
      input.select();
      input.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else if (state.profileFocus) {
      bar.querySelector(`.strip-profile[data-profile-id="${CSS.escape(state.profileFocus)}"]`)?.focus();
    }
    state.profileFocus = null;
  }

  function bindStripProfiles() {
    const bar = $('#strip-profiles');
    bar.addEventListener('dblclick', (event) => {
      const chip = event.target.closest('.strip-profile');
      if (chip) startProfileRename(chip.dataset.profileId);
    });
    bar.addEventListener('keydown', (event) => {
      const input = event.target.closest('.strip-profile-input');
      if (input) {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finishProfileRename(input, event.key === 'Enter');
        }
        return;
      }
      const chip = event.target.closest('.strip-profile');
      if (chip && event.key === 'F2') {
        event.preventDefault();
        startProfileRename(chip.dataset.profileId);
      }
    });
    bar.addEventListener('focusout', (event) => {
      const input = event.target.closest?.('.strip-profile-input');
      if (input) finishProfileRename(input, true);
    });
  }

  function toggleStrip(id) {
    const f = get(id);
    if (!isFolder(f)) return;
    const name = folderName(f);
    if (inStrip(id)) {
      const before = [...state.stripFolders];
      setStripFolders(before.filter((x) => x !== id));
      toast(t('toast.stripRemoved', { name }), 'info', {
        label: t('action.undo'),
        run: () => setStripFolders(before),
      });
      return;
    }
    setStripFolders([...state.stripFolders, id]);
    const showing = (isMinimal() ? minimalSelection() : state.selected) === VIEW_STRIP;
    toast(
      t('toast.stripAdded', { name }),
      'info',
      showing ? null : { label: t('strip.show'), run: () => selectView(VIEW_STRIP) },
    );
  }

  /** Coloca una carpeta en la posición `index` de la tira (sin contarla a ella). */
  function placeInStrip(id, index) {
    const list = state.stripFolders.filter((x) => x !== id);
    list.splice(clamp(index, 0, list.length), 0, id);
    setStripFolders(list);
  }

  /** Hueco del final de la tira: abre el selector y acepta carpetas arrastradas. */
  function stripAddTile() {
    return el(
      'button',
      { class: 'strip-add', type: 'button', dataset: { action: 'strip-pick' } },
      icon('plus'),
      el('span', { text: t('strip.add') }),
    );
  }

  /**
   * Hueco de la tira para una carpeta arrastrada (desde la tira o desde el árbol):
   * a la izquierda o a la derecha de la tarjeta bajo el puntero, o al final.
   */
  function stripSlot(event) {
    if (state.viewKind !== 'strip' || state.dragFromGroup) return null;
    const ids = state.dragIds;
    if (ids.length !== 1 || !isFolder(get(ids[0]))) return null;
    const id = ids[0];
    const item = event.target.closest?.('#cards .board-card[data-folder-id], #cards .strip-add');
    if (!item) return null;
    const list = state.stripFolders.filter((x) => x !== id);
    let index;
    let after = false;
    if (item.classList.contains('strip-add')) index = list.length;
    else {
      const rect = item.getBoundingClientRect();
      after = event.clientX > rect.left + rect.width / 2;
      const target = item.dataset.folderId;
      if (target === id) return { el: item, after, x: true, noop: true, folderId: id, index: 0 };
      index = list.indexOf(target) + (after ? 1 : 0);
    }
    const noop = inStrip(id) && state.stripFolders.indexOf(id) === index;
    return { el: item, after, x: true, noop, folderId: id, index };
  }

  // ----- Elegir las carpetas de la tira en el árbol lateral -----
  // Con la tira a la vista, el árbol entra en «modo selección»: cada carpeta lleva
  // una casilla y un clic la añade o la quita (en vez de abrirla).

  const stripPicking = () => !isMinimal() && currentShown() === VIEW_STRIP;

  function toggleStripPick(id) {
    if (!isFolder(get(id)) || id === state.rootId) return;
    setStripFolders(inStrip(id) ? state.stripFolders.filter((x) => x !== id) : [...state.stripFolders, id]);
  }

  /** «Elegir carpetas»: muestra el árbol (cajón en móvil) y señala dónde marcar. */
  function revealTreePicker() {
    closeMenu();
    // El modo minimalista no tiene árbol: se sale de él (y se queda en la tira).
    if (isMinimal()) {
      if (minimalSelection() !== VIEW_STRIP) selectView(VIEW_STRIP);
      exitMinimal();
      return;
    }
    if (!stripPicking()) selectView(VIEW_STRIP);
    if (window.matchMedia('(max-width: 900px)').matches) openDrawer();
    else if (!state.prefs.sidebarPanel) setPref('sidebarPanel', true);
    const hint = $('#tree-pick-hint');
    hint.classList.remove('is-flash');
    void hint.offsetWidth; // reinicia la animación
    hint.classList.add('is-flash');
    hint.scrollIntoView({ block: 'nearest' });
    $('#tree .tree-label')?.focus({ preventScroll: true });
  }

  // ----- Desplazamiento de la tira (sin barra visible) -----
  // La rueda la mueve en horizontal (con suavizado), el fondo se puede agarrar y
  // arrastrar con el ratón (al soltarlo sigue con inercia y se va frenando), y al arrastrar una tarjeta o un marcador cerca de un
  // borde la tira avanza sola. Unos degradados en los bordes indican que hay más.

  const stripEl = () => {
    const cards = $('#cards');
    return cards.classList.contains('is-strip') ? cards : null;
  };
  const stripMax = (cards) => Math.max(0, cards.scrollWidth - cards.clientWidth);

  /** Marca en qué lados queda contenido oculto (para los degradados del CSS). */
  function updateStripEdges() {
    const cards = $('#cards');
    const on = cards.classList.contains('is-strip');
    const max = on ? stripMax(cards) : 0;
    cards.classList.toggle('has-more-left', on && cards.scrollLeft > 1);
    cards.classList.toggle('has-more-right', on && cards.scrollLeft < max - 1);
    $('#content').classList.toggle('can-pan', max > 0);
    // Altura máxima de las tarjetas: lo que queda de pantalla bajo la cabecera
    // (cada tarjeta se desplaza por dentro; la página no).
    if (on) {
      const content = $('#content');
      const top = cards.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      cards.style.setProperty('--strip-h', `${Math.max(280, Math.floor(content.clientHeight - top - 36))}px`);
    }
  }

  // Rueda: se acumula un destino y se llega a él poco a poco.
  // Cada «gesto» de rueda (golpes separados por menos de WHEEL_LATCH ms) se queda
  // en el eje con el que empezó: mientras la tira avanza de lado, las tarjetas con
  // scroll propio que pasan bajo el puntero no lo roban. Y una tarjeta solo se
  // desplaza en vertical si el puntero lleva un momento sobre ella (HOVER_SETTLE),
  // no si solo está cruzándola de camino a otra columna.
  const WHEEL_LATCH = 300;
  const HOVER_SETTLE = 150;
  const wheelScroll = { target: 0, raf: 0, axis: null, at: 0 };
  const stripHover = { el: null, since: 0 };

  /** Tarjeta (su parte con scroll) bajo el puntero, y desde cuándo. */
  function trackStripHover(event) {
    const inner = event.target.closest?.('.board-inner') || null;
    if (inner === stripHover.el) return;
    stripHover.el = inner;
    stripHover.since = performance.now();
  }

  function stripWheel(event) {
    const cards = stripEl();
    if (!cards || event.ctrlKey || event.target.closest?.('#view-head, #home-bar, #strip-profiles')) return;
    // El desplazamiento horizontal del touchpad (o Mayús+rueda) ya lo hace el navegador.
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const now = performance.now();
    const latched = now - wheelScroll.at < WHEEL_LATCH ? wheelScroll.axis : null;
    wheelScroll.at = now;
    // Con la rueda, la tira se mueve bajo el puntero quieto: también cuenta como llegar a otra tarjeta.
    trackStripHover(event);
    // Sobre una tarjeta con más contenido del que cabe, la rueda la desplaza a ella
    // (salvo en mitad de un gesto horizontal, o si el puntero solo está de paso).
    const inner = stripHover.el;
    const scrollable = inner && inner.scrollHeight > inner.clientHeight + 1;
    if (scrollable && (latched === 'y' || (latched !== 'x' && now - stripHover.since >= HOVER_SETTLE))) {
      wheelScroll.axis = 'y';
      return;
    }
    const max = stripMax(cards);
    if (!max) return;
    stopMomentum();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? cards.clientWidth : 1;
    const delta = event.deltaY * unit;
    const from = wheelScroll.raf ? wheelScroll.target : cards.scrollLeft;
    // En el extremo, la rueda vuelve a ser de la página (por si se desplaza en vertical);
    // si el gesto ya iba de lado, se queda ahí quieta (sin desplazar la tarjeta de debajo).
    if ((delta < 0 && from <= 0) || (delta > 0 && from >= max - 1)) {
      if (latched === 'x') event.preventDefault();
      else wheelScroll.axis = null;
      return;
    }
    wheelScroll.axis = 'x';
    event.preventDefault();
    wheelScroll.target = clamp(from + delta, 0, max);
    if (REDUCED_MOTION.matches) {
      cards.scrollLeft = wheelScroll.target;
      return;
    }
    if (wheelScroll.raf) return;
    const step = () => {
      const diff = wheelScroll.target - cards.scrollLeft;
      if (Math.abs(diff) < 1 || !cards.classList.contains('is-strip')) {
        if (cards.classList.contains('is-strip')) cards.scrollLeft = wheelScroll.target;
        wheelScroll.raf = 0;
        return;
      }
      cards.scrollLeft += diff * 0.22;
      wheelScroll.raf = requestAnimationFrame(step);
    };
    wheelScroll.raf = requestAnimationFrame(step);
  }

  function stopWheelScroll() {
    cancelAnimationFrame(wheelScroll.raf);
    wheelScroll.raf = 0;
  }

  // Agarrar el fondo: lo que no es un enlace, un botón ni algo arrastrable.
  const PAN_IGNORE =
    'a, button, input, select, textarea, label, [draggable="true"], #view-head, #home-bar, #strip-profiles, #empty';
  let pan = null;

  function stripPointerDown(event) {
    const cards = stripEl();
    if (!cards || event.button !== 0 || event.pointerType !== 'mouse' || !stripMax(cards)) return;
    // Un clic mientras la tira aún se desliza la detiene (y no abre lo que haya debajo).
    if (stopMomentum() > MOMENTUM_GRAB) swallowNextClick();
    if (event.target.closest?.(PAN_IGNORE)) return;
    stopWheelScroll();
    const now = performance.now();
    pan = {
      id: event.pointerId,
      x: event.clientX,
      left: cards.scrollLeft,
      moved: false,
      cards,
      samples: [{ t: now, x: event.clientX }],
    };
  }

  function stripPointerMove(event) {
    if (!pan || event.pointerId !== pan.id) return;
    const dx = event.clientX - pan.x;
    if (!pan.moved) {
      if (Math.abs(dx) < 5) return;
      pan.moved = true;
      try {
        $('#content').setPointerCapture(pan.id);
      } catch {
        /* sin captura: el arrastre sigue mientras el puntero esté sobre el contenido */
      }
      document.documentElement.classList.add('is-panning');
      window.getSelection?.()?.removeAllRanges();
    }
    event.preventDefault();
    pan.cards.scrollLeft = pan.left - dx;
    // Últimas posiciones, para saber a qué velocidad iba el ratón al soltar.
    const now = performance.now();
    pan.samples.push({ t: now, x: event.clientX });
    while (pan.samples.length > 2 && now - pan.samples[0].t > MOMENTUM_WINDOW) pan.samples.shift();
  }

  function stripPointerUp(event) {
    if (!pan || event.pointerId !== pan.id) return;
    const { moved, samples, cards } = pan;
    pan = null;
    document.documentElement.classList.remove('is-panning');
    if (!moved) return;
    // Que soltar tras arrastrar no cuente como clic (el clic llega justo después).
    swallowNextClick();
    if (event.type === 'pointerup') startMomentum(cards, releaseVelocity(samples));
  }

  function swallowNextClick() {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  }

  // Inercia al soltar: la tira sigue a la velocidad del gesto y se frena poco a poco.
  const MOMENTUM_WINDOW = 100; // ms de movimiento que cuentan para la velocidad
  const MOMENTUM_FRICTION = 0.95; // velocidad que se conserva cada 16 ms
  const MOMENTUM_MIN = 0.02; // px/ms: por debajo, se para
  const MOMENTUM_GRAB = 0.1; // px/ms: por encima, un clic solo la detiene
  const MOMENTUM_MAX = 6; // px/ms: tope para un lanzamiento muy brusco
  const momentum = { v: 0, raf: 0 };

  /** Velocidad del puntero (px/ms, positiva hacia la derecha) al soltar. */
  function releaseVelocity(samples) {
    const last = samples.at(-1);
    const first = samples.find((s) => last.t - s.t <= MOMENTUM_WINDOW) || last;
    // Si se paró antes de soltar, no hay lanzamiento.
    if (performance.now() - last.t > 60 || last.t - first.t < 8) return 0;
    return clamp((last.x - first.x) / (last.t - first.t), -MOMENTUM_MAX, MOMENTUM_MAX);
  }

  function startMomentum(cards, velocity) {
    stopMomentum();
    // La tira va al revés que el ratón: arrastrar a la izquierda muestra lo de la derecha.
    if (REDUCED_MOTION.matches || Math.abs(velocity) < MOMENTUM_MIN * 5) return;
    momentum.v = -velocity;
    let pos = cards.scrollLeft;
    let prev = performance.now();
    const step = (now) => {
      const dt = Math.min(now - prev, 50);
      prev = now;
      const max = stripMax(cards);
      pos = clamp(pos + momentum.v * dt, 0, max);
      cards.scrollLeft = pos;
      momentum.v *= MOMENTUM_FRICTION ** (dt / 16);
      const atEdge = (pos <= 0 && momentum.v < 0) || (pos >= max && momentum.v > 0);
      if (Math.abs(momentum.v) < MOMENTUM_MIN || atEdge || !cards.classList.contains('is-strip')) {
        momentum.v = 0;
        momentum.raf = 0;
        return;
      }
      momentum.raf = requestAnimationFrame(step);
    };
    momentum.raf = requestAnimationFrame(step);
  }

  /** Detiene la inercia; devuelve la velocidad que llevaba (px/ms). */
  function stopMomentum() {
    const v = momentum.raf ? Math.abs(momentum.v) : 0;
    cancelAnimationFrame(momentum.raf);
    momentum.raf = 0;
    momentum.v = 0;
    return v;
  }

  // Bordes durante un arrastre (drag & drop): cuanto más cerca, más rápido.
  const EDGE_ZONE = 90;
  const EDGE_SPEED = 22;
  const edgeScroll = { v: 0, at: 0, raf: 0 };

  function stripEdgeScroll(event) {
    const cards = stripEl();
    if (!cards || !stripMax(cards) || !event.target.closest?.('#content')) {
      edgeScroll.v = 0;
      return;
    }
    const r = cards.getBoundingClientRect();
    const zone = Math.min(EDGE_ZONE, r.width / 4);
    const x = event.clientX;
    let v = 0;
    if (x < r.left + zone) v = -EDGE_SPEED * (1 - Math.max(0, x - r.left) / zone);
    else if (x > r.right - zone) v = EDGE_SPEED * (1 - Math.max(0, r.right - x) / zone);
    edgeScroll.v = v;
    edgeScroll.at = performance.now();
    if (!v || edgeScroll.raf) return;
    stopWheelScroll();
    stopMomentum();
    const step = () => {
      // dragover llega continuamente; si deja de llegar (fuera de la ventana), se para.
      if (!edgeScroll.v || performance.now() - edgeScroll.at > 150 || !cards.classList.contains('is-strip')) {
        edgeScroll.raf = 0;
        return;
      }
      cards.scrollLeft += edgeScroll.v;
      edgeScroll.raf = requestAnimationFrame(step);
    };
    edgeScroll.raf = requestAnimationFrame(step);
  }

  function stopEdgeScroll() {
    edgeScroll.v = 0;
    cancelAnimationFrame(edgeScroll.raf);
    edgeScroll.raf = 0;
  }

  function bindStripScroll() {
    const content = $('#content');
    content.addEventListener('wheel', stripWheel, { passive: false });
    content.addEventListener('pointerdown', stripPointerDown);
    content.addEventListener('pointermove', stripPointerMove);
    content.addEventListener('pointermove', trackStripHover, { passive: true });
    content.addEventListener('pointerup', stripPointerUp);
    content.addEventListener('pointercancel', stripPointerUp);
    $('#cards').addEventListener('scroll', updateStripEdges, { passive: true });
    window.addEventListener('resize', debounce(updateStripEdges, 100));
  }

  function animateEntering(container) {
    container.classList.remove('is-entering');
    void container.offsetWidth;
    let i = 0;
    for (const child of container.children) {
      child.style.setProperty('--i', Math.min(i++, 24));
    }
    container.classList.add('is-entering');
    clearTimeout(container._enterTimer);
    container._enterTimer = setTimeout(() => container.classList.remove('is-entering'), 900);
  }

  function reconcileCards(container, items, view) {
    const seen = new Set();
    const elements = [];
    for (const n of items) {
      let card = state.cardEls.get(n.id);
      if (isSeparator(n)) {
        if (!card) {
          card = paintSeparator(el('div', { class: 'card-sep', role: 'separator', dataset: { id: n.id } }), n.id);
          state.cardEls.set(n.id, card);
        }
        card.setAttribute('aria-label', t('separator.label'));
        if (state.newIds.has(n.id)) markNew(card);
        elements.push(card);
        seen.add(n.id);
        continue;
      }
      if (!card) {
        card = el('article', { class: 'card', draggable: 'true', dataset: { id: n.id, dragId: n.id } });
        state.cardEls.set(n.id, card);
      }
      fillCard(card, n, view);
      if (state.newIds.has(n.id)) markNew(card);
      elements.push(card);
      seen.add(n.id);
    }
    for (const id of state.cardEls.keys()) if (!seen.has(id)) state.cardEls.delete(id);
    container.replaceChildren(...elements);
  }

  function markNew(node) {
    node.classList.add('is-new');
    node.addEventListener('animationend', () => node.classList.remove('is-new'), { once: true });
    setTimeout(() => node.classList.remove('is-new'), 2000);
  }

  function fillCard(card, n, view) {
    const sig = [
      n.title,
      n.url,
      n.dateAdded,
      view.showPath ? `${n.parentId}|${pathText(n.id)}` : '',
      state.terms.join(' '),
      state.prefs.openInNewTab,
      state.prefs.showFavicons,
      lang,
      (state.groupIndex.get(n.id) || []).map((g) => `${g.id}:${g.color}:${g.name}`).join(','),
    ].join('\u0001');
    if (card._sig !== sig) {
      card._sig = sig;
      card.replaceChildren(...cardContent(n, view));
    }
    const fav = state.favorites.has(n.id);
    card.classList.toggle('is-favorite', fav);
    const favBtn = card.querySelector('.fav-btn');
    favBtn.setAttribute('aria-pressed', String(fav));
    const favLabel = t(fav ? 'action.unstar' : 'action.star');
    favBtn.title = favLabel;
    favBtn.setAttribute('aria-label', favLabel);
  }

  function cardContent(n, view) {
    const title = bookmarkTitle(n);
    const openable = isOpenable(n.url);

    const link = el(
      'a',
      {
        class: openable ? 'card-link' : 'card-link is-blocked',
        draggable: 'false',
        title: n.url ? `${title}\n${n.url}` : title,
      },
      el('span', { class: 'card-title' }, highlight(title)),
    );
    if (openable) {
      link.href = n.url;
      link.referrerPolicy = 'no-referrer';
      if (state.prefs.openInNewTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      // place:, javascript:, about:, file:… Firefox no deja abrirlos desde extensiones.
      link.href = '#';
      link.dataset.action = 'open-blocked';
    }

    const main = el('div', { class: 'card-main' }, link, el('div', { class: 'card-url' }, highlight(prettyUrl(n.url))));

    const meta = el('div', { class: 'card-meta' });
    if (view.showPath) {
      const parent = get(n.parentId);
      meta.append(
        el(
          'button',
          {
            class: 'chip',
            type: 'button',
            title: t('card.goto', { path: pathText(n.id) }),
            dataset: { action: 'goto', target: n.parentId },
          },
          icon(folderIcon(parent)),
          el('span', {}, highlight(folderName(parent))),
        ),
      );
    }
    const groups = state.groupIndex.get(n.id);
    if (groups?.length) {
      meta.append(
        el(
          'span',
          { class: 'card-groups', title: t('card.groups', { names: groups.map((g) => g.name).join(', ') }) },
          ...groups.slice(0, 6).map((g) => el('span', { class: 'group-dot', dataset: { color: g.color } })),
        ),
      );
    }
    if (n.dateAdded) {
      meta.append(
        el('time', {
          class: 'card-date',
          datetime: new Date(n.dateAdded).toISOString(),
          title: t('card.added', { date: dateTimeFmt.format(n.dateAdded) }),
          text: dateFmt.format(n.dateAdded),
        }),
      );
    }

    const actions = el(
      'div',
      { class: 'card-actions' },
      el('button', { class: 'icon-btn fav-btn', type: 'button', dataset: { action: 'favorite' } }, icon('star')),
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'more' },
        },
        icon('more'),
      ),
    );

    return [selectButton(title), faviconEl(n, title), main, meta, actions];
  }

  /** Casilla para la selección múltiple (su estado lo pone syncSelection). */
  function selectButton(title) {
    return el(
      'button',
      {
        class: 'select-btn',
        type: 'button',
        title: t('card.select'),
        'aria-label': t('card.selectNamed', { name: title }),
        'aria-pressed': 'false',
        dataset: { action: 'select' },
      },
      icon('check'),
    );
  }

  /**
   * Favicon: se pide /favicon.ico al propio sitio (nunca a servicios de terceros).
   * Mientras carga o si falla, se muestra una inicial con color derivado del dominio.
   */
  function faviconEl(n, title) {
    const host = hostOf(n.url);
    const wrap = el('div', { class: 'favicon', 'aria-hidden': 'true' });
    wrap.style.setProperty('--hue', hashHue(host || title));
    const letter =
      (host || title)
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .charAt(0)
        .toUpperCase() || '•';
    wrap.append(el('span', { class: 'favicon-letter', text: letter }));

    const u = parseUrl(n.url);
    if (state.prefs.showFavicons && u && /^https?:$/.test(u.protocol) && !state.failedIcons.has(u.origin)) {
      const img = el('img', {
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer',
        draggable: 'false',
      });
      img.addEventListener(
        'load',
        () => {
          if (img.naturalWidth > 1) wrap.classList.add('has-img');
          else img.remove();
        },
        { once: true },
      );
      img.addEventListener(
        'error',
        () => {
          state.failedIcons.add(u.origin);
          img.remove();
        },
        { once: true },
      );
      img.src = `${u.origin}/favicon.ico`;
      wrap.append(img);
    }
    return wrap;
  }

  function folderTile(folder, view) {
    const counts = getCounts();
    const total = counts.get(folder.id) || 0;
    const subs = folder.children.reduce((acc, id) => acc + (isFolder(get(id)) ? 1 : 0), 0);
    const builtin = isBuiltin(folder.id);
    const metaText =
      view.kind === 'search'
        ? pathText(folder.id) || t('root')
        : subs
          ? `${tn('n.bookmark', total)} · ${tn('n.folder', subs)}`
          : tn('n.bookmark', total);

    const tile = el(
      'article',
      {
        class: 'folder-tile',
        draggable: builtin ? null : 'true',
        dataset: { id: folder.id, dropId: folder.id, dragId: builtin ? null : folder.id },
      },
      el(
        'button',
        {
          class: 'folder-open',
          type: 'button',
          title: t('folder.open', { name: folderName(folder) }),
          dataset: { action: 'open-folder' },
        },
        el('span', { class: 'folder-icon' }, icon(folderIcon(folder))),
        el(
          'span',
          { class: 'folder-text' },
          el('span', { class: 'folder-name' }, highlight(folderName(folder))),
          el('span', { class: 'folder-meta', text: metaText }),
        ),
      ),
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'folder-more' },
        },
        icon('more'),
      ),
    );
    paintFolder(tile, folder.id);
    if (state.newIds.has(folder.id)) markNew(tile);
    return tile;
  }

  function renderEmpty(view) {
    let spec = null;
    if (view.items.length === 0 && view.folders.length === 0) {
      if (view.kind === 'search') {
        spec = {
          icon: 'search',
          title: t('empty.search.title'),
          text: t('empty.search.text', { q: state.query }),
          action: { label: t('empty.search.action'), run: clearSearch },
        };
      } else if (view.kind === 'strip') {
        spec = {
          icon: 'strip',
          title: t('empty.strip.title'),
          text: t('empty.strip.text'),
          action: { label: t('strip.pick'), run: revealTreePicker },
        };
      } else if (view.key === VIEW_FAVORITES) {
        spec = {
          icon: 'star',
          title: t('empty.favorites.title'),
          text: t('empty.favorites.text'),
          action: { label: t('empty.favorites.action'), run: () => selectView(VIEW_ALL) },
        };
      } else if (view.kind === 'view') {
        spec = {
          icon: 'bookmark',
          title: t('empty.all.title'),
          text: t('empty.all.text'),
          action: { label: t('empty.addBookmark'), run: () => openEditor({ mode: 'new-bookmark' }) },
        };
      } else {
        spec = {
          icon: 'folder',
          title: t('empty.folder.title'),
          text: t('empty.folder.text'),
          action: {
            label: t('empty.addBookmark'),
            run: () => openEditor({ mode: 'new-bookmark', parentId: view.folder.id }),
          },
        };
      }
    }
    showEmpty(spec);
  }

  function showEmpty(spec, { error = false } = {}) {
    const box = $('#empty');
    if (!spec) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.classList.toggle('is-error', error);
    // replaceChildren() escribiría «null»: se filtran los que faltan.
    box.replaceChildren(
      ...[
        el('div', { class: 'empty-icon' }, icon(spec.icon)),
        el('h2', { text: spec.title }),
        el('p', { text: spec.text }),
        spec.detail ? el('p', { class: 'empty-detail', text: spec.detail }) : null,
        spec.action
          ? el('button', { class: 'btn btn-primary', type: 'button', onclick: spec.action.run }, spec.action.label)
          : null,
      ].filter(Boolean),
    );
    box.hidden = false;
  }

  function showFatal(title, text, detail, retry) {
    $('#skeleton').hidden = true;
    $('#folders-section').hidden = true;
    $('#bookmarks-section').hidden = true;
    $('#controls').hidden = true;
    $('#breadcrumb').hidden = true;
    $('#view-icon').replaceChildren(icon('alert'));
    $('#view-title').textContent = 'Bookmark Control Panel';
    $('#view-subtitle').textContent = '';
    $('#stats').textContent = t('stats.disconnected');
    $('#live').classList.add('is-error');
    showEmpty(
      { icon: 'alert', title, text, detail, action: retry ? { label: t('action.retry'), run: retry } : null },
      { error: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Acciones sobre marcadores (solo por acción explícita del usuario)
  // ---------------------------------------------------------------------------

  function openUrl(url, newTab) {
    if (!isOpenable(url)) return;
    if (newTab) {
      api.tabs.create({ url }).catch((err) => toast(t('toast.openError', { error: err?.message || err }), 'error'));
    } else {
      window.location.assign(url);
    }
  }

  async function copyUrl(n, message = t('toast.copied')) {
    try {
      await navigator.clipboard.writeText(n.url);
      toast(message);
    } catch {
      toast(t('toast.copyError'), 'error');
    }
  }

  /**
   * Abre en pestañas nuevas (en segundo plano, a continuación de esta) los
   * marcadores indicados. Pide confirmación si son muchos, como Firefox.
   */
  async function openAllInTabs(nodes, name) {
    const bookmarks = nodes.filter(isBookmark);
    const urls = bookmarks.filter((n) => isOpenable(n.url)).map((n) => n.url);
    const skipped = bookmarks.length - urls.length;
    if (!urls.length) {
      toast(t('toast.nothingToOpen'), 'error');
      return;
    }
    if (urls.length > OPEN_ALL_CONFIRM) {
      const message = [t('openAll.confirmMessage', { name }), skipped ? tn('openAll.confirmSkipped', skipped) : '']
        .filter(Boolean)
        .join(' ');
      const ok = await confirmDialog({
        title: tn('openAll.confirmTitle', urls.length),
        message,
        confirmLabel: t('openAll.confirm'),
        icon: 'tabs',
        danger: false,
      });
      if (!ok) return;
    }

    let where = {};
    try {
      const current = await api.tabs.getCurrent();
      if (current) where = { windowId: current.windowId, index: current.index + 1 };
    } catch {
      /* sin pestaña actual: Firefox decide la posición */
    }

    let opened = 0;
    try {
      for (const url of urls) {
        const props = { url, active: false };
        if (where.windowId !== undefined)
          Object.assign(props, { windowId: where.windowId, index: where.index + opened });
        // Una a una a propósito: así las pestañas quedan en el orden de los marcadores.
        // oxlint-disable-next-line no-await-in-loop
        await api.tabs.create(props);
        opened++;
      }
    } catch (err) {
      toast(
        t('toast.openAllError', {
          opened: numberFmt.format(opened),
          total: numberFmt.format(urls.length),
          error: err?.message || err,
        }),
        'error',
      );
      return;
    }
    toast([tn('toast.openedTabs', opened), skipped ? tn('toast.skipped', skipped) : ''].filter(Boolean).join(' · '));
  }

  /** Como Firefox: abrir una carpeta "en pestañas" abre solo sus marcadores directos. */
  const directBookmarks = (f) => f.children.map(get).filter(isBookmark);

  function openFolderInTabs(id) {
    const f = get(id);
    if (!state.ready || !isFolder(f) || f.id === state.rootId) return;
    openAllInTabs(directBookmarks(f), folderName(f));
  }

  function openAllInView() {
    if (!state.ready) return;
    const view = computeView();
    const name = view.kind === 'search' ? state.query : view.title;
    openAllInTabs(view.items, name);
  }

  function toggleFavorite(id) {
    if (!isBookmark(get(id))) return;
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    savePrefs({ favorites: [...state.favorites] });
    scheduleRender();
  }

  async function confirmDelete(n) {
    if (!n || isBuiltin(n.id)) return;
    let title;
    let message;
    let done;
    if (isFolder(n)) {
      const total = getCounts().get(n.id) || 0;
      const subs = collectFolders(n.id).length;
      title = t('delete.folder.title');
      message =
        total || subs
          ? t('delete.folder.message', {
              name: folderName(n),
              bookmarks: tn('n.bookmark', total),
              subfolders: tn('n.subfolder', subs),
            })
          : t('delete.folder.empty', { name: folderName(n) });
      done = t('toast.folderDeleted');
    } else if (isSeparator(n)) {
      title = t('delete.separator.title');
      message = t('delete.separator.message', { folder: folderName(get(n.parentId)) });
      done = t('toast.separatorDeleted');
    } else {
      title = t('delete.bookmark.title');
      message = t('delete.bookmark.message', { name: bookmarkTitle(n) });
      done = t('toast.bookmarkDeleted');
    }

    const ok = await confirmDialog({ title, message, confirmLabel: t('action.delete') });
    if (!ok) return;
    await deleteNodes([n], done);
  }

  /** Borra los marcadores seleccionados (con confirmación y opción de deshacer). */
  async function confirmDeleteMany(ids) {
    const nodes = ids.map(get).filter(isBookmark);
    if (!nodes.length) return;
    if (nodes.length === 1) {
      await confirmDelete(nodes[0]);
      return;
    }
    const ok = await confirmDialog({
      title: t('delete.many.title'),
      message: tn('delete.many.message', nodes.length),
      confirmLabel: t('action.delete'),
    });
    if (!ok) return;
    clearSelection();
    await deleteNodes(nodes, tn('toast.deletedMany', nodes.length));
  }

  // ----- Deshacer -----

  const UNDO_TTL = 60_000;

  /** Copia de un nodo y su contenido desde el modelo, con su posición: basta para recrearlo. */
  function snapshotNode(id) {
    const n = get(id);
    const parent = get(n.parentId);
    const copy = (node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      url: node.url,
      children: isFolder(node) ? node.children.map(get).filter(Boolean).map(copy) : [],
    });
    return { ...copy(n), parentId: n.parentId, index: parent ? parent.children.indexOf(id) : -1 };
  }

  /** Muestra el aviso con «Deshacer»; también vale Ctrl+Z mientras siga reciente. */
  function offerUndo(message, run) {
    const entry = { run, at: Date.now() };
    state.undo = entry;
    toast(message, 'info', { label: t('action.undo'), run: () => runUndo(entry) });
  }

  async function runUndo(entry = state.undo) {
    if (!entry || state.undo !== entry || Date.now() - entry.at > UNDO_TTL) return false;
    state.undo = null;
    try {
      await entry.run();
      toast(t('toast.undone'));
    } catch (err) {
      toast(t('toast.undoError', { error: err?.message || err }), 'error');
    }
    return true;
  }

  async function deleteNodes(nodes, message) {
    const snaps = nodes.map((n) => snapshotNode(n.id));
    const removed = [];
    try {
      for (const s of snaps) {
        if (s.type === 'folder') await api.bookmarks.removeTree(s.id);
        else await api.bookmarks.remove(s.id);
        removed.push(s);
      }
    } catch (err) {
      toast(t('toast.deleteError', { error: err?.message || err }), 'error');
    }
    if (removed.length) offerUndo(message, () => restoreSnapshots(removed));
  }

  /** Vuelve a crear lo borrado en su sitio y pasa favoritos, grupos y ajustes a los ids nuevos. */
  async function restoreSnapshots(snaps) {
    const ids = new Map();
    const create = async (s, parentId, index) => {
      const info = { parentId };
      if (index != null) info.index = index;
      if (s.type === 'separator') info.type = 'separator';
      else {
        // Sin URL, Firefox crea una carpeta.
        info.title = s.title;
        if (s.type === 'bookmark') info.url = s.url;
      }
      const created = await api.bookmarks.create(info);
      ids.set(s.id, created.id);
      for (const child of s.children) await create(child, created.id, null);
    };
    try {
      // En orden de posición, para que cada uno vuelva exactamente a su índice.
      for (const s of snaps.toSorted((a, b) => a.index - b.index)) await create(s, s.parentId, Math.max(0, s.index));
    } finally {
      remapRefs(ids);
    }
  }

  function remapRefs(ids) {
    if (!ids.size) return;
    const swap = (id) => ids.get(id) ?? id;
    const swapAll = (set) => new Set([...set].map(swap));
    state.favorites = swapAll(state.favorites);
    for (const g of state.groups) g.items = [...new Set(g.items.map(swap))];
    const colors = Object.create(null);
    for (const [id, color] of Object.entries(state.folderColors)) colors[swap(id)] = color;
    state.folderColors = colors;
    const sepColors = Object.create(null);
    for (const [id, color] of Object.entries(state.separatorColors)) sepColors[swap(id)] = color;
    state.separatorColors = sepColors;
    state.boardCollapsed = swapAll(state.boardCollapsed);
    state.boardShowAll = swapAll(state.boardShowAll);
    state.stripFolders = [...new Set(state.stripFolders.map(swap))];
    for (const pr of state.stripProfiles) pr.folders = [...new Set(pr.folders.map(swap))];
    state.stripOpen = swapAll(state.stripOpen);
    state.expanded = swapAll(state.expanded);
    const patch = {
      stripFolders: [...state.stripFolders],
      stripProfiles: serializeProfiles(),
      stripOpen: [...state.stripOpen],
      favorites: [...state.favorites],
      groups: serializeGroups(),
      folderColors: { ...state.folderColors },
      separatorColors: { ...state.separatorColors },
      boardCollapsed: [...state.boardCollapsed],
      boardShowAll: [...state.boardShowAll],
      expanded: [...state.expanded],
    };
    if (ids.has(state.prefs.homeFolder)) {
      state.prefs.homeFolder = ids.get(state.prefs.homeFolder);
      patch.homeFolder = state.prefs.homeFolder;
    }
    savePrefs(patch);
    scheduleRender();
  }

  /** Posiciones actuales de unos nodos, para devolverlos a su sitio al deshacer. */
  function positionsOf(ids) {
    return ids.map((id) => {
      const n = get(id);
      return { id, parentId: n.parentId, index: get(n.parentId).children.indexOf(id) };
    });
  }

  /**
   * Deja un nodo en la posición final `index` de `parentId`. Firefox interpreta así
   * el índice; Chrome lo cuenta antes de quitarlo de su sitio y se corrige.
   */
  async function placeAt(id, parentId, index) {
    const moved = await api.bookmarks.move(id, { parentId, index });
    if (typeof moved?.index === 'number' && moved.index < index) {
      await api.bookmarks.move(id, { parentId, index: index + 1 });
    }
  }

  /** Mueve `ids` (en ese orden) a `parentId`, justo antes de `beforeId` o al final. */
  async function moveNodes(ids, parentId, beforeId = null) {
    for (const id of ids) {
      if (!beforeId) {
        await api.bookmarks.move(id, { parentId });
        continue;
      }
      const [[item], [anchor]] = await Promise.all([api.bookmarks.get(id), api.bookmarks.get(beforeId)]);
      const same = item.parentId === parentId;
      const index = same && item.index < anchor.index ? anchor.index - 1 : anchor.index;
      if (!same || item.index !== index) await placeAt(id, parentId, index);
    }
  }

  async function restorePositions(list) {
    // En orden de posición: cada nodo vuelve a su índice sin descolocar a los anteriores.
    for (const p of list.toSorted((a, b) => a.index - b.index)) {
      if (get(p.id) && isFolder(get(p.parentId))) await placeAt(p.id, p.parentId, p.index);
    }
  }

  /** Mueve con aviso y «Deshacer». */
  async function moveWithUndo(ids, parentId, beforeId = null) {
    const before = positionsOf(ids);
    const changesFolder = before.some((p) => p.parentId !== parentId);
    for (const id of ids) state.newIds.add(id);
    try {
      await moveNodes(ids, parentId, beforeId);
    } catch (err) {
      toast(t('toast.opError', { error: err?.message || err }), 'error');
      if (ids.length > 1) offerUndo(t('toast.partialMove'), () => restorePositions(before));
      return;
    }
    const folder = folderName(get(parentId));
    const message = !changesFolder
      ? t('toast.reordered')
      : ids.length > 1
        ? tn('toast.movedMany', ids.length, { folder })
        : t('toast.movedTo', { folder });
    offerUndo(message, () => restorePositions(before));
  }

  function confirmDialog({ title, message, confirmLabel, icon: iconName = 'trash', danger = true }) {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-ok').textContent = confirmLabel;
    $('#confirm-ok').className = danger ? 'btn btn-danger' : 'btn btn-primary';
    const iconBox = $('#confirm-icon');
    iconBox.replaceChildren(icon(iconName));
    iconBox.classList.toggle('is-neutral', !danger);
    dlg.returnValue = '';
    dlg.showModal();
    $('#confirm-cancel').focus();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
    });
  }

  // ----- Editor (crear / renombrar / mover) -----

  function fillFolderSelect(select, selectedId, excludeId) {
    const options = [];
    const visit = (id, depth) => {
      const f = get(id);
      if (!isFolder(f) || id === excludeId) return;
      if (id !== state.rootId) {
        options.push(el('option', { value: id, text: '   '.repeat(depth) + folderName(f) }));
      }
      for (const cid of f.children) {
        if (isFolder(get(cid))) visit(cid, id === state.rootId ? 0 : depth + 1);
      }
    };
    visit(state.rootId, 0);
    select.replaceChildren(...options);
    if (options.some((o) => o.value === selectedId)) select.value = selectedId;
  }

  function setEditorError(message) {
    const box = $('#edit-error');
    box.textContent = message;
    box.hidden = !message;
  }

  /** Diálogo «Mover a…» para varios marcadores a la vez (solo la carpeta de destino). */
  function openMoveManyDialog(ids) {
    if (!state.ready || !ids.length) return;
    closeMenu();
    state.editor = { mode: 'move-many', nodeId: null, ids };
    $('#edit-heading').textContent = tn('selection.moveTitle', ids.length);
    $('#edit-submit').textContent = t('editor.submitMove');
    $('#edit-name-row').hidden = true;
    $('#edit-url-row').hidden = true;
    const parents = new Set(ids.map((id) => get(id)?.parentId));
    const target = parents.size === 1 ? [...parents][0] : isFolder(get(state.selected)) ? state.selected : null;
    fillFolderSelect($('#edit-parent'), target || defaultParentId(), null);
    setEditorError('');
    $('#edit-dialog').showModal();
    $('#edit-parent').focus();
  }

  function openEditor({ mode, node = null, parentId = null, focus = 'auto' }) {
    if (!state.ready) return;
    closeMenu();
    const folderMode = mode === 'new-folder' || (mode === 'edit' && isFolder(node));
    state.editor = { mode, nodeId: node?.id ?? null };
    $('#edit-name-row').hidden = false;

    const headings = {
      'new-bookmark': t('editor.newBookmark'),
      'new-folder': t('editor.newFolder'),
      edit: t(folderMode ? 'editor.editFolder' : 'editor.editBookmark'),
    };
    $('#edit-heading').textContent = focus === 'folder' ? t('editor.move') : headings[mode];
    $('#edit-submit').textContent =
      mode === 'edit' ? t(focus === 'folder' ? 'editor.submitMove' : 'action.save') : t('editor.submitCreate');

    const nameInput = $('#edit-name');
    const urlInput = $('#edit-url');
    const select = $('#edit-parent');
    nameInput.value = node ? node.title : '';
    nameInput.placeholder = t(folderMode ? 'editor.folderPlaceholder' : 'editor.namePlaceholder');
    urlInput.value = node?.url || '';
    $('#edit-url-row').hidden = folderMode;

    const target = node ? node.parentId : parentId && isFolder(get(parentId)) ? parentId : defaultParentId();
    fillFolderSelect(select, target, folderMode && node ? node.id : null);
    setEditorError('');

    $('#edit-dialog').showModal();
    const focusEl = focus === 'folder' ? select : mode === 'new-bookmark' ? urlInput : nameInput;
    focusEl.focus();
    if (focusEl instanceof HTMLInputElement) focusEl.select();
  }

  async function submitEditor(event) {
    event.preventDefault();
    const dlg = $('#edit-dialog');
    const { mode, nodeId } = state.editor;
    const node = get(nodeId);
    const name = $('#edit-name').value.trim();
    const rawUrl = $('#edit-url').value.trim();
    const parentId = $('#edit-parent').value;
    const folderMode = mode === 'new-folder' || isFolder(node);

    if (mode === 'move-many') {
      if (!isFolder(get(parentId)) || parentId === state.rootId) {
        setEditorError(t('editor.invalidParent'));
        return;
      }
      const ids = state.editor.ids.filter((id) => isBookmark(get(id)));
      dlg.close();
      if (!ids.length) {
        toast(t('editor.gone'), 'error');
        return;
      }
      clearSelection();
      await moveWithUndo(ids, parentId);
      return;
    }

    if (mode === 'edit' && !node) {
      dlg.close();
      toast(t('editor.gone'), 'error');
      return;
    }
    if (!isFolder(get(parentId)) || parentId === state.rootId) {
      setEditorError(t('editor.invalidParent'));
      return;
    }

    let url = '';
    if (folderMode) {
      if (!name) {
        setEditorError(t('editor.needName'));
        $('#edit-name').focus();
        return;
      }
    } else if (node && rawUrl === node.url) {
      url = node.url;
    } else {
      url = normalizeUrl(rawUrl);
      if (!url) {
        setEditorError(t('editor.badUrl'));
        $('#edit-url').focus();
        return;
      }
    }

    const submit = $('#edit-submit');
    submit.disabled = true;
    try {
      if (mode === 'new-bookmark') {
        await api.bookmarks.create({ parentId, title: name || hostOf(url) || url, url });
        toast(t('toast.bookmarkCreated', { folder: folderName(get(parentId)) }));
      } else if (mode === 'new-folder') {
        await api.bookmarks.create({ parentId, title: name });
        if (!state.expanded.has(parentId)) {
          state.expanded.add(parentId);
          saveExpanded();
        }
        toast(t('toast.folderCreated'));
      } else {
        const changes = {};
        if (name !== node.title.trim()) changes.title = name;
        if (!folderMode && url !== node.url) changes.url = url;
        if (Object.keys(changes).length) await api.bookmarks.update(node.id, changes);
        if (parentId !== node.parentId) {
          const before = positionsOf([node.id]);
          await api.bookmarks.move(node.id, { parentId });
          offerUndo(t('toast.movedTo', { folder: folderName(get(parentId)) }), () => restorePositions(before));
        } else {
          toast(t('toast.saved'));
        }
      }
      dlg.close();
    } catch (err) {
      setEditorError(t('editor.rejected', { error: err?.message || err }));
    } finally {
      submit.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Grupos locales (panel derecho). Solo guardan ids de marcadores en
  // browser.storage.local: nunca crean, mueven ni borran marcadores de Firefox.
  // ---------------------------------------------------------------------------

  function sanitizeGroups(raw) {
    const out = [];
    const seen = new Set();
    for (const g of raw) {
      if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue;
      seen.add(g.id);
      const name = typeof g.name === 'string' ? g.name.trim().slice(0, GROUP_NAME_MAX) : '';
      out.push({
        id: g.id,
        name: name || '…',
        color: GROUP_COLORS.includes(g.color) ? g.color : GROUP_COLORS[0],
        items: Array.isArray(g.items) ? [...new Set(g.items.filter((x) => typeof x === 'string'))] : [],
        collapsed: g.collapsed === true,
      });
    }
    return out;
  }

  const getGroup = (gid) => (gid ? state.groups.find((g) => g.id === gid) || null : null);
  // Los ids de marcadores borrados se conservan (como los destacados) por si se deshace el borrado.
  const groupBookmarks = (g) => g.items.map(get).filter(isBookmark);
  const serializeGroups = () =>
    state.groups.map((g) => ({ id: g.id, name: g.name, color: g.color, items: [...g.items], collapsed: g.collapsed }));

  function saveGroups({ rerender = true } = {}) {
    savePrefs({ groups: serializeGroups() });
    if (rerender) scheduleRender();
  }

  function buildGroupIndex() {
    const index = new Map();
    for (const g of state.groups) {
      for (const id of g.items) {
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(g);
      }
    }
    state.groupIndex = index;
  }

  function nextGroupColor() {
    const used = new Set(state.groups.map((g) => g.color));
    return GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[state.groups.length % GROUP_COLORS.length];
  }

  const newGroupId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** Añade un marcador a un grupo; si viene arrastrado desde otro grupo, lo mueve. */
  function addToGroup(gid, bookmarkId, fromGid = null) {
    const g = getGroup(gid);
    if (!g || !isBookmark(get(bookmarkId)) || fromGid === gid) return;
    const already = g.items.includes(bookmarkId);
    const from = getGroup(fromGid);
    if (already && !from) {
      toast(t('toast.alreadyInGroup', { name: g.name }));
      return;
    }
    if (!already) g.items.push(bookmarkId);
    if (from) removeFromArray(from.items, bookmarkId);
    g.collapsed = false;
    state.newGroupItem = `${g.id}|${bookmarkId}`;
    saveGroups();
    toast(t(from ? 'toast.movedToGroup' : 'toast.addedToGroup', { name: g.name }));
  }

  function removeFromGroup(gid, bookmarkId) {
    const g = getGroup(gid);
    if (!g || !g.items.includes(bookmarkId)) return;
    removeFromArray(g.items, bookmarkId);
    saveGroups();
    toast(t('toast.removedFromGroup', { name: g.name }));
  }

  function toggleGroupCollapsed(gid) {
    const g = getGroup(gid);
    if (!g) return;
    g.collapsed = !g.collapsed;
    syncGroupCollapsed(g); // sin recrear el DOM, para que se anime
    saveGroups({ rerender: false });
  }

  function moveGroup(gid, delta) {
    const i = state.groups.findIndex((g) => g.id === gid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.groups.length) return;
    const [g] = state.groups.splice(i, 1);
    state.groups.splice(j, 0, g);
    saveGroups();
  }

  async function confirmDeleteGroup(gid) {
    const g = getGroup(gid);
    if (!g) return;
    const ok = await confirmDialog({
      title: t('delete.group.title'),
      message: t('delete.group.message', { name: g.name }),
      confirmLabel: t('action.delete'),
    });
    if (!ok) return;
    state.groups = state.groups.filter((x) => x.id !== gid);
    saveGroups();
    toast(t('toast.groupDeleted'));
  }

  function openGroupInTabs(gid) {
    const g = getGroup(gid);
    if (g) openAllInTabs(groupBookmarks(g), g.name);
  }

  // ----- Diálogo de grupo (crear / editar) -----

  function setGroupError(message) {
    const box = $('#group-error');
    box.textContent = message;
    box.hidden = !message;
  }

  function openGroupDialog({ group = null, addBookmarkId = null, addBookmarkIds = [] } = {}) {
    if (!state.ready) return;
    closeMenu();
    const ids = addBookmarkId ? [addBookmarkId, ...addBookmarkIds] : addBookmarkIds;
    state.groupEditor = { id: group?.id ?? null, addBookmarkIds: [...new Set(ids)] };
    $('#group-heading').textContent = t(group ? 'group.edit' : 'groups.new');
    $('#group-submit').textContent = t(group ? 'action.save' : 'editor.submitCreate');
    const nameInput = $('#group-name');
    nameInput.value = group ? group.name : '';
    const current = group ? group.color : nextGroupColor();
    $('#group-colors').replaceChildren(
      ...GROUP_COLORS.map((c) =>
        el(
          'label',
          { class: 'swatch', title: t(`color.${c}`), dataset: { color: c } },
          el('input', {
            type: 'radio',
            name: 'group-color',
            value: c,
            checked: c === current,
            'aria-label': t(`color.${c}`),
          }),
          el('span', { class: 'swatch-dot' }, icon('check')),
        ),
      ),
    );
    setGroupError('');
    $('#group-dialog').showModal();
    nameInput.focus();
    nameInput.select();
  }

  function submitGroupDialog(event) {
    event.preventDefault();
    const dlg = $('#group-dialog');
    const name = $('#group-name').value.trim().slice(0, GROUP_NAME_MAX);
    const picked = $('#group-form').querySelector('input[name="group-color"]:checked')?.value;
    const color = GROUP_COLORS.includes(picked) ? picked : nextGroupColor();
    if (!name) {
      setGroupError(t('group.needName'));
      $('#group-name').focus();
      return;
    }
    const { id, addBookmarkIds } = state.groupEditor;
    if (id) {
      const g = getGroup(id);
      dlg.close();
      if (!g) {
        toast(t('editor.gone'), 'error');
        return;
      }
      g.name = name;
      g.color = color;
      saveGroups();
      toast(t('toast.groupSaved'));
      return;
    }
    const g = { id: newGroupId(), name, color, items: [], collapsed: false };
    g.items = addBookmarkIds.filter((bid) => isBookmark(get(bid)));
    if (g.items.length === 1) state.newGroupItem = `${g.id}|${g.items[0]}`;
    state.groups.push(g);
    saveGroups();
    dlg.close();
    if (addBookmarkIds.length > 1) clearSelection();
    showGroupsPanel();
    toast(t('toast.groupCreated', { name }));
  }

  // ----- Panel: visibilidad -----

  const isGroupsOverlay = () => GROUPS_OVERLAY.matches;

  function groupsVisible() {
    return isGroupsOverlay() ? document.body.classList.contains('groups-open') : state.prefs.groupsPanel;
  }

  function updateGroupsBtn() {
    $('#groups-btn').setAttribute('aria-pressed', String(groupsVisible()));
  }

  function applyGroupsPanel() {
    document.body.classList.toggle('groups-hidden', !state.prefs.groupsPanel);
    updateGroupsBtn();
  }

  function toggleGroupsPanel() {
    if (isGroupsOverlay()) {
      document.body.classList.toggle('groups-open');
      updateGroupsBtn();
    } else {
      setPref('groupsPanel', !state.prefs.groupsPanel);
    }
  }

  function showGroupsPanel() {
    if (isGroupsOverlay()) {
      document.body.classList.add('groups-open');
      updateGroupsBtn();
    } else if (!state.prefs.groupsPanel) {
      setPref('groupsPanel', true);
    }
  }

  function closeGroupsOverlay() {
    document.body.classList.remove('groups-open');
    updateGroupsBtn();
  }

  // ----- Panel: render -----

  function renderGroups() {
    $('#groups-count').textContent = state.groups.length ? numberFmt.format(state.groups.length) : '';
    // El estado contraído no forma parte de la firma: se aplica sin recrear el DOM.
    const sig = [
      lang,
      state.prefs.showFavicons,
      state.prefs.openInNewTab,
      ...state.groups.map((g) =>
        [g.id, g.name, g.color, ...groupBookmarks(g).map((n) => `${n.id}\u0003${n.title}\u0003${n.url}`)].join(
          '\u0002',
        ),
      ),
    ].join('\u0001');
    if (sig !== state.groupsSig) {
      state.groupsSig = sig;
      const list = $('#group-list');
      const children = state.groups.map(groupEl);
      if (!state.groups.length) children.push(groupsEmpty());
      children.push(
        el(
          'li',
          {},
          el(
            'button',
            { class: 'group-add', type: 'button', dataset: { action: 'group-create', groupDrop: 'new' } },
            icon('plus'),
            el('span', { text: t('groups.new') }),
          ),
        ),
      );
      list.replaceChildren(...children);
    }
    state.newGroupItem = null;
    for (const g of state.groups) syncGroupCollapsed(g);
  }

  function groupEl(g) {
    const items = groupBookmarks(g);
    const li = el('li', { class: 'group', dataset: { groupId: g.id, groupDrop: g.id, color: g.color } });
    const head = el(
      'div',
      { class: 'group-head' },
      el(
        'button',
        { class: 'group-toggle', type: 'button', dataset: { action: 'group-toggle' } },
        icon('chevron', 'group-chevron'),
        el('span', { class: 'group-dot' }),
        el('span', { class: 'group-name', text: g.name }),
        el('span', { class: 'group-count', text: numberFmt.format(items.length) }),
      ),
      el(
        'button',
        {
          class: 'icon-btn icon-btn-sm',
          type: 'button',
          title: t('action.more'),
          'aria-label': t('action.more'),
          'aria-haspopup': 'menu',
          dataset: { action: 'group-more' },
        },
        icon('more'),
      ),
    );
    const list = el('ul', { class: 'group-items' });
    if (items.length) for (const n of items) list.append(groupItemEl(n, g));
    else list.append(el('li', { class: 'group-empty', text: t('group.dropHere') }));
    li.append(head, el('div', { class: 'group-collapse' }, list));
    return li;
  }

  function groupItemEl(n, g) {
    const title = bookmarkTitle(n);
    const openable = isOpenable(n.url);
    const link = el(
      'a',
      {
        class: openable ? 'group-link' : 'group-link is-blocked',
        draggable: 'false',
        title: n.url ? `${title}\n${n.url}` : title,
      },
      title,
    );
    if (openable) {
      link.href = n.url;
      link.referrerPolicy = 'no-referrer';
      if (state.prefs.openInNewTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      link.href = '#';
      link.dataset.action = 'open-blocked';
    }
    const li = el(
      'li',
      { class: 'group-item', draggable: 'true', dataset: { id: n.id, dragId: n.id, fromGroup: g.id } },
      faviconEl(n, title),
      link,
      el(
        'button',
        {
          class: 'icon-btn icon-btn-sm group-remove',
          type: 'button',
          title: t('group.remove'),
          'aria-label': t('group.remove'),
          dataset: { action: 'group-remove' },
        },
        icon('close'),
      ),
    );
    if (state.newGroupItem === `${g.id}|${n.id}`) markNew(li);
    return li;
  }

  function groupsEmpty() {
    return el(
      'li',
      { class: 'groups-empty' },
      el('div', { class: 'empty-icon' }, icon('groups')),
      el('strong', { text: t('groups.empty.title') }),
      el('p', { text: t('groups.empty.text') }),
    );
  }

  function syncGroupCollapsed(g) {
    const li = $(`#group-list .group[data-group-id="${CSS.escape(g.id)}"]`);
    if (!li) return;
    li.classList.toggle('is-collapsed', g.collapsed);
    const btn = li.querySelector('.group-toggle');
    btn.setAttribute('aria-expanded', String(!g.collapsed));
    btn.title = t(g.collapsed ? 'group.expand' : 'group.collapse');
  }

  // ----- Panel: menús -----

  function groupMenu(g) {
    const items = groupBookmarks(g);
    const i = state.groups.findIndex((x) => x.id === g.id);
    return [
      items.some((n) => isOpenable(n.url)) && {
        label: t('menu.openAll'),
        icon: 'tabs',
        run: () => openGroupInTabs(g.id),
      },
      { label: t('menu.editGroup'), icon: 'edit', run: () => openGroupDialog({ group: getGroup(g.id) }) },
      i > 0 && { label: t('menu.moveUp'), icon: 'arrow-up', run: () => moveGroup(g.id, -1) },
      i < state.groups.length - 1 && { label: t('menu.moveDown'), icon: 'arrow-down', run: () => moveGroup(g.id, 1) },
      '-',
      { label: t('menu.deleteGroup'), icon: 'trash', danger: true, run: () => confirmDeleteGroup(g.id) },
    ];
  }

  function groupItemMenu(n, g) {
    const openable = isOpenable(n.url);
    return [
      openable && { label: t('menu.open'), icon: 'link', run: () => openUrl(n.url, state.prefs.openInNewTab) },
      openable && { label: t('menu.openNewTab'), icon: 'external', run: () => openUrl(n.url, true) },
      { label: t('menu.copyUrl'), icon: 'copy', run: () => copyUrl(n) },
      { label: t('menu.gotoFolder'), icon: 'folder', run: () => selectView(n.parentId) },
      '-',
      { label: t('group.remove'), icon: 'minus', run: () => removeFromGroup(g.id, n.id) },
    ];
  }

  /** Submenú «Añadir a un grupo»: marca los grupos que ya lo contienen (clic = quitar). */
  function openAddToGroupMenu(n, anchor) {
    if (!state.groups.length) {
      openGroupDialog({ addBookmarkId: n.id });
      return;
    }
    const inGroups = new Set((state.groupIndex.get(n.id) || []).map((g) => g.id));
    const fallback = { x: innerWidth / 2, y: innerHeight / 3 };
    openMenu(
      [
        ...state.groups.map((g) => ({
          label: g.name,
          dot: g.color,
          checked: inGroups.has(g.id),
          run: () => (inGroups.has(g.id) ? removeFromGroup(g.id, n.id) : addToGroup(g.id, n.id)),
        })),
        '-',
        { label: t('menu.newGroup'), icon: 'plus', run: () => openGroupDialog({ addBookmarkId: n.id }) },
      ],
      anchor instanceof Element ? (anchor.isConnected ? anchor : fallback) : anchor || fallback,
    );
  }

  /** Añade varios marcadores a un grupo (los que ya estaban no se duplican). */
  function addManyToGroup(gid, ids) {
    const g = getGroup(gid);
    if (!g) return;
    const added = ids.filter((id) => isBookmark(get(id)) && !g.items.includes(id));
    if (!added.length) {
      toast(t('toast.alreadyInGroup', { name: g.name }));
      return;
    }
    g.items.push(...added);
    g.collapsed = false;
    saveGroups();
    clearSelection();
    toast(tn('toast.addedManyToGroup', added.length, { name: g.name }));
  }

  function openGroupMenuForMany(ids, anchor) {
    if (!state.groups.length) {
      openGroupDialog({ addBookmarkIds: ids });
      return;
    }
    openMenu(
      [
        ...state.groups.map((g) => ({ label: g.name, dot: g.color, run: () => addManyToGroup(g.id, ids) })),
        '-',
        { label: t('menu.newGroup'), icon: 'plus', run: () => openGroupDialog({ addBookmarkIds: ids }) },
      ],
      anchor,
    );
  }

  // ---------------------------------------------------------------------------
  // Menú contextual
  // ---------------------------------------------------------------------------

  function bookmarkMenu(n) {
    const fav = state.favorites.has(n.id);
    const openable = isOpenable(n.url);
    return [
      openable && { label: t('menu.open'), icon: 'link', run: () => openUrl(n.url, state.prefs.openInNewTab) },
      openable && { label: t('menu.openNewTab'), icon: 'external', run: () => openUrl(n.url, true) },
      { label: t('menu.copyUrl'), icon: 'copy', run: () => copyUrl(n) },
      { label: t(fav ? 'action.unstar' : 'action.star'), icon: 'star', run: () => toggleFavorite(n.id) },
      '-',
      { label: t('menu.edit'), icon: 'edit', run: () => openEditor({ mode: 'edit', node: n }) },
      { label: t('menu.moveTo'), icon: 'move', run: () => openEditor({ mode: 'edit', node: n, focus: 'folder' }) },
      state.selected !== n.parentId && {
        label: t('menu.gotoFolder'),
        icon: 'folder',
        run: () => selectView(n.parentId),
      },
      { label: t('menu.addToGroup'), icon: 'groups', run: () => openAddToGroupMenu(n, state.menuAnchor) },
      {
        label: t(state.selection.has(n.id) ? 'menu.unselect' : 'menu.select'),
        icon: 'check',
        run: () => toggleSelected(n.id),
      },
      '-',
      { label: t('menu.delete'), icon: 'trash', danger: true, run: () => confirmDelete(n) },
    ];
  }

  // ---------------------------------------------------------------------------
  // Copia de seguridad de los datos locales: grupos, colores de carpeta,
  // destacados y ajustes. Los marcadores de Firefox no se incluyen ni se tocan.
  // ---------------------------------------------------------------------------

  // Identificador interno del formato: se conserva el del nombre anterior para
  // que las copias ya exportadas se sigan pudiendo importar.
  const BACKUP_FORMAT = 'bookmark-dashboard-backup';
  const BACKUP_VERSION = 1;
  const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
  const BACKUP_PREFS = {
    lang: (v) => LANGS.includes(v),
    theme: (v) => THEMES.includes(v),
    corners: (v) => CORNERS.includes(v),
    accentColor: (v) => ACCENT_COLORS.includes(v),
    folderColor: (v) => FOLDER_COLORS.includes(v),
    sidebarPanel: (v) => typeof v === 'boolean',
    minimal: (v) => typeof v === 'boolean',
    stripe: (v) => typeof v === 'boolean',
    stripeColor: (v) => STRIPE_COLORS.includes(v),
    stripeWidth: (v) => STRIPE_WIDTHS.includes(v),
    boardColumns: (v) => BOARD_COLUMNS.includes(v),
    contentWidth: (v) => CONTENT_WIDTHS.includes(v),
    tabTitle: (v) => typeof v === 'string' && v.length <= TAB_TITLE_MAX * 4,
    tabTitleFolder: (v) => typeof v === 'boolean',
    view: (v) => VIEW_MODES.includes(v),
    sort: (v) => SORTS.includes(v),
    openInNewTab: (v) => typeof v === 'boolean',
    showFavicons: (v) => typeof v === 'boolean',
    includeSubfolders: (v) => typeof v === 'boolean',
    groupsPanel: (v) => typeof v === 'boolean',
  };
  const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** Ruta con los títulos originales: identifica una carpeta en otro perfil u ordenador. */
  function rawFolderPath(id) {
    const n = get(id);
    return n ? [...ancestors(id).map((a) => a.title), n.title].join('\u001f') : '';
  }

  function buildBackup() {
    const bookmarkIds = new Set(state.favorites);
    for (const g of state.groups) for (const id of g.items) bookmarkIds.add(id);
    const folderIds = new Set([
      ...Object.keys(state.folderColors),
      ...state.boardCollapsed,
      ...state.boardShowAll,
      ...state.stripFolders,
      ...state.stripProfiles.flatMap((pr) => pr.folders),
      ...state.stripOpen,
      ...state.expanded,
      state.prefs.homeFolder,
    ]);

    // URL y título de cada marcador referenciado (y ruta de cada carpeta), para
    // poder reconocerlos aunque en otro perfil tengan otro id interno.
    const bookmarks = {};
    for (const id of bookmarkIds) {
      const n = get(id);
      if (isBookmark(n)) bookmarks[id] = { url: n.url, title: n.title };
    }
    const folders = {};
    for (const id of folderIds) {
      const f = get(id);
      if (isFolder(f)) folders[id] = { title: f.title, path: rawFolderPath(id) };
    }
    // Los separadores no tienen título ni URL: se reconocen por su carpeta y su posición.
    const separators = {};
    for (const id of Object.keys(state.separatorColors)) {
      const ref = separatorRef(id);
      if (ref) separators[id] = ref;
    }
    const prefs = {};
    for (const key of Object.keys(BACKUP_PREFS)) prefs[key] = state.prefs[key];
    let app = '';
    try {
      app = api.runtime?.getManifest?.().version || '';
    } catch {
      /* sin versión */
    }
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app,
      exportedAt: new Date().toISOString(),
      prefs,
      homeFolder: state.prefs.homeFolder,
      favorites: [...state.favorites],
      groups: serializeGroups(),
      folderColors: { ...state.folderColors },
      separatorColors: Object.fromEntries(Object.entries(state.separatorColors).filter(([id]) => separators[id])),
      boardCollapsed: [...state.boardCollapsed],
      boardShowAll: [...state.boardShowAll],
      stripFolders: [...state.stripFolders],
      stripProfiles: serializeProfiles(),
      stripProfile: state.stripProfile,
      stripOpen: [...state.stripOpen],
      expanded: [...state.expanded],
      refs: { bookmarks, folders, separators },
    };
  }

  function exportBackup() {
    if (!state.ready) return;
    try {
      const json = JSON.stringify(buildBackup(), null, 2);
      const d = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const file = `bookmark-control-panel-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = el('a', { href: url, download: file, hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(t('toast.exported', { file }));
    } catch (err) {
      toast(t('toast.exportError', { error: err?.message || err }), 'error');
    }
  }

  /** Traduce ids de la copia a ids de este perfil (por id, URL o ruta de carpeta). */
  function makeRemapper(refs) {
    const bookmarkRefs = isPlainObject(refs?.bookmarks) ? refs.bookmarks : {};
    const folderRefs = isPlainObject(refs?.folders) ? refs.folders : {};
    const separatorRefs = isPlainObject(refs?.separators) ? refs.separators : {};
    let byUrl = null;
    let byPath = null;
    const buildIndex = () => {
      if (byUrl) return;
      byUrl = new Map();
      byPath = new Map();
      for (const n of state.nodes.values()) {
        if (isBookmark(n)) {
          if (!byUrl.has(n.url)) byUrl.set(n.url, []);
          byUrl.get(n.url).push(n);
        } else if (isFolder(n)) {
          const path = rawFolderPath(n.id);
          if (!byPath.has(path)) byPath.set(path, n);
        }
      }
    };
    return {
      bookmark(id) {
        if (typeof id !== 'string') return null;
        if (isBookmark(get(id))) return id; // mismo perfil o sincronizado: el id es el mismo
        const ref = Object.hasOwn(bookmarkRefs, id) ? bookmarkRefs[id] : null;
        if (!isPlainObject(ref) || typeof ref.url !== 'string') return null;
        buildIndex();
        const candidates = byUrl.get(ref.url) || [];
        return (candidates.find((n) => n.title === ref.title) || candidates[0])?.id ?? null;
      },
      folder(id) {
        if (typeof id !== 'string') return null;
        if (isFolder(get(id))) return id;
        const ref = Object.hasOwn(folderRefs, id) ? folderRefs[id] : null;
        if (!isPlainObject(ref) || typeof ref.path !== 'string') return null;
        buildIndex();
        return byPath.get(ref.path)?.id ?? null;
      },
      separator(id) {
        if (typeof id !== 'string') return null;
        if (isSeparator(get(id))) return id;
        const ref = Object.hasOwn(separatorRefs, id) ? separatorRefs[id] : null;
        if (!isPlainObject(ref) || typeof ref.path !== 'string' || !Number.isInteger(ref.nth)) return null;
        buildIndex();
        const parent = byPath.get(ref.path);
        return parent?.children.map(get).filter(isSeparator)[ref.nth]?.id ?? null;
      },
    };
  }

  function planImport(data) {
    const map = makeRemapper(data.refs);
    const missing = new Set();
    const mapBookmarks = (list) => {
      const out = [];
      for (const id of Array.isArray(list) ? list : []) {
        const found = map.bookmark(id);
        if (!found) missing.add(id);
        else if (!out.includes(found)) out.push(found);
      }
      return out;
    };
    const mapFolders = (list) => [
      ...new Set((Array.isArray(list) ? list : []).map((id) => map.folder(id)).filter(Boolean)),
    ];

    const favorites = mapBookmarks(data.favorites);
    const groups = sanitizeGroups(Array.isArray(data.groups) ? data.groups : []).map((g) => ({
      ...g,
      items: mapBookmarks(g.items),
    }));
    const folderColors = {};
    if (isPlainObject(data.folderColors)) {
      for (const [id, color] of Object.entries(data.folderColors)) {
        const found = GROUP_COLORS.includes(color) ? map.folder(id) : null;
        if (found) folderColors[found] = color;
      }
    }
    const separatorColors = {};
    if (isPlainObject(data.separatorColors)) {
      for (const [id, color] of Object.entries(data.separatorColors)) {
        const found = GROUP_COLORS.includes(color) ? map.separator(id) : null;
        if (found) separatorColors[found] = color;
      }
    }
    const prefs = {};
    if (isPlainObject(data.prefs)) {
      for (const [key, valid] of Object.entries(BACKUP_PREFS)) {
        if (Object.hasOwn(data.prefs, key) && valid(data.prefs[key])) prefs[key] = data.prefs[key];
      }
    }
    // La carpeta de inicio es un id de carpeta (o una vista) que también se traduce.
    const home =
      typeof data.homeFolder === 'string'
        ? isView(data.homeFolder)
          ? data.homeFolder
          : map.folder(data.homeFolder)
        : null;
    if (home) prefs.homeFolder = home;
    return {
      values: {
        ...prefs,
        favorites,
        groups,
        folderColors,
        separatorColors,
        boardCollapsed: mapFolders(data.boardCollapsed),
        boardShowAll: mapFolders(data.boardShowAll),
        stripFolders: mapFolders(data.stripFolders),
        // Copias anteriores a los perfiles: solo traen la tira (va al perfil activo).
        ...(Array.isArray(data.stripProfiles) && {
          stripProfiles: sanitizeProfiles(data.stripProfiles).map((pr) => ({ ...pr, folders: mapFolders(pr.folders) })),
          ...(typeof data.stripProfile === 'string' && { stripProfile: data.stripProfile }),
        }),
        stripOpen: mapFolders(data.stripOpen),
        expanded: mapFolders(data.expanded),
      },
      missing: missing.size,
    };
  }

  async function importBackupFile(file) {
    if (!file || !state.ready) return;
    let data;
    try {
      if (file.size > BACKUP_MAX_BYTES) throw new Error(t('backup.tooLarge'));
      data = JSON.parse(await file.text());
    } catch (err) {
      toast(t('toast.importError', { error: err?.message || err }), 'error');
      return;
    }
    if (
      !isPlainObject(data) ||
      data.format !== BACKUP_FORMAT ||
      !Number.isInteger(data.version) ||
      data.version > BACKUP_VERSION
    ) {
      toast(t('toast.importInvalid'), 'error');
      return;
    }

    const { values, missing } = planImport(data);
    const summary = [
      tn('n.group', values.groups.length),
      tn('n.starredItem', values.favorites.length),
      tn('n.folderColor', Object.keys(values.folderColors).length),
    ].join(' · ');
    const created = new Date(data.exportedAt);
    const message = [
      Number.isNaN(created.getTime()) ? '' : t('import.created', { date: dateTimeFmt.format(created) }),
      t('import.confirmMessage', { summary }),
      missing ? tn('import.missing', missing) : '',
    ]
      .filter(Boolean)
      .join(' ');
    const ok = await confirmDialog({
      title: t('import.confirmTitle'),
      message,
      confirmLabel: t('import.confirm'),
      icon: 'upload',
      danger: false,
    });
    if (!ok) return;

    try {
      await api.storage.local.set(values);
    } catch (err) {
      toast(t('toast.importError', { error: err?.message || err }), 'error');
      return;
    }
    // storage.onChanged también lo aplicaría; se aplica ya para no esperar.
    applyPrefs(values);
    applyLanguage();
    applyTheme(true);
    applyCorners();
    applyAccent();
    applySidebar();
    applyMinimal();
    applyStripe();
    applyBoardColumns();
    applyTabTitle();
    applyGroupsPanel();
    syncControls();
    scheduleRender();
    toast([t('toast.imported'), missing ? tn('toast.importMissing', missing) : ''].filter(Boolean).join(' · '));
  }

  // ----- Color propio de cada carpeta (solo en esta extensión; Firefox no guarda colores) -----

  /** Aplica el color elegido para la carpeta `id` a un elemento (o quita el que tuviera). */
  function paintFolder(node, id) {
    const color = id ? state.folderColors[id] : undefined;
    node.classList.toggle('has-color', !!color);
    if (color) node.dataset.color = color;
    else delete node.dataset.color;
    return node;
  }

  function setFolderColor(id, color) {
    if (GROUP_COLORS.includes(color)) state.folderColors[id] = color;
    else delete state.folderColors[id];
    savePrefs({ folderColors: { ...state.folderColors } });
    scheduleRender();
  }

  /**
   * Fila de colores para un menú (openMenu la pinta como puntos): un clic elige el
   * color y el último punto («Predeterminado») lo quita.
   */
  const colorRow = (current, set) => ({ colors: true, current: current || null, set });

  /** Puntos de color dentro del menú: un clic elige y cierra. */
  function menuColors(item) {
    const swatch = (color, label) =>
      el(
        'button',
        {
          class: color ? 'menu-swatch' : 'menu-swatch is-default',
          type: 'button',
          role: 'menuitemradio',
          title: label,
          'aria-label': label,
          'aria-checked': String(item.current === color),
          dataset: { color: color || null },
          onclick: () => {
            closeMenu();
            item.set(color);
          },
        },
        el('span', { class: 'menu-swatch-dot' }),
      );
    return el(
      'div',
      { class: 'menu-colors', role: 'group', 'aria-label': t('menu.color') },
      el('span', { class: 'menu-colors-label', text: t('menu.color') }),
      el(
        'div',
        { class: 'menu-swatches' },
        ...GROUP_COLORS.map((c) => swatch(c, t(`color.${c}`))),
        swatch(null, t('color.default')),
      ),
    );
  }

  // ----- Color de los separadores (también solo en esta extensión) -----

  const isColorMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  function cleanColors(map) {
    const colors = Object.create(null);
    for (const [id, color] of Object.entries(map)) if (GROUP_COLORS.includes(color)) colors[id] = color;
    return colors;
  }

  function paintSeparator(node, id) {
    const color = state.separatorColors[id];
    node.classList.toggle('has-color', !!color);
    if (color) node.dataset.color = color;
    else delete node.dataset.color;
    return node;
  }

  function setSeparatorColor(id, color) {
    if (GROUP_COLORS.includes(color)) state.separatorColors[id] = color;
    else delete state.separatorColors[id];
    savePrefs({ separatorColors: { ...state.separatorColors } });
    scheduleRender();
  }

  /** Carpeta (por ruta) y posición entre sus separadores: lo que identifica a uno en otro perfil. */
  function separatorRef(id) {
    const n = get(id);
    const parent = isSeparator(n) ? get(n.parentId) : null;
    if (!isFolder(parent)) return null;
    return { path: rawFolderPath(parent.id), nth: parent.children.map(get).filter(isSeparator).indexOf(n) };
  }

  function folderMenu(f) {
    const builtin = isBuiltin(f.id);
    const direct = directBookmarks(f);
    return [
      { label: t('menu.open'), icon: 'folder', run: () => selectView(f.id) },
      direct.some((n) => isOpenable(n.url)) && {
        label: t('menu.openAll'),
        icon: 'tabs',
        run: () => openFolderInTabs(f.id),
      },
      {
        label: t('menu.newBookmarkHere'),
        icon: 'bookmark',
        run: () => openEditor({ mode: 'new-bookmark', parentId: f.id }),
      },
      {
        label: t('menu.newSubfolder'),
        icon: 'folder-plus',
        run: () => openEditor({ mode: 'new-folder', parentId: f.id }),
      },
      homeId() !== f.id && { label: t('menu.setHome'), icon: 'home', run: () => setHomeFolder(f.id) },
      {
        label: t(inStrip(f.id) ? 'menu.stripRemove' : 'menu.stripAdd'),
        icon: 'strip',
        run: () => toggleStrip(f.id),
      },
      '-',
      colorRow(state.folderColors[f.id], (c) => setFolderColor(f.id, c)),
      !builtin && '-',
      !builtin && { label: t('menu.rename'), icon: 'edit', run: () => openEditor({ mode: 'edit', node: f }) },
      !builtin && {
        label: t('menu.moveTo'),
        icon: 'move',
        run: () => openEditor({ mode: 'edit', node: f, focus: 'folder' }),
      },
      !builtin && '-',
      !builtin && { label: t('menu.deleteFolder'), icon: 'trash', danger: true, run: () => confirmDelete(f) },
    ];
  }

  function separatorMenu(s) {
    return [
      colorRow(state.separatorColors[s.id], (c) => setSeparatorColor(s.id, c)),
      '-',
      { label: t('menu.deleteSeparator'), icon: 'trash', danger: true, run: () => confirmDelete(s) },
    ];
  }

  function menuFor(n) {
    if (isFolder(n)) return folderMenu(n);
    if (isSeparator(n)) return separatorMenu(n);
    return bookmarkMenu(n);
  }

  function openMenu(items, anchor) {
    const menu = $('#menu');
    state.menuReturnFocus = document.activeElement;
    state.menuAnchor = anchor;
    const entries = items.filter(Boolean);
    menu.replaceChildren(
      ...entries.map((item) =>
        item === '-'
          ? el('div', { class: 'menu-sep', role: 'separator' })
          : item.colors
            ? menuColors(item)
            : el(
                'button',
                {
                  class: item.danger ? 'menu-item is-danger' : 'menu-item',
                  type: 'button',
                  role: 'checked' in item ? 'menuitemcheckbox' : 'menuitem',
                  'aria-checked': 'checked' in item ? String(!!item.checked) : null,
                  onclick: () => {
                    closeMenu();
                    item.run();
                  },
                },
                item.dot ? el('span', { class: 'menu-dot', dataset: { color: item.dot } }) : icon(item.icon),
                el('span', { class: 'menu-label', text: item.label }),
                item.checked ? icon('check', 'menu-check') : null,
              ),
      ),
    );
    menu.classList.remove('is-open');
    menu.hidden = false;

    const { width, height } = menu.getBoundingClientRect();
    let x;
    let y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = r.right - width;
      y = r.bottom + 6;
      if (y + height > innerHeight - 8) y = r.top - height - 6;
    } else {
      x = anchor.x;
      y = anchor.y;
    }
    menu.style.left = `${clamp(x, 8, innerWidth - width - 8)}px`;
    menu.style.top = `${clamp(y, 8, innerHeight - height - 8)}px`;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    menu.querySelector('.menu-item, .menu-swatch')?.focus();
  }

  function closeMenu(restoreFocus = false) {
    const menu = $('#menu');
    if (menu.hidden) return;
    menu.hidden = true;
    menu.classList.remove('is-open');
    if (restoreFocus && state.menuReturnFocus?.isConnected) state.menuReturnFocus.focus();
    state.menuReturnFocus = null;
  }

  function handleMenuKeys(event) {
    // Cada opción es una parada; la fila de colores cuenta como una sola.
    const stops = [...$('#menu').querySelectorAll('.menu-item:not(:disabled), .menu-swatches')];
    const active = document.activeElement;
    const index = stops.findIndex((stop) => stop === active || stop.contains(active));
    const focusStop = (stop) =>
      (stop?.classList.contains('menu-swatches')
        ? stop.querySelector('[aria-checked="true"]') || stop.firstElementChild
        : stop
      )?.focus();
    if (active?.classList.contains('menu-swatch') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const row = [...active.parentElement.children];
      const at = row.indexOf(active) + (event.key === 'ArrowRight' ? 1 : -1);
      row[(at + row.length) % row.length].focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      focusStop(stops[(index + delta + stops.length) % stops.length]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusStop(event.key === 'Home' ? stops[0] : stops[stops.length - 1]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  }

  // ---------------------------------------------------------------------------
  // Arrastrar y soltar
  // ---------------------------------------------------------------------------

  /** Se pueden meter todos en la carpeta y al menos uno cambia de sitio. */
  function canMoveInto(nodeIds, targetId) {
    const target = get(targetId);
    if (!isFolder(target) || targetId === state.rootId || !nodeIds.length) return false;
    let changes = false;
    for (const id of nodeIds) {
      const node = get(id);
      if (!node || isBuiltin(id)) return false;
      if (isFolder(node) && isInside(targetId, id)) return false;
      if (node.parentId !== targetId) changes = true;
    }
    return changes;
  }

  const hasLink = (dataTransfer) => {
    const types = dataTransfer ? [...dataTransfer.types] : [];
    return types.includes('text/x-moz-url') || types.includes('text/uri-list');
  };

  function canDropOn(targetId, dataTransfer) {
    if (!targetId || targetId === state.rootId || !isFolder(get(targetId))) return false;
    if (state.dragIds.length) return canMoveInto(state.dragIds, targetId);
    return hasLink(dataTransfer);
  }

  function extractDroppedLink(dt) {
    const moz = dt.getData('text/x-moz-url');
    if (moz) {
      const [url, title] = moz.split(/\r?\n/);
      return { url: (url || '').trim(), title: (title || '').trim() };
    }
    const list = dt.getData('text/uri-list');
    if (list) {
      const url = list.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
      if (url) return { url: url.trim(), title: '' };
    }
    const text = dt.getData('text/plain').trim();
    if (/^https?:\/\/\S+$/i.test(text)) return { url: text, title: '' };
    return null;
  }

  function setDropTarget(target) {
    if (state.dropEl === target) return;
    state.dropEl?.classList.remove('is-drop-target');
    clearTimeout(state.dropTimer);
    state.dropEl = target;
    if (!target) return;
    target.classList.add('is-drop-target');
    // Al mantener un elemento sobre una carpeta contraída, se expande.
    const li = target.classList.contains('tree-row') ? target.parentElement : null;
    if (li && li.querySelector(':scope > .tree-collapse') && !li.classList.contains('is-expanded')) {
      const id = target.dataset.id;
      state.dropTimer = setTimeout(() => toggleExpanded(id, true), 650);
    }
  }

  function endDrag() {
    state.dragId = null;
    state.dragIds = [];
    state.dragFromGroup = null;
    document.body.classList.remove('is-dragging');
    stopEdgeScroll();
    for (const node of document.querySelectorAll('.is-drag-source')) node.classList.remove('is-drag-source');
    setDropTarget(null);
    setDropSlot(null);
  }

  function setDropSlot(slot) {
    const prev = state.dropSlot;
    if (prev?.el === slot?.el && prev?.after === slot?.after && prev?.x === slot?.x) return;
    prev?.el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-x');
    state.dropSlot = slot;
    if (!slot) return;
    slot.el.classList.add(slot.after ? 'is-drop-after' : 'is-drop-before');
    slot.el.classList.toggle('is-drop-x', slot.x);
  }

  const REORDER_ITEMS =
    '#cards .card[data-id], #cards .card-sep[data-id], #cards .board-row[data-id], #cards .board-sep[data-id]';
  const FOLDER_SLOT_ITEMS = '#folder-grid .folder-tile[data-id], #cards .board-card[data-folder-id]';

  const gridColumns = (node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length;

  /**
   * Hueco para una carpeta arrastrada sobre un bloque de carpeta o una tarjeta del
   * tablero: solo en los bordes (el centro sigue siendo «meter dentro»).
   */
  function folderEdge(item, event) {
    const rect = item.getBoundingClientRect();
    const x = item.classList.contains('folder-tile') && gridColumns($('#folder-grid')) > 1;
    if (x) {
      const band = rect.width * 0.25;
      if (event.clientX < rect.left + band) return { after: false, x };
      if (event.clientX > rect.right - band) return { after: true, x };
      return null;
    }
    const band = clamp(rect.height * 0.25, 10, 22);
    if (event.clientY < rect.top + band) return { after: false, x };
    if (event.clientY > rect.bottom - band) return { after: true, x };
    return null;
  }

  /**
   * Hueco de la sección principal donde caería lo arrastrado: antes o después del
   * marcador (o carpeta) bajo el puntero, con su índice real en la carpeta.
   */
  function reorderSlot(event) {
    if (!state.reorderable || state.dragFromGroup) return null;
    const ids = state.dragIds;
    const folderDrag = ids.length === 1 && isFolder(get(ids[0]));
    if (ids.length ? !folderDrag && !ids.every((id) => isBookmark(get(id))) : !hasLink(event.dataTransfer)) return null;

    let item;
    let edge;
    if (folderDrag) {
      item = event.target.closest?.(FOLDER_SLOT_ITEMS);
      edge = item && folderEdge(item, event);
    } else {
      item = event.target.closest?.(REORDER_ITEMS);
      if (item) {
        // Cuadrícula con varias columnas: en horizontal; lista y tablero: en vertical.
        const cards = $('#cards');
        const x = item.classList.contains('card') && !cards.classList.contains('is-list') && gridColumns(cards) > 1;
        const rect = item.getBoundingClientRect();
        edge = {
          x,
          after: x ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2,
        };
      }
    }
    if (!edge) return null;
    const node = get(item.dataset.id || item.dataset.folderId);
    // La tarjeta de la propia carpeta abierta no se reordena (sus hermanas no se ven).
    if (!node || ids.includes(node.id) || node.id === state.viewFolderId) return null;
    const parent = get(node.parentId);
    if (!isFolder(parent) || parent.id === state.rootId) return null;
    if (folderDrag && (isBuiltin(ids[0]) || isInside(parent.id, ids[0]))) return null;

    const index = parent.children.indexOf(node.id) + (edge.after ? 1 : 0);
    // Se coloca delante del primer hermano que no se mueve (o al final).
    const beforeId = parent.children.slice(index).find((id) => !ids.includes(id)) ?? null;
    let noop = false;
    if (ids.length === 1 && get(ids[0]).parentId === parent.id) {
      const current = parent.children.indexOf(ids[0]);
      noop = index === current || index === current + 1;
    }
    return { el: item, after: edge.after, x: edge.x, parentId: parent.id, index, beforeId, noop };
  }

  async function dropOnSlot(slot, ids, link) {
    if (ids.length) {
      await moveWithUndo(ids, slot.parentId, slot.beforeId);
      return;
    }
    const url = link && normalizeUrl(link.url);
    if (!url) {
      toast(t('toast.dropInvalid'), 'error');
      return;
    }
    try {
      await api.bookmarks.create({
        parentId: slot.parentId,
        index: slot.index,
        title: link.title || hostOf(url) || url,
        url,
      });
      toast(t('toast.dropSaved', { folder: folderName(get(slot.parentId)) }));
    } catch (err) {
      toast(t('toast.opError', { error: err?.message || err }), 'error');
    }
  }

  /** Etiqueta «N marcadores» que acompaña al puntero al arrastrar varios. */
  function setDragCount(dt, n) {
    const badge = el('div', { class: 'drag-count', text: tn('drag.count', n) });
    document.body.append(badge);
    dt.setDragImage(badge, -12, -12);
    setTimeout(() => badge.remove(), 0);
  }

  function bindDragAndDrop() {
    document.addEventListener('dragstart', (event) => {
      const source = event.target.closest?.('[data-drag-id]');
      if (!source) return;
      const n = get(source.dataset.dragId);
      const stripHead = state.viewKind === 'strip' && source.classList.contains('board-head');
      if (!n || n.id === state.rootId || (isBuiltin(n.id) && !stripHead)) {
        event.preventDefault();
        return;
      }
      closeMenu();
      state.dragId = n.id;
      state.dragFromGroup = source.dataset.fromGroup || null;
      // Arrastrar un marcador seleccionado arrastra toda la selección.
      const many = !state.dragFromGroup && state.selection.has(n.id) && state.selection.size > 1;
      state.dragIds = many ? selectedIds() : [n.id];
      const dt = event.dataTransfer;
      dt.effectAllowed = 'copyMove';
      dt.setData(DND_TYPE, n.id);
      if (many) {
        setDragCount(dt, state.dragIds.length);
        for (const node of document.querySelectorAll(SELECTABLE)) {
          if (state.selection.has(node.dataset.id)) node.classList.add('is-drag-source');
        }
      }
      if (n.url) {
        // Permite también soltar el marcador en la barra de pestañas o en otra app.
        dt.setData('text/x-moz-url', `${n.url}\n${bookmarkTitle(n)}`);
        dt.setData('text/uri-list', n.url);
        dt.setData('text/plain', n.url);
      } else {
        dt.setData('text/plain', folderName(n));
      }
      document.body.classList.add('is-dragging');
      source.classList.add('is-drag-source');
    });

    document.addEventListener('dragend', endDrag);

    // Soltar marcadores sobre un grupo (o sobre «Nuevo grupo») del panel derecho.
    const draggedBookmarks = () =>
      state.dragIds.length && state.dragIds.every((id) => isBookmark(get(id))) ? state.dragIds : null;
    // Un elemento arrastrado desde un grupo solo se mueve en Firefox si se suelta
    // sobre una carpeta concreta, no sobre el fondo del contenido.
    const folderDropTarget = (event) => {
      const target = event.target.closest?.('[data-drop-id]');
      if (target?.id === 'content' && state.dragFromGroup) return null;
      return target;
    };

    document.addEventListener('dragover', (event) => {
      stripEdgeScroll(event);
      const groupTarget = event.target.closest?.('[data-group-drop]');
      if (groupTarget) {
        setDropSlot(null);
        if (!draggedBookmarks()) {
          setDropTarget(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = state.dragFromGroup ? 'move' : 'copy';
        setDropTarget(groupTarget);
        return;
      }
      // Tira: una carpeta soltada junto a una tarjeta se coloca ahí (o se añade).
      const strip = stripSlot(event);
      if (strip) {
        event.preventDefault();
        event.dataTransfer.dropEffect = inStrip(strip.folderId) ? 'move' : 'copy';
        setDropTarget(null);
        setDropSlot(strip.noop ? null : strip);
        return;
      }
      // Reordenar: antes o después de un marcador de la sección principal.
      const slot = reorderSlot(event);
      if (slot) {
        event.preventDefault();
        event.dataTransfer.dropEffect = state.dragIds.length ? 'move' : 'copy';
        setDropTarget(null);
        setDropSlot(slot.noop ? null : slot);
        return;
      }
      setDropSlot(null);
      const target = folderDropTarget(event);
      const targetId = target?.dataset.dropId;
      if (!canDropOn(targetId, event.dataTransfer)) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = state.dragIds.length ? 'move' : 'copy';
      // El contenedor principal no se resalta entero; solo carpetas concretas.
      setDropTarget(target.id === 'content' ? null : target);
    });

    document.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget) {
        setDropTarget(null);
        setDropSlot(null);
      }
    });

    document.addEventListener('drop', async (event) => {
      const groupTarget = event.target.closest?.('[data-group-drop]');
      if (groupTarget) {
        const bookmarkIds = draggedBookmarks();
        const fromGroup = state.dragFromGroup;
        endDrag();
        if (!bookmarkIds) return;
        event.preventDefault();
        const gid = groupTarget.dataset.groupDrop;
        if (gid === 'new') openGroupDialog({ addBookmarkIds: bookmarkIds });
        else if (bookmarkIds.length > 1) addManyToGroup(gid, bookmarkIds);
        else addToGroup(gid, bookmarkIds[0], fromGroup);
        return;
      }
      const strip = stripSlot(event);
      if (strip) {
        event.preventDefault();
        endDrag();
        if (!strip.noop) placeInStrip(strip.folderId, strip.index);
        return;
      }
      const slot = reorderSlot(event);
      if (slot) {
        event.preventDefault();
        const ids = state.dragIds;
        // Los datos de un enlace externo solo se pueden leer durante el evento.
        const link = ids.length ? null : extractDroppedLink(event.dataTransfer);
        endDrag();
        if (slot.noop) return;
        if (ids.length > 1) clearSelection();
        dropOnSlot(slot, ids, link);
        return;
      }
      const target = folderDropTarget(event);
      const targetId = target?.dataset.dropId;
      const ids = state.dragIds;
      if (!canDropOn(targetId, event.dataTransfer)) {
        endDrag();
        return;
      }
      event.preventDefault();
      endDrag();
      const destination = folderName(get(targetId));
      try {
        if (ids.length) {
          if (ids.length > 1) clearSelection();
          // Los que ya están en esa carpeta se quedan donde están.
          await moveWithUndo(
            ids.filter((id) => get(id).parentId !== targetId),
            targetId,
          );
        } else {
          const link = extractDroppedLink(event.dataTransfer);
          const url = link && normalizeUrl(link.url);
          if (!url) {
            toast(t('toast.dropInvalid'), 'error');
            return;
          }
          await api.bookmarks.create({ parentId: targetId, title: link.title || hostOf(url) || url, url });
          toast(t('toast.dropSaved', { folder: destination }));
        }
      } catch (err) {
        toast(t('toast.opError', { error: err?.message || err }), 'error');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Selección múltiple: Ctrl/⌘+clic, Mayús+clic (rango) o la casilla de cada marcador
  // ---------------------------------------------------------------------------

  const SELECTABLE = '#cards .card[data-id], #cards .board-row[data-id]';
  const shownSelectable = () => [...document.querySelectorAll(SELECTABLE)].map((node) => node.dataset.id);

  /** Seleccionados en el orden en que se ven (los que no están a la vista, al final). */
  function selectedIds() {
    const ordered = shownSelectable().filter((id) => state.selection.has(id));
    for (const id of state.viewItemIds) if (state.selection.has(id) && !ordered.includes(id)) ordered.push(id);
    for (const id of state.selection) if (!ordered.includes(id)) ordered.push(id);
    return ordered.filter((id) => isBookmark(get(id)));
  }

  function toggleSelected(id, force) {
    if (!isBookmark(get(id))) return;
    const on = force ?? !state.selection.has(id);
    if (on) state.selection.add(id);
    else state.selection.delete(id);
    state.selAnchor = id;
    syncSelection();
  }

  function selectRange(fromId, toId) {
    const shown = shownSelectable();
    const a = shown.indexOf(fromId);
    const b = shown.indexOf(toId);
    if (a === -1 || b === -1) {
      toggleSelected(toId, true);
      return;
    }
    for (const id of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selection.add(id);
    state.selAnchor = toId;
    syncSelection();
  }

  /** Todos los marcadores de la vista, también los de páginas aún no cargadas. */
  function selectAll() {
    for (const id of [...shownSelectable(), ...state.viewItemIds]) if (isBookmark(get(id))) state.selection.add(id);
    syncSelection();
  }

  function clearSelection() {
    if (!state.selection.size) return;
    state.selection.clear();
    state.selAnchor = null;
    syncSelection();
  }

  function syncSelection() {
    for (const id of state.selection) if (!isBookmark(get(id))) state.selection.delete(id);
    const count = state.selection.size;
    document.body.classList.toggle('has-selection', count > 0);
    for (const node of document.querySelectorAll(SELECTABLE)) {
      const on = state.selection.has(node.dataset.id);
      node.classList.toggle('is-selected', on);
      node.querySelector('.select-btn')?.setAttribute('aria-pressed', String(on));
    }
    $('#selection-bar').hidden = count === 0;
    if (count) $('#selection-count').textContent = tn('selection.count', count);
  }

  /**
   * Clics en la sección principal (fase de captura): con Ctrl/⌘ o Mayús, en la
   * casilla, o con una selección activa, el clic selecciona en vez de abrir.
   */
  function handleSelectClick(event) {
    const host = event.target.closest(SELECTABLE);
    if (!host || event.button !== 0) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (action !== 'select' && !modifier) {
      // Con selección activa, los botones propios (destacar, ⋯, ruta) siguen funcionando.
      if (!state.selection.size || (action && action !== 'open-blocked')) return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && state.selAnchor && state.selAnchor !== host.dataset.id)
      selectRange(state.selAnchor, host.dataset.id);
    else toggleSelected(host.dataset.id);
  }

  function handleSelectionBar(event) {
    const btn = event.target.closest('[data-sel]');
    if (!btn) return;
    const ids = selectedIds();
    switch (btn.dataset.sel) {
      case 'open':
        openAllInTabs(ids.map(get), t('selection.name'));
        break;
      case 'move':
        openMoveManyDialog(ids);
        break;
      case 'group':
        openGroupMenuForMany(ids, btn);
        break;
      case 'delete':
        confirmDeleteMany(ids);
        break;
      case 'all':
        selectAll();
        break;
      case 'clear':
        clearSelection();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Toasts y panel lateral móvil
  // ---------------------------------------------------------------------------

  /** Aviso breve; `action` ({ label, run }) añade un botón, p. ej. «Deshacer». */
  function toast(message, type = 'info', action = null) {
    const node = el(
      'div',
      { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
      icon(type === 'error' ? 'alert' : 'check'),
      el('span', { text: message }),
    );
    const leave = () => {
      node.classList.add('is-leaving');
      node.addEventListener('animationend', () => node.remove(), { once: true });
      setTimeout(() => node.remove(), 500);
    };
    if (action) {
      node.append(
        el(
          'button',
          {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
              leave();
              action.run();
            },
          },
          action.label,
        ),
      );
    }
    const box = $('#toasts');
    box.append(node);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(leave, action ? 7000 : type === 'error' ? 5000 : 3000);
  }

  const openDrawer = () => document.body.classList.add('nav-open');
  const closeDrawer = () => document.body.classList.remove('nav-open');

  // ---------------------------------------------------------------------------
  // Eventos de la interfaz
  // ---------------------------------------------------------------------------

  const loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        state.limit += PAGE_SIZE;
        renderMain();
      }
    },
    { root: document.getElementById('content'), rootMargin: '0px 0px 800px 0px' },
  );

  function bindUI() {
    const search = $('#search');
    const debouncedQuery = debounce(() => applyQuery(search.value), 80);
    search.addEventListener('input', debouncedQuery);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && search.value) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        applyQuery(search.value);
        $('#cards .card-link, #cards .board-link')?.click();
      } else if (event.key === 'ArrowDown') {
        const first = $('#folder-grid .folder-open') || $('#cards .card-link, #cards .board-link');
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    // Vistas especiales
    $('#views').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-view]');
      if (btn) selectView(btn.dataset.view);
    });

    // Árbol de carpetas
    const tree = $('#tree');
    tree.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      const row = event.target.closest('.tree-row');
      if (!actionEl || !row) return;
      if (actionEl.dataset.action === 'toggle') toggleExpanded(row.dataset.id);
      else if (actionEl.dataset.action === 'select') {
        if (state.treePicking) toggleStripPick(row.dataset.id);
        else selectView(row.dataset.id);
      }
    });
    tree.addEventListener('dblclick', (event) => {
      const row = event.target.closest('.tree-row');
      if (state.treePicking) return; // dos clics ya marcan y desmarcan
      if (row && event.target.closest('.tree-label') && row.parentElement.querySelector(':scope > .tree-collapse')) {
        toggleExpanded(row.dataset.id);
      }
    });
    tree.addEventListener('keydown', handleTreeKeys);

    // Clic central en una carpeta (árbol, bloque o ruta): abre sus marcadores en pestañas.
    const FOLDER_TARGETS = '.tree-row, .folder-tile, .crumb, .board-head, .board-sub, .strip-sub-head';
    const folderIdFrom = (target) => {
      const host = target.closest?.(FOLDER_TARGETS);
      return host ? host.dataset.id || host.dataset.target : null;
    };
    const groupHeadFrom = (target) => target.closest?.('.group-head');
    document.addEventListener('mousedown', (event) => {
      // Evita el desplazamiento automático del botón central sobre carpetas y grupos.
      if (event.button === 1 && (folderIdFrom(event.target) || groupHeadFrom(event.target))) event.preventDefault();
    });
    document.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const head = groupHeadFrom(event.target);
      if (head) {
        event.preventDefault();
        closeMenu();
        openGroupInTabs(head.closest('.group')?.dataset.groupId);
        return;
      }
      const id = folderIdFrom(event.target);
      if (!id) return;
      event.preventDefault();
      closeMenu();
      openFolderInTabs(id);
    });

    // Menú contextual (clic derecho) en carpetas y tarjetas
    document.addEventListener('contextmenu', (event) => {
      if (event.target.closest('input, textarea, select, dialog')) return;
      const groupHost = event.target.closest('.group-item, .group-head');
      if (groupHost) {
        const g = getGroup(groupHost.closest('.group')?.dataset.groupId);
        if (!g) return;
        event.preventDefault();
        const item = groupHost.classList.contains('group-item') ? get(groupHost.dataset.id) : null;
        openMenu(item ? groupItemMenu(item, g) : groupMenu(g), { x: event.clientX, y: event.clientY });
        return;
      }
      const profileChip = event.target.closest('.strip-profile');
      if (profileChip) {
        event.preventDefault();
        openMenu(profileMenu(profileChip.dataset.profileId), { x: event.clientX, y: event.clientY });
        return;
      }
      const navView = event.target.closest('#views [data-view]');
      if (navView && isView(navView.dataset.view)) {
        event.preventDefault();
        openMenu(viewMenu(navView.dataset.view), { x: event.clientX, y: event.clientY });
        return;
      }
      const host = event.target.closest(
        '.tree-row, .folder-tile, .card, .card-sep, .board-row, .board-sep, .board-head, .strip-sub-head',
      );
      const n = get(host?.dataset.id);
      if (!n) return;
      event.preventDefault();
      openMenu(menuFor(n), { x: event.clientX, y: event.clientY });
    });

    // Selección múltiple (antes que abrir enlaces o ejecutar acciones)
    $('#content').addEventListener('click', handleSelectClick, true);
    $('#selection-bar').addEventListener('click', handleSelectionBar);

    // Contenido principal (delegación)
    $('#content').addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const host = actionEl.closest('[data-id]');
      const n = get(host?.dataset.id);
      switch (actionEl.dataset.action) {
        case 'open-blocked':
          event.preventDefault();
          if (n) copyUrl(n, t('toast.blocked'));
          break;
        case 'favorite':
          if (n) toggleFavorite(n.id);
          break;
        case 'more':
          if (n) openMenu(bookmarkMenu(n), actionEl);
          break;
        case 'folder-more':
          if (n) openMenu(folderMenu(n), actionEl);
          break;
        case 'open-folder':
          if (n) selectView(n.id);
          break;
        case 'board-toggle':
          if (n) toggleBoardCollapsed(n.id, actionEl.closest('.board-card'));
          break;
        case 'board-rows': {
          const id = actionEl.dataset.target;
          if (state.boardShowAll.has(id)) state.boardShowAll.delete(id);
          else state.boardShowAll.add(id);
          saveBoardShowAll();
          renderMain();
          break;
        }
        case 'goto':
        case 'crumb':
          selectView(actionEl.dataset.target);
          break;
        case 'strip-sub': {
          const id = actionEl.dataset.target;
          toggleStripSub(id, actionEl.closest('.strip-sub'));
          // La rama se repinta: el foco vuelve a su botón (para seguir con el teclado).
          $(`.strip-sub[data-folder-id="${CSS.escape(id)}"] > .strip-sub-head .strip-sub-toggle`)?.focus({
            preventScroll: true,
          });
          break;
        }
        case 'strip-pick':
          revealTreePicker();
          break;
        case 'profile':
          switchStripProfile(actionEl.dataset.profileId);
          break;
        case 'profile-add':
          addStripProfile();
          break;
        case 'strip-expand-all':
          toggleStripExpandAll();
          $('#strip-profiles .strip-expand-tool')?.focus({ preventScroll: true }); // la barra se rehace
          break;
        case 'strip-card-expand': {
          const id = actionEl.dataset.target;
          toggleStripCardExpand(id);
          // La tira se repinta: el foco vuelve al botón de esa columna.
          $(`.strip-card-expand[data-target="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
          break;
        }
        case 'profile-more':
          openMenu(profileMenu(state.stripProfile), actionEl);
          break;
        default:
          break;
      }
    });

    // Tira: elegir carpetas (en el árbol) y desplazamiento (rueda, arrastre del fondo)
    $('#strip-pick-btn').addEventListener('click', revealTreePicker);
    $('#strip-expand-btn').addEventListener('click', toggleStripExpandAll);
    $('#home-set-btn').addEventListener('click', setHomeHere);
    bindStripScroll();
    bindStripProfiles();

    // Controles de vista
    $('#open-all-btn').addEventListener('click', openAllInView);
    $('#sort').addEventListener('change', (event) => setPref('sort', event.target.value));
    $('#subfolders-toggle').addEventListener('change', (event) => setPref('includeSubfolders', event.target.checked));
    for (const btn of document.querySelectorAll('[data-view-mode]')) {
      btn.addEventListener('click', () => setPref('view', btn.dataset.viewMode));
    }
    $('#load-more').addEventListener('click', () => {
      state.limit += PAGE_SIZE;
      renderMain();
    });

    // Barra superior
    $('#theme-btn').addEventListener('click', cycleTheme);
    $('#settings-btn').addEventListener('click', () => {
      syncControls();
      fillHomeSelect();
      $('#home-url').value = homeUrl();
      showSettingsTab(state.settingsTab);
      $('#settings-dialog').showModal();
      $(`#stab-${state.settingsTab}`).focus();
    });
    buildSwatches($('#accent-colors'), 'accent-color', ACCENT_COLORS);
    buildSwatches($('#folder-colors'), 'folder-color', FOLDER_COLORS);
    buildSwatches($('#stripe-colors'), 'stripe-color', STRIPE_COLORS);
    const settingsTabs = $('#settings-tabs');
    settingsTabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) showSettingsTab(tab.dataset.tab);
    });
    settingsTabs.addEventListener('keydown', handleSettingsTabKeys);
    $('#minimal-btn').addEventListener('click', enterMinimal);
    $('#minimal-exit').addEventListener('click', exitMinimal);
    $('#home-back').addEventListener('click', () => selectView(homeId()));
    $('#home-url-copy').addEventListener('click', copyHomeUrl);
    $('#home-url').addEventListener('focus', (event) => event.target.select());
    $('#new-btn').addEventListener('click', (event) => {
      const parentId = defaultParentId();
      openMenu(
        [
          {
            label: t('action.newBookmark'),
            icon: 'bookmark',
            run: () => openEditor({ mode: 'new-bookmark', parentId }),
          },
          {
            label: t('action.newFolder'),
            icon: 'folder-plus',
            run: () => openEditor({ mode: 'new-folder', parentId }),
          },
          { label: t('groups.new'), icon: 'groups', run: () => openGroupDialog() },
        ],
        event.currentTarget,
      );
    });
    $('#sidebar-new-folder').addEventListener('click', () =>
      openEditor({ mode: 'new-folder', parentId: defaultParentId() }),
    );

    // Barra lateral: botón para ocultarla en escritorio; cajón en móvil
    $('#sidebar-btn').addEventListener('click', () => setPref('sidebarPanel', !state.prefs.sidebarPanel));
    $('#drawer-open').addEventListener('click', openDrawer);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);

    // Menú: cierre al hacer clic fuera, con Esc, al hacer scroll o al redimensionar
    const menu = $('#menu');
    menu.addEventListener('keydown', handleMenuKeys);
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!menu.hidden && !menu.contains(event.target)) closeMenu();
      },
      true,
    );
    document.addEventListener('scroll', () => closeMenu(), true);
    window.addEventListener('resize', () => closeMenu());
    window.addEventListener('blur', () => closeMenu());

    // Panel de grupos
    $('#groups-btn').addEventListener('click', toggleGroupsPanel);
    $('#groups-close').addEventListener('click', () =>
      isGroupsOverlay() ? closeGroupsOverlay() : setPref('groupsPanel', false),
    );
    $('#group-new').addEventListener('click', () => openGroupDialog());
    GROUPS_OVERLAY.addEventListener('change', updateGroupsBtn);
    $('#groups-panel').addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      const g = getGroup(actionEl.closest('.group')?.dataset.groupId);
      const n = get(actionEl.closest('.group-item')?.dataset.id);
      switch (actionEl.dataset.action) {
        case 'group-toggle':
          if (g) toggleGroupCollapsed(g.id);
          break;
        case 'group-more':
          if (g) openMenu(groupMenu(g), actionEl);
          break;
        case 'group-remove':
          if (g && n) removeFromGroup(g.id, n.id);
          break;
        case 'group-create':
          openGroupDialog();
          break;
        case 'open-blocked':
          event.preventDefault();
          if (n) copyUrl(n, t('toast.blocked'));
          break;
        default:
          break;
      }
    });
    $('#group-form').addEventListener('submit', submitGroupDialog);
    for (const btn of document.querySelectorAll('#group-dialog [data-close]')) {
      btn.addEventListener('click', () => $('#group-dialog').close());
    }

    // Diálogo de edición
    $('#edit-form').addEventListener('submit', submitEditor);
    for (const btn of document.querySelectorAll('#edit-dialog [data-close]')) {
      btn.addEventListener('click', () => $('#edit-dialog').close());
    }

    // Ajustes
    $('#settings-form').addEventListener('change', (event) => {
      const input = event.target;
      if (input.name === 'theme') setPref('theme', input.value);
      else if (input.name === 'lang') setPref('lang', input.value);
      else if (input.name === 'corners') setPref('corners', input.value);
      else if (input.name === 'accent-color') setPref('accentColor', input.value);
      else if (input.name === 'folder-color') setPref('folderColor', input.value);
      else if (input.id === 'opt-minimal') {
        if (input.checked) enterMinimal();
        else setPref('minimal', false);
      } else if (input.id === 'opt-home') setHomeFolder(input.value);
      else if (input.id === 'opt-stripe') setPref('stripe', input.checked);
      else if (input.name === 'stripe-color') setPref('stripeColor', input.value);
      else if (input.name === 'stripe-width') setStripeWidth(Number(input.value));
      else if (input.name === 'content-width') setPref('contentWidth', input.value);
      else if (input.name === 'board-cols')
        setPref('boardColumns', input.value === 'auto' ? 'auto' : Number(input.value));
      else if (input.id === 'opt-newtab') setPref('openInNewTab', input.checked);
      else if (input.id === 'opt-subfolders') setPref('includeSubfolders', input.checked);
      else if (input.id === 'opt-tab-folder') setPref('tabTitleFolder', input.checked);
      else if (input.id === 'opt-tab-title') {
        setPref('tabTitle', cleanTabTitle(input.value));
        input.value = state.prefs.tabTitle; // muestra el nombre ya limpio
      } else if (input.id === 'opt-favicons') {
        state.failedIcons.clear();
        setPref('showFavicons', input.checked);
      }
    });
    // Nombre de la pestaña: se ve en vivo mientras se escribe; Intro lo confirma
    // sin cerrar el diálogo (el formulario es method="dialog").
    const tabTitleInput = $('#opt-tab-title');
    const saveTabTitle = debounce(() => setPref('tabTitle', cleanTabTitle(tabTitleInput.value)), 300);
    tabTitleInput.addEventListener('input', saveTabTitle);
    tabTitleInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      tabTitleInput.blur(); // dispara «change», que guarda
    });
    $('#resync-btn').addEventListener('click', () => resync({ notify: true }));

    // Copia de seguridad
    const importInput = $('#import-file');
    $('#export-btn').addEventListener('click', exportBackup);
    $('#import-btn').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      importInput.value = ''; // permite volver a elegir el mismo archivo
      importBackupFile(file);
    });

    // Atajos globales
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if (isMinimal() && (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) {
        // Sin buscador en el modo minimalista.
      } else if (
        (event.key === '/' && !typing) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault();
        search.focus();
        search.select();
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) {
        if (state.undo) {
          event.preventDefault();
          runUndo();
        }
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'a' &&
        !typing &&
        state.selection.size
      ) {
        event.preventDefault();
        selectAll();
      } else if (event.key === 'Delete' && !typing) {
        if (state.selection.size) {
          event.preventDefault();
          confirmDeleteMany(selectedIds());
          return;
        }
        const host = event.target.closest?.('.card, .folder-tile, .tree-row, .board-row');
        const n = get(host?.dataset.id);
        if (n) {
          event.preventDefault();
          confirmDelete(n);
        }
      } else if (event.key === 'Escape') {
        if (!menu.hidden) closeMenu(true);
        else if (state.selection.size) clearSelection();
        else if (isMinimal() && state.homeNav) selectView(homeId());
        else if (document.body.classList.contains('nav-open')) closeDrawer();
        else if (document.body.classList.contains('groups-open')) closeGroupsOverlay();
      }
    });

    // Al volver a la pestaña, se relee el árbol por si hubo cambios masivos
    // (p. ej. restaurar una copia de seguridad), que pueden no emitir eventos.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (state.ready && Date.now() - hiddenAt > 15000) scheduleResync();
    });

    bindDragAndDrop();
  }

  function handleTreeKeys(event) {
    const label = event.target.closest('.tree-label');
    if (!label) return;
    const row = label.closest('.tree-row');
    const li = row.parentElement;
    const id = row.dataset.id;
    const hasChildren = !!li.querySelector(':scope > .tree-collapse');
    const expanded = li.classList.contains('is-expanded');
    const visibleLabels = () =>
      [...$('#tree').querySelectorAll('.tree-label')].filter(
        (l) => !l.closest('.tree-item:not(.is-expanded) > .tree-collapse'),
      );

    switch (event.key) {
      case 'ArrowRight':
        if (hasChildren && !expanded) toggleExpanded(id, true);
        else if (hasChildren) li.querySelector(':scope > .tree-collapse .tree-label')?.focus();
        break;
      case 'ArrowLeft':
        if (hasChildren && expanded) toggleExpanded(id, false);
        else li.parentElement.closest('.tree-item')?.querySelector(':scope > .tree-row .tree-label')?.focus();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const labels = visibleLabels();
        const i = labels.indexOf(label);
        labels[clamp(i + (event.key === 'ArrowDown' ? 1 : -1), 0, labels.length - 1)]?.focus();
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------

  async function start() {
    try {
      await loadTree();
    } catch (err) {
      console.error('[Bookmark Control Panel] Error al leer los marcadores:', err);
      showFatal(t('fatal.read.title'), t('fatal.read.text'), String(err?.message || err), () => {
        showEmpty(null);
        $('#skeleton').hidden = false;
        start();
      });
      return;
    }
    state.ready = true;
    $('#live').classList.remove('is-error');
    $('#controls').hidden = false;
    // Cada panel nuevo empieza en la carpeta de inicio, también fuera del modo minimalista.
    state.selected = homeId();
    expandAncestors(state.selected);
    render();
    scrollSelectedIntoView();
  }

  async function init() {
    state.prefs.lang = lang; // copia rápida de localStorage hasta leer las preferencias
    try {
      state.prefs.tabTitle = cleanTabTitle(localStorage.getItem(TAB_TITLE_KEY));
    } catch {
      /* sin localStorage: el nombre llega con las preferencias */
    }
    document.documentElement.lang = lang;
    translateStatic();
    applyTheme();
    document.title = docTitle(null);
    if (!api?.bookmarks || !api?.storage) {
      bindUI();
      showFatal(t('fatal.noApi.title'), t('fatal.noApi.text'), null, null);
      return;
    }
    bindUI();
    registerBookmarkListeners();
    api.storage.onChanged.addListener(handleStorageChange);
    await loadPrefs();
    if (state.prefs.lang !== lang) applyLanguage();
    applyCorners();
    applyAccent();
    applySidebar();
    applyMinimal();
    applyStripe();
    applyBoardColumns();
    applyTabTitle();
    applyGroupsPanel();
    applyTheme();
    syncControls();
    await start();
  }

  init().catch((err) => {
    console.error('[Bookmark Control Panel] Error inesperado:', err);
    showFatal(t('fatal.unexpected.title'), t('fatal.unexpected.text'), String(err?.message || err), () =>
      location.reload(),
    );
  });
})();
