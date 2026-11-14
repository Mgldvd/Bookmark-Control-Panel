// «Mostrar N más» en las tarjetas del tablero: se recuerda entre pestañas y sesiones.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('el despliegue se guarda, se recuerda al plegar y va en la copia de seguridad', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  assert.equal(first.state.boardShowAll.has('F'), false);

  first.state.boardShowAll.add('F');
  first.panel.saveBoardShowAll();
  await first.flush();
  assert.deepEqual(stored.boardShowAll, ['F']);

  const second = await openPanel({ stored });
  assert.equal(second.state.boardShowAll.has('F'), true, 'una pestaña nueva lo recuerda');
  assert.deepEqual([...second.panel.buildBackup().boardShowAll], ['F']);

  second.state.boardShowAll.delete('F');
  second.panel.saveBoardShowAll();
  await second.flush();
  assert.equal((await openPanel({ stored })).state.boardShowAll.has('F'), false, 'también recuerda al plegar');
});
