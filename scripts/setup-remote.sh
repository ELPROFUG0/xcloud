#!/usr/bin/env bash
# xCloud remote engine setup.
#
# Host this file at:
#   https://xcloud.so/setup-remote.sh
#
# Usage:
#   curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --lan
#   curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --ssh
#   curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --update-only
#
# Optional:
#   XCLOUD_REMOTE_ASSET_BASE_URL=https://xcloud.so/openclaw-extensions/unicore-workspace

set -euo pipefail

ACCESS="lan"
UPDATE_ONLY="0"
TOKEN="${XCLOUD_ENGINE_TOKEN:-}"
ASSET_BASE_URL="${XCLOUD_REMOTE_ASSET_BASE_URL:-https://xcloud.so/openclaw-extensions/unicore-workspace}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --lan|--mac-mini)
      ACCESS="lan"
      ;;
    --ssh|--host|--vps)
      ACCESS="ssh"
      ;;
    --update-only|--repair)
      UPDATE_ONLY="1"
      ;;
    --token)
      shift
      TOKEN="${1:-}"
      ;;
    --asset-base-url)
      shift
      ASSET_BASE_URL="${1:-}"
      ;;
    -h|--help)
      cat <<'HELP'
xCloud remote engine setup

Usage:
  curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --lan
  curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --ssh
  curl -fsSL https://xcloud.so/setup-remote.sh | bash -s -- --update-only

Options:
  --lan, --mac-mini       Bind the OpenClaw gateway to LAN for a nearby Mac/PC.
  --ssh, --host, --vps    Bind to loopback for SSH tunnel use.
  --update-only, --repair Update xCloud helper files without re-onboarding.
  --token TOKEN           Reuse a specific gateway token.
  --asset-base-url URL    Override where plugin assets are downloaded from.
HELP
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

bold="$(printf '\033[1m')"
green="$(printf '\033[32m')"
cyan="$(printf '\033[36m')"
yellow="$(printf '\033[33m')"
reset="$(printf '\033[0m')"

say() {
  printf '%b\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1
}

decode_b64() {
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
}

install_node_if_missing() {
  if require_command npm; then
    return
  fi

  say "${cyan}[node]${reset} npm not found. Installing Node.js runtime..."
  if require_command apt-get; then
    sudo_cmd=""
    [ "$(id -u)" -eq 0 ] || sudo_cmd="sudo"
    $sudo_cmd apt-get update
    $sudo_cmd apt-get install -y curl ca-certificates gnupg openssl build-essential python3
    curl -fsSL https://deb.nodesource.com/setup_22.x | $sudo_cmd -E bash -
    $sudo_cmd apt-get install -y nodejs
  else
    curl -fsSL https://openclaw.ai/install.sh | bash
  fi
}

ensure_openclaw() {
  install_node_if_missing
  say "${cyan}[openclaw]${reset} Installing/updating OpenClaw..."
  unset npm_config_prefix
  npm install -g openclaw@latest
  openclaw --version || true
}

find_openclaw_roots() {
  node - <<'NODE'
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const os = require("os");
const roots = [];
function add(root) {
  if (!root) return;
  try { root = fs.realpathSync(root); } catch {}
  if (!fs.existsSync(path.join(root, "dist"))) return;
  if (!roots.includes(root)) roots.push(root);
}
try {
  const bin = cp.execSync("command -v openclaw", { encoding: "utf8", shell: "/bin/sh" }).trim();
  let current = fs.realpathSync(bin);
  if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current);
  for (let i = 0; i < 10; i += 1) {
    add(current);
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
} catch {}
try {
  const npmRoot = cp.execSync("npm root -g", { encoding: "utf8" }).trim();
  add(path.join(npmRoot, "openclaw"));
} catch {}
try {
  const runtimeDeps = path.join(os.homedir(), ".openclaw", "plugin-runtime-deps");
  for (const entry of fs.readdirSync(runtimeDeps, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("openclaw-")) {
      add(path.join(runtimeDeps, entry.name));
    }
  }
} catch {}
process.stdout.write(roots.join("\n"));
NODE
}

