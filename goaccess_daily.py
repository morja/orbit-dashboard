"""Build private daily content statistics by reading existing combined access logs.

The exporter keeps visitor identities only in memory and never updates GoAccess
databases, web server logs, configuration or services.
"""
from collections import defaultdict
import datetime as dt
import gzip
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
from contextlib import nullcontext
from functools import lru_cache
from zoneinfo import ZoneInfo

from goaccess_pages import content_path


LOG_LINE = re.compile(
    r'^(\S+) \S+ \S+ \[(\d{2})/([A-Za-z]{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] '
    r'"([A-Z]+) (\S+) HTTP/[^" ]+" (\d{3}) \S+ "(?:\\.|[^"\\])*" "((?:\\.|[^"\\])*)"'
)
MONTHS = {name: index for index, name in enumerate(
    ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'), 1)}


def line_date(match, timezone):
    offset = match[8]
    minutes = int(offset[1:3]) * 60 + int(offset[3:5])
    if offset[0] == '-':
        minutes = -minutes
    stamp = dt.datetime(int(match[4]), MONTHS[match[3]], int(match[2]),
                        int(match[5]), int(match[6]), int(match[7]),
                        tzinfo=dt.timezone(dt.timedelta(minutes=minutes)))
    return stamp.astimezone(timezone).date()


def snapshot_lines(source, size=None):
    remaining = size
    while remaining is None or remaining > 0:
        line = source.readline(-1 if remaining is None else remaining)
        if not line:
            break
        if remaining is not None:
            remaining -= len(line)
        yield line.decode('utf-8', errors='replace')


def daily_statistics(log, *, today=None, timezone='Europe/Berlin', days=30):
    zone = ZoneInfo(timezone)
    today = today or dt.datetime.now(zone).date()
    start = today - dt.timedelta(days=days - 1)
    log = Path(log)
    paths = [log] + sorted(path for path in log.parent.glob(log.name + '.*')
                           if re.fullmatch(re.escape(log.name) + r'\.\d+(?:\.gz)?', path.name))
    identities = set()
    secret = secrets.token_bytes(32)
    visitors = defaultdict(set)
    pages = defaultdict(lambda: defaultdict(lambda: {'requests': 0, 'visitors': set()}))
    first_date = None
    invalid = 0
    parsed = 0
    current_read = False
    dates = {}
    cached_path = lru_cache(maxsize=16384)(content_path)

    # Bound reads to the size at open, so a busy current log cannot grow forever.
    # Inodes also prevent a rotation during inspection from counting a file twice.
    for path in paths:
        with path.open('rb') as source:
            info = os.fstat(source.fileno())
            if path == log:
                current_read = True
            identity = (info.st_dev, info.st_ino)
            if identity in identities:
                continue
            identities.add(identity)
            compressed = path.suffix == '.gz'
            context = gzip.GzipFile(fileobj=source) if compressed else nullcontext(source)
            with context as stream:
                for line in snapshot_lines(stream, None if compressed else info.st_size):
                    # A partially written final record is deferred to the next snapshot.
                    if not line.endswith('\n'):
                        continue
                    match = LOG_LINE.match(line)
                    if not match:
                        invalid += 1
                        continue
                    try:
                        # A calendar day cannot change within a logged minute.
                        # Busy logs repeat each minute thousands of times.
                        date_key = (match[2], match[3], match[4], match[5], match[6], match[8])
                        date = dates.get(date_key)
                        if date is None:
                            date = line_date(match, zone)
                            dates[date_key] = date
                    except (ValueError, KeyError, OverflowError):
                        invalid += 1
                        continue
                    parsed += 1
                    if date > today:
                        continue
                    first_date = min(first_date, date) if first_date else date
                    if date < start or match[9] != 'GET' or not 200 <= int(match[11]) < 300:
                        continue
                    path_value = cached_path(match[10])
                    if path_value is None:
                        continue
                    # No IP address, agent string or stable visitor identifier is exported.
                    visitor = hmac.digest(secret, (match[1] + '\0' + match[12]).encode(), hashlib.sha256)
                    visitors[date].add(visitor)
                    page = pages[date][path_value]
                    page['requests'] += 1
                    page['visitors'].add(visitor)

    if invalid and not parsed:
        raise ValueError('Unsupported access log format')
    # Missing older logs are unknown, rather than fabricated zero-traffic days.
    available_start = max(start, first_date) if first_date else today
    result = []
    for offset in range((today - available_start).days + 1):
        date = available_start + dt.timedelta(days=offset)
        rows = [{'path': path, 'requests': value['requests'], 'visitors': len(value['visitors']), 'variants': 1}
                for path, value in pages[date].items()]
        rows.sort(key=lambda row: (-row['requests'], row['path']))
        result.append({'date': date.isoformat(), 'requests': sum(row['requests'] for row in rows),
                       'visitors': len(visitors[date]), 'rows': rows, 'partial': bool(invalid)})
    return {'timezone': timezone, 'scope': 'successful-content-get', 'includesCurrentLog': current_read,
            'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'days': result}
