import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { openPanel } from './helpers/panel.mjs';

test('remote favicons are off by default and rejected consent does not grant access', async () => {
  const { panel, state } = await openPanel();
  assert.equal(state.prefs.showFavicons, false);
  assert.equal(await panel.requestDataConsent(['bookmarksInfo']), false);
  assert.equal(panel.hasDataConsent(['bookmarksInfo']), false);
});

test('Unsplash images require both permissions and disappear after revocation', async () => {
  const permissions = ['authenticationInfo', 'searchTerms'];
  const { panel, state } = await openPanel({ dataCollection: permissions });
  state.prefs.bgSource = 'unsplash';
  state.prefs.unsplashPhoto = { url: 'https://images.unsplash.com/photo-demo' };
  assert.equal(panel.bgImage(), 'https://images.unsplash.com/photo-demo');
  permissions.splice(0, 1);
  await panel.loadDataConsent();
  assert.equal(panel.bgImage(), '');
});

test('granting favicon consent does not grant Unsplash access', async () => {
  const { panel } = await openPanel({ grantData: true });
  assert.equal(await panel.requestDataConsent(['bookmarksInfo']), true);
  assert.equal(panel.hasDataConsent(['authenticationInfo', 'searchTerms']), false);
});

test('cached remote backgrounds cannot load before the current consent check', () => {
  const properties = [];
  vm.runInNewContext(fs.readFileSync(new URL('../theme-init.js', import.meta.url), 'utf8'), {
    localStorage: {
      getItem: (key) => (key === 'bd-bg' ? JSON.stringify({ url: 'https://images.unsplash.com/cached' }) : null),
    },
    document: {
      documentElement: {
        dataset: {},
        classList: { add() {} },
        style: { setProperty: (...args) => properties.push(args) },
      },
    },
    location: { search: '' },
    URLSearchParams,
  });
  assert.equal(
    properties.some(([key]) => key === '--bg-image'),
    false,
  );
});

test('remote background images require HTTPS', async () => {
  const { panel } = await openPanel();
  assert.equal(panel.isBgImageUrl('http://images.example/photo.jpg'), false);
  assert.equal(panel.isBgImageUrl('https://images.example/photo.jpg'), true);
  assert.equal(panel.isBgImageUrl('data:image/webp;base64,AAAA'), true);
});

test('revoking consent while Unsplash responds prevents the next image request', async () => {
  const permissions = ['authenticationInfo', 'searchTerms'];
  const images = [];
  let respond;
  const { panel, state } = await openPanel({
    dataCollection: permissions,
    imageRequests: images,
    fetchImpl: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });
  Object.assign(state.prefs, { bgSource: 'unsplash', unsplashKey: 'test-key' });
  const pending = panel.refreshUnsplash();
  permissions.length = 0;
  await panel.loadDataConsent();
  respond({
    ok: true,
    json: async () => ({
      id: 'demo',
      urls: { raw: 'https://images.unsplash.com/photo-demo' },
      links: { html: 'https://unsplash.com/photos/demo' },
    }),
  });
  await pending;
  assert.equal(images.length, 0);
  assert.equal(state.prefs.unsplashPhoto, null);
});
