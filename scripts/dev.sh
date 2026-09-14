#!/usr/bin/env bash
# One-shot ORBITAL launcher (see scripts/dev.ps1 for the Windows version):
# starts Jupyter, the agent sidecar, and the app dev server as detached
# background processes, only if each isn't already up, waits for the app to
# answer, then opens it in the browser. Replaces running scripts/jupyter.sh,
# scripts/agent.sh, and scripts/app.sh by hand.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

http_up() {
  curl -fsS -o /dev/null --max-time 2 "$1"
}

port_listening() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  local ok=$?
  exec 3>&- 2>/dev/null
  exec 3<&- 2>/dev/null
  return $ok
}

start_service() {
  name="$1"
  script="$2"
  if "$3"; then
    echo "$name: already running"
  else
    nohup "$script" >/dev/null 2>&1 &
    disown
    echo "$name: started"
  fi
}

jupyter_up() { http_up 'http://127.0.0.1:8888/api/status?token=orbital-dev'; }
agent_up() { port_listening 8787; }
app_up() { port_listening 5173; }

start_service jupyter "$root/scripts/jupyter.sh" jupyter_up
start_service agent "$root/scripts/agent.sh" agent_up
start_service app "$root/scripts/app.sh" app_up

deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$deadline" ] && ! port_listening 5173; do
  sleep 0.5
done

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open 'http://localhost:5173' >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open 'http://localhost:5173'
elif command -v start >/dev/null 2>&1; then
  start 'http://localhost:5173'
fi
