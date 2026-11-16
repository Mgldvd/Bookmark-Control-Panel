'use strict';

// Toolbar button (and the Alt+Shift+B shortcut): opens the panel
// in a new tab. tabs.create does not require the "tabs" permission.
browser.action.onClicked.addListener(() => {
  browser.tabs
    .create({ url: browser.runtime.getURL('dashboard.html') })
    .catch((error) => console.error('[Bookmark Control Panel] Could not open the panel:', error));
});
