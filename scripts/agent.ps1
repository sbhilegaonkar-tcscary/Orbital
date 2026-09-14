# Start the ORBITAL agent sidecar (WebSocket on ws://localhost:8787/ws).
# The agent's working directory is <repo>/workspace, the same tree Jupyter serves.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:ORBITAL_AGENT_PORT = "8787"
$env:ORBITAL_WORKSPACE = Join-Path $root "workspace"
node agent/server.mjs
