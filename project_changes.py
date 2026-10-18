"""Bounded project change tracking, with a macOS FSEvents adapter and safe fallback."""
from dataclasses import dataclass
from pathlib import Path
import ctypes as c
import os
import sys
import threading


# FSEvents reports loss/coalescing and root changes separately from file events.
RESCAN_FLAGS = 0x01 | 0x02 | 0x04 | 0x08 | 0x20 | 0x40 | 0x80
STRUCTURE_FLAGS = 0x100 | 0x200 | 0x800
IS_DIRECTORY = 0x20000
PROJECT_MARKERS = {'.git', 'package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'}


class FSEventsWatcher:
    """Own a single event stream and run loop; never walk the watched folders."""
    def __init__(self, roots, callback):
        self.roots = roots
        self.callback = callback
        self.ready = threading.Event()
        self.stopping = threading.Event()
        self.running = False
        self.thread = None
        self.stream_lock = threading.Lock()
        self.stream = None
        self.api = None
        self.cf = None
        self.run_loop = None

    def start(self):
        if sys.platform != 'darwin' or not self.roots:
            return False
        self.thread = threading.Thread(target=self._run, name='Orbit filesystem events', daemon=True)
        self.thread.start()
        if not self.ready.wait(5):
            self.stop()
        return self.running

    def stop(self):
        self.stopping.set()
        with self.stream_lock:
            if self.run_loop:
                self.cf.CFRunLoopStop(self.run_loop)
                self.cf.CFRunLoopWakeUp(self.run_loop)
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=3)

    def flush(self):
        # Deliver queued edits before a foreground check snapshots the dirty set.
        with self.stream_lock:
            if self.running and self.stream:
                self.api.FSEventStreamFlushSync(self.stream)

    def _run(self):
        stream = None
        strings = []
        paths = None
        try:
            cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
            fs = c.CDLL('/System/Library/Frameworks/CoreServices.framework/CoreServices')
            callback_type = c.CFUNCTYPE(None, c.c_void_p, c.c_void_p, c.c_size_t,
                                       c.POINTER(c.c_char_p), c.POINTER(c.c_uint32), c.POINTER(c.c_uint64))
            cf.CFStringCreateWithCString.argtypes = [c.c_void_p, c.c_char_p, c.c_uint32]
            cf.CFStringCreateWithCString.restype = c.c_void_p
            cf.CFArrayCreate.argtypes = [c.c_void_p, c.POINTER(c.c_void_p), c.c_long, c.c_void_p]
            cf.CFArrayCreate.restype = c.c_void_p
            cf.CFRelease.argtypes = [c.c_void_p]
            cf.CFRelease.restype = None
            cf.CFRunLoopGetCurrent.restype = c.c_void_p
            cf.CFRunLoopStop.argtypes = [c.c_void_p]
            cf.CFRunLoopStop.restype = None
            cf.CFRunLoopWakeUp.argtypes = [c.c_void_p]
            cf.CFRunLoopWakeUp.restype = None
            cf.CFRunLoopRunInMode.argtypes = [c.c_void_p, c.c_double, c.c_bool]
            cf.CFRunLoopRunInMode.restype = c.c_int32
            fs.FSEventStreamCreate.argtypes = [c.c_void_p, callback_type, c.c_void_p, c.c_void_p,
                                              c.c_uint64, c.c_double, c.c_uint32]
            fs.FSEventStreamCreate.restype = c.c_void_p
            fs.FSEventStreamScheduleWithRunLoop.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p]
            fs.FSEventStreamScheduleWithRunLoop.restype = None
            fs.FSEventStreamStart.argtypes = [c.c_void_p]
            fs.FSEventStreamStart.restype = c.c_bool
            fs.FSEventStreamFlushSync.argtypes = [c.c_void_p]
            fs.FSEventStreamFlushSync.restype = None
            for name in ('FSEventStreamStop', 'FSEventStreamInvalidate', 'FSEventStreamRelease'):
                getattr(fs, name).argtypes = [c.c_void_p]
                getattr(fs, name).restype = None

            @callback_type
            def receive(_stream, _context, count, event_paths, flags, _ids):
                try:
                    self.callback([(os.fsdecode(event_paths[i]), flags[i]) for i in range(count)])
                except Exception:
                    # Callback failures must invalidate cached results, never disappear silently.
                    self.running = False
                    self.stopping.set()

            # Keep strings and the C callback alive for the stream's whole lifetime.
            strings = [cf.CFStringCreateWithCString(None, os.fsencode(root), 0x08000100) for root in self.roots]
            if not all(strings):
                raise OSError('Unable to allocate event paths')
            values = (c.c_void_p * len(strings))(*strings)
            paths = cf.CFArrayCreate(None, values, len(strings), None)
            if not paths:
                raise OSError('Unable to allocate event paths')
            stream = fs.FSEventStreamCreate(None, receive, None, paths, 0xFFFFFFFFFFFFFFFF, 0.3, 0x04 | 0x10)
            if not stream:
                raise OSError('Unable to create event stream')
            mode = c.c_void_p.in_dll(cf, 'kCFRunLoopDefaultMode').value
            run_loop = cf.CFRunLoopGetCurrent()
            fs.FSEventStreamScheduleWithRunLoop(stream, run_loop, mode)
            self.running = bool(fs.FSEventStreamStart(stream))
            with self.stream_lock:
                self.stream, self.api = stream, fs
                self.cf, self.run_loop = cf, run_loop
            self.ready.set()
            while self.running and not self.stopping.is_set():
                cf.CFRunLoopRunInMode(mode, 60, False)
        except (OSError, AttributeError):
            self.running = False
        finally:
            self.running = False
            self.ready.set()
            if stream:
                with self.stream_lock:
                    self.stream = None
                    self.run_loop = None
                    fs.FSEventStreamStop(stream)
                    fs.FSEventStreamInvalidate(stream)
                    fs.FSEventStreamRelease(stream)
            if paths:
                cf.CFRelease(paths)
            for string in strings:
                if string:
                    cf.CFRelease(string)


