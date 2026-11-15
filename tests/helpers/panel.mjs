// Entorno de prueba: carga dashboard.js (con i18n.js) en un contexto aislado de Node,
// con una API de marcadores simulada que se comporta como la de Firefox y emite sus
// eventos, un DOM mínimo y browser.storage.local en memoria. No hace falta navegador.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
const I18N = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');

// Funciones internas que las pruebas usan directamente.
const EXPOSE = [
  'state',
  'get',
  'loadPrefs',
  'start',
  'registerBookmarkListeners',
  'selectView',
  'setHomeFolder',
  'minimalSelection',
  'saveBoardShowAll',
  'buildBackup',
  'reorderSlot',
  'dropOnSlot',
  'moveNodes',
  'moveWithUndo',
  'deleteNodes',
  'confirmDeleteMany',
  'runUndo',
  'toggleSelected',
  'selectRange',
  'selectAll',
  'clearSelection',
  'selectedIds',
  'handleSelectClick',
  'addManyToGroup',
  'canMoveInto',
  'computeView',
  'toggleStrip',
  'placeInStrip',
  'stripSlot',
  'setHomeHere',
  'stripPicking',
  'toggleStripPick',
  'toggleStripSub',
  'toggleStripExpandAll',
  'setSeparatorColor',
  'separatorMenu',
  'planImport',
  'stripAllExpanded',
  'stripSubsOf',
];

const noop = () => {};

/** Elemento de DOM mínimo: clases, dataset y atributos; el resto no hace nada. */
export function fakeElement({ id, classes = [], dataset = {}, rect } = {}) {
  const set = new Set(classes);
  const attrs = new Map();
  const node = {
    id: id || '',
    dataset: { ...dataset },
    hidden: false,
    textContent: '',
    scrollTop: 0,
    classList: {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, force) => {
        const on = force ?? !set.has(c);
        if (on) set.add(c);
        else set.delete(c);
        return on;
      },
      contains: (c) => set.has(c),
    },
    style: { setProperty: noop, removeProperty: noop },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    removeAttribute: (k) => attrs.delete(k),
    append: noop,
    replaceChildren: noop,
    addEventListener: noop,
    focus: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => rect || { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 },
    closest: () => null,
  };
  return node;
}

/**
 * API de marcadores en memoria. `semantics`: 'firefox' (índice final, como Places)
 * o 'chrome' (índice contado antes de quitar el elemento de su sitio).
 */
