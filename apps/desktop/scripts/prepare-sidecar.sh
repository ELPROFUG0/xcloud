#!/bin/bash
set -euo pipefail

# Prepare bundled Node.js + OpenClaw for Tauri.
# The app ships a self-contained OpenClaw engine plus one Node binary per macOS
# architecture, so the same bundle can run on Apple Silicon and Intel Macs.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$APP_DIR/src-tauri"
RESOURCES_DIR="$APP_DIR/src-tauri/resources"
ENTITLEMENTS_PATH="$TAURI_DIR/Entitlements.plist"
NODE_ARM64_NAME="node-aarch64-apple-darwin"
NODE_X64_NAME="node-x86_64-apple-darwin"
NODE_PTY_VERSION="1.2.0-beta.12"
SIGN_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

export NVM_DIR="$HOME/.nvm"
unset npm_config_prefix
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found in PATH"
  exit 1
fi

NODE_VERSION_RAW="$(node --version)"
NODE_VERSION="${NODE_VERSION_RAW#v}"
echo "Using Node.js $NODE_VERSION_RAW at $NODE_BIN"

OPENCLAW_DIR="$(npm root -g)/openclaw"
if [ ! -f "$OPENCLAW_DIR/openclaw.mjs" ]; then
  echo "ERROR: OpenClaw not found at $OPENCLAW_DIR"
  echo "Install with: npm install -g openclaw@latest"
  exit 1
fi
echo "Using OpenClaw at $OPENCLAW_DIR"

echo "Cleaning $RESOURCES_DIR..."
rm -rf "$RESOURCES_DIR"
mkdir -p "$RESOURCES_DIR"

copy_current_node() {
  local target="$1"
  echo "Copying local Node.js to $target..."
  cp "$NODE_BIN" "$RESOURCES_DIR/$target"
  chmod +x "$RESOURCES_DIR/$target"
}

download_node_x64() {
  local target="$RESOURCES_DIR/$NODE_X64_NAME"
  local url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-x64.tar.gz"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  echo "Downloading Intel Node.js from $url..."
  curl -fsSL "$url" -o "$tmp_dir/node-x64.tar.gz"
  tar -xzf "$tmp_dir/node-x64.tar.gz" -C "$tmp_dir"
  cp "$tmp_dir/node-v$NODE_VERSION-darwin-x64/bin/node" "$target"
  chmod +x "$target"
  rm -rf "$tmp_dir"
}

case "$(uname -m)" in
  arm64)
    copy_current_node "$NODE_ARM64_NAME"
    download_node_x64
    ;;
  x86_64)
    copy_current_node "$NODE_X64_NAME"
    echo "Downloading Apple Silicon Node.js is skipped on Intel hosts."
    echo "Run this script on Apple Silicon to create the universal release resources."
    ;;
  *)
    echo "ERROR: unsupported build host architecture: $(uname -m)"
    exit 1
    ;;
esac

if [ ! -f "$RESOURCES_DIR/$NODE_ARM64_NAME" ] || [ ! -f "$RESOURCES_DIR/$NODE_X64_NAME" ]; then
  echo "ERROR: both $NODE_ARM64_NAME and $NODE_X64_NAME are required for universal macOS builds."
  exit 1
fi

echo "Copying OpenClaw package..."
mkdir -p "$RESOURCES_DIR/openclaw"
cp "$OPENCLAW_DIR/openclaw.mjs" "$RESOURCES_DIR/openclaw/"
cp "$OPENCLAW_DIR/package.json" "$RESOURCES_DIR/openclaw/"
cp -r "$OPENCLAW_DIR/dist" "$RESOURCES_DIR/openclaw/"
cp -r "$OPENCLAW_DIR/node_modules" "$RESOURCES_DIR/openclaw/"

if [ -d "$OPENCLAW_DIR/skills" ]; then
  cp -r "$OPENCLAW_DIR/skills" "$RESOURCES_DIR/openclaw/"
fi

if [ -d "$OPENCLAW_DIR/docs/reference/templates" ]; then
  mkdir -p "$RESOURCES_DIR/openclaw/docs/reference"
  cp -r "$OPENCLAW_DIR/docs/reference/templates" "$RESOURCES_DIR/openclaw/docs/reference/"
fi

echo "Ensuring Intel native runtime dependencies..."
npm_config_platform=darwin npm_config_arch=x64 npm install \
  --prefix "$RESOURCES_DIR/openclaw" \
  --no-save \
  --omit=dev \
  --force \
  "@lydell/node-pty-darwin-x64@$NODE_PTY_VERSION"

echo "Trimming non-macOS runtime files..."
find "$RESOURCES_DIR/openclaw/node_modules" -name "clipboard-linux-*" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "clipboard-win32-*" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "node-pty-linux-*" -type d -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "node-pty-win32-*" -type d -exec rm -rf {} + 2>/dev/null || true

KOFFI_BUILD="$RESOURCES_DIR/openclaw/node_modules/koffi/build/koffi"
if [ -d "$KOFFI_BUILD" ]; then
  for dir in "$KOFFI_BUILD"/*/; do
    dirname="$(basename "$dir")"
    case "$dirname" in
      darwin_arm64|darwin_x64) ;;
      *) rm -rf "$dir" ;;
    esac
  done
fi

find "$RESOURCES_DIR/openclaw/node_modules/@types" -type d -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.d.ts" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.d.mts" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "*.map" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "README.md" -delete 2>/dev/null || true
find "$RESOURCES_DIR/openclaw/node_modules" -name "CHANGELOG.md" -delete 2>/dev/null || true

echo "Code signing embedded binaries..."
SIGN_ARGS=(--force --options runtime)
if [ -f "$ENTITLEMENTS_PATH" ]; then
  SIGN_ARGS+=(--entitlements "$ENTITLEMENTS_PATH")
fi
if [ -n "$SIGN_IDENTITY" ]; then
  SIGN_ARGS+=(--sign "$SIGN_IDENTITY")
else
  SIGN_ARGS+=(--sign -)
fi

codesign "${SIGN_ARGS[@]}" "$RESOURCES_DIR/$NODE_ARM64_NAME" 2>/dev/null || true
codesign "${SIGN_ARGS[@]}" "$RESOURCES_DIR/$NODE_X64_NAME" 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "*.node" -exec codesign "${SIGN_ARGS[@]}" {} \; 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "*.dylib" -exec codesign "${SIGN_ARGS[@]}" {} \; 2>/dev/null || true
find "$RESOURCES_DIR/openclaw" -name "spawn-helper" -exec codesign "${SIGN_ARGS[@]}" {} \; 2>/dev/null || true

echo ""
echo "=== Bundle sizes ==="
du -sh "$RESOURCES_DIR/$NODE_ARM64_NAME"
du -sh "$RESOURCES_DIR/$NODE_X64_NAME"
du -sh "$RESOURCES_DIR/openclaw/"
du -sh "$RESOURCES_DIR"
echo ""
echo "Done. Resources ready at $RESOURCES_DIR"
