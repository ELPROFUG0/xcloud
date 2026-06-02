#!/usr/bin/env bash
# Prepare the static files that xCloud remote setup expects under xcloud.so.
#
# Upload the generated directory so these URLs exist:
#   https://xcloud.so/setup-remote.sh
#   https://xcloud.so/openclaw-extensions/unicore-workspace/openclaw.plugin.json
#   https://xcloud.so/openclaw-extensions/unicore-workspace/package.json
#   https://xcloud.so/openclaw-extensions/unicore-workspace/index.js

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/dist/remote}"
PLUGIN_SRC="$ROOT_DIR/apps/desktop/src-tauri/unicore-openclaw-extensions/unicore-workspace"
PLUGIN_OUT="$OUT_DIR/openclaw-extensions/unicore-workspace"

rm -rf "$OUT_DIR"
mkdir -p "$PLUGIN_OUT"

cp "$ROOT_DIR/scripts/setup-remote.sh" "$OUT_DIR/setup-remote.sh"
cp "$PLUGIN_SRC/openclaw.plugin.json" "$PLUGIN_OUT/openclaw.plugin.json"
cp "$PLUGIN_SRC/package.json" "$PLUGIN_OUT/package.json"
cp "$PLUGIN_SRC/index.js" "$PLUGIN_OUT/index.js"
chmod +x "$OUT_DIR/setup-remote.sh"

printf 'Remote setup assets ready: %s\n' "$OUT_DIR"
