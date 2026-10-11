# Release strategy

Orbit currently ships macOS source previews for developers. The native window
uses an external Python interpreter and source checkout. Keep this status explicit
until installation is repeatable on another Mac and the distribution is self-contained.

Commit each coherent change using Conventional Commits. Group several related
changes into a tested release rather than publishing every commit. Manually start
the preview workflow when a useful version is ready. The workflow creates a draft
with filtered notes and verified source assets; publication remains a deliberate step.
No version bump or public release is triggered merely by pushing a fix or feature.

Continue the current preview sequence for source-only iterations. A self-contained
installable Mac app should first go through beta releases. Stable 1.0 should represent
reliable installation, upgrades preserving settings/notes, lifecycle behavior,
clear compatibility and tested use beyond the maintainer's own machine.
Version labels describe readiness, not the number of commits or features.

A distributable native app needs bundled runtime/resources, predictable data paths,
architecture coverage, signing, notarization and a documented upgrade path. Signing
alone does not remove the current dependency on the source checkout and Python.
The existing Swift/Python architecture can be evaluated for packaging before any
framework rewrite. Direct GitHub distribution suits the present developer audience;
a Mac App Store launch is a separate product decision.

The MIT open-source model suits a local workspace tool: users can inspect what is
read, adapt collectors and contribute fixes. Keep optional server access explicit,
provide clear installation instructions and scope the supported platforms. Avoid
implying support for arbitrary environments before testing them. Packaging and a
small external testing group are the next distribution priorities.
