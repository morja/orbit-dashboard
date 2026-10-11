"""Validated local settings, explicit discovery and migration of the personal setup."""
from pathlib import Path
import copy
import json
import os
import re
import shutil
import tempfile
from urllib.parse import urlsplit


EXCLUDED = ['node_modules', 'vendor', 'build', 'dist', 'target', 'Pods', 'DerivedData', '__pycache__']
INTERVALS = {'mac': 30, 'projects': 60, 'moon': 120, 'ddev': 60, 'docker': 120, 'sizes': 3600, 'services': 120}
TERMINALS = ['auto', 'cmux', 'Terminal', 'iTerm', 'none']
EDITORS = ['none', 'Visual Studio Code', 'Cursor', 'PyCharm', 'IntelliJ IDEA']
PALETTES = ['orbit', 'ocean', 'sand', 'lavender', 'graphite']


def defaults():
    return {'version': 1, 'sources': [], 'servers': [], 'category_order': [], 'scan_depth': 6, 'excluded_dirs': EXCLUDED.copy(),
            'moon_enabled': False, 'moon_host': '', 'moon_command': 'moon-status', 'moon_label': 'Server',
            'services_enabled': False, 'service_preferences': {}, 'ddev_enabled': False, 'docker_enabled': False, 'terminal': 'auto', 'editor': 'none',
            'intervals': INTERVALS.copy(), 'ui_refresh': 10, 'theme': 'system', 'palette': 'orbit', 'language': 'en',
            'font_size': 100, 'contrast': 100, 'zoom': 100, 'density': 'compact', 'remember_list_preferences': True, 'show_next_step': True, 'show_storage': True, 'show_last_changed': True, 'show_ddev': True}


def text(value, name, maximum=200):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f'{name}: invalid text')
    return value.strip()


