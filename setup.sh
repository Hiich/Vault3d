#!/bin/bash
#
# Vault3d — One-command setup
# Installs dependencies and launches the app.
#
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}=== Vault3d Setup ===${NC}"
echo ""

# 1. Check for Xcode Command Line Tools (needed for native addon compilation)
if ! xcode-select -p &>/dev/null; then
  echo -e "${YELLOW}Xcode Command Line Tools not found.${NC}"
  echo "Installing... (this may take a few minutes)"
  xcode-select --install
  echo ""
  echo "After installation completes, re-run this script:"
  echo "  bash setup.sh"
  exit 1
fi
echo -e "${GREEN}✓${NC} Xcode Command Line Tools"

# 2. Check/install Bun
if ! command -v bun &>/dev/null; then
  echo -e "${YELLOW}Bun not found. Installing...${NC}"
  curl -fsSL https://bun.sh/install | bash

  # Source the updated profile so bun is available in this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    echo -e "${RED}Failed to install Bun. Please install manually:${NC}"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} Bun $(bun --version)"

# 3. Install dependencies
echo ""
echo "Installing dependencies..."
bun install
echo -e "${GREEN}✓${NC} Dependencies installed"

# 4. Create data directory
mkdir -p data
echo -e "${GREEN}✓${NC} Data directory ready"

# 5. Start server
echo ""
echo -e "${GREEN}Starting Vault3d...${NC}"
echo ""
bun run server.ts &
SERVER_PID=$!

# 6. Wait for server to be ready, then open browser
sleep 2
if kill -0 $SERVER_PID 2>/dev/null; then
  echo ""
  echo -e "${GREEN}✓ Vault3d is running at http://127.0.0.1:3000${NC}"
  echo ""

  # Open browser (macOS)
  if command -v open &>/dev/null; then
    open "http://127.0.0.1:3000"
  fi

  echo "Press Ctrl+C to stop the server."
  echo ""
  wait $SERVER_PID
else
  echo -e "${RED}Server failed to start. Check the output above for errors.${NC}"
  exit 1
fi
