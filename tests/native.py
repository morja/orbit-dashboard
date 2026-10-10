"""Exercise the installed Mac app's UI and owned/reused backend lifetimes."""
from pathlib import Path
import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
BINARY = Path.home() / "Applications/Orbit Dashboard.app/Contents/MacOS/Orbit"


def healthy():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=0.5) as response:
            return json.load(response).get("app") == "Orbit"
    except (OSError, ValueError):
        return False


def wait_for(check, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for backend lifecycle")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=BINARY.parents[2],
                        help='App bundle built from this source checkout')
    binary = parser.parse_args().app.expanduser().resolve() / 'Contents/MacOS/Orbit'
    if healthy():
        raise SystemExit("Close Orbit before running the native lifecycle checks.")
    result = subprocess.run([str(binary), "--smoke-test"], capture_output=True, text=True, timeout=65)
    assert result.returncode == 0, result.stderr
    assert "Owned backend: true" in result.stdout, result.stdout
    wait_for(lambda: not healthy())
    print("Native WebKit UI and normal shutdown passed")

    # A forced app exit must not leave the server and its collectors behind.
    app = subprocess.Popen([str(binary)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for(healthy)
        rows = subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid=,command="], text=True).splitlines()
        owned = [row.split(maxsplit=3) for row in rows if "--parent-pid " + str(app.pid) in row and str(ROOT / "server.py") in row]
        assert len(owned) == 1, owned
        backend_pid, _, group, _ = owned[0]
        assert backend_pid == group
        app.kill()
        app.wait(timeout=5)
        wait_for(lambda: not healthy(), timeout=8)
        print("Forced app exit cleans up owned backend")
    finally:
        if app.poll() is None:
            app.kill()
            app.wait(timeout=5)

    # Closing the app must preserve a server started independently by the user.
    with (ROOT / "data/orbit.log").open("a") as log:
        server = subprocess.Popen([sys.executable, str(ROOT / "server.py")], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    try:
        wait_for(healthy)
        result = subprocess.run([str(binary), "--smoke-test"], capture_output=True, text=True, timeout=65)
        assert result.returncode == 0, result.stderr
        assert "Owned backend: false" in result.stdout, result.stdout
        assert server.poll() is None and healthy()
        print("Independently started backend is preserved")
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        server.wait(timeout=5)
    wait_for(lambda: not healthy())


if __name__ == "__main__":
    main()
