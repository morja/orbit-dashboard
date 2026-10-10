#!/usr/bin/env python3
"""Orbit: local, read-only collectors with a small persistent project notebook."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import argparse
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import threading
import time

from orbit_config import Settings, detect, migrate_legacy, validate
from remote_probe import probe_script, parse_probe


APP = Path(__file__).resolve().parent
SKIP = {"node_modules", "vendor", "build", "dist", "target", "Pods", "DerivedData", "__pycache__"}
STATES = {"active", "paused", "blocked", "done", "archived"}
PRIORITIES = {"normal", "high", "low"}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def command(args, timeout=8, input=None):
    # Argument arrays and disabled Git index writes keep scans read-only.
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0", LC_ALL="C", GIT_TERMINAL_PROMPT="0")
    try:
        result = subprocess.run(args, capture_output=True, text=True, errors="replace", timeout=timeout, env=env, input=input)
        return result.stdout, result.returncode
    except (OSError, subprocess.TimeoutExpired):
        return "", None


def executable(name):
    return shutil.which(name) or next((str(p) for p in [Path("/opt/homebrew/bin") / name, Path("/usr/local/bin") / name] if p.exists()), name)


def project_id(path):
    return hashlib.sha256(str(path).encode()).hexdigest()[:20]


def discover_projects(roots, scan_depth=6, excluded_dirs=None):
    projects = {}
    errors = []
    excluded = set(excluded_dirs if excluded_dirs is not None else SKIP)

    def marked(path):
        return (path / ".git").exists() or (path / ".ddev/config.yaml").is_file() or any((path / name).is_file() for name in ("composer.json", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"))

    def children(path):
        try:
            return sorted(p for p in path.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name not in excluded and not p.is_symlink())
        except OSError:
            errors.append(f"Project folder is unavailable: {path}")
            return []

    def visit(path, group, depth):
        if path.is_symlink():
            return []
        if marked(path):
            return [(path, group)]
        if depth >= scan_depth:
            return []
        found = []
        for child in children(path):
            found.extend(visit(child, path.name if depth == 0 else group, depth + 1))
        return found

    for source in roots:
        if isinstance(source, str):
            source = {"path": source, "category": "Projects", "group": "", "archived": False}
        root = Path(source["path"]).expanduser()
        if root.is_symlink():
            continue
        folders = [root] if marked(root) else children(root)
        root_found = []
        for folder in folders:
            found = visit(folder, source.get("group") or "Projects", 0)
            root_found.extend(found or ([(folder, "Projects")] if source.get("plain_folders", True) else []))
        for path, inferred_group in root_found:
            resolved = path.resolve()
            key = project_id(resolved)
            projects[key] = {"id": key, "name": path.name, "path": str(resolved),
                             "group": source.get("group") or inferred_group,
                             "category": source.get("category", "Projects"),
                             "default_state": "archived" if source.get("archived") else "active",
                             "has_ddev": (path / ".ddev/config.yaml").is_file()}
    return list(projects.values()), errors


def git_status(path):
    if not (Path(path) / ".git").exists():
        return {"available": False, "status": "none", "changed": 0}

    def git(*args):
        return command(["git", "-C", str(path), *args])

    output, code = git("status", "--porcelain=v1", "-z", "--untracked-files=normal")
    if code != 0:
        return {"available": True, "status": "unknown", "changed": None}
    items = output.split("\0")
    counts = {"changed": 0, "staged": 0, "unstaged": 0, "untracked": 0, "conflicts": 0}
    files = []
    index = 0
    while index < len(items):
        entry = items[index]
        index += 1
        if not entry:
            continue
        xy = entry[:2]
        counts["changed"] += 1
        counts["untracked"] += xy == "??"
        counts["staged"] += xy[0] not in (" ", "?")
        counts["unstaged"] += xy[1] not in (" ", "?")
        counts["conflicts"] += "U" in xy or xy in ("AA", "DD")
        if len(files) < 12:
            files.append({"path": entry[3:], "status": xy})
        if "R" in xy or "C" in xy:
            index += 1  # The next NUL field is the old filename, not another change.
    branch, _ = git("symbolic-ref", "--short", "HEAD")
    if not branch.strip():
        branch, _ = git("rev-parse", "--short", "HEAD")
    activity, _ = git("log", "-1", "--format=%ct")
    tracking, tracking_code = git("rev-list", "--left-right", "--count", "@{upstream}...HEAD")
    behind = ahead = None
    if tracking_code == 0 and len(tracking.split()) == 2:
        behind, ahead = map(int, tracking.split())
    return {"available": True, "status": "dirty" if counts["changed"] else "clean", "branch": branch.strip() or "Noch kein Commit", "last_commit": int(activity.strip()) if activity.strip().isdigit() else None, "ahead": ahead, "behind": behind, "files": files, "files_remaining": max(0, counts["changed"] - len(files)), **counts}


def open_cmux(project):
    """Reuse a matching local cmux workspace, otherwise open the project directory."""
    cmux = executable("cmux")
    if not shutil.which(cmux):
        raise ValueError("cmux is not installed or its CLI is unavailable")
    output, code = command([cmux, "--json", "workspace", "list"])
    workspaces = []
    if code == 0:
        try:
            workspaces = json.loads(output).get("workspaces", [])
        except (ValueError, AttributeError):
            pass
    match = next((w for w in workspaces if isinstance(w, dict)
                  and w.get("current_directory") == project["path"]
                  and w.get("id") and not (w.get("remote") or {}).get("enabled")), None)
    if match:
        _, code = command([cmux, "select-workspace", "--workspace", match["id"]])
    else:
        # This CLI form also launches cmux when it isn't already running.
        _, code = command([cmux, project["path"]], timeout=30)
    if code != 0:
        raise ValueError("cmux could not open the project workspace")
    _, code = command(["open", "-a", "cmux"])
    if code != 0:
        raise ValueError("cmux workspace opened, but its window could not be activated")


def latest_change(path, last_commit=None):
    """Newest source-file modification or commit; generated dependencies do not count."""
    latest = last_commit or 0
    root_path = Path(path)
    for root, directories, files in os.walk(root_path, followlinks=False):
        directories[:] = [d for d in directories if d not in SKIP
                          and (not d.startswith(".") or d == ".ddev")
                          and not (Path(root) / d).is_symlink()
                          and not (root_path == APP and d == "data" and Path(root) == APP)]
        for filename in files:
            if filename == ".DS_Store" or filename.lower().endswith(".log"):
                continue
            file = Path(root) / filename
            try:
                if not file.is_symlink():
                    latest = max(latest, file.stat().st_mtime)
            except OSError:
                continue
    return latest or None


def parse_moon(text):
    if not text.lstrip().startswith("MOON STATUS"):
        raise ValueError("Invalid Moon status output")
    sections = {}
    section = None
    warnings = []
    for line in text.splitlines()[1:]:
        if line and not line.startswith(" ") and line.strip().isupper():
            section = line.strip()
            sections[section] = []
        elif line.startswith("  HINWEIS:"):
            warnings.append(line.split("HINWEIS:", 1)[1].strip())
        elif line.startswith("  ") and section:
            if line.strip().startswith("Prüfumfang:"):
                continue
            fields = re.split(r"\s+" if section == "WEBSEITEN" else r"\s{2,}", line.strip(), maxsplit=1)
            if len(fields) == 2:
                sections[section].append({"label": fields[0], "value": fields[1]})
    # A partial result is not an all-clear, even if the command exits zero.
    if not all(sections.get(name) for name in ["DIENSTE", "SPEICHER", "BACKUP"]):
        raise ValueError("Moon status is incomplete")
    if not sections.get("WEBSEITEN"):
        warnings.append("Websites: no usable check results")
    return {"sections": sections, "warnings": warnings, "checked_at": stamp(), "error": None}


def open_terminal(project, config):
    terminal = config["terminal"]
    if terminal == "auto":
        terminal = "cmux" if shutil.which(executable("cmux")) else "Terminal"
    if terminal == "cmux":
        return open_cmux(project)
    if terminal == "none":
        raise ValueError("Terminal is disabled in Settings")
    _, code = command(["open", "-a", terminal, project["path"]])
    if code != 0:
        raise ValueError("Could not open the terminal")


def parse_ddev(text):
    # DDEV may emit more than one JSON log record. Never treat failed output as stopped.
    records = []
    try:
        records.append(json.loads(text))
    except ValueError:
        for line in text.splitlines():
            try:
                records.append(json.loads(line))
            except ValueError:
                continue
    for record in reversed(records):
        data = record.get("raw") if isinstance(record, dict) else record
        if isinstance(data, dict):
            data = data.get("projects")
        if isinstance(data, list) and all(isinstance(p, dict) and ("approot" in p or "root" in p) for p in data):
            return data
    raise ValueError("DDEV returned no usable project list")


def ddev_for_project(project_path, registered):
    root = Path(project_path).resolve()
    candidates = [(p, Path(p.get("approot", p.get("root", ""))).resolve()) for p in registered]
    exact = next((p for p, path in candidates if path == root), None)
    if exact:
        return exact
    # Some repositories keep their only DDEV website in a www subfolder.
    nested = [p for p, path in candidates if root in path.parents]
    return nested[0] if len(nested) == 1 else None


def json_records(text):
    try:
        value = json.loads(text)
        return value if isinstance(value, list) else [value]
    except ValueError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]


def docker_bytes(text):
    match = re.fullmatch(r"([0-9.]+)\s*(B|kB|KB|MB|GB|TB)(?:\s*\(.*\))?", str(text))
    if not match:
        raise ValueError("Unknown Docker size")
    return int(float(match[1]) * 1000 ** {"B": 0, "kB": 1, "KB": 1, "MB": 2, "GB": 3, "TB": 4}[match[2]])


def parse_docker_usage(text):
    rows = json_records(text)
    if {row.get("Type") for row in rows} != {"Images", "Containers", "Local Volumes", "Build Cache"}:
        raise ValueError("Incomplete Docker storage values")
    return [{"type": row["Type"], "count": int(row["TotalCount"]), "active": int(row["Active"]),
             "bytes": docker_bytes(row["Size"]), "reclaimable": docker_bytes(row["Reclaimable"])} for row in rows]


def parse_docker_containers(output):
    rows = json_records(output) if output.strip() else []
    result = []
    for row in rows[:250]:
        if not isinstance(row, dict) or not all(isinstance(row.get(key), str) for key in ('name', 'image', 'state', 'status', 'ports', 'ddev', 'project')):
            raise ValueError('Invalid Docker container list')
        result.append({key: row[key][:2000] for key in ('name', 'image', 'state', 'status', 'ports', 'project')} | {'is_ddev': row['ddev'] == 'ddev'})
    return result, len(rows) > 250


def parse_vm_disk(text):
    fields = text.strip().splitlines()[-1].split()
    total, used, free = [int(value) * 1024 for value in fields[1:4]]
    if total <= 0 or min(used, free) < 0:
        raise ValueError("Invalid VM storage")
    return {"total": total, "used": used, "free": free, "percent": round(used / (used + free) * 100, 1)}


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / "orbit.sqlite3"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, next_step TEXT, state TEXT, priority TEXT);
                CREATE TABLE IF NOT EXISTS sizes (id TEXT PRIMARY KEY, bytes INTEGER, checked REAL);
                CREATE TABLE IF NOT EXISTS samples (time REAL PRIMARY KEY, used INTEGER, free INTEGER, total INTEGER);
                CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT);
            """)

    def action_key(self):
        """Secret for state-changing requests. Only this user can read the file."""
        path = self.directory / "action.key"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return path.read_text().strip()
        with os.fdopen(descriptor, "w") as handle:
            handle.write(secrets.token_hex(32) + "\n")
        return path.read_text().strip()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database, timeout=15)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def notes(self):
        with self.connect() as db:
            return {r[0]: {"next_step": r[1], "state": r[2], "priority": r[3]} for r in db.execute("SELECT * FROM notes")}

    def save_note(self, key, data):
        if not isinstance(data, dict) or not isinstance(data.get("next_step", ""), str):
            raise ValueError("Invalid project note")
        note = data.get("next_step", "").strip()
        state, priority = data.get("state", "active"), data.get("priority", "normal")
        if len(note) > 2000 or state not in STATES or priority not in PRIORITIES:
            raise ValueError("Invalid project note")
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?)", (key, note, state, priority))

    def cached(self, key):
        with self.connect() as db:
            row = db.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def cache(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?)", (key, json.dumps(value)))


