// Mosaico: otras carpetas elegidas, en columnas (view:masonry). Es una colección
// independiente de la tira: su propia selección, perfiles y subcarpetas desplegadas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dragEvent, fakeElement, openPanel } from './helpers/panel.mjs';

const card = (id) =>
  fakeElement({
    classes: ['board-card'],
    dataset: { folderId: id, dropId: id },
    rect: { left: 0, right: 300, width: 300, top: 0, bottom: 200, height: 200 },
  });

test('añadir y quitar carpetas del mosaico no toca la tira (y al revés)', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  env.panel.toggleStrip('G', 'masonry');
  env.panel.toggleStrip('F', 'masonry');
  env.panel.toggleStrip('H');
  await env.flush();
  assert.deepEqual(stored.masonryFolders, ['G', 'F'], 'en el orden en que se añaden');
  assert.deepEqual(stored.stripFolders, ['H'], 'la tira va aparte');

  const again = await openPanel({ stored });
  assert.deepEqual([...again.state.masonryFolders], ['G', 'F']);
  assert.deepEqual([...again.state.stripFolders], ['H']);

  again.panel.toggleStrip('G', 'masonry');
  await again.flush();
  assert.deepEqual(stored.masonryFolders, ['F']);
  assert.match(again.toasts.at(-1).message, /masonry/);
  again.toasts.at(-1).action.run();
  await again.flush();
  assert.deepEqual(stored.masonryFolders, ['G', 'F'], '«Deshacer» la devuelve a su sitio');
});

test('la vista muestra sus carpetas en su orden y es una colección', async () => {
  const env = await openPanel({
    stored: { homeFolder: 'view:masonry', masonryFolders: ['G', 'borrada', 'F'], stripFolders: ['H'] },
  });
  assert.equal(env.state.selected, 'view:masonry');
  const view = env.panel.computeView();
  assert.equal(view.kind, 'masonry');
  assert.deepEqual(
    Array.from(view.folders, (f) => f.id),
    ['G', 'F'],
  );
});

test('con el mosaico abierto, el árbol marca sus carpetas (no las de la tira)', async () => {
  const stored = { homeFolder: 'view:masonry', masonryFolders: ['F'], stripFolders: ['G'] };
  const env = await openPanel({ stored });
  assert.equal(env.panel.pickingCollection(), 'masonry');
  env.panel.toggleStripPick('H');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.masonryFolders, ['H']);
  assert.deepEqual(stored.stripFolders, ['G'], 'la tira no cambia');

  env.panel.selectView('view:strip');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F'], 'en la tira se marcan las de la tira');
  assert.deepEqual(stored.masonryFolders, ['H']);
});

test('arrastrar una tarjeta encima o debajo de otra la reordena', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:masonry', masonryFolders: ['F', 'G', 'H'] } });
  env.state.viewKind = 'masonry'; // lo pone el render (que aquí no corre)
  env.state.dragIds = ['H'];
  const above = env.panel.stripSlot(dragEvent(card('F'), { y: 40 }));
  assert.equal(above.x, false, 'línea horizontal (encima / debajo)');
  assert.equal(above.after, false);
  env.panel.placeInStrip(above.folderId, above.index);
  assert.deepEqual([...env.state.masonryFolders], ['H', 'F', 'G']);

  const below = env.panel.stripSlot(dragEvent(card('G'), { y: 160 }));
  assert.equal(below.after, true);
  env.panel.placeInStrip(below.folderId, below.index);
  assert.deepEqual([...env.state.masonryFolders], ['F', 'G', 'H']);
  assert.equal(env.panel.stripSlot(dragEvent(card('G'), { y: 160 })).noop, true, 'ya está ahí');
});

test('subcarpetas desplegadas y perfiles van aparte de los de la tira', async () => {
  const stored = { homeFolder: 'view:masonry', masonryFolders: ['F'], stripFolders: ['F'] };
  const env = await openPanel({ stored });
  env.panel.toggleStripSub('G');
  await env.flush();
  assert.deepEqual(stored.masonryOpen, ['G']);
  assert.deepEqual(Array.from(stored.stripOpen ?? []), []);

  const work = env.panel.addStripProfile();
  assert.equal(env.state.masonryProfile, work);
  assert.deepEqual([...env.state.masonryFolders], [], 'el perfil nuevo empieza vacío');
  assert.deepEqual([...env.state.stripFolders], ['F'], 'la tira sigue igual');
  assert.equal(env.state.stripProfiles.length, 1);
});

test('copia de seguridad: incluye el mosaico y una copia anterior a él no lo vacía', async () => {
  const env = await openPanel({ stored: { masonryFolders: ['G'], masonryOpen: ['H'], stripFolders: ['F'] } });
  const backup = env.panel.buildBackup();
  assert.deepEqual([...backup.masonryFolders], ['G']);
  assert.deepEqual([...backup.masonryOpen], ['H']);
  assert.equal(backup.masonryProfiles.length, 1);
  assert.ok(backup.refs.folders.G && backup.refs.folders.H, 'sus carpetas, con su ruta');

  const plan = env.panel.planImport(backup);
  assert.deepEqual([...plan.values.masonryFolders], ['G']);
  assert.deepEqual([...plan.values.masonryOpen], ['H']);

  const { masonryFolders: _f, masonryProfiles: _p, masonryProfile: _a, masonryOpen: _o, ...old } = backup;
  const oldPlan = env.panel.planImport(old);
  assert.equal('masonryFolders' in oldPlan.values, false);
  assert.equal('masonryOpen' in oldPlan.values, false);
});
