# README screenshots

All images are generated from `tests/serve_dashboard_fixture.py`, with synthetic
projects, localhost-only fixture data and reserved example domains. No live
workspace, database, server, settings or action key is included in the images.

Run after installing the browser-test dependencies:

```sh
node scripts/capture-screenshots.cjs
```

The script captures both appearance modes, Docker/DDEV and server details using
Chromium. Inspect the resulting PNG files before committing them. The optional
`ORBIT_PLAYWRIGHT_MODULE` and `ORBIT_BROWSER_EXECUTABLE` environment variables work
as in the browser checks. The fixture is stopped when capture finishes.
