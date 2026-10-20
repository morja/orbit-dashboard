"""Read page request counts from prepared GoAccess HTML without executing scripts."""
from html.parser import HTMLParser
import json
import re
from urllib.parse import unquote, urlsplit


# Match file types, rather than every dotted path: article slugs may contain dots.
ASSET_EXTENSION = re.compile(
    r'\.(?:avif|bmp|css|csv|eot|gif|gz|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|'
    r'otf|pdf|png|rss|svg|tar|tiff?|ttf|txt|wav|webm|webmanifest|webp|woff2?|xml|zip)$',
    re.IGNORECASE,
)
TECHNICAL_PATH = re.compile(
    r'^/(?:admin|api|assets|build|cgi-bin|css|fonts|images|img|js|storage|vendor|'
    r'livewire(?:-[^/]+)?|filament|_debugbar|_ignition|\.well-known|wp-admin|wp-json|wp-includes|wp-content)'
    r'(?:/|$)|^/language(?:/|$)|^/(?:login|logout|signin|signout|health|healthz|'
    r'up|metrics|server-status|wp-login\.php|wp-cron\.php|xmlrpc\.php|robots\.txt|favicon[^/]*|sitemap[^/]*)(?:/|$)|^/\.',
    re.IGNORECASE,
)
ASSIGNMENT = re.compile(r'\b(?:var|let|const)\s+(?:json_data|appData)\s*=\s*')


class ReportDataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.in_script = False
        self.parts = []
        self.payload = None

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.in_script = not dict(attrs).get('src')
            self.parts = []

    def handle_data(self, data):
        if self.in_script:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag != 'script' or not self.in_script:
            return
        self.in_script = False
        script = ''.join(self.parts)
        self.parts = []
        for match in ASSIGNMENT.finditer(script):
            try:
                payload, end = json.JSONDecoder().raw_decode(script, match.end())
            except (ValueError, RecursionError):
                continue
            # Accept a JSON literal only. Never evaluate JavaScript expressions.
            remainder = script[end:].strip()
            if (not remainder or remainder.startswith(';')) and isinstance(payload, dict):
                if isinstance(payload.get('requests'), dict):
                    self.payload = payload
                    return


def count(value):
    value = value.get('count', value.get('value')) if isinstance(value, dict) else value
    return value if type(value) is int and 0 <= value <= 9_007_199_254_740_991 else None


def page_path(value):
    """Normalize query variants, but preserve case, trailing slashes and stored text."""
    if not isinstance(value, str) or not value.startswith('/') or value.startswith('//'):
        return None
    if len(value) > 8192 or any(ord(char) < 32 for char in value):
        return None
    try:
        return urlsplit(value).path or '/'
    except ValueError:
        return None


def page_requests(body):
    unavailable = {'available': False, 'rows': [], 'requests': 0, 'excludedRequests': 0, 'partial': False}
    if not body or len(body) > 10_000_000:
        return unavailable
    parser = ReportDataParser()
    try:
        parser.feed(body.decode('utf-8', errors='replace'))
        parser.close()
    except (ValueError, RecursionError):
        return unavailable
    if parser.payload is None:
        return unavailable
    panel = parser.payload['requests']
    rows = panel.get('data')
    if not isinstance(rows, list):
        return unavailable
    if any(isinstance(row, dict) and 'method' not in row for row in rows):
        return unavailable

    pages = {}
    excluded = 0
    incomplete = False
    for row in rows:
        if not isinstance(row, dict):
            incomplete = True
            continue
        hits = count(row.get('hits'))
        path = page_path(row.get('data'))
        if hits is None or path is None:
            incomplete = True
            continue
        decoded = unquote(path)
        # Locale prefixes do not make an admin or asset URL an article.
        classified = re.sub(r'^/(?:en|de)(?=/|$)', '', decoded, flags=re.IGNORECASE) or '/'
        if row.get('method') != 'GET' or ASSET_EXTENSION.search(decoded) or TECHNICAL_PATH.search(classified):
            excluded += hits
            continue
        page = pages.setdefault(path, {'path': path, 'requests': 0, 'visitors': None, 'variants': 0})
        page['requests'] += hits
        page['variants'] += 1
        # Query/protocol variants can share visitors. Adding them would overcount.
        page['visitors'] = count(row.get('visitors')) if page['variants'] == 1 else None

    metadata = panel.get('metadata', {})
    data_metadata = metadata.get('data') if isinstance(metadata, dict) else None
    total = count(data_metadata.get('total')) if isinstance(data_metadata, dict) else None
    partial = incomplete or total is None or total > len(rows)
    result = sorted(pages.values(), key=lambda page: (-page['requests'], page['path']))
    return {'available': True, 'rows': result, 'requests': sum(page['requests'] for page in result),
            'excludedRequests': excluded, 'partial': partial}
