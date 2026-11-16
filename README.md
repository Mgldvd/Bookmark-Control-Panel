# Bookmark Control Panel

A visual control panel for your **real** Firefox bookmarks, built as a WebExtension.
It reads the bookmark tree directly with `browser.bookmarks`, **updates in real time**
when you add, rename, move or delete bookmarks (from any window, the Library or Sync)
and processes your bookmark library **locally**: no developer server, runtime dependencies, frameworks, analytics or advertising. Optional favicons and remote backgrounds contact external services as described in [the privacy policy](store/privacy-en.md).

> It used to be called **Bookmark Dashboard**. Since version 1.6.1 it is called **Bookmark Control Panel**,
> but it keeps the internal id (`bookmark-dashboard@local-extension`): it updates over the previous
> version without losing groups, colors or settings, and old backups can still be imported.

---

## 1. Architecture

```
┌────────────────────────── Firefox ──────────────────────────┐
│                                                              │
│  Places (bookmarks) ──getTree()──►  dashboard.js             │
│        │                              ┌──────────────────┐   │
│        └─ onCreated / onRemoved ────► │ In-memory model  │   │
│           onChanged / onMoved         │  Map<id, node>   │   │
│                                       └────────┬─────────┘   │
│  storage.local ◄── preferences ───────┐        │ rAF         │
│  (theme, view, sort, last folder,     │        ▼             │
│   expanded folders, starred)          │   Render (DOM)       │
│                                       │   · sidebar (tree)   │
│  background.js ── toolbar button ──►  │   · cards by id      │
│                   opens dashboard.html└── · dialogs/menus    │
│  chrome_url_overrides ── new tab ──────► dashboard.html      │
└──────────────────────────────────────────────────────────────┘
```

- **Reading**: on startup `browser.bookmarks.getTree()` is called once and an in-memory model
  (`Map id → node`) is built that keeps the original hierarchy and order.
  Initialization **only reads**: it never creates, edits or deletes anything.
- **Sync**: the `onCreated`, `onRemoved`, `onChanged` and `onMoved` listeners apply _incremental_
  changes to the model (insert, remove a subtree, rename, move between parents with its index).
  The UI is repainted on the next `requestAnimationFrame`, which batches bursts of events
  (for example, when Sync downloads hundreds of bookmarks).
- **Efficient rendering**: cards are reconciled **by id**: an existing card reuses its DOM node
  and its content is only rebuilt if its title, URL or folder changed. So updating a bookmark
  does not reload the page or the favicons. Large lists are painted in batches of 200 as you
  scroll (`IntersectionObserver`).
- **Safety net**: if an event refers to an unknown node, or if the tab was hidden for more than
  15 s (restoring a backup can make bulk changes without individual events), the tree is re-read
  silently. There is also a "Reload bookmarks" button in Settings.
- **Security**: every title and URL is inserted into the DOM with `textContent` / text nodes;
  `innerHTML` is never used. Only `http(s)` URLs are opened; `place:`, `javascript:`, `about:` or
  `file:` URLs are shown, but clicking them copies the URL (Firefox does not allow opening them
  from an extension).
- **Local starred items**: the "starred" mark is stored in `browser.storage.local` by bookmark id
  (Firefox GUIDs are stable). It does not alter the structure or the bookmarks.
- **Several tabs**: `storage.onChanged` keeps several open panels consistent (theme, starred
  items, view…).

### Permissions (minimal)

| Permission  | What for                                                                          |
| ----------- | --------------------------------------------------------------------------------- |
| `bookmarks` | Read and modify bookmarks (modifications only happen on an explicit user action). |
| `storage`   | Store preferences and starred items locally.                                      |

`tabs.create` (opening a new tab) needs no permission. No host permissions are requested and
`data_collection_permissions` declares no required transmission, with optional consent for
bookmark data (favicons) and authentication information/search terms (Unsplash). Connections also
include custom remote background images explicitly selected by the user and the Unsplash API (`api.unsplash.com`, which answers with CORS,
so it needs no host permission) and the background image itself.

### Favicons and privacy

