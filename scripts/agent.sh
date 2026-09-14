#!/usr/bin/env bash
# Start the ORBITAL agent sidecar (WebSocket on ws://localhost:8787/ws).
# The agent's working directory is <repo>/workspace, the same tree Jupyter serves.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export ORBITAL_AGENT_PORT="${ORBITAL_AGENT_PORT:-8787}"
export ORBITAL_WORKSPACE="${ORBITAL_WORKSPACE:-$root/workspace}"
exec node agent/server.mjs
