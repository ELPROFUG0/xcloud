import { useState, useEffect } from "react";
import { ChevronLeft, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BrowserEngine } from "@/lib/engine";
import type { EngineMode } from "./types";
import { buildMainAgentDefaultsCommand } from "@/lib/openclaw-store";
import UNICORE_WORKSPACE_PLUGIN_INDEX from "../../../src-tauri/unicore-openclaw-extensions/unicore-workspace/index.js?raw";
import UNICORE_WORKSPACE_PLUGIN_MANIFEST from "../../../src-tauri/unicore-openclaw-extensions/unicore-workspace/openclaw.plugin.json?raw";
import UNICORE_WORKSPACE_PLUGIN_PACKAGE from "../../../src-tauri/unicore-openclaw-extensions/unicore-workspace/package.json?raw";

import cloudServerLogo from "@/assets/engine/cloud-server.png";
import macMiniLogo from "@/assets/engine/mac-mini.svg";
import localDesktopLogo from "@/assets/engine/local-desktop.svg";

const REMOTE_SETUP_SCRIPT_URL = "https://xcloud.dev/setup-remote.sh";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function base64Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function writePluginFileCommand(fileName: string, content: string, dirVar = "PLUGIN_DIR") {
  return `printf %s ${shellQuote(base64Text(content))} | decode_b64 > "$${dirVar}/${fileName}"`;
}

function nodeHeredocCommand(script: string, args = "") {
  const nodeArgs = args ? ` - ${args}` : "";
  return `(node${nodeArgs} <<'NODE'\n${script}\nNODE\n)`;
}

function patchUnicoreWorkspaceImportsCommand() {
  return nodeHeredocCommand(`const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const file = process.argv[3];
function first(pattern) {
  return fs.readdirSync(path.join(root, "dist"))
    .find((name) => pattern.test(name) && name.endsWith(".js"));
}
const pluginEntry = first(/^plugin-entry-/);
const agentsAdd = first(/^agents\\.commands\\.add-/);
if (!pluginEntry || !agentsAdd) {
  throw new Error("Could not locate OpenClaw plugin-entry or agents.commands.add runtime files.");
}
const pluginEntrySource = fs.readFileSync(path.join(root, "dist", pluginEntry), "utf8");
const agentsAddSource = fs.readFileSync(path.join(root, "dist", agentsAdd), "utf8");
const pluginEntryImport = /export\\s*\\{\\s*definePluginEntry\\s+as\\s+t\\s*\\}/.test(pluginEntrySource)
  ? \`import { t as definePluginEntry } from "../../\${pluginEntry}";\`
  : \`import { definePluginEntry } from "../../\${pluginEntry}";\`;
const agentsAddImport = /export\\s*\\{\\s*agentsAddCommand\\s+as\\s+t\\s*\\}/.test(agentsAddSource)
  ? \`import { t as agentsAddCommand } from "../../\${agentsAdd}";\`
  : \`import { agentsAddCommand } from "../../\${agentsAdd}";\`;
let source = fs.readFileSync(file, "utf8");
source = source
  .replace(/^import \\{ (?:t as )?definePluginEntry \\} from "\\.\\.\\/\\.\\.\\/plugin-entry-[^"]+";/m, pluginEntryImport)
  .replace(/^import \\{ (?:t as )?agentsAddCommand \\} from "\\.\\.\\/\\.\\.\\/agents\\.commands\\.add-[^"]+";/m, agentsAddImport);
fs.writeFileSync(file, source, "utf8");`, `"$OPENCLAW_ROOT" "$UNICORE_PLUGIN_DIR/index.js"`);
}

function buildRemoteXcloudConfigCommand() {
  const payload = base64Text(JSON.stringify({
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
  }));
  return nodeHeredocCommand(`const fs = require("fs");
const os = require("os");
const path = require("path");
const payload = JSON.parse(Buffer.from("${payload}", "base64").toString("utf8"));
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
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\\n", "utf8");`);
}

function buildRemoteApprovePendingDevicesCommand() {
  return nodeHeredocCommand(`const cp = require("child_process");
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
}`);
}

