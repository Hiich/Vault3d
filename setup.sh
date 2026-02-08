#!/bin/bash
#
# Vault3d — Zero-knowledge install
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Hiich/Vault3d/main/setup.sh | bash
#
# Or from inside the repo:
#   bash setup.sh
#
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/Hiich/Vault3d.git"
INSTALL_DIR="$HOME/Vault3d"

echo ""
echo -e "${GREEN}${BOLD}=== Vault3d Setup ===${NC}"
echo ""

# --- Detect context: are we already inside the repo? ---
INSIDE_REPO=false
if [ -f "package.json" ] && grep -q '"server.ts"' package.json 2>/dev/null; then
  INSIDE_REPO=true
  INSTALL_DIR="$(pwd)"
fi

# --- 1. Xcode Command Line Tools (provides git, clang, etc.) ---
if ! xcode-select -p &>/dev/null; then
  echo -e "${YELLOW}Xcode Command Line Tools not found.${NC}"
  echo "Installing... (a dialog may appear — click Install and wait)"
  echo ""

  # Trigger the install dialog
  xcode-select --install 2>/dev/null || true

  # Wait for it to finish (the dialog is async)
  echo "Waiting for Xcode CLT installation to complete..."
  until xcode-select -p &>/dev/null; do
    sleep 5
  done
  echo ""
fi
echo -e "${GREEN}✓${NC} Xcode Command Line Tools"

# --- 2. Git (should come with Xcode CLT, but verify) ---
if ! command -v git &>/dev/null; then
  echo -e "${RED}git not found even after Xcode CLT install.${NC}"
  echo "Please install git manually and re-run this script."
  exit 1
fi
echo -e "${GREEN}✓${NC} git $(git --version | awk '{print $3}')"

# --- 3. Bun ---
if ! command -v bun &>/dev/null; then
  echo -e "${YELLOW}Bun not found. Installing...${NC}"
  curl -fsSL https://bun.sh/install | bash

  # Make bun available in this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    echo -e "${RED}Failed to install Bun. Please install manually:${NC}"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} Bun $(bun --version)"

# --- 4. Clone or update the repo ---
if [ "$INSIDE_REPO" = true ]; then
  echo -e "${GREEN}✓${NC} Already inside project directory"
else
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || echo -e "${YELLOW}Could not auto-update (you may have local changes). Continuing with existing version.${NC}"
  else
    echo "Downloading Vault3d..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
  echo -e "${GREEN}✓${NC} Project ready at ${INSTALL_DIR}"
fi

# --- 5. Install dependencies ---
echo ""
echo "Installing dependencies..."
bun install
echo -e "${GREEN}✓${NC} Dependencies installed"

# --- 6. Create data directory ---
mkdir -p data
echo -e "${GREEN}✓${NC} Data directory ready"

# --- 7. Start server and open browser ---
echo ""
echo -e "${GREEN}${BOLD}Starting Vault3d...${NC}"
echo ""
bun run server.ts &
SERVER_PID=$!

# Wait for server to be ready
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