export function fakeBookmarks(tree, { semantics = 'firefox' } = {}) {
  const nodes = new Map();
  const listeners = { onCreated: [], onRemoved: [], onChanged: [], onMoved: [] };
  let seq = 0;
  const calls = [];

  const add = (raw, parentId) => {
    const type = raw.type || (raw.url ? 'bookmark' : 'folder');
    nodes.set(raw.id, {
      id: raw.id,
      parentId,
      type,
      title: raw.title || '',
      url: raw.url || '',
      dateAdded: raw.dateAdded || 1,
      children: type === 'folder' ? (raw.children || []).map((c) => c.id) : null,
    });
    for (const c of raw.children || []) add(c, raw.id);
  };
  add(tree, undefined);

  const indexOf = (n) => (n.parentId ? nodes.get(n.parentId).children.indexOf(n.id) : 0);
  const info = (n) => ({
    id: n.id,
    parentId: n.parentId,
    index: indexOf(n),
    type: n.type,
    title: n.title,
    url: n.url || undefined,
    dateAdded: n.dateAdded,
  });
  const raw = (n) => ({ ...info(n), children: n.children ? n.children.map((id) => raw(nodes.get(id))) : undefined });
  const emit = (name, ...args) => {
    for (const fn of listeners[name]) fn(...args);
  };
  const need = (id) => {
    const n = nodes.get(id);
    if (!n) throw new Error(`No existe el marcador ${id}`);
    return n;
  };
  const dropTree = (id) => {
    const n = nodes.get(id);
    for (const c of n.children || []) dropTree(c);
    nodes.delete(id);
  };

  const api = {
    calls,
    nodes,
    childrenOf: (id) => [...need(id).children],
    getTree: async () => [raw(nodes.get(tree.id))],
    get: async (id) => [info(need(id))],
    move: async (id, { parentId, index } = {}) => {
      calls.push(['move', id, { parentId, index }]);
      const n = need(id);
      const from = nodes.get(n.parentId);
      const to = need(parentId ?? n.parentId);
      const oldIndex = from.children.indexOf(id);
      from.children.splice(oldIndex, 1);
      let i = index ?? to.children.length;
      if (semantics === 'chrome' && from === to && index != null && oldIndex < index) i = index - 1;
      i = Math.max(0, Math.min(i, to.children.length));
      to.children.splice(i, 0, id);
      n.parentId = to.id;
      emit('onMoved', id, { parentId: to.id, index: i, oldParentId: from.id, oldIndex });
      return info(n);
    },
    create: async ({ parentId, index, title, url, type }) => {
      calls.push(['create', { parentId, index, title, url, type }]);
      const parent = need(parentId);
      const id = `new${++seq}`;
      const kind = type === 'separator' ? 'separator' : url ? 'bookmark' : 'folder';
      nodes.set(id, {
        id,
        parentId,
        type: kind,
        title: title || '',
        url: url || '',
        dateAdded: 2,
        children: kind === 'folder' ? [] : null,
      });
      const i = index == null ? parent.children.length : Math.min(index, parent.children.length);
      parent.children.splice(i, 0, id);
      const n = nodes.get(id);
      emit('onCreated', id, raw(n));
      return info(n);
    },
    remove: async (id) => {
      calls.push(['remove', id]);
      const n = need(id);
      if (n.children?.length) throw new Error('La carpeta no está vacía');
      const parent = nodes.get(n.parentId);
      const index = parent.children.indexOf(id);
      parent.children.splice(index, 1);
      nodes.delete(id);
      emit('onRemoved', id, { parentId: parent.id, index });
    },
    removeTree: async (id) => {
      calls.push(['removeTree', id]);
      const n = need(id);
      const parent = nodes.get(n.parentId);
      const index = parent.children.indexOf(id);
      parent.children.splice(index, 1);
      dropTree(id);
      emit('onRemoved', id, { parentId: parent.id, index });
    },
    update: async (id, changes) => {
      const n = need(id);
      Object.assign(n, changes);
      emit('onChanged', id, changes);
      return info(n);
    },
  };
  for (const name of Object.keys(listeners)) api[name] = { addListener: (fn) => listeners[name].push(fn) };
  return api;
}

/** Árbol de ejemplo: barra con la carpeta F (marcadores a–d), G (x) y H vacía. */
export function sampleTree() {
  const bm = (id) => ({ id, type: 'bookmark', title: id, url: `https://${id}.example/` });
  return {
    id: 'root________',
    type: 'folder',
    children: [
      {
        id: 'toolbar_____',
        type: 'folder',
        title: 'Toolbar',
        children: [
          { id: 'F', type: 'folder', title: 'F', children: ['a', 'b', 'c', 'd'].map(bm) },
          { id: 'G', type: 'folder', title: 'G', children: [bm('x')] },
          { id: 'H', type: 'folder', title: 'H', children: [] },
        ],
      },
      { id: 'unfiled_____', type: 'folder', title: 'Other', children: [] },
    ],
  };
}

/**
 * Abre un panel nuevo. `stored` es browser.storage.local (se comparte entre paneles
 * para simular pestañas); `bookmarks`, la API simulada.
 */