patch_plugin_imports() {
  node - "$1" "$2" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const file = process.argv[3];
function first(pattern) {
  return fs.readdirSync(path.join(root, "dist"))
    .find((name) => pattern.test(name) && name.endsWith(".js"));
}
const pluginEntry = first(/^plugin-entry-/);
const agentsAdd = first(/^agents\.commands\.add-/);
if (!pluginEntry || !agentsAdd) {
  throw new Error("Could not locate OpenClaw plugin-entry or agents.commands.add runtime files.");
}
const pluginEntrySource = fs.readFileSync(path.join(root, "dist", pluginEntry), "utf8");
const agentsAddSource = fs.readFileSync(path.join(root, "dist", agentsAdd), "utf8");
const pluginEntryImport = /export\s*\{\s*definePluginEntry\s+as\s+t\s*\}/.test(pluginEntrySource)
  ? `import { t as definePluginEntry } from "../../${pluginEntry}";`
  : `import { definePluginEntry } from "../../${pluginEntry}";`;
const agentsAddImport = /export\s*\{\s*agentsAddCommand\s+as\s+t\s*\}/.test(agentsAddSource)
  ? `import { t as agentsAddCommand } from "../../${agentsAdd}";`
  : `import { agentsAddCommand } from "../../${agentsAdd}";`;
let source = fs.readFileSync(file, "utf8");
source = source
  .replace(/^import \{ (?:t as )?definePluginEntry \} from "\.\.\/\.\.\/plugin-entry-[^"]+";/m, pluginEntryImport)
  .replace(/^import \{ (?:t as )?agentsAddCommand \} from "\.\.\/\.\.\/agents\.commands\.add-[^"]+";/m, agentsAddImport);
fs.writeFileSync(file, source, "utf8");
NODE
}

download_plugin_file() {
  file="$1"
  target="$2"
  curl -fsSL "${ASSET_BASE_URL}/${file}" -o "$target"
}

install_xcloud_runtime_plugin() {
  roots="$(find_openclaw_roots)"
  if [ -z "$roots" ]; then
    echo "Could not locate the OpenClaw install used by this host." >&2
    exit 1
  fi

  printf '%s\n' "$roots" | while IFS= read -r openclaw_root; do
    missing_deps=""
    [ -f "$openclaw_root/node_modules/@lydell/node-pty/package.json" ] || missing_deps="$missing_deps @lydell/node-pty@1.2.0-beta.12"
    [ -f "$openclaw_root/node_modules/typebox/package.json" ] || missing_deps="$missing_deps typebox@1.1.33"
    if [ -n "$missing_deps" ]; then
      say "${cyan}[runtime]${reset} Installing xCloud dependencies in $openclaw_root:$missing_deps"
      npm install --prefix "$openclaw_root" --no-save --omit=dev $missing_deps
    fi

    plugin_dir="$openclaw_root/dist/extensions/unicore-workspace"
    mkdir -p "$plugin_dir"
    say "${cyan}[runtime]${reset} Installing xCloud OpenClaw plugin in $plugin_dir"
    download_plugin_file "openclaw.plugin.json" "$plugin_dir/openclaw.plugin.json"
    download_plugin_file "package.json" "$plugin_dir/package.json"
    download_plugin_file "index.js" "$plugin_dir/index.js"
    patch_plugin_imports "$openclaw_root" "$plugin_dir/index.js"
  done
}

write_xcloud_config() {
  node - <<'NODE'
const fs = require("fs");
const os = require("os");
const path = require("path");
const payload = {
  pluginsEnable: ["unicore-workspace"],
  pluginsDisable: ["xcloud-terminal"],
  tools: [
    "xcloud_context",
    "xcloud_ui_action",
    "xcloud_agent_create",
    "xcloud_agent_ui_create",
    "workspace_agent_create",
  ],
  allowedOrigins: [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
  ],
};
const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
config.plugins ??= {};
config.plugins.entries ??= {};
for (const id of payload.pluginsEnable) {
  config.plugins.entries[id] = { ...(config.plugins.entries[id] || {}), enabled: true };
}
for (const id of payload.pluginsDisable) {
  if (config.plugins.entries[id]) {
    config.plugins.entries[id] = { ...config.plugins.entries[id], enabled: false };
  }
}
config.tools ??= {};
const allow = Array.isArray(config.tools.alsoAllow) ? config.tools.alsoAllow.map(String) : [];
for (const tool of payload.tools) if (!allow.includes(tool)) allow.push(tool);
config.tools.alsoAllow = allow;
config.gateway ??= {};
config.gateway.controlUi ??= {};
const origins = Array.isArray(config.gateway.controlUi.allowedOrigins)
  ? config.gateway.controlUi.allowedOrigins.map(String)
  : [];
for (const origin of payload.allowedOrigins) if (!origins.includes(origin)) origins.push(origin);
config.gateway.controlUi.allowedOrigins = origins;
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
NODE
}

