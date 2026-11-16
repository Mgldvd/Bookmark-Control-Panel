'use strict';

// Runs synchronously in <head> to apply the theme before the first paint
// and avoid the light/dark flash. The source of truth is still
// browser.storage.local; this is only a quick copy in localStorage.
try {
  const theme = localStorage.getItem('bd-theme');
  if (theme === 'light' || theme === 'dark' || theme === 'auto') {
    document.documentElement.dataset.theme = theme;
  }
  if (localStorage.getItem('bd-sidebar') === '0') {
    document.documentElement.classList.add('sidebar-hidden');
  }
  const style = localStorage.getItem('bd-style');
  if (style === 'glass' || style === 'nord' || style === 'sepia') {
    document.documentElement.dataset.style = style;
  }
  // Background image: { url, blur, dim } (see applyBackground in dashboard.js).
  let bg = null;
  try {
    bg = JSON.parse(localStorage.getItem('bd-bg') || 'null');
  } catch {
    // damaged copy: the background arrives with dashboard.js
  }
  if (bg && typeof bg === 'object') {
    const root = document.documentElement;
    // Remote images wait for dashboard.js to check current data consent.
    if (typeof bg.url === 'string' && bg.url.startsWith('data:image/')) {
      root.dataset.backdrop = 'image';
      root.style.setProperty('--bg-image', `url("${bg.url.replace(/["\\\s]/g, encodeURIComponent)}")`);
    }
    // Gradient included with the extension (see BG_PRESETS in dashboard.js).
    if (!root.dataset.backdrop && typeof bg.preset === 'string' && /^[a-z]{2,20}$/.test(bg.preset)) {
      root.dataset.backdrop = 'preset';
      root.dataset.bgPreset = bg.preset;
    }
    if (Number.isInteger(bg.blur)) root.style.setProperty('--bg-blur', `${bg.blur}px`);
    if (Number.isFinite(bg.dim)) root.style.setProperty('--bg-dim', String(bg.dim / 100));
  }
  const corners = localStorage.getItem('bd-corners');
  if (corners === 'round' || corners === 'semi' || corners === 'square') {
    document.documentElement.dataset.corners = corners;
  }
  // Accent color: without an attribute the usual indigo is used.
  const accent = localStorage.getItem('bd-accent');
  if (/^(blue|teal|green|amber|orange|red|pink|violet|slate)$/.test(accent || '')) {
    document.documentElement.dataset.accent = accent;
  }
  const folderColor = localStorage.getItem('bd-folder-color');
  if (/^(indigo|blue|teal|green|amber|orange|red|pink|violet|slate)$/.test(folderColor || '')) {
    document.documentElement.dataset.folderColor = folderColor;
  }
  // Card stripe: "visible|color|thickness" (e.g. "1|auto|3").
  const [stripe, stripeColor, stripeWidth] = (localStorage.getItem('bd-stripe') || '').split('|');
  if (stripe === '0') document.documentElement.dataset.stripe = 'off';
  if (/^(indigo|blue|teal|green|amber|orange|red|pink|violet|slate)$/.test(stripeColor || '')) {
    document.documentElement.dataset.stripeColor = stripeColor;
  }
  if (['2', '3', '5', '8'].includes(stripeWidth)) {
    document.documentElement.style.setProperty('--stripe-w', `${stripeWidth}px`);
  }
  const width = localStorage.getItem('bd-content-width');
  if (width === 'wide' || width === 'full') document.documentElement.dataset.contentWidth = width;
  const cols = localStorage.getItem('bd-board-cols');
  if (['1', '2', '3', '4', '5', '6'].includes(cols)) {
    document.documentElement.dataset.boardCols = cols;
    document.documentElement.style.setProperty('--board-cols', cols);
  }
  // Tab name chosen in Settings (without it, the HTML one stays).
  const tabTitle = localStorage.getItem('bd-tab-title');
  if (tabTitle) document.title = tabTitle;
  if (localStorage.getItem('bd-minimal') === '1') {
    document.documentElement.classList.add('minimal');
  }
} catch {
  // localStorage not available: the automatic theme will be used.
}
// dashboard.html?home (Firefox's home page) always opens minimal mode.
if (new URLSearchParams(location.search).has('home')) {
  document.documentElement.classList.add('minimal');
}
