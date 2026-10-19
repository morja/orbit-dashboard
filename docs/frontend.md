# Frontend structure

The dashboard is plain HTML, CSS and JavaScript modules served by `server.py`.
There is no build step: browsers and the Mac app's WebKit view load the files
from `static/` as they are.

## Files

```
static/
  index.html            page frame, dialogs and static text
  css/orbit.css         stylesheet entry; imports the files below in order
  css/tokens.css        colors, shadows and fonts for light and dark
  css/base.css          element defaults, buttons, badges, panels, tables
  css/layout.css        sidebar, top bar, refresh bar, page heading, footer
  css/dialogs.css       dialog frame, form rows, Git file preview
  css/overview.css      summary tiles, attention list, server summary
  css/projects.css      category tabs, filters and the project table
  css/server.css        server status panels
  css/docker.css        Docker & DDEV view
  css/storage.css       storage view and the shared two-column layout
  css/settings.css      settings dialog
  css/themes.css        optional palettes; they only redefine tokens
  js/main.js            entry point: binds events and starts refreshing
  js/store.js           shared state: last snapshot, view, filters, sorting
  js/api.js             backend requests and the action key
  js/refresh.js         polling, activity label and progress bar
  js/render.js          view headings and drawing the current view
  js/notices.js         current notices, connection failures and the sidebar panel
  js/views/*.js         one module per view
  js/paths.js           width-aware middle truncation of project paths
  js/project-actions.js note dialog, Git preview, terminal, editor, Finder
  js/settings.js        settings dialog and appearance
  js/appearance.js      independent font scale, dashboard zoom and palette contrast
  js/i18n.js            translation functions and static page text
  js/locales/de.js      German text
  js/html.js            escape() and the markup template tag
  js/format.js          numbers, sizes and times
  js/badges.js          status badges
  js/icons.js           inline SVG icons
  js/toast.js           short messages
```

## Conventions

- **Escape workspace content.** Project names, paths, notes and server output go
  through `escape()` before they reach HTML.
- **Templates use `markup`.** Line breaks and indentation inside a ``markup`…` ``
  template are removed, so templates can be formatted freely without adding
  whitespace to the page. `false`, `null` and `undefined` render nothing; arrays
  are joined. Convert booleans in attributes explicitly, for example
  `aria-pressed="${String(active)}"`.
- **Translate source text only.** English text is the key:
  - `t('Show archived')` returns plain text for `textContent`, attributes (after
    `escape()`) and messages.
  - `tHtml('{shown} of {total} projects', { shown: '<b>3</b>', total: 8 })` returns
    escaped HTML; values are inserted as given and must be safe markup.
  - Placeholders use `{name}`. Plural forms are objects keyed by
    `Intl.PluralRules` categories, for example `{ one: '…', other: '…' }`.
  - Never translate workspace content. Backend messages pass through
    `systemMessage()`, which keeps names and paths unchanged.
- **Static text** in `index.html` is translated when its exact text has an entry in
  `locales/de.js`.
- **CSS follows tokens.** Colors come from `tokens.css`; a palette in `themes.css`
  redefines the same tokens for light and dark. Each view keeps its responsive rules
  next to its base rules. Load order is defined only in `orbit.css`.
- **Shared state lives in `store`.** Views read `store.data` and the selection in
  `store.filters` and `store.sort`; they do not keep their own copies.

## Checks

```sh
npm run check            # module syntax and missing German translations
npm run test:browser     # synthetic dashboard and settings checks
```

`npm run check` needs only Node.js. It fails when a literal passed to `t()` or
`tHtml()` has no German entry, and it lists German entries that no source file
mentions any more.

Typography uses `rem` so the root font scale changes only text. The root CSS zoom
scales the dashboard; the Settings dialog cancels that zoom so its controls remain
reachable. Contrast mixes the active palette's text and border tokens toward its
ink color, reading the original values before each preview. The overview uses
container queries so its status strip and side column respond to available space,
including zoomed windows. Expanded server services live in `store` across redraws.

## Page layout and servers

All views use the compact top-bar title and the same sidebar width. Density selects
spacing and sidebar width through CSS variables; font size and zoom remain independent.
Percentage selectors use 5% steps and retain existing intermediate settings. Sidebar
collapse is local navigation state in localStorage, with accessible icon-only links.

