#!/bin/bash
# Double-click this to play with the site using fake data.
# Votes count instantly, no money is involved, and your real season is untouched.
# Close the Terminal window (or press Ctrl-C) to stop it.

cd "$(dirname "$0")" || exit 1

PORT=8000
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo ""
echo "  DEMO MODE — fake data, no real payments."
echo "  Starting on port $PORT. Close this window to stop it."
echo ""

( for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PORT/api/state"; then
      open "http://localhost:$PORT"
      break
    fi
    sleep 0.25
  done ) &

exec python3 server.py --demo --port "$PORT"
