#!/bin/bash
set -e

# Prepare bundled Node.js + OpenClaw for Tauri sidecar
# This script copies and trims the Node.js binary and OpenClaw package
# into src-tauri/resources/ for embedding in the .app bundle.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$APP_DIR/src-tauri/resources"
TARGET_TRIPLE="aarch64-apple-darwin"

# Source NVM if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Resolve Node.js binary
NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found in PATH"
  exit 1
fi
NODE_VERSION="$(node --version)"
echo "Using Node.js $NODE_VERSION at $NODE_BIN"

# Resolve OpenClaw package
OPENCLAW_DIR="$(npm root -g)/openclaw"
if [ ! -f "$OPENCLAW_DIR/openclaw.mjs" ]; then
  echo "ERROR: OpenClaw not found at $OPENCLAW_DIR"
  echo "Install with: npm install -g openclaw@latest"
  exit 1
fi
echo "Using OpenClaw at $OPENCLAW_DIR"

# Clean previous build
echo "Cleaning $RESOURCES_DIR..."
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy Node.js binary
echo "Copying Node.js binary..."
cp "$NODE_BIN" "$RESOURCES_DIR/node-$TARGET_TRIPLE"
chmod +x "$RESOURCES_DIR/node-$TARGET_TRIPLE"

# Copy OpenClaw package
echo "Copying OpenClaw package..."
mkdir -p "$RESOURCES_DIR/openclaw"
# Copy essential files only
cp "$OPENCLAW_DIR/openclaw.mjs" "$RESOURCES_DIR/openclaw/"
cp "$OPENCLAW_DIR/package.json" "$RESOURCES_DIR/openclaw/"
cp -r "$OPENCLAW_DIR/dist" "$RESOURCES_DIR/openclaw/"
cp -r "$OPENCLAW_DIR/node_modules" "$RESOURCES_DIR/openclaw/"

# Copy skills if they exist
if [ -d "$OPENCLAW_DIR/skills" ]; then
  cp -r "$OPENCLAW_DIR/skills" "$RESOURCES_DIR/openclaw/"
fi

# Copy docs/reference/templates (required for onboard)
if [ -d "$OPENCLAW_DIR/docs/reference/templates" ]; then
  mkdir -p "$RESOURCES_DIR/openclaw/docs/reference"
  cp -r "$OPENCLAW_DIR/docs/reference/templates" "$RESOURCES_DIR/openclaw/docs/reference/"
fi

# Trim unnecessary files
echo "Trimming unnecessary files..."

# Remove non-darwin-arm64 koffi builds (saves ~24 MB)
KOFFI_BUILD="$RESOURCES_DIR/openclaw/node_modules/koffi/build/koffi"
if [ -d "$KOFFI_BUILD" ]; then
  for dir in "$KOFFI_BUILD"/*/; do
    dirname="$(basename "$dir")"
    if [ "$dirname" != "darwin_arm64" ]; then
      rm -rf "$dir"
    fi
  done
fi

# Remove non-arm64 clipboard bindings
find "$RESOURCES_DIR/openclaw/node_modules" -name "clipboard-darwin-universal" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "clipboard-linux-*" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "clipboard-win32-*" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove non-arm64 node-pty bindings
find "$RESOURCES_DIR/openclaw/node_modules" -name "node-pty-darwin-x64" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "node-pty-linux-*" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "node-pty-win32-*" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove TypeScript types (not needed at runtime)
find "$RESOURCES_DIR/openclaw/node_modules/@types" -type d -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true

# Remove source maps, TypeScript declarations, READMEs from deps
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.d.ts" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.d.mts" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.map" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "README.md" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "CHANGELOG.md" -delete 2>/dev/null || true

# Code sign all Mach-O binaries (required for macOS notarization)
echo "Code signing binaries..."
codesign --force --sign - "$RESOURCES_DIR/node-$TARGET_TRIPLE" 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "*.node" -exec codesign --force --sign - {} \; 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "*.dylib" -exec codesign --force --sign - {} \; 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "spawn-helper" -exec codesign --force --sign - {} \; 2>/dev/null || true

# Report sizes
echo ""
echo "=== Bundle sizes ==="
du -sh "$RESOURCES_DIR/node-$TARGET_TRIPLE"
du -sh "$RESOURCES_DIR/openclaw/"
du -sh "$RESOURCES_DIR"
echo ""
echo "Done! Resources ready at $RESOURCES_DIR"
