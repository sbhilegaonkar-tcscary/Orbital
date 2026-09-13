# Start the local Jupyter Server for ORBITAL (port 8888, root = workspace/).
$root = Split-Path -Parent $PSScriptRoot
& "$root\.venv\Scripts\python.exe" -m jupyter_server --config="$root\jupyter\jupyter_server_config.py"
