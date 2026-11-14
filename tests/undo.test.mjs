// «Deshacer» tras mover o eliminar (botón del aviso y Ctrl+Z).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeBookmarks, openPanel, sampleTree } from './helpers/panel.mjs';

const lastAction = (env) => env.toasts.findLast((toast) => toast.action);

test('deshacer un movimiento devuelve los marcadores a su carpeta y posición', async () => {
  for (const semantics of ['firefox', 'chrome']) {
    const env = await openPanel({ bookmarks: fakeBookmarks(sampleTree(), { semantics }) });
    await env.panel.moveWithUndo(['a', 'c'], 'G');
    assert.deepEqual(env.bookmarks.childrenOf('G'), ['x', 'a', 'c']);
    assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'd']);
    assert.equal(lastAction(env).action.label, 'Undo');
    assert.match(lastAction(env).message, /Moved 2 bookmarks to “G”/);

    await lastAction(env).action.run();
    assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'c', 'd'], semantics);
    assert.deepEqual(env.bookmarks.childrenOf('G'), ['x']);
    assert.equal(env.toasts.at(-1).message, 'Undone');
  }
});

test('deshacer un reordenado dentro de la misma carpeta', async () => {
  const env = await openPanel();
  await env.panel.moveWithUndo(['d'], 'F', 'a');
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['d', 'a', 'b', 'c']);
  assert.equal(lastAction(env).message, 'Order changed');
  assert.equal(await env.panel.runUndo(), true, 'Ctrl+Z');
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'c', 'd']);
  assert.equal(await env.panel.runUndo(), false, 'solo se deshace una vez');
});

test('deshacer un borrado recrea la carpeta con su contenido y conserva favoritos, grupos y ajustes', async () => {
  const stored = {
    homeFolder: 'F',
    favorites: ['b'],
    groups: [{ id: 'g1', name: 'Uno', color: 'blue', items: ['a', 'x'] }],
    folderColors: { F: 'teal' },
    boardCollapsed: ['F'],
  };
  const env = await openPanel({ stored });
  await env.panel.deleteNodes([env.panel.get('F')], 'Folder deleted');
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['G', 'H']);

  await lastAction(env).action.run();
  await env.flush();
  const toolbar = env.bookmarks.childrenOf('toolbar_____');
  assert.equal(toolbar.length, 3);
  const folder = env.bookmarks.nodes.get(toolbar[0]);
  assert.equal(folder.title, 'F', 'vuelve a su posición');
  const restored = env.bookmarks.childrenOf(folder.id).map((id) => env.bookmarks.nodes.get(id));
  assert.deepEqual(
    restored.map((n) => n.url),
    ['a', 'b', 'c', 'd'].map((id) => `https://${id}.example/`),
  );

  const newId = (title) => restored.find((n) => n.title === title).id;
  assert.deepEqual(stored.favorites, [newId('b')]);
  assert.deepEqual(stored.groups[0].items, [newId('a'), 'x']);
  assert.deepEqual(stored.folderColors, { [folder.id]: 'teal' });
  assert.deepEqual(stored.boardCollapsed, [folder.id]);
  assert.equal(stored.homeFolder, folder.id);
});

test('deshacer el borrado de varios marcadores los deja en su sitio', async () => {
  const env = await openPanel();
  await env.panel.deleteNodes(['a', 'c'].map(env.panel.get), '2 bookmarks deleted');
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'd']);
  await env.panel.runUndo();
  const titles = env.bookmarks.childrenOf('F').map((id) => env.bookmarks.nodes.get(id).title);
  assert.deepEqual(titles, ['a', 'b', 'c', 'd']);
});

test('«Deshacer» caduca y solo vale para la última acción', async () => {
  const env = await openPanel();
  await env.panel.moveWithUndo(['a'], 'G');
  const first = lastAction(env).action;
  await env.panel.moveWithUndo(['b'], 'G');
  await first.run();
  assert.deepEqual(env.bookmarks.childrenOf('G'), ['x', 'a', 'b'], 'el botón de una acción anterior ya no hace nada');

  env.state.undo.at -= 61_000;
  assert.equal(await env.panel.runUndo(), false, 'pasado un minuto no se deshace');
  assert.deepEqual(env.bookmarks.childrenOf('G'), ['x', 'a', 'b']);
});
