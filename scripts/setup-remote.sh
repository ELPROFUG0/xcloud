#!/usr/bin/env bash
# Agent Studio — Remote Engine Setup
# Run this on your VPS or Mac Mini to install OpenClaw as a 24/7 service.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/user/agent-studio/main/scripts/setup-remote.sh | bash

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}Agent Studio — Remote Engine Setup${RESET}"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────
echo -e "${CYAN}[1/5]${RESET} Checking Node.js..."

if ! command -v node &>/dev/null; then
  echo -e "${RED}Node.js not found.${RESET}"
  echo "Install Node.js 22+ first: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo -e "${RED}Node.js $NODE_VERSION found, but 22+ required.${RESET}"
  echo "Upgrade Node.js: https://nodejs.org"
  exit 1
fi
echo -e "  Node.js v$(node -v | sed 's/v//') ✓"

# ── 2. Install OpenClaw ───────────────────────────────────────
echo -e "${CYAN}[2/5]${RESET} Installing OpenClaw..."

if command -v openclaw &>/dev/null; then
  echo "  OpenClaw already installed, updating..."
  npm install -g openclaw@latest 2>/dev/null || npm install -g openclaw@latest
else
  npm install -g openclaw@latest
fi
echo -e "  OpenClaw $(openclaw --version 2>/dev/null || echo 'installed') ✓"

# ── 3. Onboard if needed ──────────────────────────────────────
echo -e "${CYAN}[3/5]${RESET} Setting up OpenClaw..."

if [ ! -f "$HOME/.openclaw/openclaw.json" ]; then
  openclaw onboard --install-daemon 2>/dev/null || true
fi

# ── 4. Configure for remote access ────────────────────────────
echo -e "${CYAN}[4/5]${RESET} Configuring for remote access..."

# Generate a strong random token
TOKEN=$(openssl rand -hex 24)

# Get the config file path
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

if [ -f "$CONFIG_FILE" ]; then
  # Update existing config — set bind to lan and update token
  # Use node to safely merge JSON
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
    cfg.gateway = cfg.gateway || {};
    cfg.gateway.bind = 'lan';
    cfg.gateway.auth = { mode: 'token', token: '$TOKEN' };
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
  "
else
  mkdir -p "$HOME/.openclaw"
  cat > "$CONFIG_FILE" <<EOCFG
{
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "$TOKEN"
    }
  }
}
EOCFG
fi
echo "  Remote access configured ✓"

# ── 5. Install as service & start ──────────────────────────────
echo -e "${CYAN}[5/5]${RESET} Installing as service..."

openclaw gateway install 2>/dev/null || true
openclaw gateway restart 2>/dev/null || openclaw gateway --port 18789 &

sleep 2

# ── Done ───────────────────────────────────────────────────────

# Detect IP addresses
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "unknown")
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")

echo ""
echo -e "${GREEN}${BOLD}✓ Remote engine is ready!${RESET}"
echo ""
echo -e "${BOLD}Connection details for Agent Studio:${RESET}"
echo ""

if [ -n "$TAILSCALE_IP" ]; then
  echo -e "  ${CYAN}Tailscale URL:${RESET}  ws://${TAILSCALE_IP}:18789"
fi
echo -e "  ${CYAN}LAN URL:${RESET}        ws://${LOCAL_IP}:18789"
echo -e "  ${CYAN}Token:${RESET}          ${TOKEN}"
echo ""
echo -e "Paste these into Agent Studio → Settings → Engine → Remote"
echo ""
