// Strip: chosen folders, side by side (view:strip).
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

/** Panel showing the strip, dragging folder `id`. */
async function inStrip(stripFolders, id) {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders } });
  env.state.viewKind = 'strip';
  env.state.dragIds = id ? [id] : [];
  return env;
}

test('adding and removing folders: saved, remembered and included in the backup', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  first.panel.toggleStrip('G');
  first.panel.toggleStrip('F');
  await first.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F'], 'in the order they are added');

  const second = await openPanel({ stored });
  assert.deepEqual([...second.state.stripFolders], ['G', 'F']);
  assert.deepEqual([...second.panel.buildBackup().stripFolders], ['G', 'F']);

  second.panel.toggleStrip('G');
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['F']);
  // The notice's "Undo" puts it back in place.
  second.toasts.at(-1).action.run();
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F']);
});

test('the view shows the folders in order and skips those that no longer exist', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders: ['G', 'deleted', 'F'] } });
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

test('dragging a card to the left or right of another reorders it', async () => {
  const env = await inStrip(['F', 'G', 'H'], 'H');
  const before = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  assert.equal(before.noop, false);
  env.panel.placeInStrip(before.folderId, before.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);

  const after = env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 }));
  env.panel.placeInStrip(after.folderId, after.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G', 'H']);

  assert.equal(env.panel.stripSlot(dragEvent(stripCard('H'), { x: 40 })).noop, true, 'over itself');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 })).noop, true, 'already there');
});

test('a folder dragged from the tree is added to the strip where it is dropped', async () => {
  const env = await inStrip(['F'], 'G');
  const slot = env.panel.stripSlot(dragEvent(addTile()));
  assert.equal(slot.noop, false);
  env.panel.placeInStrip(slot.folderId, slot.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G']);

  env.state.dragIds = ['H'];
  const first = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  env.panel.placeInStrip(first.folderId, first.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['F', 'G', 'H'], 'Firefox does not change');
});

test('outside the strip, or when dragging bookmarks, there is no strip slot', async () => {
  const env = await inStrip(['F', 'G'], 'a');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
  env.state.dragIds = ['G'];
  env.state.viewKind = 'folder';
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
});

test('undoing a folder deletion puts it back in the strip', async () => {
  const env = await openPanel({ stored: { stripFolders: ['F', 'G'] } });
  await env.panel.deleteNodes([env.panel.get('F')], 'Folder deleted');
  await env.panel.runUndo();
  const restored = env.bookmarks.childrenOf('toolbar_____')[0];
  assert.notEqual(restored, 'F');
  assert.deepEqual([...env.state.stripFolders], [restored, 'G']);
});

test('the header house sets the strip as the home page', async () => {
  const stored = { homeFolder: 'F', stripFolders: ['G'] };
  const first = await openPanel({ stored });
  first.panel.selectView('view:strip');
  first.panel.setHomeHere();
  await first.flush();
  assert.equal(stored.homeFolder, 'view:strip');
  assert.match(first.toasts.at(-1).message, /Strip/);

  // Pressing it again only says that it already is.
  first.panel.setHomeHere();
  assert.match(first.toasts.at(-1).message, /is your home page/);

  assert.equal((await openPanel({ stored })).state.selected, 'view:strip', 'a new panel opens the strip');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.minimalSelection(), 'view:strip', 'in minimal mode too');
});

test('with the strip open, the tree checks and unchecks folders without navigating', async () => {
  const stored = { homeFolder: 'view:strip', stripFolders: ['F'] };
  const env = await openPanel({ stored });
  assert.equal(env.panel.pickingCollection(), 'strip');

  env.panel.toggleStripPick('H');
  env.panel.toggleStripPick('toolbar_____');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['F', 'H', 'toolbar_____'], 'they are added at the end, root folders too');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['H', 'toolbar_____']);
  assert.equal(env.state.selected, 'view:strip', 'still on the strip');
  assert.equal(env.toasts.length, 0, 'no notice for each checkbox');

  env.panel.selectView('F');
  assert.equal(env.panel.pickingCollection(), null, 'outside the strip the tree navigates again');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.pickingCollection(), null, 'minimal mode has no tree');
});

test('subfolders expanded in the strip are remembered and included in the backup', async () => {
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
  assert.deepEqual(stored.stripOpen, ['H'], 'collapsing is remembered too');
});

test('"Expand all" opens the cards and expands every subfolder; "Collapse all" folds them', async () => {
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
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'the collapsed card opens');

  env.panel.toggleStripExpandAll();
  await env.flush();
  assert.equal(env.panel.stripAllExpanded(), false);
  assert.deepEqual(Array.from(stored.stripOpen), []);
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'collapsing does not fold the cards');
});

