# Orbit's technical foundation

The first open-source version retains the Python standard library, HTML/CSS,
JavaScript and a small Swift shell for macOS.

Python handles local collectors, settings validation, SQLite and the HTTP API.
The frontend requires no build step. Swift provides the window and manages its
owned backend. This simple structure supports AI-assisted setup and preserves
the designed interface.

The build uses its calling interpreter rather than a fixed Homebrew path.
The interpreter and source folder remain external prerequisites. Runtime bundling,
signing and updates need separate work.

Tauri is a possible later option for multiple operating systems. It supports
external programs as sidecars but requires Rust and platform-specific builds.
The Python collectors could remain. See the [Tauri sidecar documentation](https://v2.tauri.app/develop/sidecar/)
and [Python on macOS](https://docs.python.org/3/using/mac.html).

Reconsider the shell when distribution requirements and additional operating
systems are concrete. Current setup and configuration work does not require a
complete rewrite.
