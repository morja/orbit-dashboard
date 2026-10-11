# Source preview releases

Orbit is maintained in the existing public [GitHub repository](https://github.com/morja/orbit-dashboard).
The retired private development history must remain private. Do not initialize fresh
history for subsequent public releases or publish a local checkout containing runtime data.

## Prepare

1. Choose the next preview version and update the README download links.
2. Describe behavior changes, verification and remaining limits in release notes.
3. Regenerate README screenshots with `scripts/capture-screenshots.cjs` when the UI
   changes, using only the synthetic fixture. Inspect them before committing.
4. Use Conventional Commits, including `chore(release): prepare <version>`.
5. Export committed source outside the checkout with `scripts/export-public.py`.
   The exporter rejects tracked personal configuration, keys, logs and databases.
   Review the exact archive; never add `data/`, `AGENTS.local.md`, `.git`, editor
   configuration or private project screenshots to a release.

## Verify the exact export

- Run `python3 -m unittest discover -s tests`, `npm run check` and `npm run test:browser`.
- Review public docs and synthetic screenshots. Preserve known compatibility limits.
- If native code or lifecycle behavior changes, build an isolated app from the export
  with `macos/build.py --output` and run `tests/native.py --app` against it. Close the
  installed app first and use synthetic settings; do not replace personal data.
- A second-Mac setup rehearsal, minimum-version testing and missing-prerequisite
  installation remain separate compatibility checks. Do not claim them without evidence.

## Publish

Package the clean source export into a versioned ZIP and provide `SHA256SUMS.txt`.
Push the release commit, tag its exact revision and create a GitHub prerelease with
those assets. Verify the published tag and assets after upload. Releases remain
macOS source distributions requiring Python 3.10+ and Apple Command Line Tools
for the native window, not standalone signed or notarized applications.

## Automated preview drafts

On GitHub, run **Actions → Prepare source preview → Run workflow** from `main`
and supply a new `vX.Y.Z-preview.N` version. The workflow prepares a clean source
ZIP, checksum and user-facing notes, tests that exact export, and creates a draft
prerelease. It does not run on every push and does not publish the draft automatically.
Review the notes and assets, then publish the draft when the version is ready.

For a local notes preview:

```sh
python3 scripts/release_notes.py --version v0.1.0-preview.4
```

For local packaging, first commit the source and choose a fresh directory outside
this checkout:

```sh
python3 scripts/prepare_release.py --version v0.1.0-preview.4 --output /tmp/orbit-release-candidate
```

The previous reachable version tag defines the change range. `Release-Note:`
footers provide user-facing wording; `Release-Note: none` suppresses internal work.
The workflow supports source previews only. A future standalone distribution needs
its own tested packaging, signing and notarization steps before stable releases.
