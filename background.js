'use strict';

// Botón de la barra de herramientas (y atajo Alt+Shift+B): abre el dashboard
// en una pestaña nueva. tabs.create no requiere el permiso "tabs".
browser.action.onClicked.addListener(() => {
  browser.tabs
    .create({ url: browser.runtime.getURL('dashboard.html') })
    .catch((error) => console.error('[Bookmark Dashboard] No se pudo abrir el dashboard:', error));
});
