// Home folder ("Use as home page"): every new panel starts there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('a new panel opens the home folder even after navigating elsewhere', async () => {
  const stored = { homeFolder: 'F' };
  const first = await openPanel({ stored });
  assert.equal(first.state.selected, 'F');
  assert.equal(first.state.expanded.has('toolbar_____'), true, 'its parent folders are expanded');

  first.panel.selectView('G');
  await first.flush();
  assert.equal(first.state.selected, 'G');
  assert.equal(stored.lastFolder, 'G');

  const second = await openPanel({ stored });
  assert.equal(second.state.selected, 'F', 'the new tab does not follow the last folder');
  assert.equal(first.state.selected, 'G', 'the open tab does not change');
});

test('changing the home folder affects later panels', async () => {
  const stored = { homeFolder: 'F' };
  const first = await openPanel({ stored });
  first.panel.setHomeFolder('G');
  await first.flush();
  assert.equal((await openPanel({ stored })).state.selected, 'G');
});

test('special views as home and falling back to "All" if the folder is no longer valid', async () => {
  for (const homeFolder of ['view:all', 'view:favorites', 'view:recent']) {
    assert.equal((await openPanel({ stored: { homeFolder, lastFolder: 'G' } })).state.selected, homeFolder);
  }
  for (const homeFolder of ['borrada', 'a', 'root________']) {
    assert.equal((await openPanel({ stored: { homeFolder, lastFolder: 'G' } })).state.selected, 'view:all');
  }
});

test('minimal mode and ?home start at the home folder', async () => {
  for (const [minimal, search] of [
    [true, ''],
    [false, '?home'],
  ]) {
    const stored = { homeFolder: 'F', lastFolder: 'G', minimal };
    const panel = await openPanel({ stored, search });
    assert.equal(panel.panel.minimalSelection(), 'F');
    panel.panel.selectView('G');
    assert.equal(panel.panel.minimalSelection(), 'G');
    assert.equal((await openPanel({ stored, search })).panel.minimalSelection(), 'F');
  }
});
