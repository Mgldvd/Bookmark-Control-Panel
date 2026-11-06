'use strict';

// Se ejecuta de forma síncrona en <head> para aplicar el tema antes del primer
// pintado y evitar el destello claro/oscuro. La fuente de verdad sigue siendo
// browser.storage.local; esto es solo una copia rápida en localStorage.
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
  if (localStorage.getItem('bd-minimal') === '1') {
    document.documentElement.classList.add('minimal');
  }
} catch {
  // localStorage no disponible: se usará el tema automático.
}
// dashboard.html?home (página de inicio de Firefox) abre siempre el modo minimalista.
if (new URLSearchParams(location.search).has('home')) {
  document.documentElement.classList.add('minimal');
}