@dataclass(frozen=True)
class Changes:
    generation: int
    dirty: frozenset
    source_dirty: frozenset
    discovery: bool
    full: bool


def within(path, root):
    return path == root or path.startswith(root + os.sep)


def git_directories(path):
    """Linked worktrees can keep HEAD/index and shared refs outside project roots."""
    marker = Path(path) / '.git'
    try:
        if marker.is_dir():
            directory = marker.resolve()
        else:
            text = marker.read_text().strip()
            if not text.startswith('gitdir: '):
                return []
            directory = (marker.parent / text[8:]).resolve()
        result = [str(directory)]
        common = directory / 'commondir'
        if common.is_file():
            result.append(str((directory / common.read_text().strip()).resolve()))
        return result
    except (OSError, ValueError):
        return []


class ProjectChanges:
    """Record generations, so edits arriving during a scan survive its acknowledgement."""
    def __init__(self, app_path, watcher_factory=FSEventsWatcher):
        self.app_data = str(Path(app_path).resolve() / 'data')
        self.factory = watcher_factory
        self.lock = threading.RLock()
        self.watcher = None
        self.signature = None
        self.roots = ()
        self.projects = {}
        self.git_paths = {}
        self.project_index = {}
        self.git_index = {}
        self.sources = ()
        self.excluded = set()
        self.generation = 0
        self.dirty = {}
        self.source_dirty = {}
        self.discovery = 0
        self.full = 0
        self.restart = False
        self.invalidate()

    def invalidate(self):
        with self.lock:
            self.generation += 1
            self.full = self.generation

    def configure(self, sources, projects, excluded, rebuild=False):
        signature = (tuple(item['path'] for item in sources),
                     tuple(sorted((item['id'], item['path']) for item in projects)), tuple(excluded))
        if signature == self.signature and not rebuild:
            return
        project_paths = {item['id']: item['path'] for item in projects}
        git_paths = {key: git_directories(path) for key, path in project_paths.items()}
        candidates = sorted(set(signature[0]) | {path for paths in git_paths.values() for path in paths}, key=len)
        roots = []
        for path in candidates:
            if not any(within(path, root) for root in roots):
                roots.append(path)
        with self.lock:
            self.signature = signature
            self.sources = signature[0]
            self.projects = project_paths
            self.git_paths = git_paths
            self.project_index = {}
            self.git_index = {}
            for key, path in project_paths.items():
                self.project_index.setdefault(path, set()).add(key)
                for directory in git_paths[key]:
                    self.git_index.setdefault(directory, set()).add(key)
            self.excluded = set(excluded)
            self.dirty = {key: value for key, value in self.dirty.items() if key in project_paths}
            self.source_dirty = {key: value for key, value in self.source_dirty.items() if key in project_paths}
            restart, self.restart = self.restart, False
        if tuple(roots) != self.roots or self.watcher is None or not self.watcher.running or restart:
            self.close()
            self.roots = tuple(roots)
            self.invalidate()
            self.watcher = self.factory(self.roots, self.record)
            self.watcher.start()

    def record(self, events):
        with self.lock:
            for path, flags in events:
                self.generation += 1
                generation = self.generation
                if flags & RESCAN_FLAGS:
                    self.full = generation
                if flags & (0x20 | 0x40 | 0x80):
                    self.restart = True
                if within(path, self.app_data):
                    continue
                # Match ancestors through indexes, rather than comparing each
                # event against every project during large dependency/build writes.
                project_keys, git_keys = set(), set()
                ancestor = path
                while True:
                    project_keys.update(self.project_index.get(ancestor, ()))
                    git_keys.update(self.git_index.get(ancestor, ()))
                    parent = os.path.dirname(ancestor)
                    if parent == ancestor:
                        break
                    ancestor = parent
                for key in git_keys:
                    self.dirty[key] = generation
                for key in project_keys:
                    root = self.projects[key]
                    self.dirty[key] = generation
                    relative = os.path.relpath(path, root).split(os.sep)
                    # Generated files/logs may still affect Git, but cannot change
                    # the source timestamp. Preserve that cached value without a walk.
                    folders = relative if flags & IS_DIRECTORY else relative[:-1]
                    ignored = any(name in self.excluded or (name.startswith('.') and name not in ('.git', '.ddev', '.')) for name in folders)
                    if relative[0] != '.git' and not ignored and relative[-1] != '.DS_Store' and not relative[-1].lower().endswith('.log'):
                        self.source_dirty[key] = generation
                    if path == root or (flags & IS_DIRECTORY and flags & STRUCTURE_FLAGS):
                        self.discovery = generation
                    if (relative[-1] in PROJECT_MARKERS or relative[-1] == 'commondir'
                            or relative[-2:] == ['.ddev', 'config.yaml']):
                        self.discovery = generation
                if not (project_keys or git_keys) and any(within(path, source) or within(source, path) for source in self.sources):
                    self.discovery = generation

    def snapshot(self):
        if self.watcher:
            self.watcher.flush()
        with self.lock:
            healthy = bool(self.watcher and self.watcher.running)
            # Missing source roots and watcher failures keep the conservative scan path.
            healthy = healthy and all(os.path.isdir(root) for root in self.roots)
            return Changes(self.generation, frozenset(self.dirty), frozenset(self.source_dirty),
                           bool(self.discovery), bool(self.full) or not healthy)

    def acknowledge(self, generation):
        with self.lock:
            self.dirty = {key: value for key, value in self.dirty.items() if value > generation}
            self.source_dirty = {key: value for key, value in self.source_dirty.items() if value > generation}
            if self.discovery <= generation:
                self.discovery = 0
            if self.full <= generation:
                self.full = 0

    def close(self):
        watcher, self.watcher = self.watcher, None
        if watcher:
            watcher.stop()
