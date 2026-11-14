// Carpeta de inicio («Usar como página de inicio»): cada panel nuevo empieza en ella.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('un panel nuevo abre la carpeta de inicio aunque se navegara a otra', async () => {
  const stored = { homeFolder: 'F' };
  const first = await openPanel({ stored });
  assert.equal(first.state.selected, 'F');
  assert.equal(first.state.expanded.has('toolbar_____'), true, 'se despliegan sus carpetas padre');

  first.panel.selectView('G');
  await first.flush();
  assert.equal(first.state.selected, 'G');
  assert.equal(stored.lastFolder, 'G');

  const second = await openPanel({ stored });
  assert.equal(second.state.selected, 'F', 'la pestaña nueva no sigue la última carpeta');
  assert.equal(first.state.selected, 'G', 'la pestaña abierta no cambia');
});

test('cambiar la carpeta de inicio afecta a los paneles siguientes', async () => {
  const stored = { homeFolder: 'F' };
  const first = await openPanel({ stored });
  first.panel.setHomeFolder('G');
  await first.flush();
  assert.equal((await openPanel({ stored })).state.selected, 'G');
});

test('vistas especiales como inicio y vuelta a «Todos» si la carpeta ya no vale', async () => {
  for (const homeFolder of ['view:all', 'view:favorites', 'view:recent']) {
    assert.equal((await openPanel({ stored: { homeFolder, lastFolder: 'G' } })).state.selected, homeFolder);
  }
  for (const homeFolder of ['borrada', 'a', 'root________']) {
    assert.equal((await openPanel({ stored: { homeFolder, lastFolder: 'G' } })).state.selected, 'view:all');
  }
});

test('modo minimalista y ?home empiezan en la carpeta de inicio', async () => {
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
