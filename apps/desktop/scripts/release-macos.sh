#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$APP_DIR/src-tauri"
IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Jesus Medrano (GXY6LW68A8)}"
NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-xcloud-notary}"
UPDATER_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.xcloud/tauri-updater.key}"
UPDATER_KEY_PASSWORD_SERVICE="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD_SERVICE:-xcloud-tauri-updater-key-password}"

if [ -z "${DEVELOPER_DIR:-}" ] && [ -d "$HOME/Downloads/Xcode.app/Contents/Developer" ]; then
  export DEVELOPER_DIR="$HOME/Downloads/Xcode.app/Contents/Developer"
fi

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export SDKROOT="${SDKROOT:-$(/usr/bin/xcrun --sdk macosx --show-sdk-path)}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"

if ! security find-identity -v -p codesigning | grep -Fq "$IDENTITY"; then
  echo "ERROR: signing identity not found in Keychain:"
  echo "  $IDENTITY"
  exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$UPDATER_KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_PATH")"
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  if UPDATER_PASSWORD="$(security find-generic-password -w -s "$UPDATER_KEY_PASSWORD_SERVICE" 2>/dev/null)"; then
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$UPDATER_PASSWORD"
  fi
fi

echo "Preparing universal macOS resources..."
APPLE_SIGNING_IDENTITY="$IDENTITY" bash "$SCRIPT_DIR/prepare-sidecar.sh"

echo "Building xCloud for Apple Silicon + Intel..."
rm -rf "$TAURI_DIR/target/universal-apple-darwin/release/bundle"
set +e
APPLE_SIGNING_IDENTITY="$IDENTITY" pnpm tauri build --target universal-apple-darwin
BUILD_STATUS=$?
set -e

DMG_PATH="$(find "$TAURI_DIR/target/universal-apple-darwin/release/bundle/dmg" -name "*.dmg" -maxdepth 1 -type f | head -n 1 || true)"
APP_PATH="$(find "$TAURI_DIR/target/universal-apple-darwin/release/bundle/macos" -name "*.app" -maxdepth 1 -type d | head -n 1 || true)"

if [ "$BUILD_STATUS" -ne 0 ] && [ -z "$DMG_PATH" ]; then
  echo "ERROR: Tauri build failed before producing a DMG."
  exit "$BUILD_STATUS"
fi

if [ "$BUILD_STATUS" -ne 0 ]; then
  echo "Tauri returned a non-zero status after producing the DMG. Continuing with notarization."
fi

echo ""
echo "Build complete."
[ -n "$APP_PATH" ] && echo "App: $APP_PATH"
[ -n "$DMG_PATH" ] && echo "DMG: $DMG_PATH"

if [ "${SKIP_NOTARIZE:-0}" = "1" ]; then
  echo "Skipping notarization because SKIP_NOTARIZE=1."
  exit 0
fi

if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo ""
  echo "Notary profile '$NOTARY_PROFILE' is not configured yet."
  echo "Create it once with:"
  echo "  xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id YOUR_APPLE_ID --team-id GXY6LW68A8 --password YOUR_APP_SPECIFIC_PASSWORD"
  echo ""
  echo "Then rerun:"
  echo "  pnpm release:mac"
  exit 0
fi

if [ -z "$DMG_PATH" ]; then
  echo "ERROR: no DMG was produced, cannot notarize."
  exit 1
fi

echo "Submitting DMG to Apple notarization..."
xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$DMG_PATH"
[ -n "$APP_PATH" ] && xcrun stapler staple "$APP_PATH" || true

echo "Release is signed and notarized."
