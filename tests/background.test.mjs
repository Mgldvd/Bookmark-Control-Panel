// Style (Settings → Appearance) and background image (Settings → Background).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPanel } from './helpers/panel.mjs';

const PHOTO = {
  id: 'abc',
  url: 'https://images.unsplash.com/photo-1?ixid=x&w=1920&q=80&fm=jpg&fit=max',
  color: '#336699',
  author: 'Ana',
  authorUrl: 'https://unsplash.com/@ana',
  link: 'https://unsplash.com/photos/abc',
  query: 'sea',
  at: 1,
};

test('the style is applied, saved, included in the backup and goes back to classic', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  const root = env.document.documentElement;
  assert.equal(env.state.prefs.style, 'classic');

  env.panel.setPref('style', 'glass');
  await env.flush();
  assert.equal(root.dataset.style, 'glass');
  assert.equal(stored.style, 'glass');
  assert.equal(env.panel.buildBackup().prefs.style, 'glass');
  assert.equal((await openPanel({ stored })).state.prefs.style, 'glass');

  env.panel.setPref('style', 'classic');
  assert.equal('style' in root.dataset, false);
  assert.equal((await openPanel({ stored: { style: 'neon' } })).state.prefs.style, 'classic');
});

test('Unsplash photo pages become their image; other links stay as they are', async () => {
  const { panel } = await openPanel();
  const download = 'https://unsplash.com/photos/zAjdgNXsMeg/download?w=1920';
  assert.equal(panel.resolveBgLink('https://unsplash.com/photos/a-river-in-the-woods-zAjdgNXsMeg'), download);
  assert.equal(panel.resolveBgLink('https://unsplash.com/es/fotos/un-rio-zAjdgNXsMeg'), download);
  assert.equal(panel.resolveBgLink('https://unsplash.com/photos/zAjdgNXsMeg'), download);
  assert.equal(panel.resolveBgLink(' https://unsplash.com/photos/zAjdgNXsMeg/download?force=true '), download);
  assert.equal(
    panel.resolveBgLink('https://unsplash.com/collections/12345678901/x'),
    'https://unsplash.com/collections/12345678901/x',
  );
  assert.equal(panel.resolveBgLink('https://example.com/a b.jpg'), 'https://example.com/a%20b.jpg');
  assert.equal(panel.resolveBgLink('javascript:alert(1)'), '');
  assert.equal(panel.resolveBgLink('not a link'), '');
});

test('a custom image shows the backdrop; "None" removes it', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  const root = env.document.documentElement;
  env.panel.setPref('bgCustom', 'https://example.com/bg.jpg');
  env.panel.setPref('bgSource', 'custom');
  await env.flush();
  assert.equal(root.dataset.backdrop, 'image');
  assert.equal(stored.bgCustom, 'https://example.com/bg.jpg');

  env.panel.setPref('bgSource', 'none');
  assert.equal('backdrop' in root.dataset, false);

  env.panel.setPref('bgSource', 'unsplash');
  assert.equal('backdrop' in root.dataset, false, 'Unsplash without a photo shows nothing');
  env.panel.setPref('unsplashPhoto', PHOTO);
  assert.equal(root.dataset.backdrop, 'image');
});

test('invalid background values are ignored', async () => {
  const env = await openPanel({
    stored: {
      bgSource: 'flickr',
      bgCustom: 'javascript:alert(1)',
      bgBlur: 99,
      bgDim: -1,
      unsplashEvery: 'minute',
      unsplashPhoto: { ...PHOTO, url: 'https://evil.example/x.jpg' },
    },
  });
  const p = env.state.prefs;
  assert.equal(p.bgSource, 'none');
  assert.equal(p.bgCustom, '');
  assert.equal(p.bgBlur, 0);
  assert.equal(p.bgDim, 20);
  assert.equal(p.unsplashEvery, 'day');
  assert.equal(p.unsplashPhoto, null);

  const ok = await openPanel({ stored: { unsplashPhoto: PHOTO, bgBlur: 8, bgCustom: 'data:image/webp;base64,AAAA' } });
  assert.deepEqual({ ...ok.state.prefs.unsplashPhoto }, PHOTO);
  assert.equal(ok.state.prefs.bgBlur, 8);
  assert.equal(ok.state.prefs.bgCustom, 'data:image/webp;base64,AAAA');
});

test('the backup keeps the background settings but not the key or an uploaded image', async () => {
  const env = await openPanel({
    stored: {
      bgSource: 'unsplash',
      bgBlur: 6,
      bgDim: 40,
      unsplashKey: 'secret',
      unsplashQuery: 'sea',
      unsplashEvery: 'hour',
      bgCustom: 'data:image/webp;base64,AAAA',
    },
  });
  const { prefs } = env.panel.buildBackup();
  assert.equal(prefs.bgSource, 'unsplash');
  assert.equal(prefs.bgBlur, 6);
  assert.equal(prefs.bgDim, 40);
  assert.equal(prefs.unsplashQuery, 'sea');
  assert.equal(prefs.unsplashEvery, 'hour');
  assert.equal('unsplashKey' in prefs, false);
  assert.equal('bgCustom' in prefs, false);

  env.panel.setPref('bgCustom', 'https://example.com/bg.jpg');
  assert.equal(env.panel.buildBackup().prefs.bgCustom, 'https://example.com/bg.jpg');
});

test('a built-in gradient is applied, saved and included in the backup', async () => {
  const stored = {};
  const env = await openPanel({ stored });
  const root = env.document.documentElement;
  assert.equal(env.state.prefs.bgPreset, 'aurora');

  env.panel.setPref('bgPreset', 'ocean');
  env.panel.setPref('bgSource', 'preset');
  await env.flush();
  assert.equal(root.dataset.backdrop, 'preset');
  assert.equal(root.dataset.bgPreset, 'ocean');
  assert.equal(stored.bgPreset, 'ocean');
  assert.equal(env.panel.buildBackup().prefs.bgPreset, 'ocean');
  assert.equal((await openPanel({ stored })).state.prefs.bgPreset, 'ocean');

  env.panel.setPref('bgCustom', 'https://example.com/bg.jpg');
  env.panel.setPref('bgSource', 'custom');
  assert.equal(root.dataset.backdrop, 'image');
  assert.equal('bgPreset' in root.dataset, false, 'another source removes the gradient');

  env.panel.setPref('bgSource', 'none');
  assert.equal('backdrop' in root.dataset, false);
  assert.equal((await openPanel({ stored: { bgPreset: 'rainbow' } })).state.prefs.bgPreset, 'aurora');
});
