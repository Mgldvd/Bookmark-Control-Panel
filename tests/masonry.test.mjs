// Masonry: other chosen folders, in columns (view:masonry). It is a collection
// independent from the strip: its own selection, profiles and expanded subfolders.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dragEvent, fakeElement, openPanel } from './helpers/panel.mjs';

const card = (id) =>
  fakeElement({
    classes: ['board-card'],
    dataset: { folderId: id, dropId: id },
    rect: { left: 0, right: 300, width: 300, top: 0, bottom: 200, height: 200 },
  });

test('adding and removing masonry folders does not touch the strip (and vice versa)', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  env.panel.toggleStrip('G', 'masonry');
  env.panel.toggleStrip('F', 'masonry');
  env.panel.toggleStrip('H');
  await env.flush();
  assert.deepEqual(stored.masonryFolders, ['G', 'F'], 'in the order they are added');
  assert.deepEqual(stored.stripFolders, ['H'], 'the strip is separate');

  const again = await openPanel({ stored });
  assert.deepEqual([...again.state.masonryFolders], ['G', 'F']);
  assert.deepEqual([...again.state.stripFolders], ['H']);

  again.panel.toggleStrip('G', 'masonry');
  await again.flush();
  assert.deepEqual(stored.masonryFolders, ['F']);
  assert.match(again.toasts.at(-1).message, /masonry/);
  again.toasts.at(-1).action.run();
  await again.flush();
  assert.deepEqual(stored.masonryFolders, ['G', 'F'], '"Undo" puts it back in place');
});

test('the view shows its folders in order and is a collection', async () => {
  const env = await openPanel({
    stored: { homeFolder: 'view:masonry', masonryFolders: ['G', 'deleted', 'F'], stripFolders: ['H'] },
  });
  assert.equal(env.state.selected, 'view:masonry');
  const view = env.panel.computeView();
  assert.equal(view.kind, 'masonry');
  assert.deepEqual(
    Array.from(view.folders, (f) => f.id),
    ['G', 'F'],
  );
});

test('with the masonry open, the tree checks its folders (not the strip ones)', async () => {
  const stored = { homeFolder: 'view:masonry', masonryFolders: ['F'], stripFolders: ['G'] };
  const env = await openPanel({ stored });
  assert.equal(env.panel.pickingCollection(), 'masonry');
  env.panel.toggleStripPick('H');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.masonryFolders, ['H']);
  assert.deepEqual(stored.stripFolders, ['G'], 'the strip does not change');

  env.panel.selectView('view:strip');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F'], 'in the strip, the strip ones are checked');
  assert.deepEqual(stored.masonryFolders, ['H']);
});

test('dragging a card above or below another reorders it', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:masonry', masonryFolders: ['F', 'G', 'H'] } });
  env.state.viewKind = 'masonry'; // set by the render (which does not run here)
  env.state.dragIds = ['H'];
  const above = env.panel.stripSlot(dragEvent(card('F'), { y: 40 }));
  assert.equal(above.x, false, 'horizontal line (above / below)');
  assert.equal(above.after, false);
  env.panel.placeInStrip(above.folderId, above.index);
  assert.deepEqual([...env.state.masonryFolders], ['H', 'F', 'G']);

  const below = env.panel.stripSlot(dragEvent(card('G'), { y: 160 }));
  assert.equal(below.after, true);
  env.panel.placeInStrip(below.folderId, below.index);
  assert.deepEqual([...env.state.masonryFolders], ['F', 'G', 'H']);
  assert.equal(env.panel.stripSlot(dragEvent(card('G'), { y: 160 })).noop, true, 'already there');
});

test('expanded subfolders and profiles are separate from the strip ones', async () => {
  const stored = { homeFolder: 'view:masonry', masonryFolders: ['F'], stripFolders: ['F'] };
  const env = await openPanel({ stored });
  env.panel.toggleStripSub('G');
  await env.flush();
  assert.deepEqual(stored.masonryOpen, ['G']);
  assert.deepEqual(Array.from(stored.stripOpen ?? []), []);

  const work = env.panel.addStripProfile();
  assert.equal(env.state.masonryProfile, work);
  assert.deepEqual([...env.state.masonryFolders], [], 'the new profile starts empty');
  assert.deepEqual([...env.state.stripFolders], ['F'], 'the strip stays the same');
  assert.equal(env.state.stripProfiles.length, 1);
});

test('backup: includes the masonry and an older backup does not empty it', async () => {
  const env = await openPanel({ stored: { masonryFolders: ['G'], masonryOpen: ['H'], stripFolders: ['F'] } });
  const backup = env.panel.buildBackup();
  assert.deepEqual([...backup.masonryFolders], ['G']);
  assert.deepEqual([...backup.masonryOpen], ['H']);
  assert.equal(backup.masonryProfiles.length, 1);
  assert.ok(backup.refs.folders.G && backup.refs.folders.H, 'its folders, with their path');

  const plan = env.panel.planImport(backup);
  assert.deepEqual([...plan.values.masonryFolders], ['G']);
  assert.deepEqual([...plan.values.masonryOpen], ['H']);

  const { masonryFolders: _f, masonryProfiles: _p, masonryProfile: _a, masonryOpen: _o, ...old } = backup;
  const oldPlan = env.panel.planImport(old);
  assert.equal('masonryFolders' in oldPlan.values, false);
  assert.equal('masonryOpen' in oldPlan.values, false);
});
