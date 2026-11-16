// "Show N more" on board cards: remembered across tabs and sessions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('expanding is saved, remembered when collapsing and included in the backup', async () => {
  const stored = {};
  const first = await openPanel({ stored });
  assert.equal(first.state.boardShowAll.has('F'), false);

  first.state.boardShowAll.add('F');
  first.panel.saveBoardShowAll();
  await first.flush();
  assert.deepEqual(stored.boardShowAll, ['F']);

  const second = await openPanel({ stored });
  assert.equal(second.state.boardShowAll.has('F'), true, 'a new tab remembers it');
  assert.deepEqual([...second.panel.buildBackup().boardShowAll], ['F']);

  second.state.boardShowAll.delete('F');
  second.panel.saveBoardShowAll();
  await second.flush();
  assert.equal((await openPanel({ stored })).state.boardShowAll.has('F'), false, 'collapsing is remembered too');
});
