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

## Commit messages

Use Conventional Commits for new work:

```text
feat(git): add recent commit history
fix(ui): keep Git status dialog size stable
docs: clarify local setup requirements
chore(release): prepare v0.1.0-preview.3
```

The format is `type(scope): description`; scope is optional. Use a short English
imperative description without a final period. Supported types are `feat`, `fix`,
`docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`.
Use `!` before the colon and a `BREAKING CHANGE:` footer for incompatible changes.
These conventions apply to new commits; published history is preserved.

Use [the release checklist](docs/release-checklist.md) to prepare a clean source
preview, validate its exact export and publish it to the existing public repository.
Local maintainer instructions and runtime data must remain private.

## User-facing release notes

Automatic notes include `feat`, `fix` and `perf`, excluding tooling/build/CI scopes.
Other commit types remain internal unless they carry an explicit user-facing note.
Use a single-line footer when the commit subject is too technical:

```text
fix(ui): retain dialog bounds across panel updates

Release-Note: The Git status window stays the same size when switching tabs.
```

`Release-Note: none` omits a change. A breaking commit must explain the user impact
and migration in its note. Notes group changes into New, Fixed, Performance,
Changed and Breaking changes, deduplicating identical descriptions. They never
include a raw commit dump. Review the generated notes before publication.
