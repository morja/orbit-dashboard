# Optional GoAccess integration

Enable the integration in Settings → Tools → GoAccess integration and apply changes
with the normal Settings Save button. Disable it there to hide Web traffic without
changing server preparation or deleting cached reports. Configure an
existing trusted SSH alias and one read-only export executable. Fresh installs
keep it disabled. The integration has no automatic collector and does not change
servers; Load reports downloads a prepared snapshot on demand. Sequential manual
downloads have no waiting period; overlapping downloads are rejected.

The server exporter writes JSON to stdout with schemaVersion 1 and reports. Each
report has an id matching [a-z0-9-]{1,80}, label, generatedAt ISO timestamp,
status, optional hostname, summary with nonnegative requests/visitors/bandwidth integers, and
optional html containing a base64-encoded self-contained GoAccess HTML report.
Use the same id to replace a report. Visitors are estimates, not exact people.
The Moon preparation imports completed rotations, so reports exclude the current
log until its next rotation. GoAccess retains up to 365 recorded dates, which can span longer when days have no requests.

Orbit caches downloads privately in data/goaccess. A failed import preserves the
previous manifest. The report iframe uses an opaque origin, permits scripts only,
and blocks external connections, forms, navigation and access to the Orbit window.
Reports must use inline scripts and styles. GoAccess's template compiler can
evaluate JavaScript only inside the isolated report; Orbit's own CSP remains
unchanged. Embedded data fonts are allowed, external font requests are blocked. They may contain sensitive request
paths, so never expose the cache publicly. The cache follows Orbit's trusted local
user model rather than adding a separate login.

The integration is split into goaccess_integration.py, the GoAccess view module,
and scoped CSS. Its settings are validated by orbit_config.py. No arbitrary
plugin loading, marketplace or third-party execution API is introduced. Future
integrations can follow the same module boundary before a shared plugin API is
needed. Existing Orbit collectors and the Moon status command are unchanged.

Before changing a server's log format or resetting its GoAccess database, back
up the prepared data and document the effect on historical comparisons.


The Web traffic view defaults to the last 30 calendar days, with 7 days and all
retained history available. Server exports can include periods keyed by "7", "30"
and "all", each with its own summary, startDate/endDate, dataStart/dataEnd and
optional base64 HTML. Counts in the cards and the detailed report use the same
window. Missing dates are not extended backwards to fill the period; older exports
remain available under All until the next download. Current unrotated logs remain
excluded. Visitor counts sum GoAccess's daily estimates, not unique people across
the entire period.

The report renderer preserves the isolated iframe and GoAccess controls. It uses
GoAccess's built-in bright/darkGray themes, full-width panels, 10 rows per page,
visible tables on small screens, readable typography and an inline stylesheet
from static/css/goaccess-report.css. No external theme assets are fetched.
