// Tira: carpetas elegidas, una al lado de otra (view:strip).
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

/** Panel mostrando la tira, arrastrando la carpeta `id`. */
async function inStrip(stripFolders, id) {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders } });
  env.state.viewKind = 'strip';
  env.state.dragIds = id ? [id] : [];
  return env;
}

test('añadir y quitar carpetas: se guarda, se recuerda y va en la copia de seguridad', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  first.panel.toggleStrip('G');
  first.panel.toggleStrip('F');
  await first.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F'], 'en el orden en que se añaden');

  const second = await openPanel({ stored });
  assert.deepEqual([...second.state.stripFolders], ['G', 'F']);
  assert.deepEqual([...second.panel.buildBackup().stripFolders], ['G', 'F']);

  second.panel.toggleStrip('G');
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['F']);
  // «Deshacer» del aviso la devuelve a su sitio.
  second.toasts.at(-1).action.run();
  await second.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'F']);
});

test('la vista muestra las carpetas en su orden y omite las que ya no existen', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders: ['G', 'borrada', 'F'] } });
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

test('arrastrar una tarjeta a la izquierda o a la derecha de otra la reordena', async () => {
  const env = await inStrip(['F', 'G', 'H'], 'H');
  const before = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  assert.equal(before.noop, false);
  env.panel.placeInStrip(before.folderId, before.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);

  const after = env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 }));
  env.panel.placeInStrip(after.folderId, after.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G', 'H']);

  assert.equal(env.panel.stripSlot(dragEvent(stripCard('H'), { x: 40 })).noop, true, 'sobre sí misma');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('G'), { x: 260 })).noop, true, 'ya está ahí');
});

test('una carpeta arrastrada desde el árbol se añade a la tira donde se suelta', async () => {
  const env = await inStrip(['F'], 'G');
  const slot = env.panel.stripSlot(dragEvent(addTile()));
  assert.equal(slot.noop, false);
  env.panel.placeInStrip(slot.folderId, slot.index);
  assert.deepEqual([...env.state.stripFolders], ['F', 'G']);

  env.state.dragIds = ['H'];
  const first = env.panel.stripSlot(dragEvent(stripCard('F'), { x: 40 }));
  env.panel.placeInStrip(first.folderId, first.index);
  assert.deepEqual([...env.state.stripFolders], ['H', 'F', 'G']);
  assert.deepEqual(env.bookmarks.childrenOf('toolbar_____'), ['F', 'G', 'H'], 'Firefox no cambia');
});

test('fuera de la tira, o arrastrando marcadores, no hay hueco de tira', async () => {
  const env = await inStrip(['F', 'G'], 'a');
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
  env.state.dragIds = ['G'];
  env.state.viewKind = 'folder';
  assert.equal(env.panel.stripSlot(dragEvent(stripCard('F'))), null);
});

test('deshacer el borrado de una carpeta la devuelve a la tira', async () => {
  const env = await openPanel({ stored: { stripFolders: ['F', 'G'] } });
  await env.panel.deleteNodes([env.panel.get('F')], 'Folder deleted');
  await env.panel.runUndo();
  const restored = env.bookmarks.childrenOf('toolbar_____')[0];
  assert.notEqual(restored, 'F');
  assert.deepEqual([...env.state.stripFolders], [restored, 'G']);
});

test('la casa de la cabecera deja la tira como página de inicio', async () => {
  const stored = { homeFolder: 'F', stripFolders: ['G'] };
  const first = await openPanel({ stored });
  first.panel.selectView('view:strip');
  first.panel.setHomeHere();
  await first.flush();
  assert.equal(stored.homeFolder, 'view:strip');
  assert.match(first.toasts.at(-1).message, /Strip/);

  // Pulsarla otra vez solo avisa de que ya lo es.
  first.panel.setHomeHere();
  assert.match(first.toasts.at(-1).message, /is your home page/);

  assert.equal((await openPanel({ stored })).state.selected, 'view:strip', 'un panel nuevo abre la tira');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.minimalSelection(), 'view:strip', 'también en el modo minimalista');
});

test('con la tira abierta, el árbol marca y desmarca carpetas sin navegar', async () => {
  const stored = { homeFolder: 'view:strip', stripFolders: ['F'] };
  const env = await openPanel({ stored });
  assert.equal(env.panel.pickingCollection(), 'strip');

  env.panel.toggleStripPick('H');
  env.panel.toggleStripPick('toolbar_____');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['F', 'H', 'toolbar_____'], 'se añaden al final, también las raíz');
  env.panel.toggleStripPick('F');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['H', 'toolbar_____']);
  assert.equal(env.state.selected, 'view:strip', 'sigue en la tira');
  assert.equal(env.toasts.length, 0, 'sin avisos por cada casilla');

  env.panel.selectView('F');
  assert.equal(env.panel.pickingCollection(), null, 'fuera de la tira el árbol vuelve a navegar');
  const minimal = await openPanel({ stored: { ...stored, minimal: true } });
  assert.equal(minimal.panel.pickingCollection(), null, 'el modo minimalista no tiene árbol');
});

