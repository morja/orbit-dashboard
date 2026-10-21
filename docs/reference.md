# Orbit Dashboard

A local developer dashboard for macOS. Keep track of projects, Git work and storage.
DDEV, Docker and a server connection are optional. Requires Python 3.10 or newer,
with no additional Python packages or account. Licensed under MIT.

An AI can set up Orbit using the [setup guide](ai-setup.md). All workspace
settings are editable in the app. See the [technology decision](technology.md)
and [contribution guide](../CONTRIBUTING.md).

English is the default language. Choose German in Settings. Documentation, source
comments and internal messages use English. Project names, custom categories,
paths and personal notes retain their original content.

## Launch

Open **Orbit Dashboard** through Spotlight or `~/Applications/Orbit Dashboard.app`.
The Mac app displays the dashboard in its own WebKit window. It starts the local
backend and stops its process group when the last window closes or you press Cmd+Q.
A parent-process check also stops the owned backend after a forced app termination.
No separate browser is required.

Settings live in `data/settings.json`; notes live in `data/orbit.sqlite3`. An Orbit
backend started independently is reused and remains running after the app closes.
The backend binds only to `127.0.0.1`.

Viewing the dashboard needs no key. Changes such as notes, settings, **Refresh** and
opening a terminal, editor or folder require the key in `data/action.key`, which only
your user account can read. The Mac app passes it to its window. `Orbit.command`
opens the address with the key once, and `python3 server.py` prints that address.
A browser tab opened without the key can view Orbit but not change anything.

### Startup sequence

1. The app checks `http://127.0.0.1:8765/api/health` every 0.25 seconds.
2. An existing Orbit backend is reused. A different service on that port produces
   an error, and the app does not start another backend.
3. If nothing responds, the app launches the Python interpreter chosen at build
   time with `server.py --managed --parent-pid <App-PID>` in the source directory.
   Output goes to `data/orbit.log`.
4. Managed mode creates a separate process group. Closing the app sends SIGTERM
   to the group, including running `du`, Git and SSH calls. If the app disappears,
   the backend stops itself within a second.
5. After 25 seconds without a response, the app offers **Try again**.

The app's `Info.plist` records the source directory and interpreter. An app-owned
backend is available only while the app is running.

Changes take effect as follows:

- HTML, CSS and JavaScript: reload with Cmd+R. Files are served from the source
  directory with `Cache-Control: no-store`.
- Backend code or direct changes to `data/settings.json`: restart the app.
  Changes saved through Settings take effect immediately.
- Swift code: rebuild with `python3 macos/build.py`.

## Build the Mac app

Requires Apple developer tools and Python 3.10 or newer. The build uses the calling
Python interpreter:

```sh
python3 macos/build.py
```

The build installs the app in `~/Applications` and registers it with macOS.
`macos/Orbit.swift` provides the WebKit window and manages the Python backend.
The installed interpreter and source directory remain necessary. Rebuild after
moving the source directory or changing interpreters. This is not a portable
app with an embedded Python runtime.

## Browser mode and optional autostart

Double-click **Orbit.command** in Finder to start a background backend and open
<http://127.0.0.1:8765>. Repeating this opens the existing instance.
To run in the foreground and stop with Ctrl+C:

```sh
python3 server.py
```

For a persistent backend that starts at login:

```sh
python3 install_autostart.py
```

Close the Mac app first. This optional mode continues running when the app closes.
The launch agent is `~/Library/LaunchAgents/one.tearoom.orbit-dashboard.plist`.
To disable it:

```sh
launchctl bootout gui/$(id -u)/one.tearoom.orbit-dashboard
rm ~/Library/LaunchAgents/one.tearoom.orbit-dashboard.plist
```

## Features

- Overview of free Mac space, projects and uncommitted Git changes.
- Project search, categories, groups, filters, sorting and Finder shortcuts.
- Git branches, staged/unstaged/untracked entries, conflicts and local commits
  compared with the last locally known upstream state. Collectors never fetch,
  pull, commit or push.
