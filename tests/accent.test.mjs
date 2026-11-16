// Accent color of the UI (Settings → Appearance): data-accent attribute on <html>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('the default accent color is indigo, with no attribute on <html>', async () => {
  const env = await openPanel();
  env.panel.applyAccent();
  assert.equal(env.state.prefs.accentColor, 'indigo');
  assert.equal('accent' in env.document.documentElement.dataset, false);
});

test('changing the accent color applies it, saves it and includes it in the backup', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  env.panel.setPref('accentColor', 'teal');
  await env.flush();
  assert.equal(env.document.documentElement.dataset.accent, 'teal');
  assert.equal(stored.accentColor, 'teal');
  assert.equal(env.panel.buildBackup().prefs.accentColor, 'teal');

  const second = await openPanel({ stored });
  assert.equal(second.state.prefs.accentColor, 'teal', 'later panels keep it');

  env.panel.setPref('accentColor', 'indigo');
  assert.equal('accent' in env.document.documentElement.dataset, false, 'going back to indigo removes the attribute');
});

test('an unknown accent color is ignored', async () => {
  const env = await openPanel({ stored: { accentColor: 'chartreuse' } });
  assert.equal(env.state.prefs.accentColor, 'indigo');
});

test('the folder color is applied, saved and goes back to the usual yellow', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  env.panel.applyAccent();
  assert.equal(env.state.prefs.folderColor, 'default');
  assert.equal('folderColor' in env.document.documentElement.dataset, false);

  env.panel.setPref('folderColor', 'blue');
  await env.flush();
  assert.equal(env.document.documentElement.dataset.folderColor, 'blue');
  assert.equal(stored.folderColor, 'blue');
  assert.equal(env.panel.buildBackup().prefs.folderColor, 'blue');
  assert.equal((await openPanel({ stored })).state.prefs.folderColor, 'blue');

  env.panel.setPref('folderColor', 'default');
  assert.equal('folderColor' in env.document.documentElement.dataset, false);
  assert.equal((await openPanel({ stored: { folderColor: 'nope' } })).state.prefs.folderColor, 'default');
});