function buildRemoteHelperFilesCommand() {
  const resolveRoots = `OPENCLAW_ROOTS="$(node - <<'NODE'
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
process.stdout.write(roots.join("\\n"));
NODE
)"`;
  const writeFiles = [
    `UNICORE_PLUGIN_DIR="$OPENCLAW_ROOT/dist/extensions/unicore-workspace"`,
    `mkdir -p "$UNICORE_PLUGIN_DIR"`,
    writePluginFileCommand("openclaw.plugin.json", UNICORE_WORKSPACE_PLUGIN_MANIFEST, "UNICORE_PLUGIN_DIR"),
    writePluginFileCommand("package.json", UNICORE_WORKSPACE_PLUGIN_PACKAGE, "UNICORE_PLUGIN_DIR"),
    writePluginFileCommand("index.js", UNICORE_WORKSPACE_PLUGIN_INDEX, "UNICORE_PLUGIN_DIR"),
    patchUnicoreWorkspaceImportsCommand(),
    `echo "Installed xCloud runtime plugins in $OPENCLAW_ROOT/dist/extensions"`,
  ].join(" && ");
  const installDependency = [
    `MISSING_DEPS=""`,
    `[ -f "$OPENCLAW_ROOT/node_modules/@lydell/node-pty/package.json" ] || MISSING_DEPS="$MISSING_DEPS @lydell/node-pty@1.2.0-beta.12"`,
    `[ -f "$OPENCLAW_ROOT/node_modules/typebox/package.json" ] || MISSING_DEPS="$MISSING_DEPS typebox@1.1.33"`,
    `if [ -n "$MISSING_DEPS" ]; then echo "Installing xCloud runtime dependencies in $OPENCLAW_ROOT:$MISSING_DEPS"; npm install --prefix "$OPENCLAW_ROOT" --no-save --omit=dev $MISSING_DEPS; fi`,
  ].join("; ");
  return [
    `unset npm_config_prefix`,
    resolveRoots,
    `if [ -z "$OPENCLAW_ROOTS" ]; then echo "Could not locate the OpenClaw install used by this host."; exit 1; fi`,
    `decode_b64() { if base64 --decode </dev/null >/dev/null 2>&1; then base64 --decode; else base64 -D; fi; }`,
    `printf '%s\\n' "$OPENCLAW_ROOTS" | while IFS= read -r OPENCLAW_ROOT; do ${installDependency}; ${writeFiles}; done`,
  ].join(" && ");
}

function buildRemoteHelperUpdateCommand() {
  return [
    "openclaw --version >/dev/null",
    buildRemoteHelperFilesCommand(),
    buildRemoteXcloudConfigCommand(),
    "openclaw gateway restart",
    "openclaw gateway status || true",
    buildRemoteApprovePendingDevicesCommand(),
    "echo \"xCloud remote runtime updated.\"",
  ].join(" && ");
}

