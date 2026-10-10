# AI-assisted Orbit setup plan

Recorded on October 10, 2026. The setup guide, settings, generic adapters and README prompt are implemented.
The second-Mac verification and public source release remain pending. Every supported
setting must also be editable directly in the app.

Prepare Orbit as an open-source project that a developer can download and unpack,
then ask their AI: "Set this up for my computer." The result should be a useful,
well-designed dashboard with little manual setup.

The main product value is Mathis's interface design. The AI adapts the existing
app to the local environment while preserving that design.

## Scope

- Move personal paths, categories and integrations into documented local settings.
  Preserve the existing installation and its data.
- Detect project folders and installed tools where reliable. Ask focused questions
  when assignments are uncertain.
- Integrate Git, DDEV, Docker, Colima, editor and terminal when available.
  Missing optional tools must not block the basic dashboard.
- Make Moon an optional server integration with configurable SSH target and source.
  Configure server access deliberately.
- Document setup, launch, autostart and verification for AI agents. Start with macOS.
- Default to English, with German selectable in the app. Keep documentation and
  internal developer text in English.

## Agent guidance

A public AGENTS.md and short setup guide cover prerequisites, detection, settings,
permitted changes, verification and missing tools. Example configuration contains
no personal data. Add a setup skill only if it meaningfully simplifies this workflow.

Separate local settings and user data from versioned code. Setup must not modify
project repositories or server services. Preserve existing settings and clarify
uncertain ownership of working-tree changes.

## Completion criteria

An AI can configure a fresh copy on another Mac without Mathis correcting paths or
code manually. The dashboard shows real local projects and available status values,
preserves the design and clearly explains unavailable integrations. The AI verifies
startup and the interface, and reports remaining setup steps.

## Later decisions

After successful setup on other computers, prepare public release and try Orbit
with a few developers. A standalone installer, Windows/Linux support, a general
plugin platform and a commercial offering are later decisions.