class Dashboard:
    def __init__(self, store, config, settings=None):
        self.store = store
        self.settings = settings or Settings(store.directory / "settings.json")
        self.config = migrate_legacy(config) if "roots" in config else validate(config)
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=5)
        self.active = set()
        self.last = {}
        self.errors = {}
        self.projects = []
        self.mac = None
        self.moon = store.cached("moon:" + self.config["moon_host"] + ":" + self.config["moon_command"]) or (store.cached("moon") if self.config["moon_label"] == "Moon" else None)
        self.probe_attempts = {}
        self.servers = {self.server_key(item): store.cached(self.server_key(item)) for item in self.config['servers']}
        self.ddev = {"projects": [], "checked_at": None, "error": None}
        self.docker = {"checked_at": None, "status": "unknown", "colima_status": "unknown", "errors": [], "usage": []}
        self.sizes = {}
        with store.connect() as db:
            self.sizes = {r[0]: {"bytes": r[1], "checked_at": datetime.fromtimestamp(r[2], timezone.utc).isoformat()} for r in db.execute("SELECT * FROM sizes")}
        self.started_at = stamp()
        self.action_key = store.action_key()
        self.progress = {}
        self.restore()
        self.stop = threading.Event()

    @staticmethod
    def server_key(item):
        return 'moon:' + item['host'] + ':' + item['command']

    def project_scope(self):
        # Cached projects are only valid for the folders and discovery rules that produced them.
        return json.dumps([self.config["sources"], self.config["scan_depth"], self.config["excluded_dirs"]], sort_keys=True)

    def restore(self):
        """Show the last saved state at once; collectors replace it when their first check finishes."""
        cached = self.store.cached("projects")
        if cached and cached.get("scope") == self.project_scope():
            self.projects = cached["projects"]
            self.project_errors = cached.get("errors", [])
            self.projects_checked = cached.get("checked_at")
        if self.config["ddev_enabled"]:
            self.ddev = self.store.cached("ddev") or self.ddev
        if self.config["docker_enabled"]:
            self.docker = self.store.cached("docker") or self.docker

    def schedule(self, name, fn, force=False):
        intervals = self.config["intervals"]
        with self.lock:
            if name in self.active or (not force and time.time() - self.last.get(name, 0) < intervals[name]):
                return
            self.active.add(name)
        self.pool.submit(self._run, name, fn)

    def _run(self, name, fn):
        config = self.config
        try:
            fn()
            with self.lock:
                self.errors.pop(name, None)
        except Exception:
            with self.lock:
                self.errors[name] = "Check failed. Refresh to try again."
        finally:
            with self.lock:
                self.active.discard(name)
                self.progress.pop(name, None)
                self.last[name] = time.time() if self.config is config else 0

    def update_config(self, data):
        with self.lock:
            previous = self.config
            self.config = self.settings.save(data)
            if (previous["moon_host"], previous["moon_command"]) != (self.config["moon_host"], self.config["moon_command"]):
                self.moon = self.store.cached("moon:" + self.config["moon_host"] + ":" + self.config["moon_command"])
            self.servers = {self.server_key(item): self.servers.get(self.server_key(item)) or self.store.cached(self.server_key(item)) for item in self.config['servers']}
            self.last.clear()
        self.refresh(True)
        return copy.deepcopy(self.config)

    def refresh(self, force=False):
        for name in ["mac", "projects", "moon", "ddev", "docker", "sizes"]:
            if name in ("moon", "ddev", "docker") and not self.config[name + "_enabled"]:
                continue
            self.schedule(name, getattr(self, "collect_" + name), force)

    def loop(self):
        while not self.stop.is_set():
            self.refresh()
            self.stop.wait(5)

    def collect_mac(self):
        disk = shutil.disk_usage(str(Path.home()))
        now = time.time()
        with self.store.connect() as db:
            # Keep six months of five-minute points, instead of writing on every poll.
            latest = db.execute("SELECT MAX(time) FROM samples").fetchone()[0]
            if latest is None or now - latest >= 300:
                db.execute("INSERT INTO samples VALUES (?, ?, ?, ?)", (now, disk.used, disk.free, disk.total))
            db.execute("DELETE FROM samples WHERE time < ?", (now - 180 * 86400,))
            history = [{"time": r[0], "used": r[1], "free": r[2], "total": r[3]} for r in db.execute("SELECT * FROM samples WHERE time > ? ORDER BY time", (now - 7 * 86400,))]
        with self.lock:
            self.mac = {"hostname": socket.gethostname().removesuffix(".local"), "total": disk.total, "used": disk.used, "free": disk.free, "percent": round(disk.used / disk.total * 100, 1), "history": history, "checked_at": stamp()}

    def collect_projects(self):
        config = self.config
        discovered, errors = discover_projects(config["sources"], config["scan_depth"], config["excluded_dirs"])
        notes = self.store.notes()
        with self.lock:
            previous = {p["id"]: p for p in self.projects}
            self.progress["projects"] = {"done": 0, "total": len(discovered)}

        def inspect(project):
            try:
                if notes.get(project["id"], {}).get("state", project.get("default_state", "active")) == "archived":
                    # Archived projects keep their space in storage, without active Git checks.
                    return {"git": {"available": False, "status": "archived", "changed": 0},
                            "last_modified": previous.get(project["id"], {}).get("last_modified")}
                git = git_status(project["path"])
                return {"git": git, "last_modified": latest_change(project["path"], git.get("last_commit"))}
            finally:
                with self.lock:
                    self.progress["projects"]["done"] += 1

        with ThreadPoolExecutor(max_workers=4) as workers:
            results = list(workers.map(inspect, discovered))
        for project, result in zip(discovered, results):
            project.update(result)
            try:
                project["display_path"] = "~/" + str(Path(project["path"]).relative_to(Path.home()))
            except ValueError:
                project["display_path"] = project["path"]
        with self.lock:
            if self.config is not config:
                return
            self.projects = discovered
            self.project_errors = errors
            self.projects_checked = stamp()
            saved = {"scope": self.project_scope(), "projects": discovered, "errors": errors, "checked_at": self.projects_checked}
        self.store.cache("projects", saved)
        # Start sizing as soon as discovery finishes, including the first scan.
        self.schedule("sizes", self.collect_sizes, True)

    def collect_sizes(self):
        with self.lock:
            projects = copy.deepcopy(self.projects)
        def measure(project):
            key = project["id"]
            with self.lock:
                previous = self.sizes.get(key)
            if previous and time.time() - datetime.fromisoformat(previous["checked_at"]).timestamp() < self.config["intervals"]["sizes"]:
                return
            output, code = command(["du", "-sk", project["path"]], timeout=120)
            if code != 0 or not output.split() or not output.split()[0].isdigit():
                with self.lock:
                    self.sizes[key] = {**(previous or {}), "error": "Size could not be measured completely"}
                return
            size = int(output.split()[0]) * 1024
            with self.store.connect() as db:
                db.execute("INSERT OR REPLACE INTO sizes VALUES (?, ?, ?)", (key, size, time.time()))
            with self.lock:
                self.sizes[key] = {"bytes": size, "checked_at": stamp()}
        with ThreadPoolExecutor(max_workers=2) as workers:
            list(workers.map(measure, projects))

    def collect_moon(self):
        config = self.config
        if not config["moon_enabled"]:
            return
        enabled = [item for item in config['servers'] if item['enabled']]

        def check(item):
            key = self.server_key(item)
            automatic = item.get('automatic', False)
            options = (item['command'], automatic, item.get('probe_services'), item.get('probe_ports'))
            attempt_key = (key, options)
            previous_attempt, failures = self.probe_attempts.get(attempt_key, (0, 0))
            # Automatic collection has its own minimum and exponential failure backoff.
            if automatic and time.time() - previous_attempt < max(300, config['intervals']['moon']) * 2**min(failures, 4):
                return
            ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=6',
                   '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', item['host']]
            if automatic:
                # The validated optional executable runs in this same connection.
                custom = (item['command'] + " </dev/null\nprintf '__ORBIT_CUSTOM_EXIT__%s\\n' \"$?\"\n") if item['command'] else ''
                output, code = command(ssh + ['sh -s'], input=custom + probe_script(item), timeout=45)
            else:
                output, code = command(ssh + [item['command']], timeout=45)
            try:
                if code not in (0, 1):
                    raise ValueError('SSH failed')
                if item['command']:
                    custom_output = output.split('__ORBIT_CUSTOM_EXIT__', 1)[0] if automatic else output
                    value = parse_moon(custom_output)
                    custom_code = output.split('__ORBIT_CUSTOM_EXIT__', 1)[1].splitlines()[0] if automatic else str(code)
                    if custom_code not in ('0', '1'):
                        raise ValueError('Status command failed')
                    if custom_code == '1' and not value['warnings']:
                        value['warnings'].append('Server reported a notice without a usable description')
                else:
                    value = {'sections': {}, 'warnings': [], 'checked_at': stamp(), 'error': None}
                if automatic:
                    probe = parse_probe(output)
                    # The custom adapter remains authoritative for its existing sections.
                    for section, rows in probe['sections'].items():
                        if section == 'SYSTEM' or not value['sections'].get(section):
                            value['sections'][section] = rows
                        elif section == 'PORTS':
                            value['sections'][section] += rows
                    value['memory'] = probe['memory']
                    if not item['command']:
                        value['disk'] = probe['disk']
                    value['warnings'] += probe['warnings']
                    self.probe_attempts[attempt_key] = (time.time(), 0)
            except (ValueError, IndexError):
                if automatic:
                    self.probe_attempts[attempt_key] = (time.time(), failures + 1)
                with self.lock:
                    previous = self.servers.get(key) or (self.moon if item is enabled[0] and item['command'] == config['moon_command'] else None)
                    value = copy.deepcopy(previous) or {'sections': {}, 'warnings': [], 'checked_at': None}
                value['error'] = item['label'] + ' is currently unavailable or its status cannot be read. Last values remain visible.'
            value['attempted_at'] = stamp()
            with self.lock:
                if self.config is not config:
                    return
                if not value.get('error'):
                    self.store.cache(key, value)
                self.servers[key] = value
                if item is enabled[0]:
                    self.moon = value

        # Independent failures retain only that connection's last successful values.
        with ThreadPoolExecutor(max_workers=4) as workers:
            list(workers.map(check, enabled))

    def collect_ddev(self):
        config = self.config
        if not config["ddev_enabled"]:
            return
        output, code = command([executable("ddev"), "list", "--json-output"], timeout=20)
        try:
            if code != 0:
                raise ValueError("DDEV unavailable")
            projects = parse_ddev(output)
            value = {"projects": projects, "checked_at": stamp(), "error": None}
            self.store.cache("ddev", value)
        except ValueError:
            with self.lock:
                value = copy.deepcopy(self.ddev)
            value["error"] = "DDEV is unavailable. Docker may be stopped or unreachable."
        with self.lock:
            if self.config is config:
                self.ddev = value

    def collect_docker(self):
        config = self.config
        if not config["docker_enabled"]:
            return
        value = {"checked_at": stamp(), "status": "unreachable", "colima_status": "unknown", "errors": [], "usage": []}
        colima = executable("colima")
        output, code = command([colima, "list", "--json"])
        try:
            if code != 0:
                raise ValueError()
            profiles = json_records(output)
            value["colima_status"] = "not_installed" if not profiles else "stopped"
        except (ValueError, TypeError):
            profiles = []
            value["errors"].append("Colima status is unavailable.")

        # Match the socket rather than the context name (the default context may point at Colima).
        output, code = command([executable("docker"), "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])
        endpoint = output.strip() if code == 0 else ""
        profile = next((p for p in profiles if endpoint == "unix://" + str(Path.home() / ".colima" / p["name"] / "docker.sock")), None)
        if profile is None and profiles:
            profile = next((p for p in profiles if p["name"] == "default"), profiles[0])
        if profile:
            value["profile"] = profile["name"]
            value["colima_status"] = str(profile.get("status", "unknown")).lower()
            value["docker_on_colima"] = endpoint == "unix://" + str(Path.home() / ".colima" / profile["name"] / "docker.sock")
            if value["colima_status"] == "running" and profile.get("runtime") == "docker":
                output, code = command([colima, "ssh", "--profile", profile["name"], "--", "df", "-Pk", "/var/lib/docker"], timeout=15)
                try:
                    if code != 0:
                        raise ValueError()
                    value["vm_disk"] = parse_vm_disk(output)
                except (ValueError, IndexError):
                    value["errors"].append("Free space in the Colima VM could not be measured.")

        # du reports allocated blocks, unlike the much larger logical VM image size.
        paths = [str(p) for p in [Path.home() / ".colima", Path.home() / ".local/share/colima"] if p.is_dir() and not p.is_symlink()]
        if paths:
            output, code = command(["du", "-sk", *paths], timeout=20)
            try:
                if code != 0:
                    raise ValueError()
                value["host_bytes"] = sum(int(line.split()[0]) * 1024 for line in output.splitlines())
            except (ValueError, IndexError):
                value["errors"].append("Colima disk usage on Mac could not be measured.")

        output, code = command([executable("docker"), "system", "df", "--format", "{{json .}}"], timeout=20)
        try:
            if code != 0:
                raise ValueError()
            value["usage"] = parse_docker_usage(output)
            value["status"] = "running"
        except (ValueError, TypeError, KeyError):
            value["errors"].append("Docker is unavailable or its storage values cannot be read.")
        # One read-only list query; request only display fields and the DDEV marker.
        template = '{"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}},"ddev":{{json (.Label "com.ddev.platform")}},"project":{{json (.Label "com.docker.compose.project")}}}'
        output, code = command([executable("docker"), "ps", "--all", "--format", template], timeout=20)
        value['containers'] = []
        value['containers_error'] = None
        try:
            if code != 0:
                raise ValueError('Container query failed')
            value['containers'], value['containers_truncated'] = parse_docker_containers(output)
        except (ValueError, TypeError, KeyError):
            value['containers_error'] = 'Docker container list is unavailable.'
        with self.lock:
            if self.config is not config:
                return
            self.docker = value
        self.store.cache("docker", value)

    def snapshot(self):
        notes = self.store.notes()
        with self.lock:
            projects = copy.deepcopy(self.projects)
            ddev = copy.deepcopy(self.ddev) if self.config["ddev_enabled"] else {"projects": [], "checked_at": None, "error": "DDEV disabled"}
            for project in projects:
                project.update(notes.get(project["id"], {"next_step": "", "state": project.get("default_state", "active"), "priority": "normal"}))
                project["size"] = copy.deepcopy(self.sizes.get(project["id"], {}))
                match = ddev_for_project(project["path"], ddev["projects"])
                project["ddev"] = {"status": "unknown" if ddev["error"] else "unregistered", "url": None} if project["has_ddev"] or match else {"status": "none", "url": None}
                if match:
                    status = str(match.get("status", "unknown")).lower()
                    project["ddev"]["status"] = "unknown" if ddev["error"] else ("running" if status == "running" else "stopped" if status in ("stopped", "paused", "exited") else status)
                    url = match.get("primary_url") or match.get("httpurl")
                    if isinstance(url, str) and urlparse(url).scheme in ("http", "https"):
                        project["ddev"]["url"] = url
            return {"servers": [{**item, "status": copy.deepcopy(self.servers.get(self.server_key(item)))} for item in self.config['servers'] if item['enabled']], "app": "Orbit", "mac": copy.deepcopy(self.mac), "moon": copy.deepcopy(self.moon) if self.config["moon_enabled"] else None, "projects": projects, "docker": copy.deepcopy(self.docker) if self.config["docker_enabled"] else {"status": "disabled", "errors": [], "usage": []}, "ddev": {"checked_at": ddev["checked_at"], "error": ddev["error"], "running": None if ddev["error"] or not ddev["checked_at"] else sum(str(p.get("status", "")).lower() == "running" for p in ddev["projects"]), "projects": [{"name": p.get("name", ""), "path": p.get("approot", p.get("root", "")), "status": "unknown" if ddev["error"] else str(p.get("status", "unknown")).lower()} for p in ddev["projects"]]}, "checking": sorted(self.active), "errors": dict(self.errors), "project_errors": getattr(self, "project_errors", []), "projects_checked_at": getattr(self, "projects_checked", None), "started_at": self.started_at, "progress": copy.deepcopy(self.progress), "roots": [source["path"] for source in self.config["sources"]], "config": copy.deepcopy(self.config), "server_time": stamp()}


STATIC = APP / "static"
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}


def static_file(path):
    """Resolve a URL path to a file in static/, or None. Hidden files and other folders stay unreachable."""
    relative = "index.html" if path == "/" else path.lstrip("/")
    parts = relative.split("/")
    if any(not part or part.startswith(".") for part in parts):
        return None
    file = (STATIC / relative).resolve()
    if not file.is_relative_to(STATIC.resolve()) or file.suffix not in STATIC_TYPES or not file.is_file():
        return None
    return file


class Handler(BaseHTTPRequestHandler):
    server_version = "Orbit/1.0"

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "304"):
            super().log_message(fmt, *args)

    def allowed(self):
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {"http://" + host for host in hosts}

    def send(self, data, code=200, mime="application/json; charset=utf-8", headers=None):
        body = b"" if code == 304 else json.dumps(data, ensure_ascii=False).encode() if mime.startswith("application/json") else data
        self.send_response(code)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.allowed():
            return self.send({"error": "Access is restricted to this computer"}, 403)
        path = urlparse(self.path).path
        if path == "/api/state":
            # The dashboard asks with its last ETag and redraws only when the state changed.
            snapshot = self.server.dashboard.snapshot()
            server_time = snapshot.pop("server_time")
            etag = '"' + hashlib.sha1(json.dumps(snapshot, sort_keys=True).encode()).hexdigest() + '"'
            if self.headers.get("If-None-Match") == etag:
                return self.send(None, 304, headers={"ETag": etag})
            snapshot["server_time"] = server_time
            return self.send(snapshot, headers={"ETag": etag})
        if path == "/api/settings":
            return self.send(copy.deepcopy(self.server.dashboard.config))
        if path == "/api/detect":
            return self.send(detect())
        if path == "/api/health":
            return self.send({"app": "Orbit", "version": 1})
        file = static_file(path)
        if file is None:
            return self.send({"error": "Not found"}, 404)
        return self.send(file.read_bytes(), mime=STATIC_TYPES[file.suffix])

    def do_POST(self):
        if not self.allowed() or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send({"error": "Request not allowed"}, 403)
        # Reading stays open on 127.0.0.1; changes need the key from the private data folder.
        if not hmac.compare_digest(self.headers.get("X-Orbit-Key", "").encode(), self.server.dashboard.action_key.encode()):
            return self.send({"error": "This window can only view Orbit. Open it from the Mac app or Orbit.command to make changes."}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            limit = 512000 if urlparse(self.path).path == "/api/settings" else 12000
            if not 0 <= length <= limit:
                raise ValueError("Request too large")
            data = json.loads(self.rfile.read(length))
            path = urlparse(self.path).path
            dashboard = self.server.dashboard
            if path == "/api/settings":
                return self.send(dashboard.update_config(data))
            if path == "/api/refresh":
                with dashboard.lock:
                    if time.time() - getattr(dashboard, "manual_refresh", 0) < 5:
                        return self.send({"ok": True})
                    dashboard.manual_refresh = time.time()
                dashboard.refresh(True)
                return self.send({"ok": True})
            match = re.fullmatch(r"/api/projects/([a-f0-9]{20})(/open|/terminal|/editor)?", path)
            if not match:
                return self.send({"error": "Not found"}, 404)
            with dashboard.lock:
                project = next((p for p in dashboard.projects if p["id"] == match[1]), None)
            if not project:
                return self.send({"error": "Project not found"}, 404)
            if match[2] == "/terminal":
                try:
                    open_terminal(project, dashboard.config)
                except ValueError as error:
                    return self.send({"error": str(error)}, 400)
            elif match[2] == "/editor":
                editor = dashboard.config["editor"]
                if editor == "none":
                    raise ValueError("Choose an editor in Settings first")
                _, code = command(["open", "-a", editor, project["path"]])
                if code != 0:
                    raise ValueError("Could not open the editor")
            elif match[2] == "/open":
                _, code = command(["open", project["path"]])
                if code != 0:
                    return self.send({"error": "Could not open the folder"}, 500)
            else:
                dashboard.store.save_note(project["id"], data)
                dashboard.schedule("projects", dashboard.collect_projects, True)
            return self.send({"ok": True})
        except (ValueError, TypeError) as error:
            return self.send({"error": str(error) if isinstance(error, ValueError) else "Invalid input"}, 400)
        except Exception:
            return self.send({"error": "Save failed"}, 500)


def load_config(data_dir=None):
    return Settings((data_dir or APP / "data") / "settings.json", APP / "config.json").value


def main():
    parser = argparse.ArgumentParser(description="Orbit, your local project dashboard")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=APP / "data")
    parser.add_argument("--managed", action="store_true", help="Isolate collectors for the native app lifecycle")
    parser.add_argument("--parent-pid", type=int, help="Native app process to watch")
    args = parser.parse_args()
    if args.managed:
        # The native app terminates this group, including running collector commands.
        if os.getpgrp() != os.getpid():
            os.setsid()
    os.umask(0o077)
    settings = Settings(args.data_dir / "settings.json", APP / "config.json")
    dashboard = Dashboard(Store(args.data_dir), settings.value, settings)
    if args.managed:
        parent_pid = args.parent_pid or os.getppid()

        def watch_parent():
            # Also clean up collectors if macOS force-quits the native app.
            while not dashboard.stop.wait(1):
                if os.getppid() != parent_pid:
                    os.killpg(os.getpid(), signal.SIGTERM)

        threading.Thread(target=watch_parent, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.dashboard = dashboard
    threading.Thread(target=dashboard.loop, daemon=True).start()
    # The managed app passes the key directly; browser mode opens this address once.
    print(f"Orbit is running at http://127.0.0.1:{args.port}" + ("" if args.managed else f"/#key={dashboard.action_key}"), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        dashboard.stop.set()
        server.server_close()
        dashboard.pool.shutdown(wait=True)


if __name__ == "__main__":
    main()