test('las subcarpetas desplegadas en la tira se recuerdan y van en la copia de seguridad', async () => {
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
  assert.deepEqual(stored.stripOpen, ['H'], 'plegar también se recuerda');
});

test('«Expandir todo» abre las tarjetas y despliega todas las subcarpetas; «Contraer todo» las pliega', async () => {
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
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'la tarjeta plegada se abre');

  env.panel.toggleStripExpandAll();
  await env.flush();
  assert.equal(env.panel.stripAllExpanded(), false);
  assert.deepEqual(Array.from(stored.stripOpen), []);
  assert.deepEqual(Array.from(stored.boardCollapsed), [], 'contraer no pliega las tarjetas');
});

test('«Expandir todo» de una columna solo despliega las subcarpetas de esa columna', async () => {
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
  assert.deepEqual(Array.from(stored.boardCollapsed), ['unfiled_____'], 'solo se abre esa tarjeta');
  assert.equal(env.panel.stripCardExpanded('unfiled_____'), false, 'la otra columna no cambia');
  assert.equal(env.state.stripOpen.has(subA.id), false);

  env.panel.toggleStripCardExpand('toolbar_____');
  await env.flush();
  assert.equal(env.panel.stripCardExpanded('toolbar_____'), false);
  assert.deepEqual(Array.from(stored.stripOpen), []);
  assert.deepEqual(Array.from(stored.boardCollapsed), ['unfiled_____'], 'contraer no pliega la tarjeta');
});

// ----- Perfiles: distintas selecciones de carpetas para la tira -----

test('perfiles: la tira de antes pasa a ser el primero; cada uno guarda su selección', async () => {
  const stored = { stripFolders: ['F'] };
  const env = await openPanel({ stored });
  const { state, panel } = env;
  assert.equal(state.stripProfiles.length, 1, 'sin perfiles guardados, se crea uno con la tira de siempre');
  const main = state.stripProfile;
  assert.deepEqual([...state.stripFolders], ['F']);

  const work = panel.addStripProfile();
  assert.equal(state.stripProfile, work, 'el nuevo queda activo');
  assert.deepEqual([...state.stripFolders], [], 'y empieza vacío');
  assert.equal(state.profileRenaming, work, 'con su nombre listo para escribir');
  panel.toggleStrip('G');
  panel.toggleStrip('H');
  await env.flush();
  assert.deepEqual(stored.stripFolders, ['G', 'H']);
  assert.equal(stored.stripProfile, work);

  panel.switchStripProfile(main);
  await env.flush();
  assert.deepEqual([...state.stripFolders], ['F'], 'al volver, la selección del primero');
  assert.deepEqual(
    stored.stripProfiles.map((pr) => pr.folders),
    [['F'], ['G', 'H']],
  );

  // Otra pestaña (o una recarga) abre el perfil guardado.
  const again = await openPanel({ stored });
  assert.equal(again.state.stripProfile, main);
  again.panel.switchStripProfile(work);
  assert.deepEqual([...again.state.stripFolders], ['G', 'H']);
});

test('perfiles: renombrar, duplicar, reordenar y eliminar (con «Deshacer»)', async () => {
  const stored = { stripFolders: ['F'] };
  const env = await openPanel({ stored });
  const { state, panel } = env;
  const main = state.stripProfile;

  panel.renameStripProfile(main, '  Trabajo  ');
  panel.renameStripProfile(main, '   ');
  assert.equal(state.stripProfiles[0].name, 'Trabajo', 'sin espacios; vacío no cambia el nombre');

  const copy = panel.addStripProfile(main);
  assert.equal(state.stripProfiles[1].id, copy, 'la copia va justo detrás');
  assert.deepEqual([...state.stripFolders], ['F'], 'con las mismas carpetas');
  assert.match(state.stripProfiles[1].name, /Trabajo/);
  panel.toggleStrip('G');
  assert.deepEqual([...state.stripProfiles[0].folders], ['F'], 'cambiar la copia no toca el original');

  panel.moveStripProfile(copy, -1);
  assert.deepEqual(
    Array.from(state.stripProfiles, (pr) => pr.id),
    [copy, main],
  );

  panel.deleteStripProfile(copy);
  await env.flush();
  assert.equal(state.stripProfiles.length, 1);
  assert.equal(state.stripProfile, main, 'se pasa al perfil que queda');
  assert.deepEqual([...state.stripFolders], ['F']);
  assert.equal(
    panel.profileMenu(main).some((item) => item && item.danger),
    false,
    'el último perfil no se puede eliminar',
  );
  panel.deleteStripProfile(main);
  assert.equal(state.stripProfiles.length, 1);

  env.toasts.at(-1).action.run();
  await env.flush();
  assert.deepEqual(
    Array.from(state.stripProfiles, (pr) => pr.id),
    [copy, main],
    '«Deshacer» lo devuelve a su sitio',
  );
  assert.equal(state.stripProfile, copy, 'y vuelve a estar activo');
  assert.deepEqual([...state.stripFolders], ['F', 'G']);
  assert.deepEqual(stored.stripFolders, ['F', 'G']);
});

