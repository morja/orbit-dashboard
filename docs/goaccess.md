# Optional GoAccess integration

Enable the integration in Settings → Tools → GoAccess integration and apply changes
with the normal Settings Save button. Disable it there to hide Web traffic without
changing server preparation or deleting cached reports. Configure an
existing trusted SSH alias and one read-only export executable. Fresh installs
keep it disabled. The integration has no automatic collector and does not change
servers; Load reports downloads a prepared snapshot on demand. Sequential manual
downloads have no waiting period; overlapping downloads are rejected.
Opening Web traffic reads the saved local copy and never starts an SSH download,
including after app startup. The Load reports button shows a loading state and
is disabled while that local read or a manual download is in progress.

The server exporter writes JSON to stdout with schemaVersion 1 and reports. Each
report has an id matching [a-z0-9-]{1,80}, label, generatedAt ISO timestamp,
status, optional hostname, summary with nonnegative requests/visitors/bandwidth integers, and
optional html containing a base64-encoded self-contained GoAccess HTML report.
Use the same id to replace a report. Visitors are estimates, not exact people.
Prepared aggregate reports import completed rotations, so they exclude the current
log until its next rotation. The optional daily extension below also reads the
current log. GoAccess retains up to 365 recorded dates, which can span longer when
days have no requests.

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

## Page overview

Web traffic opens the first saved website in **Visited pages**. This view reads
the JSON request panel embedded in the selected period's HTML report, without
running its scripts or contacting the server. Existing cached reports work without
a new export. The **Technical report** button opens the original isolated report.

The page table shows GET request counts and GoAccess's estimated visitors per
content path. Asset extensions, asset directories, Livewire endpoints, language
switches, API routes, admin pages and common health/authentication endpoints are
excluded, including under `/en` and `/de`. These are path-based classification
rules, not evidence that a human read a page. Downloads such as PDFs are excluded
from this content overview and remain available in the technical report.

Search, sort and pagination operate on the saved data. Query strings are removed
so campaign variants share one path. The optional English/German grouping removes
only the leading `/en` or `/de` prefix and adds request counts; it does not translate
stored paths. Case and trailing slashes remain distinct. Visitors are never added
across query, protocol or language variants because those audiences can overlap;
combined rows show an em dash instead. There is no summed visitor metric for pages.

The website cards explicitly show **All requests**, including technical traffic.
The page overview's **Page requests** and **Different pages** metrics use the filtered
URL rows, independent of search and pagination. GoAccess's embedded request panel
does not contain per-URL response statuses or bot identities, so bots, redirects
and failed requests can remain in these estimates. In particular, `/` can include
redirects. Current unrotated logs remain excluded, as for the technical report.

When GoAccess exports fewer rows than its request metadata declares, the overview
shows a partial-data notice and totals only available rows. Missing or unsupported
embedded data shows an unavailable message rather than a zero-traffic claim. To
retain more URLs in future reports, review GoAccess's `--max-items` setting in the
server's report preparation; Orbit does not change it or reconstruct missing history.

## Daily visitors and pages

Choose **Today**, **Yesterday** or **Specific day** in the period selector, or
select a bar in **Visitors by day**. Website cards and the page table then use the
same calendar date. The chart shows up to 30 available days, or seven in the
seven-day range. The server's reporting timezone determines day boundaries; the
timezone and snapshot timestamp appear beside the chart. Missing dates display
unavailable values, never an invented zero. A recorded empty day displays zero.

Existing HTML exports can provide daily visitor totals from their `visitors`
panel. They cannot provide the URLs visited on each day. Orbit clearly labels this
fallback as all traffic and explains that page details require the daily export.
It never presents aggregate URL counts as a daily breakdown.

### Optional server export extension

`goaccess_daily.py` reads current and rotated combined-format logs, including gzip
rotations. It exports the last 30 calendar days that available logs cover. The
current log is read to its size at opening, with incomplete trailing records
deferred until the next snapshot. Inode checks prevent a rotation or hard link
from counting the same file twice. It does not mutate the logs or GoAccess database.
Readable current logs are required; a missing file or unsupported format reports
daily data as unavailable instead of reporting zero visitors.

