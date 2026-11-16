// Separators: own color (right-click → "Separator color…").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeBookmarks, openPanel } from './helpers/panel.mjs';

/** Toolbar with folder F: a, separator, b, separator, c. `prefix` changes the ids (another profile). */
function treeWithSeparators(prefix = '') {
  const bm = (id) => ({ id: prefix + id, type: 'bookmark', title: id, url: `https://${id}.example/` });
  const sep = (id) => ({ id: prefix + id, type: 'separator' });
  return {
    id: 'root________',
    type: 'folder',
    children: [
      {
        id: 'toolbar_____',
        type: 'folder',
        title: 'Toolbar',
        children: [
          {
            id: prefix + 'F',
            type: 'folder',
            title: 'F',
            children: [bm('a'), sep('s1'), bm('b'), sep('s2'), bm('c')],
          },
        ],
      },
      { id: 'unfiled_____', type: 'folder', title: 'Other', children: [] },
    ],
  };
}

test('a separator color is saved, removed and included in the backup', async () => {
  const stored = {};
  const env = await openPanel({ stored, bookmarks: fakeBookmarks(treeWithSeparators()) });
  env.panel.setSeparatorColor('s2', 'red');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, { s2: 'red' });

  const backup = env.panel.buildBackup();
  assert.deepEqual({ ...backup.separatorColors }, { s2: 'red' });
  assert.equal(backup.refs.separators.s2.nth, 1, 'second separator of its folder');

  env.panel.setSeparatorColor('s2', 'not-a-color');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, {});
});

test('when importing on another profile, the color goes to the separator in the same folder and position', async () => {
  const source = await openPanel({ stored: {}, bookmarks: fakeBookmarks(treeWithSeparators()) });
  source.panel.setSeparatorColor('s2', 'teal');
  const backup = JSON.parse(JSON.stringify(source.panel.buildBackup()));

  const other = await openPanel({ stored: {}, bookmarks: fakeBookmarks(treeWithSeparators('x-')) });
  const { values } = other.panel.planImport(backup);
  assert.deepEqual({ ...values.separatorColors }, { 'x-s2': 'teal' });
});

test('a separator menu shows the colors in a row and picking one applies it', async () => {
  const stored = {};
  const env = await openPanel({ stored, bookmarks: fakeBookmarks(treeWithSeparators()) });
  env.panel.setSeparatorColor('s1', 'blue');
  const items = Array.from(env.panel.separatorMenu(env.panel.get('s1'))).filter((i) => i && i !== '-');
  const row = items[0];
  assert.equal(row.colors, true, 'the first option is the color row');
  assert.equal(row.current, 'blue', 'it marks the current color');
  assert.equal(items.at(-1).icon, 'trash');

  row.set('green');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, { s1: 'green' });
  row.set(null);
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, {}, 'the last dot removes the color');
});

test('in the strip, expanded subfolders show the separators between them', async () => {
  const sep = (id) => ({ id, type: 'separator' });
  const sub = (id) => ({ id, type: 'folder', title: id, children: [] });
  const tree = {
    id: 'root________',
    type: 'folder',
    children: [
      {
        id: 'toolbar_____',
        type: 'folder',
        title: 'Toolbar',
        children: [
          {
            id: 'F',
            type: 'folder',
            title: 'F',
            children: [sep('s0'), sub('B'), sep('s1'), sep('s2'), sub('A'), sep('s3')],
          },
        ],
      },
      { id: 'unfiled_____', type: 'folder', title: 'Other', children: [] },
    ],
  };
  const env = await openPanel({ stored: {}, bookmarks: fakeBookmarks(tree) });
  const ids = () => Array.from(env.panel.stripSubsOf(env.panel.get('F')), (n) => n.id);
  assert.deepEqual(ids(), ['B', 's1', 'A'], 'Firefox order, without loose or consecutive separators');

  env.state.prefs.sort = 'name-asc';
  assert.deepEqual(ids(), ['A', 'B'], 'sorted by name: no separators');
});