The WebExtensions API gives no access to Firefox's favicon cache. Favicons are **off by default**. After enabling them and granting Firefox's optional bookmark-data consent, the panel requests
`https://<site>/favicon.ico` **directly from each bookmarked site** (with `no-referrer`), never
from third-party services such as Google. While loading or on failure, it shows an initial with a
color derived from the domain. For **no automatic network connections**, keep favicons off and use no background, a built-in gradient, or an uploaded image. Opening a bookmark still visits its destination.

---

## 2. File tree

```
bookmarks/
├── manifest.json      # MV3 manifest: permissions, new tab, button, gecko id
├── background.js      # Toolbar button / Alt+Shift+B → opens the panel
├── dashboard.html     # Structure, SVG icon sprite and dialogs
├── dashboard.css      # Light/dark design (light-dark()), responsive, animations
├── dashboard.js       # Model, sync, render, search, CRUD, drag and drop
├── theme-init.js      # Applies the theme before the first paint (avoids the flash)
├── i18n.js            # UI strings: English (default) and Spanish
├── _locales/          # Manifest strings (description, button, shortcut) in en / es
│   ├── en/messages.json
│   └── es/messages.json
├── icons/
│   └── icon.svg       # Extension icon
├── package.sh         # Builds dist/bookmark-control-panel-<version>.zip for signing
├── sign.sh            # Signs the package on AMO (private channel) and leaves the .xpi in dist/
├── tests/             # Tests with node:test (no browser)
└── README.md
```

---

## 3. Features

- Sidebar with Firefox's real folders (Bookmarks Menu, Bookmarks Toolbar, Other Bookmarks,
  Mobile Bookmarks if it has content), with expandable and collapsible subfolders and a recursive
  count per folder.
- Special views: **All**, **Starred** and **Recent** (the 60 most recently added).
- Bookmarks as cards (grid view) or rows (list view), with favicon, title, domain, folder
  (clickable) and creation date.
- Instant **global search** by title, URL and folder path. It ignores case and accents
  ("javascrípt" finds "JavaScript") and highlights the matches.
- Create bookmarks and folders, rename, edit the URL, move (dialog or **dragging** onto any folder
  in the sidebar or onto a folder tile) and delete with confirmation (for folders it says how much
  content will be deleted).
- **Reorder by dragging** in the main section (grid, list and board): drop a bookmark before or
  after another and a line marks the slot; the change is saved to the Firefox bookmarks. Dropping
  it next to a bookmark in another folder (another board card or an included subfolder) moves it
  to that position in that folder. Only with "Original order"; with another order, dropping on the
  folder still moves it to the end. A link dragged from a website is saved where it is dropped.
- **Reorder folders by dragging**: a folder tile (or a board card header) dropped on the **edge**
  of another is placed before or after it; in the **center** it goes inside, as always. In the grid
  the left and right edges count; on the board, the top and bottom ones.
- **Undo**: moving (by dragging or with "Move to…"), reordering or deleting shows a notice with
  **"Undo"** (also `Ctrl+Z` for a minute). Undoing a deletion recreates everything with its content
  in place, and its starred items, groups, folder color, home folder and collapsed state move to the
  recreated bookmarks.
- **Multiple selection**: `Ctrl`/`⌘`+click on a bookmark (or its checkbox, which appears when
  hovering the card) selects it; `Shift`+click selects the range. With something selected, a plain
  click also toggles the selection, `Ctrl+A` selects the whole view, `Delete` deletes and `Esc`
  clears it. The bottom bar can **open**, **move to…**, **add to group** and **delete** everything at
  once; dragging one of the selected items drags them all (to a folder, a slot or a group). Middle
  click still opens the link in a tab.
- Dragging a link from any web page or the address bar onto a folder saves it there as a bookmark.
- Context menu (right-click or the `⋯` button) on cards and folders.
- **Open all in tabs**: the "Open all" button next to the sort selector (opens every bookmark in
  the current view: folder, search, starred…) and the "Open all in tabs" option in each folder's menu
  (its direct bookmarks, as Firefox does). Also with a **middle click** on any folder (sidebar,
  folder tile or top path). They open in the background, in order, right after the panel's tab.
  With more than 15 it asks for confirmation. Links Firefox does not allow opening from extensions
  (`place:`, `javascript:`…) are skipped with a notice.
