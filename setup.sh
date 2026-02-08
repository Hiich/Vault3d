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

# --- 1. Xcode Command Line Tools (macOS only) ---
if [ "$(uname -s)" = "Darwin" ]; then
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
fi

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

# --- 7. Create app launcher ---
chmod +x "$INSTALL_DIR/launch.sh"

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  # macOS: create .app bundle in ~/Applications (searchable via Spotlight)
  APP_DIR="$HOME/Applications/Vault3d.app/Contents/MacOS"
  mkdir -p "$APP_DIR"
  cat > "$APP_DIR/Vault3d" << LAUNCHER
#!/bin/bash
exec "$INSTALL_DIR/launch.sh"
LAUNCHER
  chmod +x "$APP_DIR/Vault3d"

  # Info.plist for proper app identity
  cat > "$HOME/Applications/Vault3d.app/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Vault3d</string>
  <key>CFBundleExecutable</key><string>Vault3d</string>
  <key>CFBundleIdentifier</key><string>com.vault3d.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><false/>
</dict>
</plist>
PLIST
  echo -e "${GREEN}✓${NC} App created — search ${BOLD}Vault3d${NC} in Spotlight or find it in ~/Applications"

elif [ "$OS" = "Linux" ]; then
  # Linux: create .desktop file (shows in app menu)
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat > "$DESKTOP_DIR/vault3d.desktop" << DESKTOP
[Desktop Entry]
Name=Vault3d
Exec=$INSTALL_DIR/launch.sh
Type=Application
Terminal=true
Categories=Utility;
Comment=Local wallet extraction tool
DESKTOP
  chmod +x "$DESKTOP_DIR/vault3d.desktop"
  echo -e "${GREEN}✓${NC} App added to application menu"
fi

# --- 8. Start server and open browser ---
echo ""

# Kill existing process on port 3000 (previous instance)
if command -v lsof &>/dev/null && lsof -ti:3000 &>/dev/null; then
  echo -e "${YELLOW}Stopping existing server on port 3000...${NC}"
  kill $(lsof -ti:3000) 2>/dev/null || true
  sleep 1
elif command -v fuser &>/dev/null && fuser 3000/tcp 2>/dev/null; then
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 1
fi

echo -e "${GREEN}${BOLD}Starting Vault3d...${NC}"
echo ""
bun run server.ts &
SERVER_PID=$!

# Wait for server to be ready (poll instead of fixed sleep)
READY=0
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:3000 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 1 ] && kill -0 $SERVER_PID 2>/dev/null; then
  echo ""
  echo -e "${GREEN}✓ Vault3d is running at http://127.0.0.1:3000${NC}"
  echo ""

  # Open browser (cross-platform)
  if command -v open &>/dev/null; then
    open "http://127.0.0.1:3000"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://127.0.0.1:3000"
  fi

  echo ""
  echo -e "${BOLD}To relaunch later:${NC}"
  if [ "$OS" = "Darwin" ]; then
    echo -e "  Search ${GREEN}Vault3d${NC} in Spotlight (Cmd+Space)"
  elif [ "$OS" = "Linux" ]; then
    echo -e "  Find ${GREEN}Vault3d${NC} in your application menu"
  fi
  echo -e "  Or run: ${GREEN}~/Vault3d/launch.sh${NC}"
  echo ""
  echo "Press Ctrl+C to stop the server."
  echo ""
  wait $SERVER_PID
else
  echo -e "${RED}Server failed to start. Check the output above for errors.${NC}"
  exit 1
fi