function buildRemoteSetupCommand(access: "lan" | "ssh" = "ssh") {
  const gatewayBind = access === "lan" ? "lan" : "loopback";
  const onboardCommand = [
    "ONBOARD_STATUS=0",
    `openclaw onboard --non-interactive --accept-risk --mode local --gateway-bind ${gatewayBind} --gateway-auth token --gateway-token "$TOKEN" --install-daemon --skip-channels --skip-skills --skip-search --skip-ui || ONBOARD_STATUS=$?`,
    "if [ \"$ONBOARD_STATUS\" -ne 0 ]; then echo \"OpenClaw setup finished with a health warning; continuing to print xCloud connection details.\"; fi",
  ].join("; ");
  const printConnection = access === "lan"
    ? [
        "IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname)",
        "echo \"URL: ws://$IP:18789\"",
        "echo \"\"",
        "echo \"Paste this in xCloud:\"",
        "echo \"xcloud://engine?mode=mac-mini&url=ws://$IP:18789&token=$TOKEN\"",
      ]
    : [
        "USER_NAME=$(id -un 2>/dev/null || echo root)",
        "HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)",
        "echo \"Host: $HOST\"",
        "echo \"SSH user: $USER_NAME\"",
        "echo \"SSH port: 22\"",
        "echo \"Remote port: 18789\"",
        "echo \"Local tunnel port: 18790\"",
        "echo \"SSH tunnel: ssh -N -L 18790:127.0.0.1:18789 $USER_NAME@$HOST\"",
        "echo \"URL: ws://127.0.0.1:18790\"",
        "echo \"\"",
        "echo \"Paste this in xCloud:\"",
        "echo \"xcloud://engine?mode=vps&host=$HOST&user=$USER_NAME&sshPort=22&remotePort=18789&localPort=18790&token=$TOKEN\"",
      ];
  return [
    "unset npm_config_prefix",
    "if ! command -v npm >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then SUDO=\"\"; [ \"$(id -u)\" -eq 0 ] || SUDO=\"sudo\"; $SUDO apt-get update && $SUDO apt-get install -y curl ca-certificates gnupg openssl build-essential python3 && curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; else curl -fsSL https://openclaw.ai/install.sh | bash; fi; fi",
    "npm install -g openclaw@latest",
    "TOKEN=$(openssl rand -hex 24)",
    buildRemoteHelperFilesCommand(),
    onboardCommand,
    buildMainAgentDefaultsCommand(),
    "openclaw devices approve --latest >/dev/null 2>&1 && echo \"Approved pending OpenClaw device request.\" || true",
    buildRemoteXcloudConfigCommand(),
    "openclaw gateway restart || echo \"Warning: gateway restart reported a problem; run openclaw gateway status.\"",
    "openclaw gateway status || true",
    buildRemoteApprovePendingDevicesCommand(),
    "openclaw gateway status || true",
    ...printConnection,
    "echo \"Token: $TOKEN\"",
  ].join(" && ");
}

function buildHostedRemoteSetupCommand(access: "lan" | "ssh" = "ssh") {
  return `curl -fsSL ${REMOTE_SETUP_SCRIPT_URL} | bash -s -- --${access}`;
}

function buildHostedRemoteUpdateCommand() {
  return `curl -fsSL ${REMOTE_SETUP_SCRIPT_URL} | bash -s -- --update-only`;
}

interface EngineSectionProps {
  engine: BrowserEngine;
}

const ENGINE_VIEW_LABELS: Record<EngineMode, { label: string; desc: string }> = {
  local: { label: "Local", desc: "This machine" },
  "mac-mini": { label: "Mac mini", desc: "Home OpenClaw host" },
  vps: { label: "OpenClaw host", desc: "Any VPS or server" },
};