def validate(data):
    if not isinstance(data, dict) or set(data) - set(defaults()):
        raise ValueError('Unknown settings')
    result = defaults()
    result.update(copy.deepcopy(data))
    if type(result['version']) is not int or result['version'] != 1:
        raise ValueError('Unsupported configuration version')
    sources = result['sources']
    if not isinstance(sources, list) or len(sources) > 100:
        raise ValueError('A maximum of 100 project folders is supported')
    normalized = []
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or set(source) - {'path', 'category', 'group', 'archived', 'plain_folders'}:
            raise ValueError('Invalid project folder')
        path = Path(text(source.get('path'), 'Path', 4096)).expanduser()
        if not path.is_absolute():
            raise ValueError('Project paths must be absolute or start with ~/')
        path = str(path.resolve())
        if path in seen:
            raise ValueError('Duplicate project folder')
        seen.add(path)
        archived = source.get('archived', False)
        if type(archived) is not bool:
            raise ValueError('Archived must be a boolean')
        plain = source.get('plain_folders', True)
        if type(plain) is not bool:
            raise ValueError('Folder discovery must be a boolean')
        normalized.append({'path': path, 'category': text(source.get('category', 'Projects'), 'Category', 80) or 'Projects',
                           'group': text(source.get('group', ''), 'Group', 80), 'archived': archived, 'plain_folders': plain})
    result['sources'] = normalized
    order = result['category_order']
    if not isinstance(order, list) or len(order) > 100:
        raise ValueError('Category order must be a list of up to 100 names')
    result['category_order'] = list(dict.fromkeys(text(name, 'Category', 80) for name in order if name))
    if type(result['scan_depth']) is not int or not 1 <= result['scan_depth'] <= 12:
        raise ValueError('Search depth must be between 1 and 12')
    excluded = result['excluded_dirs']
    if not isinstance(excluded, list) or len(excluded) > 100:
        raise ValueError('Invalid excluded folders')
    excluded = [text(name, 'Folder name', 100) for name in excluded]
    result['excluded_dirs'] = list(dict.fromkeys(excluded))
    for name in excluded:
        if not name or '/' in name or name in ('.', '..'):
            raise ValueError('Exclusions must be individual folder names')
    for key in ('services_enabled', 'moon_enabled', 'ddev_enabled', 'docker_enabled', 'remember_list_preferences', 'show_next_step', 'show_storage', 'show_last_changed', 'show_ddev'):
        if type(result[key]) is not bool:
            raise ValueError(f'{key} must be a boolean')
    preferences = result['service_preferences']
    if not isinstance(preferences, dict) or len(preferences) > 1500:
        raise ValueError('Invalid service preferences')
    for key, item in preferences.items():
        if not re.fullmatch(r'[a-f0-9]{20}', key) or not isinstance(item, dict) or set(item) - {'favorite', 'own', 'description'}:
            raise ValueError('Invalid service preferences')
        for flag in ('favorite', 'own'):
            if type(item.get(flag, False)) is not bool:
                raise ValueError('Invalid service preferences')
        item['description'] = text(item.get('description', ''), 'Service description', 500)
    host = text(result['moon_host'], 'SSH alias')
    if host and (not re.fullmatch(r'[a-zA-Z0-9_.-]+', host) or host.startswith('-')):
        raise ValueError('Invalid SSH alias')
    result['moon_host'] = host
    remote = text(result['moon_command'], 'Status command', 4096)
    # SSH joins remote arguments into a shell command. Accept a single executable only.
    if not re.fullmatch(r'[a-zA-Z0-9_./-]+', remote) or remote.startswith('-'):
        raise ValueError('Status command must be a single executable name or path')
    result['moon_command'] = remote
    result['moon_label'] = text(result['moon_label'], 'Server name', 80) or 'Server'
    if result['moon_enabled'] and not host:
        raise ValueError('Provide an SSH alias to enable server checks')
    servers = result['servers']
    if not isinstance(servers, list) or len(servers) > 30:
        raise ValueError('A maximum of 30 servers is supported')
    if not servers and result['moon_enabled']:
        servers = [{'label': result['moon_label'], 'host': host, 'command': remote, 'enabled': True}]
    normalized_servers = []
    identities = set()
    for item in servers:
        if not isinstance(item, dict) or set(item) - {'label', 'host', 'command', 'enabled', 'show_in_overview', 'automatic', 'probe_services', 'probe_ports', 'website_links'}:
            raise ValueError('Invalid server')
        alias = text(item.get('host', ''), 'SSH alias')
        executable = text(item.get('command', 'moon-status'), 'Status command', 4096)
        show_in_overview = item.get('show_in_overview', True)
        if type(show_in_overview) is not bool:
            raise ValueError('Server overview visibility must be a boolean')
        enabled = item.get('enabled', False)
        if type(enabled) is not bool:
            raise ValueError('Server enabled must be a boolean')
        if alias and (not re.fullmatch(r'[a-zA-Z0-9_.-]+', alias) or alias.startswith('-')):
            raise ValueError('Invalid SSH alias')
        if enabled and not alias:
            raise ValueError('Provide an SSH alias to enable server checks')
        automatic = item.get('automatic', False)
        probe_services = item.get('probe_services', False)
        probe_ports = item.get('probe_ports', False)
        if any(type(flag) is not bool for flag in (automatic, probe_services, probe_ports)):
            raise ValueError('Automatic SSH options must be booleans')
        if (probe_services or probe_ports) and not automatic:
            raise ValueError('Enable automatic SSH queries before service or port queries')
        if enabled and not executable and not automatic:
            raise ValueError('Enable automatic SSH queries or provide a status command')
        if executable and (not re.fullmatch(r'[a-zA-Z0-9_./-]+', executable) or executable.startswith('-')):
            raise ValueError('Status command must be a single executable name or path')
        identity = (alias, executable)
        if alias and identity in identities:
            raise ValueError('Duplicate server connection')
        identities.add(identity)
        links = item.get('website_links', {})
        if not isinstance(links, dict) or len(links) > 100:
            raise ValueError('A maximum of 100 website links is supported per server')
        clean_links = {}
        for label, url in links.items():
            label = text(label, 'Website label', 200)
            url = text(url, 'Website URL', 4096)
            parsed = urlsplit(url)
            if not label or parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in url):
                raise ValueError('Website links must be HTTP or HTTPS URLs without credentials')
            clean_links[label] = url
        normalized_servers.append({'label': text(item.get('label', 'Server'), 'Server name', 80) or 'Server',
                                   'host': alias, 'command': executable, 'enabled': enabled, 'show_in_overview': show_in_overview,
                                   'automatic': automatic, 'probe_services': probe_services, 'probe_ports': probe_ports, 'website_links': clean_links})
    result['servers'] = normalized_servers
    # Keep the original fields as a compatibility view of the first enabled connection.
    first = next((item for item in normalized_servers if item['enabled']), None)
    result['moon_enabled'] = bool(first)
    if first:
        result.update(moon_host=first['host'], moon_command=first['command'] or 'moon-status', moon_label=first['label'])
    if result['language'] not in ('en', 'de'):
        raise ValueError('Unsupported language')
    if result['palette'] not in PALETTES:
        raise ValueError('Unknown theme')
    if result['theme'] not in ('system', 'light', 'dark'):
        raise ValueError('Unknown appearance mode')
    if result['density'] not in ('compact', 'comfortable'):
        raise ValueError('Unknown layout density')
    for key, minimum, maximum in [('font_size', 80, 160), ('contrast', 100, 200), ('zoom', 70, 200)]:
        if type(result[key]) is not int or not minimum <= result[key] <= maximum:
            raise ValueError(f'{key}: Percentage must be between {minimum} and {maximum}')
    if result['terminal'] not in TERMINALS or result['editor'] not in EDITORS:
        raise ValueError('Unknown terminal or editor')
    # How often an active dashboard window asks the backend for new values.
    if type(result['ui_refresh']) is not int or not 5 <= result['ui_refresh'] <= 300:
        raise ValueError('Dashboard refresh must be between 5 and 300 seconds')
    intervals = result['intervals']
    if isinstance(intervals, dict):
        intervals.setdefault('services', INTERVALS['services'])
    if not isinstance(intervals, dict) or set(intervals) != set(INTERVALS):
        raise ValueError('Invalid refresh intervals')
    for key, seconds in intervals.items():
        minimum = 300 if key == 'sizes' else 15
        if type(seconds) is not int or not minimum <= seconds <= 86400:
            raise ValueError(f'{key}: Interval must be between {minimum} and 86400 seconds')
    return result


