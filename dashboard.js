'use strict';

/*
 * Bookmark Dashboard — lógica principal.
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
  const DND_TYPE = 'application/x-bookmark-dashboard-id';

  const VIEW_ALL = 'view:all';
  const VIEW_FAVORITES = 'view:favorites';
  const VIEW_RECENT = 'view:recent';
  const VIEWS = {
    [VIEW_ALL]: { label: 'view.all', icon: 'layers' },
    [VIEW_FAVORITES]: { label: 'view.favorites', icon: 'star' },
    [VIEW_RECENT]: { label: 'view.recent', icon: 'clock' },
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
  const SORTS = ['manual', 'name-asc', 'name-desc', 'date-desc', 'date-asc'];
  const THEME_META = {
    auto: { icon: 'monitor', label: 'themeBtn.auto' },
    light: { icon: 'sun', label: 'themeBtn.light' },
    dark: { icon: 'moon', label: 'themeBtn.dark' },
  };

  const DEFAULT_PREFS = Object.freeze({
    lang: DEFAULT_LANG,
    theme: 'auto',
    view: 'grid',
    sort: 'manual',
    lastFolder: VIEW_ALL,
    openInNewTab: false,
    showFavicons: true,
    includeSubfolders: false,
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
      theme: DEFAULT_PREFS.theme,
      view: DEFAULT_PREFS.view,
      sort: DEFAULT_PREFS.sort,
      lastFolder: DEFAULT_PREFS.lastFolder,
      openInNewTab: DEFAULT_PREFS.openInNewTab,
      showFavicons: DEFAULT_PREFS.showFavicons,
      includeSubfolders: DEFAULT_PREFS.includeSubfolders,
    },
    expanded: new Set(DEFAULT_PREFS.expanded),
    favorites: new Set(),
    selected: VIEW_ALL,
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
    dropEl: null,
    dropTimer: 0,
    menuReturnFocus: null,
    editor: { mode: null, nodeId: null },
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
    return String(template).replace(/\{(\w+)\}/g, (m, name) => (vars && Object.hasOwn(vars, name) ? String(vars[name]) : m));
  }

  /** Texto traducido (siempre texto plano, nunca HTML). */
  function t(key, vars) {
    const value = lookup(key);
    return fill(typeof value === 'string' ? value : value.other, vars);
  }

  /** Texto traducido con plural; {n} recibe el número formateado. */
  function tn(key, n, vars) {
    const value = lookup(key);
    const template = typeof value === 'string' ? value : value[pluralRules.select(n)] ?? value.other;
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
  const fold = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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
    return out.reverse();
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
      console.error('[Bookmark Dashboard] Error al releer los marcadores:', err);
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
    if (p.view === 'grid' || p.view === 'list') prefs.view = p.view;
    if (SORTS.includes(p.sort)) prefs.sort = p.sort;
    if (typeof p.lastFolder === 'string') prefs.lastFolder = p.lastFolder;
    for (const key of ['openInNewTab', 'showFavicons', 'includeSubfolders']) {
      if (typeof p[key] === 'boolean') prefs[key] = p[key];
    }
    if (Array.isArray(p.expanded)) state.expanded = new Set(p.expanded.filter((x) => typeof x === 'string'));
    if (Array.isArray(p.favorites)) state.favorites = new Set(p.favorites.filter((x) => typeof x === 'string'));
  }

  async function loadPrefs() {
    try {
      applyPrefs(await api.storage.local.get({ ...DEFAULT_PREFS }));
    } catch (err) {
      console.warn('[Bookmark Dashboard] No se pudieron leer las preferencias:', err);
    }
  }

  function savePrefs(partial) {
    return api.storage.local.set(partial).catch((err) => {
      console.error('[Bookmark Dashboard] Error al guardar preferencias:', err);
      toast(t('toast.prefsError'), 'error');
    });
  }

  const saveExpanded = debounce(() => savePrefs({ expanded: [...state.expanded] }), 300);
  const persistSelection = () => savePrefs({ lastFolder: state.selected });

  function setPref(key, value) {
    state.prefs[key] = value;
    savePrefs({ [key]: value });
    if (key === 'theme') applyTheme(true);
    if (key === 'lang') applyLanguage();
    if (key === 'includeSubfolders') state.limit = PAGE_SIZE;
    syncControls();
    scheduleRender();
  }

  /** Mantiene sincronizadas varias pestañas del dashboard abiertas a la vez. */
  function handleStorageChange(changes, area) {
    if (area !== 'local') return;
    const incoming = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key !== 'lastFolder' && change.newValue !== undefined) incoming[key] = change.newValue;
    }
    if (!Object.keys(incoming).length) return;
    applyPrefs(incoming);
    if (incoming.lang !== undefined) applyLanguage();
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
    invalidate(); // las rutas de carpeta incluyen nombres traducidos
    if (!state.ready) {
      // Textos que el render todavía no ha sustituido.
      $('#stats').textContent = t('stats.loading');
      $('#view-title').textContent = t('view.loading');
    }
    scheduleRender();
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
    $('#opt-newtab').checked = state.prefs.openInNewTab;
    $('#opt-subfolders').checked = state.prefs.includeSubfolders;
    $('#opt-favicons').checked = state.prefs.showFavicons;
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
    const target = resolveSelection(id);
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

  function applyQuery(value, render = true) {
    state.query = value.trim();
    state.terms = fold(state.query).split(/\s+/).filter(Boolean);
    state.limit = PAGE_SIZE;
    if (render && state.ready) {
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
        return list.sort((a, b) => collator.compare(nameFn(a), nameFn(b)));
      case 'name-desc':
        return list.sort((a, b) => collator.compare(nameFn(b), nameFn(a)));
      case 'date-desc':
        return list.sort((a, b) => b.dateAdded - a.dateAdded);
      case 'date-asc':
        return list.sort((a, b) => a.dateAdded - b.dateAdded);
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
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }

  function render() {
    if (!state.ready) return;
    renderSidebar();
    renderMain();
  }

  // ----- Sidebar -----

  function renderSidebar() {
    const counts = getCounts();
    const root = get(state.rootId);
    const total = counts.get(state.rootId) || 0;

    $('#count-all').textContent = numberFmt.format(total);
    $('#count-favorites').textContent = numberFmt.format(countFavorites());

    const tree = $('#tree');
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

    const label = el(
      'button',
      { class: 'tree-label', type: 'button', title: folderName(folder), dataset: { action: 'select' } },
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
    const sel = state.selected;
    const root = state.rootId;

    if (state.query) {
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
      return { kind: 'view', key: sel, title: t(VIEWS[sel].label), icon: VIEWS[sel].icon, items: sortNodes(collectBookmarks(root), bookmarkTitle), folders: [], showPath: true };
    }
    if (sel === VIEW_FAVORITES) {
      const items = collectBookmarks(root).filter((n) => state.favorites.has(n.id));
      return { kind: 'view', key: sel, title: t(VIEWS[sel].label), icon: VIEWS[sel].icon, items: sortNodes(items, bookmarkTitle), folders: [], showPath: true };
    }
    if (sel === VIEW_RECENT) {
      const items = collectBookmarks(root)
        .sort((a, b) => b.dateAdded - a.dateAdded)
        .slice(0, RECENT_LIMIT);
      return { kind: 'view', key: sel, title: t(VIEWS[sel].label), icon: VIEWS[sel].icon, items, folders: [], showPath: true, fixedOrder: true };
    }

    const folder = get(sel);
    const children = folder.children.map(get);
    const folders = children.filter(isFolder);
    const direct = children.filter(isBookmark);
    const items = sortNodes(state.prefs.includeSubfolders ? collectBookmarks(folder.id) : direct, bookmarkTitle);
    // Separadores de Firefox: solo en la vista de lista, con el orden original
    // y sin mezclar subcarpetas (fuera de ese contexto no tienen sentido).
    const showSeparators = state.prefs.view === 'list' && state.prefs.sort === 'manual' && !state.prefs.includeSubfolders;
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
  function withSeparators(children) {
    const rows = [];
    for (const c of children) {
      if (isBookmark(c)) rows.push(c);
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
      return t('all.subtitle', { bookmarks: tn('n.bookmark', view.items.length), folders: tn('n.folder', userFolderCount()) });
    }
    if (view.key === VIEW_FAVORITES) return t('favorites.subtitle', { count: tn('n.starred', view.items.length) });
    if (view.key === VIEW_RECENT) return t('recent.subtitle', { n: numberFmt.format(RECENT_LIMIT) });
    const total = getCounts().get(view.folder.id) || 0;
    const parts = [tn('n.bookmark', total)];
    if (view.folders.length) parts.push(tn('n.subfolder', view.folders.length));
    if (total !== view.directCount && !state.prefs.includeSubfolders) parts.push(t('folder.atThisLevel', { n: numberFmt.format(view.directCount) }));
    return parts.join(' · ');
  }

  function renderHeader(view) {
    const crumbs = $('#breadcrumb');
    if (view.kind === 'folder') {
      const parts = ancestors(view.folder.id);
      crumbs.replaceChildren(
        ...parts.flatMap((p) => [
          el('button', { class: 'crumb', type: 'button', title: folderName(p), dataset: { action: 'crumb', target: p.id } }, folderName(p)),
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
    $('#view-title').textContent = view.title;
    $('#view-subtitle').textContent = subtitleFor(view);

    $('#sort').disabled = !!view.fixedOrder;
    $('#subfolders-chip').hidden = view.kind !== 'folder';
    $('#open-all-btn').hidden = !view.items.some((n) => isOpenable(n.url));
    $('#controls').hidden = false;
    document.title = view.kind === 'search' ? t('doc.search', { q: state.query }) : t('doc.view', { title: view.title });
  }

  function renderMain() {
    if (!state.ready) return;
    $('#skeleton').hidden = true;
    const view = computeView();
    renderHeader(view);

    $('#content').dataset.dropId = view.kind === 'folder' ? view.folder.id : '';

    // Carpetas
    const folderGrid = $('#folder-grid');
    $('#folders-section').hidden = view.folders.length === 0;
    $('#folders-count').textContent = numberFmt.format(view.folders.length);
    folderGrid.replaceChildren(...view.folders.map((f) => folderTile(f, view)));

    // Marcadores (y separadores, si la vista los incluye)
    const rows = view.rows || view.items;
    const visible = rows.slice(0, state.limit);
    $('#bookmarks-section').hidden = view.items.length === 0;
    $('#bookmarks-count').textContent = numberFmt.format(view.items.length);
    const cards = $('#cards');
    cards.classList.toggle('is-list', state.prefs.view === 'list');
    reconcileCards(cards, visible, view);

    // Paginación incremental
    const more = $('#load-more');
    const remaining = view.items.length - visible.filter(isBookmark).length;
    loadMoreObserver.unobserve(more);
    more.hidden = remaining <= 0;
    if (remaining > 0) {
      more.textContent = t('loadMore.remaining', { n: numberFmt.format(remaining) });
      loadMoreObserver.observe(more);
    }

    // Animación al cambiar de vista
    const viewKey = `${view.key}|${state.prefs.view}`;
    if (viewKey !== state.lastViewKey) {
      state.lastViewKey = viewKey;
      animateEntering(folderGrid);
      animateEntering(cards);
    }

    renderEmpty(view);
    state.newIds.clear();
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
          card = el('div', { class: 'card-sep', role: 'separator', dataset: { id: n.id } });
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
      { class: openable ? 'card-link' : 'card-link is-blocked', draggable: 'false', title: n.url ? `${title}\n${n.url}` : title },
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
          { class: 'chip', type: 'button', title: t('card.goto', { path: pathText(n.id) }), dataset: { action: 'goto', target: n.parentId } },
          icon(folderIcon(parent)),
          el('span', {}, highlight(folderName(parent))),
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
      el('button', { class: 'icon-btn', type: 'button', title: t('action.more'), 'aria-label': t('action.more'), 'aria-haspopup': 'menu', dataset: { action: 'more' } }, icon('more')),
    );

    return [faviconEl(n, title), main, meta, actions];
  }

  /**
   * Favicon: se pide /favicon.ico al propio sitio (nunca a servicios de terceros).
   * Mientras carga o si falla, se muestra una inicial con color derivado del dominio.
   */
  function faviconEl(n, title) {
    const host = hostOf(n.url);
    const wrap = el('div', { class: 'favicon', 'aria-hidden': 'true' });
    wrap.style.setProperty('--hue', hashHue(host || title));
    const letter = (host || title).replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '•';
    wrap.append(el('span', { class: 'favicon-letter', text: letter }));

    const u = parseUrl(n.url);
    if (state.prefs.showFavicons && u && /^https?:$/.test(u.protocol) && !state.failedIcons.has(u.origin)) {
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
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
        { class: 'folder-open', type: 'button', title: t('folder.open', { name: folderName(folder) }), dataset: { action: 'open-folder' } },
        el('span', { class: 'folder-icon' }, icon(folderIcon(folder))),
        el(
          'span',
          { class: 'folder-text' },
          el('span', { class: 'folder-name' }, highlight(folderName(folder))),
          el('span', { class: 'folder-meta', text: metaText }),
        ),
      ),
      el('button', { class: 'icon-btn', type: 'button', title: t('action.more'), 'aria-label': t('action.more'), 'aria-haspopup': 'menu', dataset: { action: 'folder-more' } }, icon('more')),
    );
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
          action: { label: t('empty.addBookmark'), run: () => openEditor({ mode: 'new-bookmark', parentId: view.folder.id }) },
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
    box.replaceChildren(
      el('div', { class: 'empty-icon' }, icon(spec.icon)),
      el('h2', { text: spec.title }),
      el('p', { text: spec.text }),
      spec.detail ? el('p', { class: 'empty-detail', text: spec.detail }) : null,
      spec.action ? el('button', { class: 'btn btn-primary', type: 'button', onclick: spec.action.run }, spec.action.label) : null,
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
    $('#view-title').textContent = 'Bookmark Dashboard';
    $('#view-subtitle').textContent = '';
    $('#stats').textContent = t('stats.disconnected');
    $('#live').classList.add('is-error');
    showEmpty({ icon: 'alert', title, text, detail, action: retry ? { label: t('action.retry'), run: retry } : null }, { error: true });
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
      const message = [t('openAll.confirmMessage', { name }), skipped ? tn('openAll.confirmSkipped', skipped) : ''].filter(Boolean).join(' ');
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
        if (where.windowId !== undefined) Object.assign(props, { windowId: where.windowId, index: where.index + opened });
        await api.tabs.create(props);
        opened++;
      }
    } catch (err) {
      toast(t('toast.openAllError', { opened: numberFmt.format(opened), total: numberFmt.format(urls.length), error: err?.message || err }), 'error');
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
          ? t('delete.folder.message', { name: folderName(n), bookmarks: tn('n.bookmark', total), subfolders: tn('n.subfolder', subs) })
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
    try {
      if (isFolder(n)) await api.bookmarks.removeTree(n.id);
      else await api.bookmarks.remove(n.id);
      toast(done);
    } catch (err) {
      toast(t('toast.deleteError', { error: err?.message || err }), 'error');
    }
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

  function openEditor({ mode, node = null, parentId = null, focus = 'auto' }) {
    if (!state.ready) return;
    closeMenu();
    const folderMode = mode === 'new-folder' || (mode === 'edit' && isFolder(node));
    state.editor = { mode, nodeId: node?.id ?? null };

    const headings = {
      'new-bookmark': t('editor.newBookmark'),
      'new-folder': t('editor.newFolder'),
      edit: t(folderMode ? 'editor.editFolder' : 'editor.editBookmark'),
    };
    $('#edit-heading').textContent = focus === 'folder' ? t('editor.move') : headings[mode];
    $('#edit-submit').textContent = mode === 'edit' ? t(focus === 'folder' ? 'editor.submitMove' : 'action.save') : t('editor.submitCreate');

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
        if (parentId !== node.parentId) await api.bookmarks.move(node.id, { parentId });
        toast(parentId !== node.parentId ? t('toast.movedTo', { folder: folderName(get(parentId)) }) : t('toast.saved'));
      }
      dlg.close();
    } catch (err) {
      setEditorError(t('editor.rejected', { error: err?.message || err }));
    } finally {
      submit.disabled = false;
    }
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
      state.selected !== n.parentId && { label: t('menu.gotoFolder'), icon: 'folder', run: () => selectView(n.parentId) },
      '-',
      { label: t('menu.delete'), icon: 'trash', danger: true, run: () => confirmDelete(n) },
    ];
  }

  function folderMenu(f) {
    const builtin = isBuiltin(f.id);
    const direct = directBookmarks(f);
    return [
      { label: t('menu.open'), icon: 'folder', run: () => selectView(f.id) },
      direct.some((n) => isOpenable(n.url)) && { label: t('menu.openAll'), icon: 'tabs', run: () => openFolderInTabs(f.id) },
      { label: t('menu.newBookmarkHere'), icon: 'bookmark', run: () => openEditor({ mode: 'new-bookmark', parentId: f.id }) },
      { label: t('menu.newSubfolder'), icon: 'folder-plus', run: () => openEditor({ mode: 'new-folder', parentId: f.id }) },
      !builtin && '-',
      !builtin && { label: t('menu.rename'), icon: 'edit', run: () => openEditor({ mode: 'edit', node: f }) },
      !builtin && { label: t('menu.moveTo'), icon: 'move', run: () => openEditor({ mode: 'edit', node: f, focus: 'folder' }) },
      !builtin && '-',
      !builtin && { label: t('menu.deleteFolder'), icon: 'trash', danger: true, run: () => confirmDelete(f) },
    ];
  }

  function separatorMenu(s) {
    return [{ label: t('menu.deleteSeparator'), icon: 'trash', danger: true, run: () => confirmDelete(s) }];
  }

  function menuFor(n) {
    if (isFolder(n)) return folderMenu(n);
    if (isSeparator(n)) return separatorMenu(n);
    return bookmarkMenu(n);
  }

  function openMenu(items, anchor) {
    const menu = $('#menu');
    state.menuReturnFocus = document.activeElement;
    const entries = items.filter(Boolean);
    menu.replaceChildren(
      ...entries.map((item) =>
        item === '-'
          ? el('div', { class: 'menu-sep', role: 'separator' })
          : el(
              'button',
              {
                class: item.danger ? 'menu-item is-danger' : 'menu-item',
                type: 'button',
                role: 'menuitem',
                onclick: () => {
                  closeMenu();
                  item.run();
                },
              },
              icon(item.icon),
              el('span', { text: item.label }),
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
    menu.querySelector('.menu-item')?.focus();
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
    const items = [...$('#menu').querySelectorAll('.menu-item:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
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

  function canMoveInto(nodeId, targetId) {
    const node = get(nodeId);
    const target = get(targetId);
    if (!node || !isFolder(target) || targetId === state.rootId || isBuiltin(nodeId)) return false;
    if (node.parentId === targetId) return false;
    if (isFolder(node) && isInside(targetId, nodeId)) return false;
    return true;
  }

  function canDropOn(targetId, dataTransfer) {
    if (!targetId || targetId === state.rootId || !isFolder(get(targetId))) return false;
    if (state.dragId) return canMoveInto(state.dragId, targetId);
    const types = dataTransfer ? [...dataTransfer.types] : [];
    return types.includes('text/x-moz-url') || types.includes('text/uri-list');
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
    document.body.classList.remove('is-dragging');
    for (const node of document.querySelectorAll('.is-drag-source')) node.classList.remove('is-drag-source');
    setDropTarget(null);
  }

  function bindDragAndDrop() {
    document.addEventListener('dragstart', (event) => {
      const source = event.target.closest?.('[data-drag-id]');
      if (!source) return;
      const n = get(source.dataset.dragId);
      if (!n || isBuiltin(n.id)) {
        event.preventDefault();
        return;
      }
      closeMenu();
      state.dragId = n.id;
      const dt = event.dataTransfer;
      dt.effectAllowed = 'copyMove';
      dt.setData(DND_TYPE, n.id);
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

    document.addEventListener('dragover', (event) => {
      const target = event.target.closest?.('[data-drop-id]');
      const targetId = target?.dataset.dropId;
      if (!canDropOn(targetId, event.dataTransfer)) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = state.dragId ? 'move' : 'copy';
      // El contenedor principal no se resalta entero; solo carpetas concretas.
      setDropTarget(target.id === 'content' ? null : target);
    });

    document.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget) setDropTarget(null);
    });

    document.addEventListener('drop', async (event) => {
      const target = event.target.closest?.('[data-drop-id]');
      const targetId = target?.dataset.dropId;
      const dragId = state.dragId;
      if (!canDropOn(targetId, event.dataTransfer)) {
        endDrag();
        return;
      }
      event.preventDefault();
      endDrag();
      const destination = folderName(get(targetId));
      try {
        if (dragId) {
          await api.bookmarks.move(dragId, { parentId: targetId });
          toast(t('toast.movedTo', { folder: destination }));
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
  // Toasts y panel lateral móvil
  // ---------------------------------------------------------------------------

  function toast(message, type = 'info') {
    const node = el(
      'div',
      { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
      icon(type === 'error' ? 'alert' : 'check'),
      el('span', { text: message }),
    );
    const box = $('#toasts');
    box.append(node);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(
      () => {
        node.classList.add('is-leaving');
        node.addEventListener('animationend', () => node.remove(), { once: true });
        setTimeout(() => node.remove(), 500);
      },
      type === 'error' ? 5000 : 3000,
    );
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
        $('#cards .card-link')?.click();
      } else if (event.key === 'ArrowDown') {
        const first = $('#folder-grid .folder-open') || $('#cards .card-link');
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
      else if (actionEl.dataset.action === 'select') selectView(row.dataset.id);
    });
    tree.addEventListener('dblclick', (event) => {
      const row = event.target.closest('.tree-row');
      if (row && event.target.closest('.tree-label') && row.parentElement.querySelector(':scope > .tree-collapse')) {
        toggleExpanded(row.dataset.id);
      }
    });
    tree.addEventListener('keydown', handleTreeKeys);

    // Clic central en una carpeta (árbol, bloque o ruta): abre sus marcadores en pestañas.
    const FOLDER_TARGETS = '.tree-row, .folder-tile, .crumb';
    const folderIdFrom = (target) => {
      const host = target.closest?.(FOLDER_TARGETS);
      return host ? host.dataset.id || host.dataset.target : null;
    };
    document.addEventListener('mousedown', (event) => {
      // Evita el desplazamiento automático del botón central sobre carpetas.
      if (event.button === 1 && folderIdFrom(event.target)) event.preventDefault();
    });
    document.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const id = folderIdFrom(event.target);
      if (!id) return;
      event.preventDefault();
      closeMenu();
      openFolderInTabs(id);
    });

    // Menú contextual (clic derecho) en carpetas y tarjetas
    document.addEventListener('contextmenu', (event) => {
      if (event.target.closest('input, textarea, select, dialog')) return;
      const host = event.target.closest('.tree-row, .folder-tile, .card, .card-sep');
      const n = get(host?.dataset.id);
      if (!n) return;
      event.preventDefault();
      openMenu(menuFor(n), { x: event.clientX, y: event.clientY });
    });

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
        case 'goto':
        case 'crumb':
          selectView(actionEl.dataset.target);
          break;
        default:
          break;
      }
    });

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
      $('#settings-dialog').showModal();
    });
    $('#new-btn').addEventListener('click', (event) => {
      const parentId = defaultParentId();
      openMenu(
        [
          { label: t('action.newBookmark'), icon: 'bookmark', run: () => openEditor({ mode: 'new-bookmark', parentId }) },
          { label: t('action.newFolder'), icon: 'folder-plus', run: () => openEditor({ mode: 'new-folder', parentId }) },
        ],
        event.currentTarget,
      );
    });
    $('#sidebar-new-folder').addEventListener('click', () => openEditor({ mode: 'new-folder', parentId: defaultParentId() }));

    // Panel lateral en móvil
    $('#drawer-open').addEventListener('click', openDrawer);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);

    // Menú: cierre al hacer clic fuera, con Esc, al hacer scroll o al redimensionar
    const menu = $('#menu');
    menu.addEventListener('keydown', handleMenuKeys);
    document.addEventListener('pointerdown', (event) => {
      if (!menu.hidden && !menu.contains(event.target)) closeMenu();
    }, true);
    document.addEventListener('scroll', () => closeMenu(), true);
    window.addEventListener('resize', () => closeMenu());
    window.addEventListener('blur', () => closeMenu());

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
      else if (input.id === 'opt-newtab') setPref('openInNewTab', input.checked);
      else if (input.id === 'opt-subfolders') setPref('includeSubfolders', input.checked);
      else if (input.id === 'opt-favicons') {
        state.failedIcons.clear();
        setPref('showFavicons', input.checked);
      }
    });
    $('#resync-btn').addEventListener('click', () => resync({ notify: true }));

    // Atajos globales
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        search.focus();
        search.select();
      } else if (event.key === 'Delete' && !typing) {
        const host = event.target.closest?.('.card, .folder-tile, .tree-row');
        const n = get(host?.dataset.id);
        if (n) {
          event.preventDefault();
          confirmDelete(n);
        }
      } else if (event.key === 'Escape') {
        if (!menu.hidden) closeMenu(true);
        else if (document.body.classList.contains('nav-open')) closeDrawer();
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
      [...$('#tree').querySelectorAll('.tree-label')].filter((l) => !l.closest('.tree-item:not(.is-expanded) > .tree-collapse'));

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
      console.error('[Bookmark Dashboard] Error al leer los marcadores:', err);
      showFatal(
        t('fatal.read.title'),
        t('fatal.read.text'),
        String(err?.message || err),
        () => {
          showEmpty(null);
          $('#skeleton').hidden = false;
          start();
        },
      );
      return;
    }
    state.ready = true;
    $('#live').classList.remove('is-error');
    $('#controls').hidden = false;
    state.selected = resolveSelection(state.prefs.lastFolder);
    expandAncestors(state.selected);
    render();
    scrollSelectedIntoView();
  }

  async function init() {
    state.prefs.lang = lang; // copia rápida de localStorage hasta leer las preferencias
    document.documentElement.lang = lang;
    translateStatic();
    applyTheme();
    if (!api?.bookmarks || !api?.storage) {
      bindUI();
      showFatal(
        t('fatal.noApi.title'),
        t('fatal.noApi.text'),
        null,
        null,
      );
      return;
    }
    bindUI();
    registerBookmarkListeners();
    api.storage.onChanged.addListener(handleStorageChange);
    await loadPrefs();
    if (state.prefs.lang !== lang) applyLanguage();
    applyTheme();
    syncControls();
    await start();
  }

  init().catch((err) => {
    console.error('[Bookmark Dashboard] Error inesperado:', err);
    showFatal(t('fatal.unexpected.title'), t('fatal.unexpected.text'), String(err?.message || err), () => location.reload());
  });
})();