test('a column\'s "Expand all" only expands that column\'s subfolders', async () => {
  const stored = {
    homeFolder: 'view:strip',
    stripFolders: ['toolbar_____', 'unfiled_____'],
    boardCollapsed: ['toolbar_____', 'unfiled_____'],
  };
  const env = await openPanel({ stored });
  const subA = await env.bookmarks.create({ parentId: 'unfiled_____', title: 'A' });
  await env.flush();
  assert.equal(env.panel.stripCardExpanded('toolbar_____'), false);

  env.panel.toggleStripCardExpand('toolbar_____');
  await env.flush();
  assert.equal(env.panel.stripCardExpanded('toolbar_____'), true);
  assert.deepEqual(Array.from(stored.stripOpen).toSorted(), ['F', 'G', 'H']);
  assert.deepEqual(Array.from(stored.boardCollapsed), ['unfiled_____'], 'only that card opens');
  assert.equal(env.panel.stripCardExpanded('unfiled_____'), false, 'the other column does not change');
  assert.equal(env.state.stripOpen.has(subA.id), false);

  env.panel.toggleStripCardExpand('toolbar_____');
  await env.flush();
  assert.equal(env.panel.stripCardExpanded('toolbar_____'), false);
  assert.deepEqual(Array.from(stored.stripOpen), []);
  assert.deepEqual(Array.from(stored.boardCollapsed), ['unfiled_____'], 'collapsing does not fold the card');
});

// ----- Profiles: different folder selections for the strip -----

test('profiles: the previous strip becomes the first one; each keeps its selection', async () => {
  const stored = { stripFolders: ['F'] };
  const env = await openPanel({ stored });
  const { state, panel } = env;
  assert.equal(state.stripProfiles.length, 1, 'without saved profiles, one is created with the usual strip');
  const main = state.stripProfile;
  assert.deepEqual([...state.stripFolders], ['F']);

  const work = panel.addStripProfile();
  assert.equal(state.stripProfile, work, 'the new one becomes active');
  assert.deepEqual([...state.stripFolders], [], 'and starts empty');
  assert.equal(state.profileRenaming, work, 'with its name ready to type');
  panel.toggleStrip('G');
  panel.toggleStrip('H');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'H']);
  assert.equal(stored.stripProfile, work);

  panel.switchStripProfile(main);
  await env.flush();
  assert.deepEqual([...state.stripFolders], ['F'], "going back, the first one's selection");
  assert.deepEqual(
    stored.stripProfiles.map((pr) => pr.folders),
    [['F'], ['G', 'H']],
  );

  // Another tab (or a reload) opens the saved profile.
  const again = await openPanel({ stored });
  assert.equal(again.state.stripProfile, main);
  again.panel.switchStripProfile(work);
  assert.deepEqual([...again.state.stripFolders], ['G', 'H']);
});

test('profiles: rename, duplicate, reorder and delete (with "Undo")', async () => {
  const stored = { stripFolders: ['F'] };
  const env = await openPanel({ stored });
  const { state, panel } = env;
  const main = state.stripProfile;

  panel.renameStripProfile(main, '  Work  ');
  panel.renameStripProfile(main, '   ');
  assert.equal(state.stripProfiles[0].name, 'Work', 'trimmed; empty does not change the name');

  const copy = panel.addStripProfile(main);
  assert.equal(state.stripProfiles[1].id, copy, 'the copy goes right after');
  assert.deepEqual([...state.stripFolders], ['F'], 'with the same folders');
  assert.match(state.stripProfiles[1].name, /Work/);
  panel.toggleStrip('G');
  assert.deepEqual([...state.stripProfiles[0].folders], ['F'], 'changing the copy does not touch the original');

  panel.moveStripProfile(copy, -1);
  assert.deepEqual(
    Array.from(state.stripProfiles, (pr) => pr.id),
    [copy, main],
  );

  panel.deleteStripProfile(copy);
  await env.flush();
  assert.equal(state.stripProfiles.length, 1);
  assert.equal(state.stripProfile, main, 'it switches to the remaining profile');
  assert.deepEqual([...state.stripFolders], ['F']);
  assert.equal(
    panel.profileMenu(main).some((item) => item && item.danger),
    false,
    'the last profile cannot be deleted',
  );
  panel.deleteStripProfile(main);
  assert.equal(state.stripProfiles.length, 1);

  env.toasts.at(-1).action.run();
  await env.flush();
  assert.deepEqual(
    Array.from(state.stripProfiles, (pr) => pr.id),
    [copy, main],
    '"Undo" puts it back in place',
  );
  assert.equal(state.stripProfile, copy, 'and it is active again');
  assert.deepEqual([...state.stripFolders], ['F', 'G']);
  assert.deepEqual(stored.stripFolders, ['F', 'G']);
});

