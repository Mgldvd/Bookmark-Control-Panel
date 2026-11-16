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
