#!/usr/bin/env bash
# Start the local Jupyter Server for ORBITAL (port 8888, root = workspace/).
root="$(cd "$(dirname "$0")/.." && pwd)"
if [ -x "$root/.venv/Scripts/python.exe" ]; then py="$root/.venv/Scripts/python.exe"; else py="$root/.venv/bin/python"; fi
exec "$py" -m jupyter_server --config="$root/jupyter/jupyter_server_config.py"