- Firefox **separators** in the **list view** (with "Original order" and without "Include
  subfolders", which is when they make sense). They update live and can be deleted with a right
  click. No separators are shown at the start, at the end or repeated.
- **Board view** (third button next to grid and list): each folder is a card with its name on top
  and its links below, in the same format as the groups. In a folder there is one card for its own
  bookmarks and another for each subfolder (with shortcuts to its sub-subfolders); in "All",
  "Starred", "Recent" and in search, bookmarks are grouped by folder showing their path. Each card
  shows 10 links ("Show more" for the rest; if you leave it expanded, it is remembered), can be
  collapsed (remembered), its header opens the folder (middle click: everything in tabs) and it
  accepts dragged bookmarks (it moves them into that folder in Firefox).
- **Hide the sidebar**: the panel button to the left of the search box hides or shows the folder
  tree (the one on the right does the same with the groups); the content takes the free space.
  Remembered and applied before the first paint. On mobile the sidebar is still a drawer.
- **Strip**: a special view (sidebar, below "Recent") with the folders you choose, side by side as
  board cards in a single row. It has no scrollbar: it moves with the **mouse wheel** (horizontally;
  at the end the wheel goes back to the page), by **grabbing the background** and dragging (on
  release it keeps going with momentum and slows down), or by bringing whatever you are dragging (a
  card or a bookmark) near an edge. A gradient on the edges shows there is more. Folders are chosen
  in the **sidebar tree**: with the Strip open, each folder shows a checkbox and a click adds it
  (at the end) or removes it, instead of opening it; "Choose folders" takes you there (on mobile it
  opens the drawer). "Add to strip" in any folder's menu or dragging a folder from the tree to the
  strip also works. Dragging a card header to the left or right of another changes its place (only
  in the strip; Firefox does not change).
  Inside each card, **subfolders expand** like a tree (arrow or click on their name) and show their
  links and their own subfolders; which ones are open is remembered.
  **Expand all** (in the header) expands every subfolder in the strip at once and opens the
  collapsed cards; **Collapse all** folds them again. In minimal mode, which hides the header, that
  general button appears as an icon in the profiles bar, next to "+". Besides, each column with
  subfolders has its own button in its header (next to the counter) that does the same only for
  that column.
  Firefox **separators** show as a light line between links and between subfolders, also inside
  the expanded folders (with "Original order", which keeps the subfolders in Firefox's order);
  right-clicking shows the colors as dots and a click applies one (same as for folders); it is
  remembered and included in the backup.
  Each card fits on the screen and has its own vertical scroll: the wheel over a card with more
  content scrolls it; on the rest of the strip, it moves it sideways. A wheel gesture that is moving
  the strip sideways keeps going sideways even when it passes over scrollable cards, and a card only
  takes the wheel if the pointer has rested on it for a moment (not when crossing it towards another
  column). Stored in `browser.storage.local`, included in the backup and it can be the home folder
  (also in minimal mode).
  **Strip profiles**: a bar centered above the strip (also in minimal mode) stores different folder
  selections; a click switches between them. **+** creates an empty profile (with the name ready to
  type) and **⋯** or right-clicking a tab lets you rename it (also double click or F2), duplicate
  it, give it a **color** (a dot before the name and a tinted tab when active), move it or delete it
  (with "Undo"; one always remains). The strip as it was before becomes the "Main" profile. Synced
  across tabs and included in the backup.
- **Masonry**: a special view below "Strip" that works just like it (checkboxes in the tree,
  "Choose folders", "Add to masonry" in the folder menu, expandable subfolders, Expand / Collapse
  all, profiles, separators, home folder), but with its **own selection**: its folders, profiles and
  open subfolders are not the strip's (`masonryFolders`, `masonryProfiles`, `masonryProfile`,
  `masonryOpen`). Cards are spread across columns and each one goes into the **shortest column**, so
  the order reads left to right (the board uses CSS columns, which read top to bottom). The page
  scrolls vertically and each card shows all its content. The number of columns depends on the width
  (min. 300 px) and respects the maximum in Settings → Layout; they are re-laid out when the width
  changes, but expanding or collapsing something does not move the cards. Dragging a card header
  above or below another changes its order. Included in the backup; a backup older than the masonry
  does not empty it when imported.
- **Home folder**: every new panel tab starts at the folder or view marked with "Use as home page",
  both in the normal panel and in minimal mode. Any view (the **Strip** too) can be set as home with
  the house button in the header (highlighted when what you see is already home), by right-clicking
  the view in the sidebar or in Settings → Home page.
- **Minimal mode / home page**: the four-corners button (top bar) leaves only the board of the
  folder (or view) you are on, with "Back to …" to go to the **home folder**; on exit, the panel
  stays on the folder you were viewing. New tabs and the `?home` address start at the home folder.
  The search box, side panels, header and buttons are hidden. To exit, use the fixed button in the
  top-right corner.
  The home folder is chosen in Settings → Home page ("All", "Starred" or "Recent" also work) or by
  right-clicking a folder → "Use as home page". Inside the mode, opening a subfolder shows
  "Back to …" (or `Esc`); it is kept when reloading the tab, new tabs start at the home folder and
  the normal panel's folder does not change.
  The mode is remembered (also in new tabs) and applied before the first paint.
  Entering and leaving is an animated transition (View Transitions API): panels slide out through
  their edge, cards fly, staggered, to their new position and the exit button spins in. With
  "reduce motion" in the system, or without API support, the change is instant.
  The `moz-extension://…/dashboard.html?home` address always opens minimal mode without changing the
  setting: it is in Settings → Home page, with a "Copy" button.
- **Redesigned Settings**: a dialog with tabs on the left (Appearance, General, Home page, Backup,
  Keyboard shortcuts) and options in grouped rows; on mobile the tabs move to the top. It can also
  be navigated with the keyboard (arrows, Home, End).
- **Content width** (Settings → Appearance → Layout): Normal (1440px, as always), Wide (1920px) or
  Full (all the available space). Useful on large monitors and in minimal mode.
- **Board columns** (Settings → Appearance → Layout): Auto (by width, as always) or a maximum of
  1 to 6. Each column is at least 160px wide, so narrow windows use fewer; on mobile always one.
- **Cards' left border** (Settings → Appearance → Card border): the color stripe of board cards and
  groups can be hidden or change thickness (none, thin, normal, thick, extra; "None" is the same as
  turning the switch off); its color is the column color (Settings → Appearance → Colors). Groups
  keep their own. With a live preview; applied before the first paint and included in the backup.
- **Main color** (Settings → Appearance): the color of buttons, selection, focus and other
  highlighted elements is chosen among ten (indigo, the usual one, blue, teal, green, amber, orange,
  red, pink, violet and slate), with variants for light and dark themes. Applied before the first
  paint, synced across tabs and included in the backup.
- **Folder and column color** (Settings → Appearance → Colors): the yellow of folders (icons,
  folder cards and board columns) can be changed to any of the ten colors, and board columns can
  have a different one ("Folder color" follows the former). Folders with their own color keep it.
  The column color no longer depends on the left border being visible.
- **Style** (Settings → Appearance → Style): Classic (the usual one), **Glass** (translucent,
  frosted surfaces over the background image or, without one, over a gradient made with the main
  color), **Nord** (cool blue-gray) and **Sepia** (warm paper). Each works in light and dark and,
  while the main color is the default one, brings its own. Applied before the first paint, synced
  across tabs and included in the backup.
- **Background image** (Settings → Background): none, a built-in **gradient**, a random
  **Unsplash** photo or a **custom** one. The ten gradients (Aurora, the Glass one, which uses the
  main color; Sunset, Ocean, Forest, Lavender, Peach, Mint, Midnight, Candy and Graphite) are pure
  CSS, need no connection and have light and dark versions. Unsplash needs the user's own free access key (unsplash.com/developers); the photo is
  chosen by topic and renewed every hour, every day or by hand ("Another photo"), and the panel
  shows the "Photo by … on Unsplash" credit the API guidelines require. A custom image is a link
  (any image, or an Unsplash photo page such as `unsplash.com/photos/…`, turned into its image)
  or a file from the computer, reduced to 2560 px and saved as WebP inside the extension.
  Adjustable blur and "soften" (lightens or darkens it by theme). The backup keeps these settings
  but not the access key or an uploaded image.
- **Corner style** (Settings → Corners): rounded, semi-rounded or square corners across the whole UI
  (cards, buttons, menus, dialogs, search box…). Applied before the first paint, like the theme,
  and synced across tabs.
- **Backup** (Settings → Backup): "Export…" saves groups, folder colors, starred items and settings
  to a `.json`; "Import…" restores them after confirming (it replaces the current ones). Since
  bookmarks' internal ids can change between profiles, the backup also stores each bookmark's URL
  and each folder's path: when restoring on another computer they are recognized by URL/path and
  the missing ones are reported. It does not include or modify the Firefox bookmarks. It is a good
  idea to export before reinstalling or switching signed versions.
- **Color per folder**: any folder's menu (right-click or `⋯`) → "Color…" → one of the 10 colors or
  "Default". Applied to the sidebar icon, the folder tile, the board card (stripe, header and
  counter), the subfolder shortcuts and the view header. Stored only in `browser.storage.local`
  (Firefox does not support folder colors) and synced across panel tabs.
- **Groups** (right column): create groups with a name and a characteristic color (10 colors) and
  **drag bookmarks** onto them to add them. A bookmark can be in several groups and its cards show a
  dot in each group's color. Dragging an item from one group to another moves it; dropping on
  "New group" creates a group with that bookmark. There is also "Add to group…" in each bookmark's
  menu. Each group can be collapsed, renamed, recolored, reordered, opened entirely in tabs (menu or
  middle click on its header) and deleted (with confirmation). Groups are stored only in
  `browser.storage.local`: **they do not create, move or delete Firefox bookmarks**. Below 1200 px
  the panel floats over the content and opens with the panel button in the top bar.
- **Tab name** (Settings → General → Browser tab): the title of the panel's tab can be changed
  (empty = "Bookmarks" / "Marcadores", depending on the language; up to 60 characters) and is
  previewed live while typing. "Show the current folder in the tab" prepends the folder, view or
  search ("Bookmarks Toolbar · Start"); off, the tab shows only the name. Applied before the first
  paint, synced across tabs and included in the backup.
- **Language**: English by default; Spanish optional in Settings → Language / Idioma. Applied
  instantly, stored in `browser.storage.local` and synced across panel tabs.
- Light / dark / system theme, grid/list view, sort (original, name A→Z / Z→A, newest / oldest),
  home folder and expanded folders, all stored in `browser.storage.local`.
- Responsive: below 900 px the sidebar becomes a sliding panel.
- Shortcuts: `/` or `Ctrl+K` search · `Enter` opens the first result · `↓` moves to the results ·
  `Delete` deletes the focused item · `Esc` clears / closes · arrows to navigate the tree ·
  `Alt+Shift+B` opens the panel.
- Empty states (empty folder, no results, no starred items, no bookmarks) and error states (API not
  available, read failure with a "Retry" button).

---

## 4. Saving the files

The project is already in this folder. If you want to copy it elsewhere, the files in the tree
above are enough as long as the structure is kept (`manifest.json` must be at the root of the
folder you load in Firefox, and `icon.svg` inside `icons/`).

---

## 5. Installing for testing (`about:debugging`)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **"Load Temporary Add-on…"**.
3. Select the project's `manifest.json` file.
4. The extension icon appears in the toolbar (if you do not see it, open the extensions menu 🧩
   and pin it). Click it, open a new tab or use `Alt+Shift+B`.

Notes:

- A temporary add-on **is unloaded when Firefox closes**; it has to be loaded again in the next
  session. Your bookmarks are not affected; the panel's local preferences (starred items, theme…)
  may be lost when uninstalling it.
- After changing the code, click **"Reload"** in `about:debugging`.
- To see errors: the **"Inspect"** button in `about:debugging` (opens the extension console).

---

## 6. Using it as the new tab page

It comes enabled: `manifest.json` includes

```json
"chrome_url_overrides": { "newtab": "dashboard.html" }
```

- The first time you open a new tab, Firefox shows a notice _"An extension has changed the page
  you see when you open a new tab"_. Choose **"Keep Changes"**.
- In **Settings → Home → New tabs** you will see that Bookmark Control Panel controls that page.
- **If you do not want it as the new tab**, delete the `"chrome_url_overrides"` block (3 lines) from
  `manifest.json` and reload the extension. The panel is still available from the toolbar button
  and with `Alt+Shift+B`.
- To have it in **private windows** too: `about:addons` → Bookmark Control Panel →
  "Run in Private Windows" → Allow.
- To make the **new tab** show only the home folder, turn on minimal mode
  (four-corners button or Settings → Home page → "Minimal mode").
- Optionally, as Firefox's **home page**: in the panel's Settings → Home page, click "Copy" (it
  copies `moz-extension://…/dashboard.html?home`, which always opens minimal mode) and paste it in
  Firefox Settings → Home → "Homepage and new windows" → Custom URLs. The UUID is stable as long as
  the extension keeps the same `id`.

---

## 7. Public AMO publication

The public listing materials are in [`store/`](store/README.md): bilingual descriptions, privacy policies,
reviewer notes, eleven 1280×800 screenshots using synthetic data, and a short Spanish MP4 presentation.
The package contains only original, readable runtime files. There is no compilation or minification.

Run `./package.sh` with a POSIX shell and Python 3 to create a reproducible ZIP. Development checks use
`npm ci && npm run check`; dependencies are development tools and are not part of the extension.
Do not upload `.env`, developer credentials, synthetic fixtures, or media inside the extension package.
The AMO API client reads the existing ignored `.env` without executing it.

No source license was present in the repository when preparing this release, so the listing retains
**All Rights Reserved**. This does not add an open-source license or change ownership.

### Permanent installation and private signing

Firefox **Release and Beta** only install extensions **signed by Mozilla** permanently. Copying the
files into the profile folder does not work: Firefox would disable the unsigned add-on. Signing is
free and can be **private** (unlisted, not published in the store):

### Option A: "unlisted" signing on AMO (recommended)

1. Package the extension:
   ```sh
   ./package.sh            # creates dist/bookmark-control-panel-<version>.zip
   ```
   (or by hand: `zip -r -X bookmark-control-panel.zip manifest.json background.js dashboard.* theme-init.js i18n.js _locales icons`).
2. Create an account or sign in at <https://addons.mozilla.org/developers/>.
3. **"Submit a New Add-on"** → choose **"On your own"** (self-distribution, unlisted).
4. Upload the `.zip`. Automatic validation and signing usually take a few minutes; it is not
   published and nobody sees it.
5. Download the signed `.xpi` and install it from `about:addons` → ⚙️ → **"Install Add-on From
   File…"** (or drag the `.xpi` onto Firefox).
6. For each new version, bump `"version"` in `manifest.json` and repeat.

Requirements: the `browser_specific_settings.gecko.id` (`bookmark-dashboard@local-extension`) must
be unique on AMO. If it is rejected as a duplicate, change it to your own (e.g.
`bookmark-dashboard@your-domain.example`) **before** the first signing and keep it afterwards
(storage and the `moz-extension://` URL depend on it).

### Option A2: signing from the terminal with `sign.sh`

1. At <https://addons.mozilla.org/developers/addon/api/key/> generate your API credentials
   ("JWT issuer" and "JWT secret").
2. Save them once in a `.env` file at the project root (it is in `.gitignore`, so it is never
   pushed to the repository; use `.env.example` as a template):
   ```sh
   cp .env.example .env && chmod 600 .env   # and edit the two values
   ./sign.sh --check                        # checks that they load, without signing anything
   ./sign.sh                                # packages and signs
   ```
   You can also export them in the terminal (`export WEB_EXT_API_KEY=…`); if you do, they take
   precedence over `.env`.
   The script packages, signs exactly the contents of the `.zip` through the _unlisted_ channel with
   Mozilla's official `web-ext` tool (via `npx`, it is not part of the extension) and leaves the
   signed `.xpi` in `dist/`.
3. Install it: `about:addons` → ⚙️ → "Install Add-on From File…".

**Before switching from the temporary version to the signed one**, export your data (Settings →
Backup → Export…) and, once the signed one is installed, import it. Groups, colors and starred
items live in the extension's storage and are not included in the `.xpi`.

### Option B: unsigned (Developer Edition, Nightly or ESR only)

In **Firefox Developer Edition, Nightly, ESR** or unbranded builds you can set
`xpinstall.signatures.required = false` in `about:config` and install the `.zip` (renamed to `.xpi`)
from `about:addons`. **In regular Firefox this preference is ignored.**

---

## 8. Testing the sync

With the panel open (ideally in its own window, next to a normal window):

| Test           | What to do                                                            | Expected result in the panel                                                        |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Create         | `Ctrl+D` on any page and save it to the bookmarks toolbar             | The card appears instantly with a brief highlight; the counters go up.              |
| Rename         | Library (`Ctrl+Shift+O`) → edit a bookmark's name                     | The card changes its title without reloading.                                       |
| Change URL     | Change the URL in the Library                                         | The domain and the favicon update.                                                  |
| Move           | Drag a bookmark to another folder in the Library or the toolbar       | It disappears from the old folder and appears in the new one; both counters change. |
| Reorder        | Drag a bookmark within the same folder (toolbar)                      | With "Original order", its position changes.                                        |
| Delete         | Delete a bookmark or folder from the Library                          | It disappears; if you were inside the deleted folder, you go to the parent.         |
| Undo           | `Ctrl+Z` in the Library after deleting                                | The bookmark appears again.                                                         |
| Several panels | Open two panel tabs and star something in one                         | The other updates the star and the counter.                                         |
| From the panel | Create / edit / move / delete from the panel                          | The change shows in the toolbar and in the Firefox Library.                         |
| Drag a link    | Drag a link from a website onto a sidebar folder                      | It is saved as a bookmark in that folder.                                           |
| Separator      | Library → right-click → "New Separator" (with the panel in list view) | A divider line appears in the same position.                                        |

The green dot in the bottom-left corner pulses every time an event arrives from Firefox.

---

## 9. Lint and formatting (Vite+)

The code is linted and formatted with [Vite+](https://viteplus.dev) (`vp`), which bundles Oxlint
and Oxfmt. It is only a development tool: `package.sh` packages only the extension's files, so it
does not end up in the `.xpi` and the extension still has no dependencies.

Requires Node.js `^22.18.0 || ^24.11.0 || >=26.0.0`. The first time:

```sh
npm install
```

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `npm run check`     | Format + lint + tests (recommended before every commit).        |
| `npm test`          | Only the tests in `tests/`.                                     |
| `npm run lint`      | Oxlint on the `.js` files (`browser` and `webextensions` envs). |
| `npm run lint:fix`  | Fixes what can be fixed automatically.                          |
| `npm run fmt`       | Formats JS, CSS, HTML, JSON and Markdown (writes the files).    |
| `npm run fmt:check` | Only checks the formatting, without writing.                    |

The configuration is in `vite.config.mjs` (`lint` and `fmt` blocks): single quotes, semicolons,
trailing commas and 120 columns. Disabled rules carry a comment with the reason.

### Tests

`tests/` uses `node:test`, with no browser and no dependencies. `tests/helpers/panel.mjs` loads
`dashboard.js` (with `i18n.js`) in an isolated Node context, with a simulated bookmarks API that
behaves like Firefox's (and, for comparison, like Chrome's) and emits its events, a minimal DOM and
an in-memory `browser.storage.local`. They cover the home folder, "Show more", reordering bookmarks
and folders, "Undo", multiple selection, the strip, the masonry, separators, colors and the tab
name. The visual UI (styles, animations, real mouse dragging) is checked by hand in Firefox.

---

## Troubleshooting

- **The UI is in English**: it is the default language. Change it in Settings (controls icon) →
  _Language_ → Español.
- **"Open this page from the extension"**: you opened `dashboard.html` as a local file; it must be
  loaded as an extension (section 5).
- **Some favicons do not show**: the site does not serve `/favicon.ico` (it declares the icon only in
  its HTML). The initial is used instead.
- **A "Most Visited" bookmark or a bookmarklet does not open**: they are `place:` / `javascript:`
  URLs, which Firefox blocks from extensions; the URL is copied to the clipboard.
