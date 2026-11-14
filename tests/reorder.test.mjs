// Reordenar arrastrando en la sección principal: marcadores (uno o varios) y carpetas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { card, dragEvent, fakeBookmarks, fakeElement, openPanel, sampleTree } from './helpers/panel.mjs';

/** Panel abierto en F, con «Orden original», arrastrando `ids`. */
async function inFolderF(options = {}) {
  const env = await openPanel({ stored: { homeFolder: 'F' }, ...options });
  env.state.reorderable = true;
  env.state.viewFolderId = 'F';
  return env;
}

const drag = (env, ids) => {
  env.state.dragIds = ids;
  env.state.dragId = ids[0] ?? null;
};
// Tarjeta de 100×40 en la cuadrícula de una columna: mitad superior = antes, inferior = después.
const over = (env, id, after) => env.panel.reorderSlot(dragEvent(card(id), { y: after ? 30 : 10 }));

for (const semantics of ['firefox', 'chrome']) {
  test(`reordena un marcador arriba, abajo y al final (${semantics})`, async () => {
    const cases = [
      ['a', 'c', true, ['b', 'c', 'a', 'd']],
      ['d', 'a', false, ['d', 'a', 'b', 'c']],
      ['a', 'd', true, ['b', 'c', 'd', 'a']],
      ['b', 'a', false, ['b', 'a', 'c', 'd']],
    ];
    for (const [id, target, after, expected] of cases) {
      const env = await inFolderF({ bookmarks: fakeBookmarks(sampleTree(), { semantics }) });
      drag(env, [id]);
      const slot = over(env, target, after);
      assert.equal(slot.noop, false);
      await env.panel.dropOnSlot(slot, [id], null);
      assert.deepEqual(env.bookmarks.childrenOf('F'), expected, `${id} ${after ? 'tras' : 'antes de'} ${target}`);
      assert.deepEqual(env.state.nodes.get('F').children, expected, 'el modelo sigue a Firefox');
    }
  });
}

test('soltar junto a un marcador de otra carpeta lo mueve a esa posición', async () => {
  const env = await inFolderF();
  drag(env, ['b']);
  await env.panel.dropOnSlot(over(env, 'x', false), ['b'], null);
  assert.deepEqual(env.bookmarks.childrenOf('G'), ['b', 'x']);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'c', 'd']);
  assert.match(env.toasts.at(-1).message, /Moved to “G”/);
});

test('varios marcadores seleccionados se mueven juntos y en orden', async () => {
  const env = await inFolderF();
  drag(env, ['a', 'c']);
  await env.panel.dropOnSlot(over(env, 'd', true), ['a', 'c'], null);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'd', 'a', 'c']);

  drag(env, ['d', 'c']);
  await env.panel.dropOnSlot(over(env, 'b', false), ['d', 'c'], null);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['d', 'c', 'b', 'a']);
});

test('huecos sin cambio y casos en los que no se reordena', async () => {
  const env = await inFolderF();
  drag(env, ['b']);
  assert.equal(over(env, 'a', true).noop, true, 'tras el anterior = mismo sitio');
  assert.equal(over(env, 'c', false).noop, true, 'antes del siguiente = mismo sitio');
  assert.equal(over(env, 'b', false), null, 'sobre sí mismo');

  env.state.reorderable = false;
  assert.equal(over(env, 'c', true), null, 'sin «Orden original»');
  env.state.reorderable = true;
  env.state.dragFromGroup = 'g1';
  assert.equal(over(env, 'c', true), null, 'desde un grupo');
  assert.equal(env.bookmarks.calls.length, 0, 'nada toca los marcadores');
});

test('un enlace externo se guarda en el hueco donde se suelta', async () => {
  const env = await inFolderF();
  drag(env, []);
  const slot = env.panel.reorderSlot(dragEvent(card('c'), { y: 10, types: ['text/uri-list'] }));
  await env.panel.dropOnSlot(slot, [], { url: 'https://nuevo.example/', title: 'Nuevo' });
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'new1', 'c', 'd']);
});

// ----- Carpetas: bloques de carpeta (cuadrícula) y tarjetas del tablero -----

const tile = (id) =>
  fakeElement({
    classes: ['folder-tile'],
    dataset: { id, dropId: id, dragId: id },
    rect: { left: 0, top: 0, right: 200, bottom: 60, width: 200, height: 60 },
  });
const boardCard = (id) =>
  fakeElement({
    classes: ['board-card'],
    dataset: { dropId: id, folderId: id },
    rect: { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 },
  });

/** Panel en la barra de marcadores (carpetas F, G, H), arrastrando una carpeta. */
async function inToolbar(columns) {
  const env = await openPanel({ stored: { homeFolder: 'toolbar_____' }, columns });
  env.state.reorderable = true;
  env.state.viewFolderId = 'toolbar_____';
  return env;
}

test('en la cuadrícula de carpetas, los bordes reordenan y el centro mete dentro', async () => {
  const env = await inToolbar(3);
  drag(env, ['H']);
  const left = env.panel.reorderSlot(dragEvent(tile('F'), { x: 10, y: 30 }));
  assert.equal(left.after, false);
  assert.equal(left.x, true);
  assert.equal(env.panel.reorderSlot(dragEvent(tile('F'), { x: 100, y: 30 })), null, 'centro: meter dentro');
  const right = env.panel.reorderSlot(dragEvent(tile('F'), { x: 190, y: 30 }));
  assert.equal(right.after, true);

  await env.panel.dropOnSlot(left, ['H'], null);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['H', 'F', 'G']);
  assert.match(env.toasts.at(-1).message, /Order changed/);
});

test('en el tablero, el borde superior o inferior de la tarjeta reordena la carpeta', async () => {
  const env = await inToolbar(1);
  drag(env, ['F']);
  const below = env.panel.reorderSlot(dragEvent(boardCard('H'), { y: 195 }));
  assert.equal(below.after, true);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('H'), { y: 100 })), null, 'centro: meter dentro');
  await env.panel.dropOnSlot(below, ['F'], null);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['G', 'H', 'F']);
});

test('una carpeta no se coloca dentro de sí misma, junto a la carpeta abierta ni si es del sistema', async () => {
  const tree = sampleTree();
  // F pasa a contener la subcarpeta S.
  tree.children[0].children[0].children.push({ id: 'S', type: 'folder', title: 'S', children: [] });
  const env = await openPanel({ stored: { homeFolder: 'F' }, bookmarks: fakeBookmarks(tree), columns: 1 });
  env.state.reorderable = true;
  env.state.viewFolderId = 'toolbar_____';
  drag(env, ['F']);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('F'), { y: 2 })), null, 'junto a sí misma');
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('S'), { y: 2 })), null, 'dentro de su subcarpeta');
  env.state.viewFolderId = 'G';
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('G'), { y: 2 })), null, 'tarjeta de la carpeta abierta');
  drag(env, ['toolbar_____']);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('F'), { y: 2 })), null, 'carpeta del sistema');
  drag(env, ['G']);
  assert.notEqual(env.panel.reorderSlot(dragEvent(boardCard('S'), { y: 2 })), null, 'G sí puede ir junto a S');
});