def migrate_legacy(data):
    """Translate the old Work layout once; normal discovery has no personal folder rules."""
    if 'sources' in data:
        return validate(data)
    value = defaults()
    sources = {}
    for root_text in data.get('roots', []):
        root = Path(root_text).expanduser()
        folders = [root]
        if root.name == 'Work' and root.is_dir():
            folders = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith('.') and not p.is_symlink())
        for folder in folders:
            sources[str(folder.resolve())] = {'path': str(folder.resolve()), 'category': folder.name,
                                            'group': '', 'archived': folder.name == 'Archive', 'plain_folders': True}
    value['sources'] = list(sources.values())
    if data.get('moon_host'):
        value.update(moon_enabled=True, moon_host=data['moon_host'], moon_label=data.get('moon_label', 'Server'), moon_command=data.get('moon_command', 'moon-status'))
    value.update(ddev_enabled=True, docker_enabled=True, terminal=data.get('terminal', 'auto'))
    return validate(value)


class Settings:
    def __init__(self, path, legacy=None):
        self.path = Path(path)
        if self.path.exists():
            self.value = validate(json.loads(self.path.read_text()))
        elif legacy and Path(legacy).exists():
            self.value = migrate_legacy(json.loads(Path(legacy).read_text()))
            self.save(self.value)
        else:
            self.value = defaults()

    def save(self, data):
        value = validate(data)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Replace only after a complete private file has been flushed to disk.
        descriptor, name = tempfile.mkstemp(prefix='.settings-', dir=self.path.parent)
        try:
            with os.fdopen(descriptor, 'w') as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        self.value = value
        return copy.deepcopy(value)


def detect(home=None):
    """Suggest bounded, conventional locations; never scan the whole home or connect over SSH."""
    home = Path(home or Path.home())
    candidates = ['Work', 'Projects', 'Developer', 'Code', 'src', 'AndroidStudioProjects']
    paths = [home / name for name in candidates if (home / name).is_dir() and not (home / name).is_symlink()]
    tools = {name: bool(shutil.which(name) or any((Path(folder) / name).is_file() for folder in ('/opt/homebrew/bin', '/usr/local/bin'))) for name in ('git', 'ddev', 'docker', 'colima', 'cmux')}
    apps = [name for name in EDITORS[1:] if any((folder / (name + '.app')).is_dir() for folder in (Path('/Applications'), home / 'Applications'))]
    return {'sources': [{'path': str(path), 'category': 'Projects', 'group': '', 'archived': False} for path in paths], 'tools': tools, 'editors': apps}
