# First public release

See [the latest readiness review](release-readiness.md) for validation and remaining limits.

## First preview

Public repository: [morja/orbit-dashboard](https://github.com/morja/orbit-dashboard).
The first source prerelease is `v0.1.0-preview.1`. Fresh history, clean exports and
local verification are complete. The second-Mac setup rehearsal remains open.
The steps below also apply when preparing later candidates.

## Prepared

- MIT license, English documentation and optional German interface.
- Generic settings, optional tools and explicitly enabled SSH collection.
- AI setup guide and a copyable setup prompt in the README.
- Synthetic screenshots and tests; local settings, keys and databases excluded.
- Website link overrides belong to per-server settings. No personal domain behavior.

## Before going live

- Verify the native install and AI setup workflow on a second Mac, including missing
  tools, reopening and backend shutdown. Record macOS/Python versions tested.
- Export committed source with `python3 scripts/export-public.py /path/to/new/folder`.
  The exporter rejects tracked local artifacts and never copies history. Do not copy `.git`, local data,
  `config.json`, `AGENTS.local.md`, editor settings or screenshots of real projects.
- Review the exact export for personal content and credentials. The private GitLab
  history contains old personal configuration and must remain private.
- Initialize fresh Git history and create the public GitHub repository only when
  the user chooses to go live. Add its actual URL and source download instructions.
- Run Python, frontend and browser checks from that exact export.
- Regenerate and inspect screenshots if the visible interface has changed.
- Tag the first developer preview and state the source/Python requirement clearly.

The private GitLab repository remains the development archive. Do not rewrite or
publish its history. A bundled Python runtime, signing, notarization and updates
are separate distribution work, not prerequisites for a source preview.

## Preparing a candidate

Use a new folder outside the development checkout. An existing destination is
never overwritten. Commit tracked changes first; ignored local data does not enter
the export. Run the documented checks from that folder. Build an isolated native
app with `python3 macos/build.py --output /path/to/Orbit-preview.app` and test with
`python3 tests/native.py --app /path/to/Orbit-preview.app`. Close other Orbit
instances first because the native app uses port 8765. Use synthetic project
settings for this check, then remove the test data before preparing Git.

After reviewing the exact candidate, initialize Git locally with a new root commit.
Do not copy `.git`, add a GitLab remote, or push the private development branch.
The new repository must have exactly one root commit and no remote until public
publication is explicitly requested. Adding the GitHub URL and tagging the public
preview happens at publication time.