Daily page counts include successful GET responses to content paths, using the
same path classifier as the aggregate overview. Assets, technical endpoints,
redirects and errors are excluded. Visitors are estimates of distinct address
and user-agent combinations per day. Each visitor is counted once across that
day and once per page, including query variants. Bots can remain. Addresses and
agent strings stay in memory on the server; only counts and paths are exported.
The temporary HMAC identities used for counting are never exported or persisted.

The two parts have separate responsibilities. GoAccess continues to prepare the
aggregate HTML reports. The Python extension calculates daily statistics directly
from logs because those HTML reports do not retain the date of each URL request.
The existing SSH executable returns both kinds of data. Orbit validates the
response, saves a private local copy and displays it without any further SSH call
when a day or page filter changes. No website tracking script is needed.

### Set up another server

The extension is reusable Python code distributed with Orbit under the repository's
MIT license. It is an optional server component installed manually, rather than
an automatically installed Orbit plugin. It needs Python 3.10 or newer, the IANA
timezone database, readable combined-format access logs and existing trusted SSH
access. The default reporting timezone is `Europe/Berlin` and the daily window is
30 calendar days. Other log formats need an adapted reader.

For the prepared-report exporter with `export_snapshot()` and a `sites` mapping,
the manual installer can add the extension. That function must build a `manifest`
with `reports`, end with `print(json.dumps(manifest))`, and use a `sites` mapping
keyed by report ID with each site's log path in `site['log']`. The installer checks
its supported source marker before making changes. It does not create a complete
exporter or configure GoAccess for a new server. Other exporters can produce the
daily protocol described below directly.

Keep an Orbit source checkout on the server, review its installer and run from
that checkout using the path to the existing exporter:

```sh
python3 scripts/install-goaccess-daily.py /path/to/reports.py
```

Review and authorize installation on the server separately. The installer copies
`goaccess_daily.py` and `goaccess_pages.py` alongside the exporter and backs up
replaced sources before atomic replacement. It extends only the read-only export
path, preserving existing import, scheduling, persistent history and report
generation. The export reads logs on demand when **Load reports** is clicked;
it creates no daily database, background service or tracking script. Repeated
downloads recompute counts from the available logs without importing them twice.

The extension omits redundant top-level HTML when an all-history period already
contains the report. Existing report files remain on the server. Orbit uses SSH
compression and retains its existing download size and timeout limits. Large log
collections can take tens of seconds to scan, so the button shows a loading state.

In Orbit, configure the existing trusted SSH alias and export executable under
**Settings → Tools → GoAccess integration**. Keep the command as one executable,
without arguments or shell syntax. Click **Load reports**, select a website and
choose **Today**. The chart should show its timezone and snapshot time, and the
page table should match that day. Click **Load reports** again after sharing a
page to measure subsequent traffic. This is an on-demand snapshot, not a live feed.

If only old HTML reports are available, daily totals still work but the page
breakdown explains that a daily export is required. Missing log permissions or
an unsupported format leave daily data unavailable. A malformed download preserves
the previous local copy. Check the export account's existing log read access;
Orbit does not elevate privileges or change permissions on access logs.

To undo the extension, restore the exporter's matching
`reports.py.before-daily-<hash>` backup to its original path and retain its original
permissions. The helper modules can remain unused. This does not reset GoAccess
history, delete reports or change scheduled jobs. Review and test the restored
export before downloading it into Orbit.

### Daily export protocol

The optional per-report `daily` protocol field contains `scope` set to
`successful-content-get`, an IANA `timezone`, `includesCurrentLog`, a timezone-aware
`generatedAt`, and `days`. Each day has an ISO `date`, `requests`, `visitors`, optional
`partial`, and `rows` with `path`, `requests` and `visitors`. Counts must be
nonnegative integers. Day request totals must equal the sum of page requests;
day visitors must be consistent with the per-page estimates. Import validation
rejects malformed dates, duplicate dates/paths, technical paths and inconsistent
counts atomically, preserving the previous local snapshot. Daily page rows are
cached privately in content-addressed files; the overview API returns only day
summaries. URL requests for a date never execute SSH or read remote logs.
