// Selección múltiple: Ctrl/Mayús+clic, casilla, «Seleccionar todo» y acciones en bloque.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { card, clickEvent, fakeElement, openPanel } from './helpers/panel.mjs';

/** Panel en F con sus cuatro marcadores a la vista, en orden. */
async function withCards() {
  const cards = ['a', 'b', 'c', 'd'].map((id) => card(id));
  const env = await openPanel({ stored: { homeFolder: 'F' }, selectable: cards });
  env.state.viewItemIds = ['a', 'b', 'c', 'd'];
  const at = (id) => cards.find((c) => c.dataset.id === id);
  return { ...env, cards, at };
}

const link = () => fakeElement({ classes: ['card-link'] });
const button = (action) => fakeElement({ classes: ['icon-btn'], dataset: { action } });

test('un clic normal abre el enlace; Ctrl+clic y la casilla seleccionan', async () => {
  const env = await withCards();
  const plain = clickEvent([link(), env.at('a')]);
  env.panel.handleSelectClick(plain);
  assert.equal(plain.prevented, false, 'sin selección, el clic abre el enlace');

  const ctrl = clickEvent([link(), env.at('a')], { ctrl: true });
  env.panel.handleSelectClick(ctrl);
  assert.equal(ctrl.prevented, true);
  env.panel.handleSelectClick(clickEvent([button('select'), env.at('c')]));
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'c']);
  assert.equal(env.at('a').classList.contains('is-selected'), true);
  assert.equal(env.document.body.classList.contains('has-selection'), true);
  assert.equal(env.document.getElementById('selection-bar').hidden, false);
  assert.equal(env.document.getElementById('selection-count').textContent, '2 selected');
});

test('con selección activa, un clic normal alterna y los botones siguen funcionando', async () => {
  const env = await withCards();
  env.panel.toggleSelected('a');
  const toggle = clickEvent([link(), env.at('b')]);
  env.panel.handleSelectClick(toggle);
  assert.equal(toggle.prevented, true);
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'b']);

  const star = clickEvent([button('favorite'), env.at('c')]);
  env.panel.handleSelectClick(star);
  assert.equal(star.prevented, false, 'destacar no selecciona');
  env.panel.handleSelectClick(clickEvent([link(), env.at('a')]));
  assert.deepEqual([...env.panel.selectedIds()], ['b'], 'un segundo clic quita de la selección');
});

test('Mayús+clic selecciona el rango y «Seleccionar todo» incluye lo no cargado', async () => {
  const env = await withCards();
  env.panel.handleSelectClick(clickEvent([link(), env.at('b')], { ctrl: true }));
  env.panel.handleSelectClick(clickEvent([link(), env.at('d')], { shift: true }));
  assert.deepEqual([...env.panel.selectedIds()], ['b', 'c', 'd']);

  env.panel.clearSelection();
  env.state.viewItemIds = ['a', 'b', 'c', 'd', 'x'];
  env.panel.selectAll();
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'b', 'c', 'd', 'x']);
});

test('cambiar de carpeta o borrar un marcador lo quita de la selección', async () => {
  const env = await withCards();
  env.panel.selectAll();
  await env.bookmarks.remove('b');
  env.panel.toggleSelected('c');
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'd']);
  env.panel.selectView('G');
  assert.deepEqual([...env.panel.selectedIds()], []);
  assert.equal(env.document.getElementById('selection-bar').hidden, true);
});

test('añadir la selección a un grupo sin duplicar', async () => {
  const stored = { groups: [{ id: 'g1', name: 'Uno', color: 'blue', items: ['a'] }] };
  const env = await openPanel({ stored });
  env.panel.addManyToGroup('g1', ['a', 'b', 'c']);
  await env.flush();
  assert.deepEqual(stored.groups[0].items, ['a', 'b', 'c']);
  assert.match(env.toasts.at(-1).message, /Added 2 bookmarks to “Uno”/);
});

test('eliminar la selección pide confirmación y se puede deshacer', async () => {
  const env = await withCards();
  env.panel.toggleSelected('a');
  env.panel.toggleSelected('d');

  env.setConfirm(false);
  await env.panel.confirmDeleteMany(env.panel.selectedIds());
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'c', 'd'], 'cancelar no borra nada');

  env.setConfirm(true);
  await env.panel.confirmDeleteMany(env.panel.selectedIds());
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'c']);
  assert.deepEqual([...env.panel.selectedIds()], []);
  assert.equal(env.toasts.at(-1).message, '2 bookmarks deleted');
  await env.toasts.at(-1).action.run();
  const titles = env.bookmarks.childrenOf('F').map((id) => env.bookmarks.nodes.get(id).title);
  assert.deepEqual(titles, ['a', 'b', 'c', 'd']);
});

test('mover a una carpeta solo acepta destinos válidos', async () => {
  const env = await openPanel();
  assert.equal(env.panel.canMoveInto(['a', 'b'], 'G'), true);
  assert.equal(env.panel.canMoveInto(['a', 'b'], 'F'), false, 'ya están ahí');
  assert.equal(env.panel.canMoveInto(['a', 'x'], 'F'), true, 'al menos uno cambia');
  assert.equal(env.panel.canMoveInto(['F'], 'F'), false, 'una carpeta no entra en sí misma');
  assert.equal(env.panel.canMoveInto(['a'], 'root________'), false, 'la raíz no admite marcadores');
});