export async function openPanel({
  stored = {},
  bookmarks = fakeBookmarks(sampleTree()),
  search = '',
  columns = 1,
  selectable = [],
} = {}) {
  const timers = [];
  const toasts = [];
  const byId = new Map();
  const bySelector = new Map();
  const element = (key, map) => {
    if (!map.has(key)) map.set(key, fakeElement({ id: key }));
    return map.get(key);
  };
  const document = {
    getElementById: (id) => element(id, byId),
    querySelector: (sel) =>
      sel.startsWith('#') && !sel.includes(' ') ? element(sel.slice(1), byId) : element(sel, bySelector),
    // Solo los marcadores seleccionables «a la vista», en el orden que diga la prueba.
    querySelectorAll: (sel) => (sel.includes('.board-row[data-id]') ? selectable : []),
    createElement: () => fakeElement(),
    createElementNS: () => fakeElement(),
    body: fakeElement({ id: 'body' }),
    documentElement: fakeElement({ id: 'html' }),
  };
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Intl,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: noop,
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    window: { matchMedia: () => ({ matches: false, addEventListener: noop }) },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    innerWidth: 1280,
    innerHeight: 800,
    location: { search },
    localStorage: { getItem: () => null, setItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    getComputedStyle: () => ({ gridTemplateColumns: Array(columns).fill('200px').join(' ') }),
    document,
    browser: {
      bookmarks,
      runtime: { getManifest: () => ({ version: 'test' }), getURL: (p) => `moz-extension://test/${p}` },
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...structuredClone(stored) }),
          set: async (partial) => Object.assign(stored, structuredClone(partial)),
        },
        onChanged: { addListener: noop },
      },
    },
  });

  const tail = /\n {2}init\(\)\.catch\([\s\S]*\n\}\)\(\);\s*$/;
  if (!tail.test(SOURCE))
    throw new Error('dashboard.js ya no termina en init().catch(…): actualiza tests/helpers/panel.mjs');
  const instrumented = SOURCE.replace(
    tail,
    `
  render = renderMain = renderSidebar = updateSidebarSelection = scrollSelectedIntoView = () => {};
  applyMinimal = syncControls = scheduleRender = () => {};
  toast = (message, type = 'info', action = null) => globalThis.__toasts.push({ message, type, action });
  confirmDialog = async () => globalThis.__confirm;
  globalThis.__panel = { ${EXPOSE.join(', ')} };
})();`,
  );
  context.__toasts = toasts;
  context.__confirm = true;
  vm.runInContext(I18N, context, { filename: 'i18n.js' });
  vm.runInContext(instrumented, context, { filename: 'dashboard.js' });

  const panel = context.__panel;
  panel.registerBookmarkListeners();
  await panel.loadPrefs();
  await panel.start();
  return {
    panel,
    state: panel.state,
    bookmarks,
    stored,
    toasts,
    document,
    /** Ejecuta los temporizadores pendientes (debounce) y espera a que se guarde. */
    async flush() {
      while (timers.length) timers.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    },
    setConfirm: (value) => {
      context.__confirm = value;
    },
  };
}

/**
 * Destino de un evento: el primero de la cadena (de dentro hacia fuera) que
 * coincide con el selector, como Element.closest().
 */
export function targetIn(...chain) {
  return { closest: (sel) => chain.find((node) => matches(node, sel)) ?? null };
}

/** Evento de arrastre simulado sobre `item` (un fakeElement), en el punto (x, y). */
export function dragEvent(item, { x = 50, y = 10, types = [] } = {}) {
  return { target: targetIn(item), clientX: x, clientY: y, dataTransfer: { types } };
}

/** Clic simulado; registra si el panel lo intercepta (preventDefault). */
export function clickEvent(chain, { ctrl = false, shift = false } = {}) {
  const event = {
    target: targetIn(...chain),
    button: 0,
    ctrlKey: ctrl,
    metaKey: false,
    shiftKey: shift,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation: noop,
  };
  return event;
}

/** Coincidencia sencilla (última parte de cada selector: clases y [data-…]). */
function matches(node, sel) {
  return sel.split(',').some((part) => {
    const last = part.trim().split(' ').pop();
    const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...last.matchAll(/\[data-([\w-]+)\]/g)].map((m) =>
      m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()),
    );
    return classes.every((c) => node.classList.contains(c)) && attrs.every((a) => node.dataset[a] != null);
  });
}

/** Tarjeta de marcador «a la vista» para la selección y el arrastre. */
export const card = (id, rect) => fakeElement({ classes: ['card'], dataset: { id, dragId: id }, rect });
