// Tab name (Settings → General → Browser tab).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

const folderView = { kind: 'folder', title: 'F' };

test('without a custom name the default is used, with the folder in front', async () => {
  const { panel } = await openPanel();
  assert.equal(panel.docTitle(folderView), 'F · Bookmarks');
  assert.equal(panel.docTitle(null), 'Bookmarks');
});

test('the chosen name replaces the default and is stored clean', async () => {
  const stored = {};
  const { panel, state, flush } = await openPanel({ stored });
  panel.setPref('tabTitle', 'Start');
  await flush();
  assert.equal(stored.tabTitle, 'Start');
  assert.equal(panel.docTitle(folderView), 'F · Start');

  state.query = 'abc';
  assert.equal(panel.docTitle({ kind: 'search', title: '' }), '“abc” · Start');

  // A new tab reads it from the preferences, without extra spaces and capped.
  const long = `  My   panel ${'x'.repeat(100)} `;
  const next = await openPanel({ stored: { tabTitle: long } });
  assert.equal(next.state.prefs.tabTitle.startsWith('My panel x'), true);
  assert.equal(next.state.prefs.tabTitle.length, 60);
});

test('without the folder, the tab shows only the name', async () => {
  const { panel } = await openPanel({ stored: { tabTitle: 'Start', tabTitleFolder: false } });
  assert.equal(panel.docTitle(folderView), 'Start');
  assert.equal(panel.docTitle({ kind: 'search', title: '' }), 'Start');
});

test('the name and the option are included in the backup', async () => {
  const { panel } = await openPanel({ stored: { tabTitle: 'Start', tabTitleFolder: false } });
  const backup = panel.buildBackup();
  assert.equal(backup.prefs.tabTitle, 'Start');
  assert.equal(backup.prefs.tabTitleFolder, false);
});
