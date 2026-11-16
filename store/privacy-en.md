Bookmark Control Panel privacy policy
Updated: November 16, 2026

The extension has no developer-operated server, analytics, advertising, telemetry, or account requirement. It does not send your bookmark library, groups, preferences, or backups to the developer.

Local data

Firefox maintains your bookmarks. The extension reads them to display the dashboard and changes them when you use its editing, moving, or deleting controls. Groups, starred items, colors, profiles, preferences, an optional Unsplash access key, and uploaded background images are saved in this browser's extension storage. Firefox Sync, if you enable it separately, may sync Firefox bookmarks under Mozilla's own terms; this extension does not implement its own cloud sync.

Optional connections

Favicons are off by default. Enabling them requests Firefox's optional bookmark-data consent. When granted, the extension requests /favicon.ico directly from the origin of displayed bookmarks. Each contacted site receives a normal image request and your IP address. Bookmark titles, folder names, and full bookmark paths or query strings are not sent. There is no centralized favicon service. Disable this feature in Settings → General or revoke the optional data permission in Firefox's add-on settings.

Unsplash backgrounds are optional. Enabling them requests Firefox's optional authentication-information and search-terms consent. If you enter an Unsplash access key and photo search, the extension sends them to api.unsplash.com to retrieve photographs, and requests images from images.unsplash.com. Unsplash also receives a download request when a photo is selected. Depending on your refresh setting, requests may happen automatically when the dashboard is opened. API requests omit cookies and referrers. Unsplash receives your IP address and applies its own privacy policy: https://unsplash.com/privacy. Switch the background to None, a built-in gradient, or an uploaded image to stop those requests, or revoke the optional data permissions in Firefox.

If you choose a custom remote image URL, the browser contacts that image's host to display it, including when the dashboard is opened again. That host receives a normal image request and your IP address, and may apply its own cookie and privacy practices. An Unsplash photo-page URL is resolved through unsplash.com. A background image uploaded from your computer stays in local extension storage and is not uploaded to a server.

Opening a bookmark navigates to its destination using Firefox. That website's own privacy practices then apply.

Backups and removal

Export saves a JSON file where you choose. It contains local organizational preferences and bookmark references to match items on import; it is not a full Firefox-bookmark backup. The Unsplash key and uploaded background image are excluded. Share exported files only with people you choose. Removing the extension removes its local extension data according to Firefox's behavior; it does not delete your Firefox bookmarks. You can clear groups and preferences by removing the extension or use Settings to change them.

Questions or issues: https://github.com/Mgldvd/Bookmark-Control-Panel/issues