function normalizeGatewayUrl(value: string) {
  const trimmed = value.trim().replace(/^URL:\s*/i, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  return `ws://${trimmed}`;
}

function normalizeGatewayToken(value: string) {
  return value.trim().replace(/^Token:\s*/i, "");
}

function normalizePort(value: string | number | null | undefined, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function localTunnelUrl(port: string | number | null | undefined) {
  return `ws://127.0.0.1:${normalizePort(port, 18790)}`;
}

type RemoteConnectionPaste = {
  mode: Exclude<EngineMode, "local">;
  url?: string;
  token: string;
  host?: string;
  user?: string;
  sshPort?: number;
  remotePort?: number;
  localPort?: number;
};

function lineValue(input: string, label: string) {
  const match = input.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function parseRemoteConnectionPaste(input: string, fallbackMode: Exclude<EngineMode, "local">): RemoteConnectionPaste {
  const value = input.trim();
  if (!value) throw new Error("Paste the connection block from your remote engine.");

  const uriMatch = value.match(/xcloud:\/\/engine\?[^\s]+/i);
  const rawUri = uriMatch?.[0] ?? (value.startsWith("xcloud://engine?") ? value : "");
  if (rawUri) {
    const parsed = new URL(rawUri);
    const params = parsed.searchParams;
    const rawMode = params.get("mode");
    const mode: Exclude<EngineMode, "local"> = rawMode === "vps" ? "vps" : "mac-mini";
    const token = params.get("token")?.trim() ?? "";
    if (!token) throw new Error("The connection string is missing a token.");
    const localPort = normalizePort(params.get("localPort"), 18790);
    const remotePort = normalizePort(params.get("remotePort"), 18789);
    return {
      mode,
      url: params.get("url") ? normalizeGatewayUrl(params.get("url") ?? "") : localTunnelUrl(localPort),
      token,
      host: params.get("host")?.trim() || "",
      user: params.get("user")?.trim() || "root",
      sshPort: normalizePort(params.get("sshPort"), 22),
      remotePort,
      localPort,
    };
  }

  const token = normalizeGatewayToken(lineValue(value, "Token"));
  if (!token) throw new Error("The connection block is missing Token.");

  const host = lineValue(value, "Host");
  const user = lineValue(value, "SSH user") || "root";
  const sshPort = normalizePort(lineValue(value, "SSH port"), 22);
  const remotePort = normalizePort(lineValue(value, "Remote port"), 18789);
  const localPort = normalizePort(lineValue(value, "Local tunnel port"), 18790);
  const url = normalizeGatewayUrl(lineValue(value, "URL"));
  const hasSsh = Boolean(host || /SSH tunnel\s*:/i.test(value));
  const mode = hasSsh ? "vps" : fallbackMode;

  return {
    mode,
    url: hasSsh ? localTunnelUrl(localPort) : url,
    token,
    host,
    user,
    sshPort,
    remotePort,
    localPort,
  };
}

function inferSshHostFromGatewayUrl(url: string) {
  try {
    const parsed = new URL(normalizeGatewayUrl(url).replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://"));
    if (!parsed.hostname || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return "";
    return parsed.hostname;
  } catch {
    return "";
  }
}

function getStoredRemoteEngineConfig(mode: Exclude<EngineMode, "local">) {
  const prefix = mode === "mac-mini" ? "engineMacMini" : "engineVps";
  return {
    url: localStorage.getItem(`${prefix}Url`) ?? "",
    token: localStorage.getItem(`${prefix}Token`) ?? "",
  };
}

async function writeGatewayModeToOpenClawConfig(mode: EngineMode, url?: string, token?: string) {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home }).catch(() => "{}");
  const config = JSON.parse(raw || "{}") as Record<string, unknown>;
  const gateway = ((config.gateway && typeof config.gateway === "object") ? config.gateway : {}) as Record<string, unknown>;
  const remote = ((gateway.remote && typeof gateway.remote === "object") ? gateway.remote : {}) as Record<string, unknown>;
  const normalizedUrl = normalizeGatewayUrl(url ?? "");
  const existingRemoteUrl = typeof remote.url === "string" && remote.url.trim() ? normalizeGatewayUrl(remote.url) : "";
  const nextRemote = normalizedUrl
    ? {
        ...remote,
        url: normalizedUrl,
        ...(token?.trim() ? { token: token.trim() } : {}),
      }
    : existingRemoteUrl
      ? { ...remote, url: existingRemoteUrl }
      : null;

  if (mode === "local") {
    const nextGateway: Record<string, unknown> = { ...gateway, mode: "local" };
    delete nextGateway.remote;
    config.gateway = nextGateway;
  } else {
    if (!nextRemote) {
      config.gateway = { ...gateway, mode: "local" };
      await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
      return;
    }
    config.gateway = {
      ...gateway,
      mode: "remote",
      remote: nextRemote,
    };
  }

  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
}

export function EngineSection({ engine: _engine }: EngineSectionProps) {
  const [engineMode, setEngineModeState] = useState<EngineMode>(() =>
    (localStorage.getItem("engineMode") as EngineMode) ?? "local",
  );
  const saveRemoteEngineConfig = (mode: Exclude<EngineMode, "local">, url: string, token: string) => {
    const normalizedUrl = normalizeGatewayUrl(mode === "vps" ? localTunnelUrl(vpsTunnelPort) : url);
    const normalizedToken = normalizeGatewayToken(token);
    const prefix = mode === "mac-mini" ? "engineMacMini" : "engineVps";
    localStorage.setItem(`${prefix}Url`, normalizedUrl);
    localStorage.setItem(`${prefix}Token`, normalizedToken);
    if (mode === "mac-mini") {
      setMacMiniUrl(normalizedUrl);
      setMacMiniToken(normalizedToken);
    } else {
      localStorage.setItem("engineVpsSshHost", vpsSshHost.trim());
      localStorage.setItem("engineVpsSshUser", vpsSshUser.trim() || "root");
      localStorage.setItem("engineVpsSshPort", String(normalizePort(vpsSshPort, 22)));
      localStorage.setItem("engineVpsTunnelPort", String(normalizePort(vpsTunnelPort, 18790)));
      setVpsUrl(normalizedUrl);
      setVpsToken(normalizedToken);
    }
    return { url: normalizedUrl, token: normalizedToken };
  };
  const setEngineMode = async (m: EngineMode, remoteOverride?: { url: string; token: string }) => {
    setEngineModeState(m);
    localStorage.setItem("engineMode", m);
    const prefix = m === "mac-mini" ? "engineMacMini" : m === "vps" ? "engineVps" : "";
    const url = remoteOverride?.url ?? (prefix ? localStorage.getItem(`${prefix}Url`) ?? "" : "");
    const token = remoteOverride?.token ?? (prefix ? localStorage.getItem(`${prefix}Token`) ?? "" : "");
    await writeGatewayModeToOpenClawConfig(m, url, token).catch(() => {});
    window.dispatchEvent(new CustomEvent("xcloud-engine-config-changed"));
  };
  const [macMiniUrl, setMacMiniUrl] = useState(() => localStorage.getItem("engineMacMiniUrl") ?? "");
  const [macMiniToken, setMacMiniToken] = useState(() => localStorage.getItem("engineMacMiniToken") ?? "");
  const [vpsUrl, setVpsUrl] = useState(() => localStorage.getItem("engineVpsUrl") ?? "");
  const [vpsToken, setVpsToken] = useState(() => localStorage.getItem("engineVpsToken") ?? "");
  const [vpsSshHost, setVpsSshHost] = useState(() =>
    localStorage.getItem("engineVpsSshHost") ?? inferSshHostFromGatewayUrl(localStorage.getItem("engineVpsUrl") ?? ""),
  );
  const [vpsSshUser, setVpsSshUser] = useState(() => localStorage.getItem("engineVpsSshUser") ?? "root");
  const [vpsSshPort, setVpsSshPort] = useState(() => localStorage.getItem("engineVpsSshPort") ?? "22");
  const [vpsTunnelPort, setVpsTunnelPort] = useState(() => localStorage.getItem("engineVpsTunnelPort") ?? "18790");
  const [engineSaved, setEngineSaved] = useState(false);
  const [engineStatus, setEngineStatus] = useState<{ running: boolean; port: number; pid: number | null; managed: boolean } | null>(null);
  const [copiedScript, setCopiedScript] = useState<"setup" | "setup-standalone" | "helper" | "helper-standalone" | null>(null);
  const [selectedEngineView, setSelectedEngineView] = useState<EngineMode | null>(null);
  const [connectionPaste, setConnectionPaste] = useState("");
  const [connectionPasteStatus, setConnectionPasteStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);

  const applyRemoteConnection = async (parsed: RemoteConnectionPaste) => {
    const prefix = parsed.mode === "mac-mini" ? "engineMacMini" : "engineVps";
    const nextUrl = parsed.mode === "vps"
      ? localTunnelUrl(parsed.localPort)
      : normalizeGatewayUrl(parsed.url ?? "");
    const nextToken = normalizeGatewayToken(parsed.token);
    if (!nextUrl || !nextToken) throw new Error("Connection block needs URL and Token.");

    localStorage.setItem(`${prefix}Url`, nextUrl);
    localStorage.setItem(`${prefix}Token`, nextToken);

    if (parsed.mode === "mac-mini") {
      setMacMiniUrl(nextUrl);
      setMacMiniToken(nextToken);
    } else {
      const host = (parsed.host || inferSshHostFromGatewayUrl(parsed.url ?? "")).trim();
      if (!host) throw new Error("SSH connection block needs Host.");
      const user = (parsed.user || "root").trim() || "root";
      const sshPort = normalizePort(parsed.sshPort, 22);
      const localPort = normalizePort(parsed.localPort, 18790);
      localStorage.setItem("engineVpsSshHost", host);
      localStorage.setItem("engineVpsSshUser", user);
      localStorage.setItem("engineVpsSshPort", String(sshPort));
      localStorage.setItem("engineVpsTunnelPort", String(localPort));
      setVpsUrl(nextUrl);
      setVpsToken(nextToken);
      setVpsSshHost(host);
      setVpsSshUser(user);
      setVpsSshPort(String(sshPort));
      setVpsTunnelPort(String(localPort));
    }

    setEngineModeState(parsed.mode);
    setSelectedEngineView(parsed.mode);
    localStorage.setItem("engineMode", parsed.mode);
    await writeGatewayModeToOpenClawConfig(parsed.mode, nextUrl, nextToken).catch(() => {});
    window.dispatchEvent(new CustomEvent("xcloud-engine-config-changed"));
  };

  const pasteAndConnect = async () => {
    try {
      const fallbackMode: Exclude<EngineMode, "local"> = selectedEngineView === "vps" ? "vps" : "mac-mini";
      const parsed = parseRemoteConnectionPaste(connectionPaste, fallbackMode);
      await applyRemoteConnection(parsed);
      setConnectionPaste("");
      setConnectionPasteStatus({ type: "ok", message: `Connected config saved for ${ENGINE_VIEW_LABELS[parsed.mode].label}.` });
      setTimeout(() => setConnectionPasteStatus(null), 3500);
    } catch (error) {
      setConnectionPasteStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    invoke<{ running: boolean; port: number; pid: number | null; managed: boolean }>("engine_status")
      .then(setEngineStatus).catch(() => {});
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {selectedEngineView && (
          <button
            onClick={() => setSelectedEngineView(null)}
            className="text-text-muted hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h3 className="text-base font-semibold">
          {selectedEngineView ? ENGINE_VIEW_LABELS[selectedEngineView].label : "Engine"}
        </h3>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Engine: list view */}
        {!selectedEngineView && (
          <div className="space-y-1">
            {([
              { id: "local" as EngineMode, img: localDesktopLogo },
              { id: "mac-mini" as EngineMode, img: macMiniLogo },
              { id: "vps" as EngineMode, img: cloudServerLogo },
            ]).map(({ id, img }) => {
              const { label, desc } = ENGINE_VIEW_LABELS[id];
              const active = engineMode === id;
              const configured = id === "local"
                ? (engineStatus?.running ?? false)
                : id === "mac-mini" ? !!macMiniUrl : !!(vpsSshHost || vpsUrl);
              return (
                <button
                  key={id}
                  onClick={() => setSelectedEngineView(id)}
                  className="flex w-full items-center justify-between rounded-lg bg-container px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                      <img src={img} alt={label} className="h-5 w-5 object-contain" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-text">{label}</span>
                      <span className="text-xs text-text-muted ml-2">{desc}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {active && <span className="text-xs text-text-muted">Active</span>}
                    <div className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      active && configured ? "bg-emerald-400" : active ? "bg-amber-400" : "bg-text-muted/30",
                    )} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Engine: Local detail */}
        {selectedEngineView === "local" && (
          <div>
            <div className="flex justify-center py-4">
              <img src={localDesktopLogo} alt="Local" className="h-16 w-16 object-contain" />
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Active</span>
              <button
                onClick={() => setEngineMode("local")}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  engineMode === "local" ? "bg-emerald-500" : "bg-text-muted/20",
                )}
              >
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  engineMode === "local" ? "translate-x-4" : "translate-x-0.5",
                )} />
              </button>
            </div>
            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Status</span>
              <span className={cn("text-sm", engineStatus?.running ? "text-emerald-400" : "text-red-400")}>
                {engineStatus?.running ? "Running" : "Stopped"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Port</span>
              <span className="text-sm font-mono text-text-muted">{engineStatus?.port ?? 18789}</span>
            </div>
            {engineStatus?.pid && (
              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Process</span>
                <span className="text-sm font-mono text-text-muted">PID {engineStatus.pid}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-text">Managed</span>
              <span className="text-sm text-text-muted">{engineStatus?.managed ? "By app" : "External"}</span>
            </div>
          </div>
        )}

        {/* Engine: remote host detail */}
        {(selectedEngineView === "mac-mini" || selectedEngineView === "vps") && (() => {
          const isMini = selectedEngineView === "mac-mini";
          const title = ENGINE_VIEW_LABELS[selectedEngineView].label;
          const url = isMini ? macMiniUrl : localTunnelUrl(vpsTunnelPort);
          const token = isMini ? macMiniToken : vpsToken;
          const setUrl = isMini ? setMacMiniUrl : setVpsUrl;
          const setToken = isMini ? setMacMiniToken : setVpsToken;
          const installCmd = buildRemoteSetupCommand(isMini ? "lan" : "ssh");
          const helperUpdateCmd = buildRemoteHelperUpdateCommand();
          const hostedInstallCmd = buildHostedRemoteSetupCommand(isMini ? "lan" : "ssh");
          const hostedHelperUpdateCmd = buildHostedRemoteUpdateCommand();
          const canSave = isMini ? Boolean(url.trim() && token.trim()) : Boolean(vpsSshHost.trim() && token.trim());

          return (
            <div>
              <div className="flex justify-center py-4">
                <img src={isMini ? macMiniLogo : cloudServerLogo} alt="" className="h-16 w-16 object-contain" />
              </div>

              <div className="mb-4 rounded-xl border border-border/50 bg-container/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[13px] font-medium text-text">Paste connection block</h4>
                    <p className="text-xs text-text-muted">
                      Run the setup command on the host, paste the xCloud link or URL/token block here, then connect.
                    </p>
                  </div>
                </div>
                <textarea
                  value={connectionPaste}
                  onChange={(e) => {
                    setConnectionPaste(e.target.value);
                    setConnectionPasteStatus(null);
                  }}
                  placeholder="xcloud://engine?mode=mac-mini&url=ws://192.168.1.50:18789&token=..."
                  rows={3}
                  className="w-full resize-none rounded-xl bg-[#262626] px-3 py-2 text-[11px] font-mono leading-relaxed text-text placeholder:text-text-muted focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className={cn(
                    "min-h-4 text-[11px]",
                    connectionPasteStatus?.type === "ok" ? "text-emerald-400" : "text-red-400",
                  )}>
                    {connectionPasteStatus?.message ?? ""}
                  </span>
                  <button
                    onClick={() => void pasteAndConnect()}
                    disabled={!connectionPaste.trim()}
                    className="shrink-0 rounded-xl bg-text px-4 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
                  >
                    Paste & connect
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Active</span>
                <button
                  onClick={() => {
                    const remote = saveRemoteEngineConfig(selectedEngineView, url, token);
                    if (!canSave || !remote.url) return;
                    void setEngineMode(selectedEngineView, remote);
                  }}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    engineMode === selectedEngineView ? "bg-emerald-500" : "bg-text-muted/20",
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                    engineMode === selectedEngineView ? "translate-x-4" : "translate-x-0.5",
                  )} />
                </button>
              </div>
              {isMini ? (
                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">URL</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setEngineSaved(false); }}
                    placeholder="ws://192.168.1.50:18789"
                    className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-border/50 py-3">
                    <span className="text-sm text-text">SSH Host</span>
                    <input
                      type="text"
                      value={vpsSshHost}
                      onChange={(e) => { setVpsSshHost(e.target.value); setEngineSaved(false); }}
                      placeholder="2.24.111.200"
                      className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 py-3">
                    <span className="text-sm text-text">SSH User</span>
                    <input
                      type="text"
                      value={vpsSshUser}
                      onChange={(e) => { setVpsSshUser(e.target.value); setEngineSaved(false); }}
                      placeholder="root"
                      className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 py-3">
                    <span className="text-sm text-text">SSH Port</span>
                    <input
                      type="text"
                      value={vpsSshPort}
                      onChange={(e) => { setVpsSshPort(e.target.value); setEngineSaved(false); }}
                      placeholder="22"
                      className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 py-3">
                    <span className="text-sm text-text">Local Tunnel</span>
                    <input
                      type="text"
                      value={vpsTunnelPort}
                      onChange={(e) => { setVpsTunnelPort(e.target.value); setEngineSaved(false); }}
                      placeholder="18790"
                      className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 py-3">
                    <span className="text-sm text-text">Gateway URL</span>
                    <span className="w-52 truncate rounded-xl bg-[#202020] px-3 py-1.5 text-right font-mono text-sm text-text-muted">
                      {url}
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Token</span>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setEngineSaved(false); }}
                  placeholder="paste token"
                  className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                />
              </div>
              {/* Setup script */}
              <div className="py-4 border-b border-border/50">
                <h4 className="text-[13px] font-medium mb-1">
                  {isMini ? "Setup new Mac mini" : "Setup new OpenClaw host"}
                </h4>
                <p className="text-xs text-text-muted mb-3">
                  {isMini
                    ? "Use this on a fresh Mac mini or home server. It installs OpenClaw and outputs a URL and token."
                    : "Use this on any VPS or server that can run OpenClaw. xCloud opens the SSH tunnel automatically after you paste the SSH host and token."}
                </p>
                <div className="flex items-center gap-2">
                  <pre className="flex-1 min-w-0 rounded-xl bg-[#262626] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">
                    {[hostedInstallCmd, "", "# prints an xcloud://engine link", "# paste that link here and connect"].join("\n")}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(hostedInstallCmd);
                      setCopiedScript("setup");
                      setTimeout(() => setCopiedScript(null), 2000);
                    }}
                    className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                  >
                    {copiedScript === "setup" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <details className="mt-3 group">
                  <summary className="cursor-pointer list-none text-xs text-text-muted hover:text-text">
                    Standalone fallback
                  </summary>
                  <div className="mt-2 flex items-center gap-2">
                    <pre className="flex-1 min-w-0 rounded-xl bg-[#202020] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">
                      {"# use this only before the hosted setup script is published\n# copies the full installer inline"}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(installCmd);
                        setCopiedScript("setup-standalone");
                        setTimeout(() => setCopiedScript(null), 2000);
                      }}
                      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                    >
                      {copiedScript === "setup-standalone" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </details>
              </div>

              {/* Helper repair */}
              <div className="py-4 border-b border-border/50">
                <h4 className="text-[13px] font-medium mb-1">Repair / update remote helper</h4>
                <p className="text-xs text-text-muted mb-3">
                  Use this when this {title.toLowerCase()} is already connected. It keeps the current URL and token.
                </p>
                <div className="flex items-center gap-2">
                  <pre className="flex-1 min-w-0 rounded-xl bg-[#262626] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">
                    {[hostedHelperUpdateCmd, "", "# repairs plugins and restarts gateway", "# keeps your existing token"].join("\n")}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(hostedHelperUpdateCmd);
                      setCopiedScript("helper");
                      setTimeout(() => setCopiedScript(null), 2000);
                    }}
                    className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                  >
                    {copiedScript === "helper" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <details className="mt-3 group">
                  <summary className="cursor-pointer list-none text-xs text-text-muted hover:text-text">
                    Standalone fallback
                  </summary>
                  <div className="mt-2 flex items-center gap-2">
                    <pre className="flex-1 min-w-0 rounded-xl bg-[#202020] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">
                      {"# use this only before the hosted setup script is published\n# copies the full repair command inline"}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(helperUpdateCmd);
                        setCopiedScript("helper-standalone");
                        setTimeout(() => setCopiedScript(null), 2000);
                      }}
                      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                    >
                      {copiedScript === "helper-standalone" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </details>
              </div>

              {/* Save */}
              <div className="flex justify-center pt-5">
                <button
                  onClick={() => {
                    const activeMode = selectedEngineView;
                    const savedRemote = saveRemoteEngineConfig(activeMode, url, token);
                    if (engineMode === selectedEngineView) localStorage.setItem("engineMode", selectedEngineView);
                    const activeConfig = engineMode !== selectedEngineView && engineMode !== "local"
                      ? getStoredRemoteEngineConfig(engineMode)
                      : savedRemote;
                    writeGatewayModeToOpenClawConfig(engineMode === selectedEngineView ? activeMode : engineMode, activeConfig.url, activeConfig.token)
                      .then(() => {
                        setEngineSaved(true);
                        if (engineMode === selectedEngineView) {
                          window.dispatchEvent(new CustomEvent("xcloud-engine-config-changed"));
                        }
                        setTimeout(() => setEngineSaved(false), 3000);
                      })
                      .catch(() => {
                        setEngineSaved(true);
                        setTimeout(() => setEngineSaved(false), 3000);
                      });
                  }}
                  disabled={!canSave}
                  className="rounded-2xl bg-text text-bg px-8 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  {engineSaved ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
