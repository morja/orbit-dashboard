# Orbit Dashboard

Read README.md and docs/ai-setup.md before setting up Orbit. If AGENTS.local.md
exists, read it for local maintainer instructions.

Use English for documentation, README files, comments, internal messages and the
default interface unless explicitly requested otherwise. German is an optional
interface language. Never translate user-authored content or stored data automatically.
Keep translations in static/js/locales/de.js and follow docs/frontend.md;
run `npm run check` after frontend changes.

Preserve the existing dashboard design and light/dark colors. Local customization
belongs in data/settings.json, not hardcoded paths or source code edits. Every
supported setting must be editable in the app and validated by orbit_config.py.

Preserve existing settings, manually changed files and personal notes. Do not
repeat a legacy config.json migration when data/settings.json already exists.
Project IDs depend on canonical absolute paths. Verify migration preserves IDs,
categories, groups and archive defaults.

Collectors must not modify project repositories, fetch/pull or change remote
services. Use argument arrays, local-only HTTP binding and origin checks.
State-changing requests require the X-Orbit-Key header from data/action.key; never
print or commit that key. Remote
SSH commands are single executables, without arguments or shell syntax. Keep
credentials, production data, logs and databases out of Git and tool output.

Separate larger code blocks with blank lines and comment where helpful. Run the
relevant unit tests and JavaScript syntax checks. For dashboard changes, run the synthetic
tests/browser.cjs checks. For settings changes, run the
synthetic settings-browser.cjs checks in both languages, light/dark appearance and a narrow viewport.

The native Mac app starts server.py --managed when opened and stops its owned
process group when closed. Static changes need a reload; backend changes need
an app restart; native changes need a rebuild. Do not leave a manual production
backend running. Synthetic fixture servers are allowed for isolated checks.
