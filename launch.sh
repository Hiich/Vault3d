#!/bin/bash
#
# Vault3d launcher — starts the server and opens the browser.
# Works on macOS and Linux. Can be run directly:
#   ~/Vault3d/launch.sh
#
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

# Ensure bun is on PATH
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Kill existing instance on port 3000
if command -v lsof &>/dev/null && lsof -ti:3000 &>/dev/null; then
  kill $(lsof -ti:3000) 2>/dev/null || true
  sleep 1
elif command -v fuser &>/dev/null && fuser 3000/tcp 2>/dev/null; then
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 1
fi

# Start server
bun run server.ts &
SERVER_PID=$!

sleep 2
if kill -0 $SERVER_PID 2>/dev/null; then
  # Open browser (cross-platform)
  if command -v open &>/dev/null; then
    open "http://127.0.0.1:3000"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://127.0.0.1:3000"
  fi
  wait $SERVER_PID
else
  echo "Vault3d failed to start. Run ~/Vault3d/launch.sh from a terminal to see the error."
  exit 1
fi
