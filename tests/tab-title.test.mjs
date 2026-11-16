// Nombre de la pestaña (Ajustes → General → Pestaña del navegador).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

const folderView = { kind: 'folder', title: 'F' };

test('sin nombre propio se usa el predeterminado, con la carpeta delante', async () => {
  const { panel } = await openPanel();
  assert.equal(panel.docTitle(folderView), 'F · Bookmarks');
  assert.equal(panel.docTitle(null), 'Bookmarks');
});

test('el nombre elegido sustituye al predeterminado y se guarda limpio', async () => {
  const stored = {};
  const { panel, state, flush } = await openPanel({ stored });
  panel.setPref('tabTitle', 'Inicio');
  await flush();
  assert.equal(stored.tabTitle, 'Inicio');
  assert.equal(panel.docTitle(folderView), 'F · Inicio');

  state.query = 'abc';
  assert.equal(panel.docTitle({ kind: 'search', title: '' }), '“abc” · Inicio');

  // Una pestaña nueva lo lee de las preferencias, sin espacios sobrantes y con tope.
  const long = `  Mi   panel ${'x'.repeat(100)} `;
  const next = await openPanel({ stored: { tabTitle: long } });
  assert.equal(next.state.prefs.tabTitle.startsWith('Mi panel x'), true);
  assert.equal(next.state.prefs.tabTitle.length, 60);
});

test('sin la carpeta, la pestaña muestra solo el nombre', async () => {
  const { panel } = await openPanel({ stored: { tabTitle: 'Inicio', tabTitleFolder: false } });
  assert.equal(panel.docTitle(folderView), 'Inicio');
  assert.equal(panel.docTitle({ kind: 'search', title: '' }), 'Inicio');
});

test('el nombre y la opción entran en la copia de seguridad', async () => {
  const { panel } = await openPanel({ stored: { tabTitle: 'Inicio', tabTitleFolder: false } });
  const backup = panel.buildBackup();
  assert.equal(backup.prefs.tabTitle, 'Inicio');
  assert.equal(backup.prefs.tabTitleFolder, false);
});