test('perfiles: van en la copia de seguridad y una copia antigua llena el perfil activo', async () => {
  const env = await openPanel({ stored: { stripFolders: ['F'] } });
  const work = env.panel.addStripProfile();
  env.panel.toggleStrip('G');
  // Color desde su menú (fila de muestras); la copia lo hereda.
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
  assert.ok(backup.refs.folders.F && backup.refs.folders.G, 'las carpetas de todos los perfiles, con su ruta');

  const plan = env.panel.planImport(backup);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.values.stripProfiles.map((pr) => pr.folders))), [['F'], ['G']]);
  assert.equal(plan.values.stripProfile, work);
  const odd = env.panel.planImport({
    ...backup,
    stripProfiles: [{ id: 'z', name: 'Z', color: 'neon', folders: ['F'] }],
  });
  assert.equal(odd.values.stripProfiles[0].color, '', 'un color desconocido se descarta');

  const { stripProfiles: _p, stripProfile: _a, ...old } = backup;
  const oldPlan = env.panel.planImport({ ...old, stripFolders: ['H'] });
  assert.equal('stripProfiles' in oldPlan.values, false, 'sin perfiles en la copia, no se tocan');
  assert.deepEqual([...oldPlan.values.stripFolders], ['H']);
});

// ----- Rueda en la tira: las tarjetas con scroll propio no se lo roban al gesto horizontal -----

test('rueda: una tarjeta solo se desplaza en vertical si el puntero se ha posado y no hay un gesto de lado', async () => {
  const env = await openPanel({ stored: { homeFolder: 'view:strip', stripFolders: ['F', 'G'] } });
  const cards = env.document.getElementById('cards');
  cards.classList.add('is-strip');
  Object.assign(cards, { scrollWidth: 2000, clientWidth: 1000, scrollLeft: 0 });
  // Dos tarjetas con más contenido del que cabe (scroll vertical propio).
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
    return event.prevented; // true: la tira se mueve de lado; false: la tarjeta en vertical
  };
  const at = (ms) => {
    env.clock.now = ms;
  };

  // El puntero se posa en A y se queda: la rueda desplaza la tarjeta.
  at(1000);
  env.panel.trackStripHover({ target: over(innerA) });
  at(1200);
  assert.equal(wheel(innerA), false, 'posado sobre la tarjeta: scroll vertical');

  // Cruzando hacia otra columna (acaba de llegar a B): la tira se mueve de lado.
  at(2000);
  env.panel.trackStripHover({ target: over(innerB) });
  at(2050);
  assert.equal(wheel(innerB), true, 'recién llegado a la tarjeta: la tira sigue de lado');

  // Mientras dura el gesto, sigue de lado aunque el puntero se pose en la tarjeta.
  at(2250);
  assert.equal(wheel(innerB), true);
  at(2500);
  assert.equal(wheel(innerB), true, 'gesto horizontal en curso: no se lo roba la tarjeta');

  // Tras una pausa, el siguiente golpe ya es de la tarjeta (el puntero lleva rato en ella).
  at(3000);
  assert.equal(wheel(innerB), false, 'después de una pausa: scroll vertical');
  // Y ese gesto vertical se queda en vertical.
  at(3100);
  assert.equal(wheel(innerB), false);

  // Al final de la tira, un gesto que iba de lado no pasa a desplazar la tarjeta de debajo.
  at(5000);
  cards.scrollLeft = 1000;
  env.panel.trackStripHover({ target: over(innerA) });
  at(5010);
  assert.equal(wheel(innerA, -100), true, 'de lado (hacia la izquierda)');
  cards.scrollLeft = 1000;
  at(5100);
  assert.equal(wheel(innerA, 100), true, 'en el extremo, el gesto lateral se queda quieto');
  // Tras una pausa, en el extremo la rueda vuelve a ser de la tarjeta.
  at(6000);
  assert.equal(wheel(innerA, 100), false);
});
