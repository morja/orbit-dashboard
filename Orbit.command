#!/bin/bash
# Double-click this file in Finder to start Orbit and open the dashboard.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
exec python3 start.py
