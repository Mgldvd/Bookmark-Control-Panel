// Color principal de la interfaz (Ajustes → Apariencia): atributo data-accent en <html>.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

test('el color principal por defecto es el índigo, sin atributo en <html>', async () => {
  const env = await openPanel();
  env.panel.applyAccent();
  assert.equal(env.state.prefs.accentColor, 'indigo');
  assert.equal('accent' in env.document.documentElement.dataset, false);
});

test('cambiar el color principal lo aplica, lo guarda y entra en la copia de seguridad', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  env.panel.setPref('accentColor', 'teal');
  await env.flush();
  assert.equal(env.document.documentElement.dataset.accent, 'teal');
  assert.equal(stored.accentColor, 'teal');
  assert.equal(env.panel.buildBackup().prefs.accentColor, 'teal');

  const second = await openPanel({ stored });
  assert.equal(second.state.prefs.accentColor, 'teal', 'los paneles siguientes lo conservan');

  env.panel.setPref('accentColor', 'indigo');
  assert.equal('accent' in env.document.documentElement.dataset, false, 'volver al índigo quita el atributo');
});

test('un color principal desconocido se ignora', async () => {
  const env = await openPanel({ stored: { accentColor: 'chartreuse' } });
  assert.equal(env.state.prefs.accentColor, 'indigo');
});

test('el color de las carpetas se aplica, se guarda y vuelve al amarillo de siempre', async () => {
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
