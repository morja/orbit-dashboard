#!/usr/bin/env python3
"""Start Orbit once, then open it in the default browser."""
from pathlib import Path
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


app = Path(__file__).resolve().parent
url = "http://127.0.0.1:8765"


def running():
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
            return json.load(response).get("app") == "Orbit"
    except (OSError, ValueError, urllib.error.URLError):
        return False


if not running():
    os.umask(0o077)
    data = app / "data"
    data.mkdir(exist_ok=True)
    with (data / "orbit.log").open("a") as log:
        process = subprocess.Popen([sys.executable, str(app / "server.py")], cwd=app, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    for _ in range(60):
        if running():
            break
        if process.poll() is not None:
            raise SystemExit("Orbit could not start. See data/orbit.log for details.")
        time.sleep(0.25)
    else:
        raise SystemExit("Orbit is taking longer to start. Check data/orbit.log.")

# The key in the address lets this browser save changes. The fragment never reaches the server.
key_file = app / "data" / "action.key"
webbrowser.open(url + ("/#key=" + key_file.read_text().strip() if key_file.exists() else ""))
print("Orbit is running at " + url)