The `#servers` route lists enabled servers and displays one selected server. The
`server` query parameter uses SSH host and command as its stable key. Legacy `#moon`
links still open the Servers page. Overview cards link to the corresponding server;
the status strip shows free space for one selected server or aggregate health for
multiple selected servers, without combining disk capacities. Server overview
visibility filters only its cards and metric; checks, navigation and attention
notices continue to include all enabled servers.
Unknown, failed and stale checks count as needing attention. Service expansion remains
independent of server selection. Storage focuses on Mac capacity, history and local projects. Server disk sections
remain on the Servers page and its overview cards.


Server details use separate fact and list grids. System, Storage and Backup
remain above Services, Websites and Ports at every column count. Both grids align cards
to their content height, so a long neighbouring list never stretches a short card.

Project paths keep their unmodified full path in the title and data attributes.
`paths.js` measures their displayed font and available width, retaining the start
and end around a middle ellipsis. Rendering and ResizeObserver update the label
when the page, font size or sidebar width changes. Stored paths are untouched.

Project columns use configured DDEV visibility and `show_next_step`. Header and row cells are generated together; responsive rules target named classes rather than changing column positions. Status cells fit content while the project name receives spare width.

Same-view refreshes preserve window and table scroll offsets and restore search focus
with `preventScroll`. Changing view or selected server starts at the top. Server
facts start with System; addresses use separate monospace rows and uptime uses
localized day/hour/minute units. Storage shows disk and RAM meters together. Exact
memory bytes come from automatic SSH queries; old cached RAM strings remain usable.


Docker and DDEV lists keep independent search, status, scope and sort selections
in `store.integrationLists`, across polling redraws. Search focus is restored by
input ID. Docker classification uses the `com.ddev.platform` label, not a guess
based on a container name. Container rows contain only display metadata, never
commands, environment variables or arbitrary labels.

List selections persist through `list-preferences.js` in browser localStorage under
`orbit-list-preferences-v1`. Overview and Projects keep independent filters and sorting. Legacy shared
preferences initialize both views separately; DDEV and Docker keep independent selections. Search strings are excluded.
`remember_list_preferences` defaults to true and is editable in Appearance. Disabling
it clears saved selections but leaves the current session intact. Filter resets
clear search and filters in their own list, preserving sorting. Storage errors or
invalid saved values fall back to defaults without blocking the dashboard.

The native WebKit window uses a persistent website data store so these local choices
also survive quitting the Mac app. Settings and notes continue to live in `data/`.
Native regression checks verify browser storage across separate app processes.

Local Services keeps filters in `store.servicesSelection` and remembers them through
`list-preferences.js`, excluding search text. Personal descriptions, own-service marks
and favorites live in validated `service_preferences` settings. The service dialog
saves through the authenticated `/api/services/<id>` endpoint.

Service tables override the shared nowrap rule and use fixed column layout so
identifiers and program names cannot overlap actions. Full paths appear only in
the wrapping Details facts. My services uses collector ownership hints unless a
persisted own-service boolean overrides them; scope remains a separate filter.

Git badges and branch buttons share the Git status dialog, opening Changed files
or History respectively. Tabs support arrow keys and show the branch, upstream
and ahead/behind counts from the last local project check. Dashboard polling
leaves the open dialog untouched. History reads ten local HEAD commits lazily
through `/api/projects/<id>/commits`, with a 30-second cache shared by the mini
preview. No fetch runs. Mini previews show three changed paths or the latest
commit subject with its timestamp; full details remain available on click.

The Git status dialog keeps a fixed viewport-bounded frame across tabs and loading
states; only the content panel scrolls. Mini-preview paths use the shared UI font
and stay on one line, with ellipsis only when a path exceeds available width.

Shared typography and component rules are maintained in [ui-style.md](ui-style.md).
Use the named font-size tokens in `tokens.css` for equivalent elements across views.

Global notices appear through the sidebar Notices button, with a count and warning
color. The count remains visible in collapsed navigation and the mobile icon bar.
The on-demand popover reuses the shared section heading and attention rows without
adding height above the dashboard. It supports Escape, outside-click dismissal,
detail links, and live updates while open. Polling preserves link focus and scroll;
resolved notices disappear automatically. A connection failure adds a red notice
and keeps the existing live status visible. Action-specific errors remain beside
their controls.

The live status uses the last project collector timestamp instead of the current
clock time. It shows the age of cached project values, marks overdue checks in
amber, and keeps that age visible while a fresh check runs. The sidebar stale-data
notice uses the same freshness rule, allowing the configured background interval
plus a short scheduling grace period. Foreground polling waits for activity
registration and polls running project checks every second, so completed values appear
promptly even when the normal UI polling interval is longer.
