#!/usr/bin/env python3
"""Install Orbit as a per-user macOS LaunchAgent, without opening a browser."""
from pathlib import Path
import os
import plistlib
import shlex
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import json


APP = Path(__file__).resolve().parent
LABEL = "one.tearoom.orbit-dashboard"


def run(*args):
    return subprocess.run(args, capture_output=True, text=True)


def stop_manual_instance():
    # Only stop a listener whose command is exactly this checkout's Python server.
    result = run("/usr/sbin/lsof", "-nP", "-iTCP:8765", "-sTCP:LISTEN", "-Fp")
    for line in result.stdout.splitlines():
        if not line.startswith("p") or not line[1:].isdigit():
            continue
        pid = int(line[1:])
        process = run("/bin/ps", "-p", str(pid), "-o", "command=")
        args = shlex.split(process.stdout.strip())
        if len(args) != 2 or Path(args[1]) != APP / "server.py" or not Path(args[0]).name.lower().startswith("python"):
            raise SystemExit("Port 8765 is used by another process. Autostart has not been loaded.")
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            raise SystemExit("Orbit could not be stopped. Check the running Orbit process.")


def main():
    os.umask(0o077)
    home = Path.home()
    python = Path("/opt/homebrew/bin/python3")
    if not python.is_file():
        python = Path(sys.executable)
    data = APP / "data"
    data.mkdir(exist_ok=True)
    agent = home / "Library/LaunchAgents" / (LABEL + ".plist")
    agent.parent.mkdir(parents=True, exist_ok=True)
    settings = {
        "Label": LABEL,
        "ProgramArguments": [str(python), str(APP / "server.py")],
        "WorkingDirectory": str(APP),
        "EnvironmentVariables": {"HOME": str(home), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONUNBUFFERED": "1"},
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardOutPath": str(data / "orbit.log"),
        "StandardErrorPath": str(data / "orbit.log"),
    }
    if agent.exists() and plistlib.loads(agent.read_bytes()) != settings:
        raise SystemExit("A different Orbit autostart already exists. Existing settings are preserved.")

    domain = f"gui/{os.getuid()}"
    service = domain + "/" + LABEL
    if run("/bin/launchctl", "print", service).returncode == 0:
        result = run("/bin/launchctl", "bootout", service)
        if result.returncode != 0:
            raise SystemExit("The existing Orbit autostart could not be stopped.")
    stop_manual_instance()
    agent.write_bytes(plistlib.dumps(settings))
    agent.chmod(0o600)
    # Explicitly enable the job in case it was previously disabled in macOS.
    subprocess.run(["/bin/launchctl", "enable", service], check=True)
    subprocess.run(["/bin/launchctl", "bootstrap", domain, str(agent)], check=True)
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=1) as response:
                if json.load(response).get("app") == "Orbit":
                    print("Orbit is running and will start automatically at login.")
                    return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise SystemExit("Autostart is configured, but Orbit is not responding yet. See data/orbit.log for details.")


if __name__ == "__main__":
    main()