- The Git column distinguishes repositories without a remote, branches without
  upstream tracking and branches in sync with the last locally known upstream.
  A configured upstream whose difference cannot be read is marked unavailable.
- Registered DDEV projects, running status and local website links. Unavailable
  status is shown as unknown rather than stopped.
- Project status, priority and next-step notes in the local database.
- Optional Moon-compatible server status: services, websites, storage, backups
  and Gasamba. Orbit reads an existing SSH status command and changes no services.
- Project folder sizes and Mac storage history collected from the first launch.
- Last server values remain visible after connection failures and restarts.

## Data and measurement scope

`data/orbit.sqlite3` stores notes, size readings, server status and Mac history.
`data/orbit.log` contains startup output. Both stay local and are excluded from Git.
The dashboard uses no external fonts or APIs.

Default intervals are 30 seconds for Mac storage, one minute for foreground project checks
and DDEV, five minutes for background project checks, two minutes for server status
and Docker, and one hour for folder sizes. Existing saved intervals are preserved.
Under Settings → Advanced, disable **Check projects in the background** to pause
project discovery, Git, last-changed and folder-size checks while no authenticated
Orbit window is active. Returning to the foreground checks projects immediately;
checks already running finish normally. The foreground interval and background
interval are independently editable. Manual Refresh still works while paused.
Other enabled integrations keep their own schedules.

Foreground windows report activity every 15 seconds. Closed or disconnected
windows expire after 45 seconds, and each window has its own activity identity.
The native app reports activation, key-window and minimization changes explicitly.
Read-only browser windows cannot activate project checks without the local action key.

On macOS, filesystem notifications mark changed projects for their next scheduled
check. Unchanged projects reuse cached Git and last-changed values without walking
their source folders. Returning to Orbit immediately checks pending changes rather
than rescanning every project. Notifications continue to accumulate in the background
while project scans are paused. Notifications are asynchronous; changes delivered
during a check remain pending for the following check.

Each inspected Git repository uses three read-only Git processes. File changes,
branch, upstream and ahead/behind counts share one status query; commit time and
the remote list are read separately. This also applies to full fallback checks.

Source edits, deletions and renames trigger a source timestamp scan for that project.
Changes confined to Git metadata, logs, hidden folders or configured excluded folders
update Git without walking source files. Source and commit timestamps are cached
separately, so commit-only changes still update last changed. Project discovery runs
again for new/removed project folders and other structural changes. Linked worktrees
also watch their external Git metadata and shared references.

**Full project checks**, under Settings → Advanced, default to 1800 seconds.
Full checks also run on startup, after settings changes, after dropped/coalesced
events, and on manual Refresh. If notifications are unavailable or a watched root
is missing, Orbit falls back to full scans at the normal project interval. The
foreground-only preference still applies to automatic full checks. Folder-size
checks retain their separate hourly interval.

The dashboard window asks for new values every 10 seconds, only while
it is active and visible; this is also configurable. Unchanged values are answered
with `304 Not Modified` and are not redrawn.

The compact live status shows when projects were last checked, rather than the
current clock time. While updating older project values, it keeps their age visible;
overdue values are marked in amber. Staleness allows the configured foreground or
enabled background interval, at least three minutes, plus 30 seconds of scheduling
grace. The Notices panel uses the same rule. Running project checks are polled every second
so their completed results appear promptly when returning to Orbit.

The last project list, Git status, DDEV and Docker values are saved after each check.
After a restart Orbit shows them immediately, with their original check time, and
replaces them as fresh checks finish. Saved projects are ignored when project
folders or discovery rules change. During the first check after a start, and after
**Refresh**, a thin bar below the top bar shows progress; for projects it counts the
checked repositories. Routine background checks only update the status label. Storage history samples every five minutes, retains six months and
displays the last seven days. At most two folder-size scans run concurrently; each
has a 120-second limit. Incomplete measurements are marked.

