// Reordering by dragging in the main section: bookmarks (one or several) and folders.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { card, dragEvent, fakeBookmarks, fakeElement, openPanel, sampleTree } from './helpers/panel.mjs';

/** Panel open on F, with "Original order", dragging `ids`. */
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
// 100×40 card in a one-column grid: top half = before, bottom half = after.
const over = (env, id, after) => env.panel.reorderSlot(dragEvent(card(id), { y: after ? 30 : 10 }));

for (const semantics of ['firefox', 'chrome']) {
  test(`reorders a bookmark up, down and to the end (${semantics})`, async () => {
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
      assert.deepEqual(env.bookmarks.childrenOf('F'), expected, `${id} ${after ? 'after' : 'before'} ${target}`);
      assert.deepEqual(env.state.nodes.get('F').children, expected, 'the model follows Firefox');
    }
  });
}

test('dropping next to a bookmark in another folder moves it to that position', async () => {
  const env = await inFolderF();
  drag(env, ['b']);
  await env.panel.dropOnSlot(over(env, 'x', false), ['b'], null);
  assert.deepEqual(env.bookmarks.childrenOf('G'), ['b', 'x']);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'c', 'd']);
  assert.match(env.toasts.at(-1).message, /Moved to “G”/);
});

test('several selected bookmarks move together and in order', async () => {
  const env = await inFolderF();
  drag(env, ['a', 'c']);
  await env.panel.dropOnSlot(over(env, 'd', true), ['a', 'c'], null);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['b', 'd', 'a', 'c']);

  drag(env, ['d', 'c']);
  await env.panel.dropOnSlot(over(env, 'b', false), ['d', 'c'], null);
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['d', 'c', 'b', 'a']);
});

test('no-op slots and cases where nothing is reordered', async () => {
  const env = await inFolderF();
  drag(env, ['b']);
  assert.equal(over(env, 'a', true).noop, true, 'after the previous one = same place');
  assert.equal(over(env, 'c', false).noop, true, 'before the next one = same place');
  assert.equal(over(env, 'b', false), null, 'over itself');

  env.state.reorderable = false;
  assert.equal(over(env, 'c', true), null, 'without "Original order"');
  env.state.reorderable = true;
  env.state.dragFromGroup = 'g1';
  assert.equal(over(env, 'c', true), null, 'from a group');
  assert.equal(env.bookmarks.calls.length, 0, 'nothing touches the bookmarks');
});

test('an external link is saved in the slot where it is dropped', async () => {
  const env = await inFolderF();
  drag(env, []);
  const slot = env.panel.reorderSlot(dragEvent(card('c'), { y: 10, types: ['text/uri-list'] }));
  await env.panel.dropOnSlot(slot, [], { url: 'https://new.example/', title: 'New' });
  assert.deepEqual(env.bookmarks.childrenOf('F'), ['a', 'b', 'new1', 'c', 'd']);
});

// ----- Folders: folder tiles (grid) and board cards -----

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

/** Panel on the bookmarks toolbar (folders F, G, H), dragging a folder. */
async function inToolbar(columns) {
  const env = await openPanel({ stored: { homeFolder: 'toolbar_____' }, columns });
  env.state.reorderable = true;
  env.state.viewFolderId = 'toolbar_____';
  return env;
}

test('in the folder grid, the edges reorder and the center puts inside', async () => {
  const env = await inToolbar(3);
  drag(env, ['H']);
  const left = env.panel.reorderSlot(dragEvent(tile('F'), { x: 10, y: 30 }));
  assert.equal(left.after, false);
  assert.equal(left.x, true);
  assert.equal(env.panel.reorderSlot(dragEvent(tile('F'), { x: 100, y: 30 })), null, 'center: put inside');
  const right = env.panel.reorderSlot(dragEvent(tile('F'), { x: 190, y: 30 }));
  assert.equal(right.after, true);

  await env.panel.dropOnSlot(left, ['H'], null);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['H', 'F', 'G']);
  assert.match(env.toasts.at(-1).message, /Order changed/);
});

test('on the board, the top or bottom edge of the card reorders the folder', async () => {
  const env = await inToolbar(1);
  drag(env, ['F']);
  const below = env.panel.reorderSlot(dragEvent(boardCard('H'), { y: 195 }));
  assert.equal(below.after, true);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('H'), { y: 100 })), null, 'center: put inside');
  await env.panel.dropOnSlot(below, ['F'], null);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['G', 'H', 'F']);
});

test('a folder is not placed inside itself, next to the open folder or if it is a system folder', async () => {
  const tree = sampleTree();
  // F now contains the subfolder S.
  tree.children[0].children[0].children.push({ id: 'S', type: 'folder', title: 'S', children: [] });
  const env = await openPanel({ stored: { homeFolder: 'F' }, bookmarks: fakeBookmarks(tree), columns: 1 });
  env.state.reorderable = true;
  env.state.viewFolderId = 'toolbar_____';
  drag(env, ['F']);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('F'), { y: 2 })), null, 'next to itself');
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('S'), { y: 2 })), null, 'inside its subfolder');
  env.state.viewFolderId = 'G';
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('G'), { y: 2 })), null, 'card of the open folder');
  drag(env, ['toolbar_____']);
  assert.equal(env.panel.reorderSlot(dragEvent(boardCard('F'), { y: 2 })), null, 'system folder');
  drag(env, ['G']);
  assert.notEqual(env.panel.reorderSlot(dragEvent(boardCard('S'), { y: 2 })), null, 'G can go next to S');
});
