// Multiple selection: Ctrl/Shift+click, checkbox, "Select all" and bulk actions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { card, clickEvent, fakeElement, openPanel } from './helpers/panel.mjs';

/** Panel on F with its four bookmarks in view, in order. */
async function withCards() {
  const cards = ['a', 'b', 'c', 'd'].map((id) => card(id));
  const env = await openPanel({ stored: { homeFolder: 'F' }, selectable: cards });
  env.state.viewItemIds = ['a', 'b', 'c', 'd'];
  const at = (id) => cards.find((c) => c.dataset.id === id);
  return { ...env, cards, at };
}

const link = () => fakeElement({ classes: ['card-link'] });
const button = (action) => fakeElement({ classes: ['icon-btn'], dataset: { action } });

test('a plain click opens the link; Ctrl+click and the checkbox select', async () => {
  const env = await withCards();
  const plain = clickEvent([link(), env.at('a')]);
  env.panel.handleSelectClick(plain);
  assert.equal(plain.prevented, false, 'without a selection, the click opens the link');

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

test('with an active selection, a plain click toggles and the buttons still work', async () => {
  const env = await withCards();
  env.panel.toggleSelected('a');
  const toggle = clickEvent([link(), env.at('b')]);
  env.panel.handleSelectClick(toggle);
  assert.equal(toggle.prevented, true);
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'b']);

  const star = clickEvent([button('favorite'), env.at('c')]);
  env.panel.handleSelectClick(star);
  assert.equal(star.prevented, false, 'starring does not select');
  env.panel.handleSelectClick(clickEvent([link(), env.at('a')]));
  assert.deepEqual([...env.panel.selectedIds()], ['b'], 'a second click removes it from the selection');
});

test('Shift+click selects the range and "Select all" includes what is not loaded', async () => {
  const env = await withCards();
  env.panel.handleSelectClick(clickEvent([link(), env.at('b')], { ctrl: true }));
  env.panel.handleSelectClick(clickEvent([link(), env.at('d')], { shift: true }));
  assert.deepEqual([...env.panel.selectedIds()], ['b', 'c', 'd']);

  env.panel.clearSelection();
  env.state.viewItemIds = ['a', 'b', 'c', 'd', 'x'];
  env.panel.selectAll();
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'b', 'c', 'd', 'x']);
});

test('changing folder or deleting a bookmark removes it from the selection', async () => {
  const env = await withCards();
  env.panel.selectAll();
  await env.bookmarks.remove('b');
  env.panel.toggleSelected('c');
  assert.deepEqual([...env.panel.selectedIds()], ['a', 'd']);
  env.panel.selectView('G');
  assert.deepEqual([...env.panel.selectedIds()], []);
  assert.equal(env.document.getElementById('selection-bar').hidden, true);
});

test('adding the selection to a group without duplicates', async () => {
  const stored = { groups: [{ id: 'g1', name: 'Uno', color: 'blue', items: ['a'] }] };
  const env = await openPanel({ stored });
  env.panel.addManyToGroup('g1', ['a', 'b', 'c']);
  await env.flush();
  assert.deepEqual(stored.groups[0].items, ['a', 'b', 'c']);
  assert.match(env.toasts.at(-1).message, /Added 2 bookmarks to “Uno”/);
});

test('deleting the selection asks for confirmation and can be undone', async () => {
  const env = await withCards();
  env.panel.toggleSelected('a');
  env.panel.toggleSelected('d');

  env.setConfirm(false);
  await env.panel.confirmDeleteMany(env.panel.selectedIds());
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'c', 'd'], 'cancelling deletes nothing');

  env.setConfirm(true);
  await env.panel.confirmDeleteMany(env.panel.selectedIds());
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'c']);
  assert.deepEqual([...env.panel.selectedIds()], []);
  assert.equal(env.toasts.at(-1).message, '2 bookmarks deleted');
  await env.toasts.at(-1).action.run();
  const titles = env.bookmarks.childrenOf('F').map((id) => env.bookmarks.nodes.get(id).title);
  assert.deepEqual(titles, ['a', 'b', 'c', 'd']);
});

test('moving to a folder only accepts valid targets', async () => {
  const env = await openPanel();
  assert.equal(env.panel.canMoveInto(['a', 'b'], 'G'), true);
  assert.equal(env.panel.canMoveInto(['a', 'b'], 'F'), false, 'already there');
  assert.equal(env.panel.canMoveInto(['a', 'x'], 'F'), true, 'at least one changes');
  assert.equal(env.panel.canMoveInto(['F'], 'F'), false, 'a folder does not go into itself');
  assert.equal(env.panel.canMoveInto(['a'], 'root________'), false, 'the root does not accept bookmarks');
});
