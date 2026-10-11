# Release readiness review

Reviewed on 10 October 2026 for a first macOS source developer preview.

## Result

The source candidate is prepared for publication with fresh Git history. Local
checks passed against an exported copy. A second-Mac installation and AI-assisted
setup rehearsal remain the final recommended check before announcing the preview.
The public source repository is [morja/orbit-dashboard](https://github.com/morja/orbit-dashboard).
The first prerelease is `v0.1.0-preview.1`; the second-Mac rehearsal remains open.

## Verification

- 50 Python tests passed, including clean-export exclusions and rejection of dirty
  source or tracked private configuration.
- 22 frontend modules passed syntax and English/German translation checks.
- Dashboard and settings browser checks passed on the clean export, covering filters,
  sorting, local persistence, actions, both languages, appearance and narrow layouts.
  One initial localhost fixture load timed out; the unchanged full run passed on retry.
- A separate native app built successfully from the export. Native WebKit interaction,
  normal shutdown, forced-exit cleanup and preservation of an independently started
  backend passed using synthetic projects, with server and container checks disabled.
- Local documentation links resolve. README screenshots use synthetic projects,
  reserved example domains and documentation IP addresses; two representative images
  were visually reviewed again. The images still match the current layout.
- Tracked text was scanned for private paths/domains, common credential formats,
  embedded private keys and credential assignments. No matches were found. Local
  settings, keys, notes, databases, editor files and development history are excluded.

The verification machine ran macOS 27.0.1 with Python 3.14.8 and Node 26.10.0.
The native build used the installed Apple developer tools. Browser checks used
locally installed Chrome through Playwright. This does not establish compatibility
with every supported Python version, older macOS releases or a second Mac.

## Scope and remaining limits

- Publish as a source developer preview. Python 3.10+ and Apple Command Line Tools
  are prerequisites for the native window. The bundle references its source folder
  and interpreter. Signed, notarized, standalone downloads are future distribution work.
- Fresh defaults include no project sources, enabled optional tools or server access.
  Automatic SSH queries require explicit activation and existing trusted SSH access.
- Custom server status commands retain the documented Moon-compatible text protocol.
  Backup and legacy SMB rows are optional integration data, not universal defaults.
  The automatic adapter primarily targets Linux and can run independently.
- Native instances use a single local port. Do not run the preview alongside an
  installed Orbit instance while testing. Read-only data is available to trusted
  local processes, as explained in the README.
- The public repository uses fresh history and its own GitHub remote.
  The remaining setup verification is a README/AI prompt rehearsal on a second Mac.

See [the release checklist](release-checklist.md) for exporting and publishing.

## Public-repository onboarding rehearsal

On 10 October 2026, two new copies were cloned anonymously over HTTPS from the
public GitHub repository. A Python virtual environment without pip or third-party
packages was used. Source folders contained spaces. No existing Orbit data was copied.

The real browser backend, rather than a stubbed fixture server, was exercised with
synthetic project folders. English defaults scanned nothing and enabled no optional
integration. In-app configuration selected only the intended project; settings,
project IDs and notes survived backend reopening. Environment detection made no
configuration changes. Git status remained clean after setup.

The README AI workflow was rehearsed separately: read project instructions, check
prerequisites, suggest conventional folders, choose a synthetic workspace, validate
`config.example.json` and save only local settings. The real backend loaded that
configuration and retained notes and settings after reopening. No project Git
operations, container operations or SSH activation were needed during setup.

One native issue was found: WebKit's transient website data store discarded local
filter/sort choices on app quit. Developer Preview 2 uses the persistent store. A
regression check failed against the original store and passed with the fix across
two separate native processes. The native build and lifecycle were tested using an
isolated app identity and the virtual environment's interpreter.

This is a clean local setup rehearsal, not a second-Mac or clean macOS installation.
Python and Apple developer tools were already installed. Missing-prerequisite
installation and compatibility with the minimum Python version remain unverified.

## Developer Preview 3

Prepared on 11 October 2026 from the maintained public checkout. This preview adds
Local Services, the shared Git status window, mini previews and shared typography.
All four public README screenshots were regenerated from synthetic fixture data;
the light/dark overview images were visually reviewed. Conventional Commits are
now documented in AGENTS.md and CONTRIBUTING.md. Existing Git history is preserved.

The release checklist now describes subsequent releases from the public repository
rather than repeating the first-publication history reset. The source ZIP is built
from a clean committed export; run Python, frontend and browser checks against that
exact export before publishing. Native code is unchanged from Preview 2, so this
release retains its native-lifecycle evidence and compatibility limits rather than
claiming another native build or a second-Mac rehearsal.