Project discovery searches configured roots up to the configured depth, six by
default. Git repositories, DDEV configuration and project files such as
`package.json`, `composer.json`, `pyproject.toml`, `Cargo.toml` or `go.mod` identify
projects. A detected project ends discovery in that subtree to avoid counting its
dependencies or nested repositories. Container folders are split into their projects.
Hidden folders, symbolic links and excluded dependency/build folders are skipped.
Direct folders without project markers can also be included.

Last-changed checks use directory entries directly, read each source file's
modification time once, and honor the configured excluded folders. Uncommitted
edits still count. Hidden folders other than `.ddev`, symlinks, `.log` files and
Orbit's own `data/` directory are excluded.

Folder sizes include dependencies and Git files, but exclude separate Docker
volumes and DDEV databases. APFS clones, snapshots and purgeable space may differ
from Finder's figures or cause shared blocks to be counted more than once.

The Moon adapter reads existing DNS/TLS/HTTP checks performed **from Moon**. An
active service does not guarantee a working application. A logged backup success
is not a new restore test. Orbit performs neither restore tests nor server mutations.
Backup and Review-SMB currently reflect the configured Moon command rather than
generic backup or service discovery. Optional PORTS rows are displayed alongside
the legacy Review-SMB check. See the [adapter format and limits](ai-setup.md#server-status-adapter-and-its-current-limits).
The adapter currently expects the Moon status text format, including its original
German protocol identifiers. These identifiers are retained for compatibility.

## Settings

Settings are organized into Appearance, Tools, Servers, Project folders and Advanced
tabs. Navigation and Save/Cancel stay visible while the selected panel scrolls.
Switching tabs keeps unsaved changes; Save applies all sections together. Appearance opens first. Project folders use compact, expandable rows showing their
path, category and group. Search by any of those values; expand a row to edit its details.

Use the gear button in the sidebar or top bar to configure project folders,
categories, groups, archive defaults, DDEV, Docker/Colima, terminal, editor,
language, appearance, server access, discovery depth, excluded folders and intervals.

English is the default; German is optional. Language changes take effect after
saving. Number and date formats follow the selected language. Native menus update
as well. User-authored content is never translated automatically.

Appearance supports **Light**, **Dark** and **Automatic**, which follows the system.
The independent theme selector offers **Orbit** as the original design, **Ocean**,
**Sand**, **Lavender** and **Graphite**, each in light and dark. Appearance previews
immediately; Cancel restores the saved appearance. Save persists it.

The overview uses a single status strip above recent projects, with attention and
server summaries in a side column. Service lists expand on demand. On smaller
windows the side column stacks below the project list. The full Projects view
retains paths and next-step columns; long paths stay on one line and shorten in
the middle to fit the available width, with the complete path in the tooltip; project notes stay available from each row.

Appearance also provides **Font size** (80–160%), **Contrast** (100–200%) and
**Overall zoom** (70–200%). Font size changes text independently; zoom scales text,
icons and spacing together. Contrast strengthens text and borders using the
selected palette in either light or dark mode. All three default to 100%, preview
immediately and persist only on Save. Settings keep their normal zoom so the controls
remain reachable during preview. Percentages are selected in 5% steps; existing
intermediate values remain available. **Layout density** switches between **Compact**
and **Comfortable** spacing independently of text size and zoom. The slightly wider
sidebar can collapse to icons; its state is retained locally in the browser or native
window. Every page uses a compact header. Cancel restores saved appearance values. **Reset to
100%** resets the three controls without changing your theme or language.


**Detect environment** suggests existing conventional folders and installed tools.
It activates nothing and makes no SSH connection. Fresh copies have no personal
paths or active server checks.

`data/settings.json` uses the schema illustrated by `config.example.json`.
An older `config.json` is migrated once if settings do not yet exist. The original
file remains intact. Existing IDs, categories, groups, archive defaults and notes
are preserved. Missing language settings default to English. SSH uses BatchMode.
The `servers` list supports separate names, SSH aliases, status commands and enabled
states. The Servers page lists enabled connections and shows the selected server’s
services, websites, storage and backups. Direct links retain the selection on reload.
Choose **Show in overview** for each server independently of its checks. A single
selected server shows its name, free disk space and health in the status strip.
Multiple selected servers show a combined count and health, with individual cards
in the side column. Storage focuses on the Mac and local projects. Server disk
values remain on the Servers page and its overview cards. Cards show expandable
services, free space and the last
successful backup. Hidden servers remain available on the Servers page and keep
their checks and attention notices. Each server has its own cached status; a failed
connection retains its own last values. Existing single-server settings migrate
automatically. The original `moon_*` fields remain a compatibility view of the first
enabled server. The status command must be a single executable name or path, without arguments
or shell syntax.

## Development and verification

Python standard library and plain HTML, CSS and JavaScript modules, with no
frontend build step. The [frontend structure](frontend.md) describes the files
and conventions. Source text is English; German text lives in
`static/js/locales/de.js` and applies only to source-owned text. Project names,
paths and notes remain untouched.

```sh
python3 -m unittest discover -s tests -v
npm run check             # module syntax and missing German translations
python3 tests/native.py   # close the installed Mac app first
```

Tests cover Git edge cases, discovery, status parsers, notes, local APIs and
cross-origin protection. Native tests check startup, normal shutdown, forced app
termination and preservation of an independently started backend.

Both browser tests start their own backend with synthetic projects, settings and
command output. They never read your projects, contact a server or need the Mac app.
Playwright is the only development dependency and is not needed to run Orbit:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

An existing Playwright installation works as well:

```sh
ORBIT_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/browser.cjs
ORBIT_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/settings-browser.cjs
```

`tests/browser.cjs` covers sorting, filters, the archive switch, the action key,
dialogs, the Docker, server and storage views and a narrow viewport.
`tests/settings-browser.cjs` covers saving, reopening, validation, detection, both
languages, appearance modes, all themes and a narrow viewport. Screenshots go to
the system's temporary folder as `orbit-*.png`.

## Archive, activity and Git preview

Set **Archived** in a project note and return it to **Active** at any time. Archived
projects are hidden from the project list and Git attention notices by default.
**Show archived** includes them and their archive category. Files are not moved.
Archived projects are no longer actively checked for Git changes, but their sizes
remain included in the storage view.

By default, the newest source-file modification or commit appears first.
Dependencies, Git internals and build folders do not count. Recently copied or
checked-out files may therefore appear recent. Paths are displayed relative to home.

Column headers sort by name, size, Git activity, DDEV, last change and next step.
Click again to reverse direction. Missing values remain at the bottom. Git sorting
prioritizes conflicts, changed entries and local commits.

Clicking an uncommitted Git badge previews up to twelve filenames and statuses.
Larger lists show the remaining count. Untracked folders may appear as one entry.
File contents are not read.

## Terminal and editor

The terminal button opens the configured terminal. Automatic chooses cmux when
available, otherwise Terminal. A selected editor receives its own open button.
cmux reuses a local workspace with exactly the same working directory or creates
one. Its CLI starts the app if needed. Orbit does not execute commands in existing
terminals or perform Git mutations. An accessible cmux CLI is required.

## Docker and Colima

The overview shows free space in Colima's data partition. Details distinguish VM
capacity, physical Colima disk usage on Mac and free Mac space. Docker reports
images, containers, volumes/databases and build cache with estimated reclaimable
space. All registered DDEV projects count, including those outside configured roots.
Unknown values remain explicitly unknown.

Checks do not start containers or delete data. The Docker endpoint is compared
with the Colima profile; different sources are identified. VM data-partition size
is measured directly and may differ from the configured virtual disk size. Mac
usage is based on allocated file blocks.

## Sources and categories

New installations choose their own project folders and categories. Legacy root lists
are converted once into sources. A Work root uses its immediate subfolders as
categories, without customer-specific folder rules. Current settings and manually
assigned category and group names remain unchanged.

Categories, groups, status filters and search can be combined. Archive defaults
apply until a manually saved project state overrides them. Notes survive because
project IDs depend on canonical absolute paths.

A single registered DDEV project under a repository, such as `www`, is associated
with its parent. Multiple sites do not result in a guessed status. Categories can
be selected with buttons or the keyboard.

## Browser app window

Open `http://127.0.0.1:8765/` in Chrome and use its menu to install the page as an app,
named **Orbit Dashboard**. Brave offers a similar option. The shortcut can be opened
through Spotlight. This browser shortcut does not own the backend; configure the
optional launch agent if you want the backend to start at login.

## Open-source preparation

MIT licensing, generic settings and an [AI setup plan](ai-setup-plan.md) are
included. The designed interface remains the product foundation.

Before public release, audit a clean export for personal content and verify AI
setup on a second Mac. The private Git history contains older personal configuration
and must not be published without review. Personal reference tests also need a
release review. Local maintainer rules stay in ignored `AGENTS.local.md`.
A portable, signed app with bundled Python is a separate distribution step.


## Optional SSH collection and project columns

Server settings support explicitly activated automatic SSH queries without installing
anything remotely. Leave the command empty for automatic collection, or keep a custom
command and enable automatic queries to add system and RAM data. Existing servers
keep automatic queries disabled. See [SSH collection](ai-setup.md#opt-in-automatic-ssh-queries)
for permissions, supported systems and retry intervals.

The server view puts system details, storage and backup above services,
websites and ports. Storage includes a usage bar when a numeric percentage is available.
Project tables place Last changed directly after Git status. DDEV appears only when
DDEV checks are configured. Appearance can hide the Next step column; project notes
remain editable using the pencil button.

Appearance → Project columns controls Storage, Last changed, DDEV and Next step.
DDEV still requires a configured integration. Hidden columns do not remove notes or
project data. Last changed displays relative time, such as “2 hours ago”, with the complete local
date and time in its tooltip. It uses the newest file modification or commit, not a record of human
editing. Automatic writes count too; dependency/build folders, Git metadata and `.log` files are excluded.

## Isolated native verification

The build accepts `--output /path/to/Orbit-preview.app` to preserve an installed
Orbit app while testing a clean source export. The native checks accept the same
bundle via `python3 tests/native.py --app /path/to/Orbit-preview.app`. The source
folder and Python interpreter are still referenced by the bundle. Close other
Orbit instances before testing because native instances share port 8765.

## Local background services

Enable **Check local background services** in Settings → Tools. Checks run every
120 seconds by default; change the interval under Advanced. Orbit reads plist
definitions in the standard user, third-party and Apple LaunchAgents/LaunchDaemons
directories, plus `launchctl print` and `print-disabled` for the current GUI user
and system domains. Global agents are shown in the current user's context. User
definitions shadow global agents with the same label. Services without a plist in
these directories, other users' sessions and bundled app helpers are outside this view.

A loaded job with a PID is running. A loaded idle job with a nonzero last exit code
is marked as a failed last run; otherwise it is waiting. Definitions absent from
a readable runtime list are not loaded. Explicit runtime overrides identify disabled
jobs; unavailable runtime data stays unknown. A successful exit code describes the
last reported process result, not application health. No last-run timestamp is inferred.

Cron rows come from the current user's `crontab -l` and readable `/etc/crontab`.
Other users' and root crontabs are not queried. Scheduled means a definition exists;
execution results, daemon health and run times are unknown. Only the first command
token is displayed. Launchd arguments and environment values are omitted.

Origin and execution scope are separate filters. Apple origin follows the system
definition directory. My services includes the current user's cron entries and
launchd programs or scripts located in the user's home folder outside application
bundles and managed directories such as Library, Applications and package data.
This is a path-based inference, not proof of authorship. Merely running as the user
does not qualify a service. Manual own-service choices override detection in either
direction. Under Details, change that classification, add a description and select Favorite. Favorites
appear on Overview. The table shows readable application/script/executable names and
short program names; full program, script and configuration paths stay in Details
and remain searchable. These annotations stay in local settings and never alter job
definitions. Checks use no sudo and never load, unload, start or stop services.
