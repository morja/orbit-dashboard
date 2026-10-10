# Set up Orbit on a Mac

An AI should be able to configure a fresh Orbit copy for its local user. Preserve
the existing design. Computer-specific settings belong in local configuration and
must also be editable in the app. English is the default language; German is optional.

## Prerequisites and existing data

Read AGENTS.md, inspect existing changes and preserve settings and notes. Check
`python3 --version`; Python 3.10 or newer is required, with no additional packages.
For the native window, check Apple developer tools with `xcrun --find swiftc`.
Report missing tools and agree on installations with the user. Browser mode does
not require the native developer tools.

Git is needed for Git status. DDEV, Docker, Colima, cmux and SSH are optional.
Missing optional tools must not prevent basic dashboard setup.

## Local setup

Build with `python3 macos/build.py`, then open Orbit. Alternatively, run
`python3 server.py` in the foreground and open its printed URL in a browser.
Stop that temporary process after verification.

Choose **Detect environment** in Settings. Detection suggests existing conventional
folders and installed tools. It activates nothing and makes no SSH connection.
The user chooses which folders may be read. Do not search the entire home folder.

Set project folders, categories, groups and archive defaults, then save. An empty
group is derived from subfolders. Archive defaults do not override manually saved
project states. Avoid overlapping sources; the last configured source wins when
a project is discovered more than once.

Without UI interaction, create `data/settings.json` using `config.example.json`
and validate it with `orbit_config.validate`. Do not invent unknown keys. The UI
and JSON file use the same schema. For a running Orbit instance, use local
`GET/POST /api/settings` so changes take effect without restarting. Direct file
changes are loaded on the next launch.

Use `language: "en"` by default; `"de"` selects German. An absent language setting
defaults to English. Preserve user-authored names, categories, paths and notes.

A legacy `config.json` is migrated once if settings do not yet exist. The original
file is preserved. Never overwrite current settings with that legacy file again.
Do not commit local data.

## Optional servers

Use only an existing SSH alias selected deliberately by the user. Fresh installations
have server checks disabled. Add connections to the `servers` list. Each has `label`, `host`, `command` and
`enabled` fields, plus optional `show_in_overview` which defaults to true. The display name and status command are configurable.
The command is one executable name or path, without arguments or shell syntax.
The current adapter expects the Moon status format and retains its protocol
identifiers. Custom commands use the documented adapter. Automatic system queries are an
independent opt-in option and require no installed status command. Make no server changes.

The optional `category_order` list sets the category tab order. Edit it under
Project folders, one existing category name per line. An empty list follows the
configured folder order. User-authored category names are never translated.

Website links are optional per-server mappings in `website_links`, for example
`{"app.example.com": "https://app.example.com/dashboard"}`. They change the link
opened from a website row, not the remote check. Edit them under Servers using
one `website label = URL` line per link. Only HTTP/HTTPS URLs without credentials
are accepted. Defaults contain no personal domains or paths.

Existing saved settings remain authoritative. Legacy root-list migration uses
folder names as categories, honors an explicitly supplied status command and never
invents a user-specific remote path.

## Final verification

- Compare visible projects with the selected folders.
- Reopen Settings and check saved values.
- Close and reopen the app; settings and notes must persist.
- Verify that missing integrations are explained clearly.
- Check English and German, light and dark, and preserve the design.
- In native mode, verify that closing the app stops its owned backend.

Report configured sources and tools, plus missing prerequisites. Do not expose
private notes, keys, credentials or databases.

## Distribution limits

The native window still requires the installed Python interpreter and source
folder. Rebuild after moving the folder or changing interpreters. A standalone,
signed app with a bundled runtime is a later step. Windows and Linux desktop
apps are not yet supported. A separate setup skill is unnecessary at present;
this guide describes the workflow.


## Server status adapter and its current limits

Custom status commands use the existing Moon text protocol. Automatic SSH queries
are a separate opt-in adapter described below. A custom command must start its output with `MOON STATUS` and
provide `DIENSTE`, `SPEICHER` and `BACKUP` sections. `WEBSEITEN` is expected for
website checks; missing results produce a notice. Section names and known German
protocol labels remain unchanged for compatibility, with English UI labels.

Backup data comes entirely from the configured command. Moon's existing command
reports the outcome and timestamps from its own backup logs, schedule and cloud
check. Orbit does not configure backup jobs, infer other backup providers, download
backups or test restores. The overview reads `Letzter Erfolg` from `BACKUP`; the
Server view shows the other reported rows without imposing a fixed schedule.
Keep Moon's current command and backup operation intact. Another installation must
supply equivalent rows from its own backup process, or explicitly report unknown
values. The mandatory BACKUP section is a current adapter limitation.

`GASAMBA REVIEW-SMB` is a legacy check for Moon's Review-SMB TCP endpoint, performed
locally on the server. It does not verify SMB credentials, an SMB session or access
from the developer's computer. Its row is retained in the generic Ports card and
prefixed with `Review-SMB` so its scope remains identifiable.

Commands may also report an optional `PORTS` section. Orbit displays its rows
alongside the legacy check. Labels and values are supplied by the command; separate
them with at least two spaces. For example:

```text
PORTS
  HTTPS · TCP 443          reachable from the server
  Internal API · TCP 8080  listening locally
```

Orbit performs no port scan and opens no new connection for this card. A listening
port, a reachable socket and a working application are different checks. State the
scope in each value, and report failures through the command's `HINWEIS:` rows so
they contribute to server health. Arbitrary custom services and ports must not be
assumed healthy merely because no warning was emitted.


## Opt-in automatic SSH queries

A connection can use a custom status command, automatic queries, or both. Existing
connections default to custom commands with automatic queries off. Moon keeps its
existing command. For a new host, enable Check server, explicitly check Allow
automatic read-only SSH queries, and leave the command empty. Saving grants the
permission. Optional service and port queries need separate checked options.

Orbit sends a fixed shell query through SSH stdin to `sh -s`. It creates no remote
files, installs no packages and never uses sudo. Combined mode invokes the validated
single status executable first, then reads system data in the same SSH connection.
The custom adapter remains authoritative for storage, backups and services. System
data is added, and listening-port rows supplement custom port rows.

Queries run at most once every five minutes, or the longer configured server interval.
Failures increase this delay exponentially up to sixteen times; cached values remain
visible and marked out of date. Manual Refresh also respects this limit. Host key
verification is strict and authentication is noninteractive. Configure trusted SSH
access outside Orbit first; Orbit will not accept a new host key or prompt for passwords.

The first automatic adapter targets Linux: hostname, kernel, IP addresses, uptime,
RAM usage and the home filesystem. Hostname, kernel and disk may also work on other
Unix systems. Missing RAM or disk data produces a notice rather than invented values.
Optional services require systemd; optional listening ports require `ss`. Each list is
limited to 200 entries and reports truncation. Ports describe local listeners, not
external reachability. No port scan runs. Websites and backup success still require
a custom adapter. The whole connection has a 45-second timeout.