write_main_agent_defaults() {
  node <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const workspace = path.join(os.homedir(), ".openclaw", "workspace");
const identityPath = path.join(workspace, "IDENTITY.md");
const agentsPath = path.join(workspace, "AGENTS.md");
const markerStart = "<!-- XCLOUD_MAIN_AGENT_START -->";
const identityMd = `# IDENTITY.md

- **Name:** Main
- **Role:** Global xCloud main agent for this OpenClaw engine.
- **Vibe:** Practical, direct, helpful, and context-aware.

You are the global Main agent for this engine. You coordinate normal chats, agents, tools, automations, channels, integrations, memory, and app work unless the user is explicitly inside a named xCloud workspace.
`;
const agentsAppend = `<!-- XCLOUD_MAIN_AGENT_START -->

## xCloud Main Agent

You are the global Main agent for this OpenClaw engine.

- Your agent id is \`main\`.
- Your display name is \`Main\` unless the user intentionally changes your identity.
- The OpenClaw "workspace" folder is your durable home directory.
- Named xCloud workspaces are separate project spaces with their own workspace-scoped main agents.

<!-- XCLOUD_MAIN_AGENT_END -->
`;
function isPlaceholderIdentity(content) {
  const value = String(content || "").trim();
  return !value
    || value.includes("_Fill this in during your first conversation._")
    || value.includes("_(pick something you like)_")
    || value.includes("_(AI? robot? familiar?")
    || /^\s*-?\s*\*\*Name:\*\*\s*(?:\r?\n\s*_\(|$)/im.test(value);
}
fs.mkdirSync(workspace, { recursive: true });
let identity = "";
try { identity = fs.readFileSync(identityPath, "utf8"); } catch {}
if (isPlaceholderIdentity(identity)) {
  fs.writeFileSync(identityPath, identityMd, "utf8");
}
let agents = "";
try { agents = fs.readFileSync(agentsPath, "utf8"); } catch {}
if (!agents.includes(markerStart)) {
  fs.writeFileSync(agentsPath, agents.trimEnd() + (agents.trim() ? "\n\n" : "") + agentsAppend, "utf8");
}
NODE
}

approve_pending_devices() {
  openclaw devices approve --latest >/dev/null 2>&1 && say "${green}Approved pending OpenClaw device request.${reset}" || true
  node <<'NODE'
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const stateDir = path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");
const pendingPath = path.join(stateDir, "devices", "pending.json");
let token = "";
try {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  token = config?.gateway?.auth?.token || "";
} catch {}
let pending = {};
try { pending = JSON.parse(fs.readFileSync(pendingPath, "utf8")); } catch {}
for (const requestId of Object.keys(pending)) {
  const args = ["devices", "approve", requestId];
  if (token) args.push("--token", token);
  cp.spawnSync("openclaw", args, { stdio: "inherit" });
}
NODE
}

configure_gateway() {
  if [ -z "$TOKEN" ]; then
    TOKEN="$(openssl rand -hex 24)"
  fi

  bind="loopback"
  [ "$ACCESS" = "lan" ] && bind="lan"

  if [ "$UPDATE_ONLY" = "0" ]; then
    status=0
    openclaw onboard --non-interactive --accept-risk --mode local --gateway-bind "$bind" --gateway-auth token --gateway-token "$TOKEN" --install-daemon --skip-channels --skip-skills --skip-search --skip-ui || status=$?
    if [ "$status" -ne 0 ]; then
      say "${yellow}OpenClaw setup finished with a health warning; continuing.${reset}"
    fi
  fi

  node - "$ACCESS" "$TOKEN" <<'NODE'
const fs = require("fs");
const os = require("os");
const path = require("path");
const access = process.argv[2];
const token = process.argv[3];
const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
config.gateway ??= {};
config.gateway.mode = "local";
config.gateway.bind = access === "lan" ? "lan" : "loopback";
config.gateway.auth = { mode: "token", token };
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
NODE
}

detect_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname
}

print_connection() {
  say ""
  say "${green}${bold}xCloud remote engine ready.${reset}"
  say ""
  if [ "$ACCESS" = "lan" ]; then
    ip="$(detect_ip)"
    say "URL: ws://${ip}:18789"
    say ""
    say "Paste this in xCloud:"
    say "xcloud://engine?mode=mac-mini&url=ws://${ip}:18789&token=${TOKEN}"
  else
    host="$(detect_ip)"
    user_name="$(id -un 2>/dev/null || echo root)"
    say "Host: ${host}"
    say "SSH user: ${user_name}"
    say "SSH port: 22"
    say "Remote port: 18789"
    say "Local tunnel port: 18790"
    say "SSH tunnel: ssh -N -L 18790:127.0.0.1:18789 ${user_name}@${host}"
    say "URL: ws://127.0.0.1:18790"
    say ""
    say "Paste this in xCloud:"
    say "xcloud://engine?mode=vps&host=${host}&user=${user_name}&sshPort=22&remotePort=18789&localPort=18790&token=${TOKEN}"
  fi
  say "Token: ${TOKEN}"
  say ""
}

say ""
say "${bold}xCloud remote engine setup${reset}"
say ""

ensure_openclaw
install_xcloud_runtime_plugin
configure_gateway
write_main_agent_defaults
write_xcloud_config
openclaw gateway restart || say "${yellow}Warning: gateway restart reported a problem; run openclaw gateway status.${reset}"
openclaw gateway status || true
approve_pending_devices
openclaw gateway status || true
print_connection