test('profiles: included in the backup, and an old backup fills the active profile', async () => {
  const env = await openPanel({ stored: { stripFolders: ['F'] } });
  const work = env.panel.addStripProfile();
  env.panel.toggleStrip('G');
  // Color from its menu (swatch row); the copy inherits it.
  env.panel
    .profileMenu(work)
    .find((item) => item && item.colors)
    .set('teal');
  assert.equal(env.state.stripProfiles[1].color, 'teal');
  const copy = env.panel.addStripProfile(work);
  assert.equal(env.state.stripProfiles[2].color, 'teal');
  env.panel.deleteStripProfile(copy);
  env.panel.switchStripProfile(work);
  const backup = env.panel.buildBackup();
  assert.deepEqual(JSON.parse(JSON.stringify(backup.stripProfiles.map((pr) => pr.folders))), [['F'], ['G']]);
  assert.equal(backup.stripProfile, work);
  assert.deepEqual(
    Array.from(backup.stripProfiles, (pr) => pr.color),
    ['', 'teal'],
  );
  assert.ok(backup.refs.folders.F && backup.refs.folders.G, 'the folders of every profile, with their path');

  const plan = env.panel.planImport(backup);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.values.stripProfiles.map((pr) => pr.folders))), [['F'], ['G']]);
  assert.equal(plan.values.stripProfile, work);
  const odd = env.panel.planImport({
    ...backup,
    stripProfiles: [{ id: 'z', name: 'Z', color: 'neon', folders: ['F'] }],
  });
  assert.equal(odd.values.stripProfiles[0].color, '', 'an unknown color is dropped');

  const { stripProfiles: _p, stripProfile: _a, ...old } = backup;
  const oldPlan = env.panel.planImport({ ...old, stripFolders: ['H'] });
  assert.equal('stripProfiles' in oldPlan.values, false, 'without profiles in the backup, they are not touched');
  assert.deepEqual([...oldPlan.values.stripFolders], ['H']);
});

// ----- Wheel in the strip: cards with their own scroll do not steal the horizontal gesture -----

test('wheel: a card only scrolls vertically if the pointer has rested on it and there is no sideways gesture', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders: ['F', 'G'] } });
  const cards = env.document.getElementById('cards');
  cards.classList.add('is-strip');
  Object.assign(cards, { scrollWidth: 2000, clientWidth: 1000, scrollLeft: 0 });
  // Two cards with more content than fits (their own vertical scroll).
  const innerA = fakeElement({ classes: ['board-inner'] });
  const innerB = fakeElement({ classes: ['board-inner'] });
  for (const inner of [innerA, innerB]) Object.assign(inner, { scrollHeight: 800, clientHeight: 300 });
  const over = (inner) => ({ closest: (sel) => (sel === '.board-inner' ? inner : null) });
  const wheel = (inner, deltaY = 100) => {
    const event = {
      deltaX: 0,
      deltaY,
      deltaMode: 0,
      target: over(inner),
      prevented: false,
      preventDefault() {
        event.prevented = true;
      },
    };
    env.panel.stripWheel(event);
    return event.prevented; // true: the strip moves sideways; false: the card vertically
  };
  const at = (ms) => {
    env.clock.now = ms;
  };

  // The pointer rests on A and stays: the wheel scrolls the card.
  at(1000);
  env.panel.trackStripHover({ target: over(innerA) });
  at(1200);
  assert.equal(wheel(innerA), false, 'resting on the card: vertical scroll');

  // Crossing to another column (it just reached B): the strip moves sideways.
  at(2000);
  env.panel.trackStripHover({ target: over(innerB) });
  at(2050);
  assert.equal(wheel(innerB), true, 'just reached the card: the strip keeps moving sideways');

  // While the gesture lasts, it keeps moving sideways even if the pointer rests on the card.
  at(2250);
  assert.equal(wheel(innerB), true);
  at(2500);
  assert.equal(wheel(innerB), true, 'horizontal gesture in progress: the card does not steal it');

  // After a pause, the next tick belongs to the card (the pointer has been on it for a while).
  at(3000);
  assert.equal(wheel(innerB), false, 'after a pause: vertical scroll');
  // And that vertical gesture stays vertical.
  at(3100);
  assert.equal(wheel(innerB), false);

  // At the end of the strip, a gesture that was going sideways does not start scrolling the card underneath.
  at(5000);
  cards.scrollLeft = 1000;
  env.panel.trackStripHover({ target: over(innerA) });
  at(5010);
  assert.equal(wheel(innerA, -100), true, 'sideways (to the left)');
  cards.scrollLeft = 1000;
  at(5100);
  assert.equal(wheel(innerA, 100), true, 'at the end, the sideways gesture stays still');
  // After a pause, at the end the wheel belongs to the card again.
  at(6000);
  assert.equal(wheel(innerA, 100), false);
});
