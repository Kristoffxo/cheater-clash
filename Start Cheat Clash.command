#!/bin/bash
# Double-click this to run Cheat Clash.
# Close the Terminal window (or press Ctrl-C) to stop it.

cd "$(dirname "$0")" || exit 1

PORT=8000

# if something is already on the port, use the next free one
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo ""
echo "  Starting Cheat Clash on port $PORT ..."
echo "  Close this window to stop it."
echo ""

# open the browser once the server is actually listening
( for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PORT/api/state"; then
      open "http://localhost:$PORT"
      break
    fi
    sleep 0.25
  done ) &

exec python3 server.py --port "$PORT"
