'use strict';

// Se ejecuta de forma síncrona en <head> para aplicar el tema antes del primer
// pintado y evitar el destello claro/oscuro. La fuente de verdad sigue siendo
// browser.storage.local; esto es solo una copia rápida en localStorage.
try {
  const theme = localStorage.getItem('bd-theme');
  if (theme === 'light' || theme === 'dark' || theme === 'auto') {
    document.documentElement.dataset.theme = theme;
  }
} catch {
  // localStorage no disponible: se usará el tema automático.
}
