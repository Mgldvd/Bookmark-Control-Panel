// Tira: carpetas elegidas, una al lado de otra (view:strip).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dragEvent, fakeElement, openPanel } from './helpers/panel.mjs';

const stripCard = (id) =>
  fakeElement({
    classes: ['board-card'],
    dataset: { folderId: id, dropId: id },
    rect: { left: 0, right: 300, width: 300 },
  });
const addTile = () => fakeElement({ classes: ['strip-add'] });

/** Panel mostrando la tira, arrastrando la carpeta `id`. */
async function inStrip(stripFolders, id) {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders } });
  env.state.viewKind = 'strip';
  env.state.dragIds = id ? [id] : [];
  return env;
}

test('añadir y quitar carpetas: se guarda, se recuerda y va en la copia de seguridad', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  first.panel.toggleStrip('G');
  first.panel.toggleStrip('F');
  await first.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F'], 'en el orden en que se añaden');

  const second = await openPanel({ stored });
  assert.deepEqual([...second.state.stripFolders], ['G', 'F']);
  assert.deepEqual([...second.panel.buildBackup().stripFolders], ['G', 'F']);

  second.panel.toggleStrip('G');
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['F']);
  // «Deshacer» del aviso la devuelve a su sitio.
  second.toasts.at(-1).action.run();
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F']);
});

test('la vista muestra las carpetas en su orden y omite las que ya no existen', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders: ['G', 'borrada', 'F'] } });
  assert.equal(env.state.selected, 'view:strip');
  const view = env.panel.computeView();
  assert.equal(view.kind, 'strip');
  assert.deepEqual(
    Array.from(view.folders, (f) => f.id),
    ['G', 'F'],
  );
  assert.deepEqual(
    Array.from(view.items, (n) => n.id),
    ['x', 'a', 'b', 'c', 'd'],
  );
});

test('arrastrar una tarjeta a la izquierda o a la derecha de otra la reordena', async () => {
  const env = await inStrip(['F', 'G', 'H'], 'H');
  const before = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  assert.equal(before.noop, false);
  env.panel.placeInStrip(before.folderId, before.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);

  const after = env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 }));
  env.panel.placeInStrip(after.folderId, after.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G', 'H']);

  assert.equal(env.panel.stripSlot(dragEvent(stripCard('H'), { x: 40 })).noop, true, 'sobre sí misma');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 })).noop, true, 'ya está ahí');
});

test('una carpeta arrastrada desde el árbol se añade a la tira donde se suelta', async () => {
  const env = await inStrip(['F'], 'G');
  const slot = env.panel.stripSlot(dragEvent(addTile()));
  assert.equal(slot.noop, false);
  env.panel.placeInStrip(slot.folderId, slot.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G']);

  env.state.dragIds = ['H'];
  const first = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  env.panel.placeInStrip(first.folderId, first.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['F', 'G', 'H'], 'Firefox no cambia');
});

test('fuera de la tira, o arrastrando marcadores, no hay hueco de tira', async () => {
  const env = await inStrip(['F', 'G'], 'a');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
  env.state.dragIds = ['G'];
  env.state.viewKind = 'folder';
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
});

test('deshacer el borrado de una carpeta la devuelve a la tira', async () => {
  const env = await openPanel({ stored: { stripFolders: ['F', 'G'] } });
  await env.panel.deleteNodes([env.panel.get('F')], 'Folder deleted');
  await env.panel.runUndo();
  const restored = env.bookmarks.childrenOf('toolbar_____')[0];
  assert.notEqual(restored, 'F');
  assert.deepEqual([...env.state.stripFolders], [restored, 'G']);
});

test('la casa de la cabecera deja la tira como página de inicio', async () => {
  const stored = { homeFolder: 'F', stripFolders: ['G'] };
  const first = await openPanel({ stored });
  first.panel.selectView('view:strip');
  first.panel.setHomeHere();
  await first.flush();
  assert.equal(stored.homeFolder, 'view:strip');
  assert.match(first.toasts.at(-1).message, /Strip/);

  // Pulsarla otra vez solo avisa de que ya lo es.
  first.panel.setHomeHere();
  assert.match(first.toasts.at(-1).message, /is your home page/);

  assert.equal((await openPanel({ stored })).state.selected, 'view:strip', 'un panel nuevo abre la tira');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.minimalSelection(), 'view:strip', 'también en el modo minimalista');
});

test('con la tira abierta, el árbol marca y desmarca carpetas sin navegar', async () => {
  const stored = { homeFolder: 'view:strip', stripFolders: ['F'] };
  const env = await openPanel({ stored });
  assert.equal(env.panel.stripPicking(), true);

  env.panel.toggleStripPick('H');
  env.panel.toggleStripPick('toolbar_____');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['F', 'H', 'toolbar_____'], 'se añaden al final, también las raíz');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['H', 'toolbar_____']);
  assert.equal(env.state.selected, 'view:strip', 'sigue en la tira');
  assert.equal(env.toasts.length, 0, 'sin avisos por cada casilla');

  env.panel.selectView('F');
  assert.equal(env.panel.stripPicking(), false, 'fuera de la tira el árbol vuelve a navegar');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.stripPicking(), false, 'el modo minimalista no tiene árbol');
});

test('las subcarpetas desplegadas en la tira se recuerdan y van en la copia de seguridad', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  first.panel.toggleStripSub('G');
  first.panel.toggleStripSub('H');
  await first.flush();
  assert.deepEqual(stored.stripOpen, ['G', 'H']);

  const second = await openPanel({ stored });
  assert.deepEqual([...second.state.stripOpen], ['G', 'H']);
  assert.deepEqual([...second.panel.buildBackup().stripOpen], ['G', 'H']);
  second.panel.toggleStripSub('G');
  await second.flush();
  assert.deepEqual(stored.stripOpen, ['H'], 'plegar también se recuerda');
});

test('«Expandir todo» abre las tarjetas y despliega todas las subcarpetas; «Contraer todo» las pliega', async () => {
  const stored = {
    homeFolder: 'view:strip',
    stripFolders: ['toolbar_____'],
    stripOpen: ['G'],
    boardCollapsed: ['toolbar_____'],
  };
  const env = await openPanel({ stored });
  assert.equal(env.panel.stripAllExpanded(), false);

  env.panel.toggleStripExpandAll();
  await env.flush();
  assert.equal(env.panel.stripAllExpanded(), true);
  assert.deepEqual(Array.from(stored.stripOpen).toSorted(), ['F', 'G', 'H']);
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'la tarjeta plegada se abre');

  env.panel.toggleStripExpandAll();
  await env.flush();
  assert.equal(env.panel.stripAllExpanded(), false);
  assert.deepEqual(Array.from(stored.stripOpen), []);
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'contraer no pliega las tarjetas');
});
