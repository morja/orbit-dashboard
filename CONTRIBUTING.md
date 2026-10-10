# Contributing to Orbit

Orbit is a local developer dashboard licensed under MIT. Contributions should
improve setup on other computers and everyday project visibility while preserving
the existing design. Read README.md and AGENTS.md first.

Use English for documentation, source comments, internal messages and the default
interface. German is an optional interface language. Keep source-owned translations
in `static/js/locales/de.js` and follow [the frontend conventions](docs/frontend.md);
never translate user-authored data automatically.

Validate configuration and expose every supported setting in the app. Use synthetic
data in tests. Collectors read project state without Git mutations or server changes.
Run relevant checks, and verify UI changes in both languages and light/dark modes.

Explain the concrete problem, resulting behavior and validation in change proposals.
Do not contribute personal paths, notes, logs, databases or credentials.

## Before public release

- Audit a clean export for personal content. The private development history
  contains older personal configuration and needs review before publication.
- Use the release checklist in docs/release-checklist.md. Keep local maintainer rules private.
- Verify AI setup on a second Mac.
- Add the public repository address and download instructions.
- Distinguish source distribution from a future standalone signed app.
