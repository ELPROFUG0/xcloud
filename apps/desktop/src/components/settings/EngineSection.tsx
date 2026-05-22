import { useState, useEffect } from "react";
import { ChevronLeft, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BrowserEngine } from "@/lib/engine";
import type { EngineMode } from "./types";

import cloudServerLogo from "@/assets/engine/cloud-server.png";
import macMiniLogo from "@/assets/engine/mac-mini.svg";
import localDesktopLogo from "@/assets/engine/local-desktop.svg";

const XCLOUD_TERMINAL_PLUGIN_MANIFEST = `{
  "id": "xcloud-terminal",
  "name": "xCloud Terminal",
  "description": "Remote terminal bridge for xCloud.",
  "enabledByDefault": true,
  "activation": { "onStartup": true },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
`;

const XCLOUD_TERMINAL_PLUGIN_PACKAGE = `{
  "name": "@xcloud/openclaw-terminal-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@lydell/node-pty": "1.2.0-beta.12"
  },
  "openclaw": { "extensions": ["./index.js"] }
}
`;

const XCLOUD_TERMINAL_PLUGIN_INDEX = `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessions = new Map();
let ptyModulePromise = null;

async function loadPty() {
  ptyModulePromise ??= (async () => {
    let lastError = null;
    for (const specifier of ["@lydell/node-pty", "@lydell/node-pty/index.js"]) {
      try {
        return await import(specifier);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("Cannot load @lydell/node-pty.");
  })();
  const module = await ptyModulePromise;
  const spawn = module.spawn ?? module.default?.spawn;
  if (!spawn) throw new Error("PTY support is unavailable on this engine.");
  return spawn;
}

function int(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function text(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function authProfilesPath() {
  return path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
}

function authProfileProvider(profile) {
  if (!profile || typeof profile !== "object") return "";
  if (typeof profile.provider === "string" && profile.provider) return profile.provider;
  const credential = profile.credential;
  if (credential && typeof credential === "object" && typeof credential.provider === "string") return credential.provider;
  return "";
}

function hasAuthProvider(profiles, provider) {
  if (!profiles || typeof profiles !== "object") return false;
  return Object.entries(profiles).some(([id, profile]) => (
    authProfileProvider(profile) === provider ||
    (typeof id === "string" && id.startsWith(provider + ":"))
  ));
}

async function disconnectAuthProvider(providerRaw) {
  const provider = text(providerRaw).trim();
  if (!provider) throw new Error("Auth provider is required.");
  const filePath = authProfilesPath();
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") {
      return { ok: true, provider, removed: 0, status: { openaiCodex: false, githubCopilot: false } };
    }
    throw err;
  }

  const value = JSON.parse(raw || "{}");
  const profiles = value?.profiles && typeof value.profiles === "object" && !Array.isArray(value.profiles)
    ? value.profiles
    : null;
  if (!profiles) {
    return { ok: true, provider, removed: 0, status: { openaiCodex: false, githubCopilot: false } };
  }

  let removed = 0;
  for (const [id, profile] of Object.entries(profiles)) {
    if (authProfileProvider(profile) === provider || (typeof id === "string" && id.startsWith(provider + ":"))) {
      delete profiles[id];
      removed += 1;
    }
  }
  if (removed > 0) await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\\n", "utf8");

  return {
    ok: true,
    provider,
    removed,
    status: {
      openaiCodex: hasAuthProvider(profiles, "openai-codex"),
      githubCopilot: hasAuthProvider(profiles, "github-copilot")
    }
  };
}

function shell(command) {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: command ? ["/d", "/s", "/c", command] : [] };
  }
  return { command: process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), args: command ? ["-lc", command] : ["-l"] };
}

function push(session, data) {
  session.seq += 1;
  session.chunks.push({ seq: session.seq, data });
  if (session.chunks.length > 2000) session.chunks.splice(0, session.chunks.length - 2000);
  session.updatedAt = Date.now();
}

function session(id) {
  const key = text(id);
  if (!key) throw new Error("PTY id is required.");
  const found = sessions.get(key);
  if (!found) throw new Error("Remote terminal session not found.");
  return found;
}

function sweep() {
  const now = Date.now();
  for (const [id, value] of sessions) {
    if (value.exited && now - value.updatedAt > 300000) sessions.delete(id);
  }
}

function fail(respond, err) {
  respond(false, void 0, {
    code: "UNAVAILABLE",
    message: err instanceof Error ? err.message : String(err)
  });
}

function register(api) {
  api.registerGatewayMethod("xcloud.pty.spawn", async ({ params, respond }) => {
    try {
      sweep();
      const spawn = await loadPty();
      const command = text(params?.command);
      const cols = int(params?.cols, 80, 20, 400);
      const rows = int(params?.rows, 24, 8, 120);
      const cwdRaw = text(params?.cwd);
      const cwd = cwdRaw ? cwdRaw.replace(/^~(?=\\/|$)/, os.homedir()) : os.homedir();
      const launch = shell(command);
      const pty = spawn(launch.command, launch.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: process.env.TERM || "xterm-256color" }
      });
      const id = randomUUID();
      const value = { id, pty, chunks: [], seq: 0, exited: false, exitCode: null, signal: null, updatedAt: Date.now() };
      pty.onData((data) => push(value, data));
      pty.onExit((event) => {
        value.exited = true;
        value.exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
        value.signal = typeof event.signal === "number" || typeof event.signal === "string" ? event.signal : null;
        value.updatedAt = Date.now();
      });
      sessions.set(id, value);
      respond(true, { id, pid: pty.pid ?? null, cols, rows });
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });

  api.registerGatewayMethod("xcloud.pty.read", async ({ params, respond }) => {
    try {
      const value = session(params?.id);
      const after = int(params?.after, 0, 0, Number.MAX_SAFE_INTEGER);
      respond(true, {
        id: value.id,
        chunks: value.chunks.filter((chunk) => chunk.seq > after),
        lastSeq: value.seq,
        exited: value.exited,
        exitCode: value.exitCode,
        signal: value.signal
      });
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });

  api.registerGatewayMethod("xcloud.pty.write", async ({ params, respond }) => {
    try {
      const value = session(params?.id);
      const data = typeof params?.data === "string" ? params.data : "";
      if (data && !value.exited) value.pty.write(data);
      respond(true, { ok: true });
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });

  api.registerGatewayMethod("xcloud.pty.resize", async ({ params, respond }) => {
    try {
      const value = session(params?.id);
      const cols = int(params?.cols, 80, 20, 400);
      const rows = int(params?.rows, 24, 8, 120);
      if (!value.exited) value.pty.resize(cols, rows);
      respond(true, { ok: true, cols, rows });
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });

  api.registerGatewayMethod("xcloud.pty.kill", async ({ params, respond }) => {
    try {
      const value = session(params?.id);
      try { value.pty.kill(); } catch {}
      sessions.delete(value.id);
      respond(true, { ok: true });
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });

  api.registerGatewayMethod("xcloud.auth.disconnect", async ({ params, respond }) => {
    try {
      respond(true, await disconnectAuthProvider(params?.provider));
    } catch (err) {
      fail(respond, err);
    }
  }, { scope: "operator.admin" });
}

export default definePluginEntry({
  id: "xcloud-terminal",
  name: "xCloud Terminal",
  description: "Remote terminal bridge for xCloud.",
  register
});
`;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function base64Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function writePluginFileCommand(fileName: string, content: string) {
  return `printf %s ${shellQuote(base64Text(content))} | decode_b64 > "$PLUGIN_DIR/${fileName}"`;
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
    `PLUGIN_DIR="$OPENCLAW_ROOT/dist/extensions/xcloud-terminal"`,
    `mkdir -p "$PLUGIN_DIR"`,
    writePluginFileCommand("openclaw.plugin.json", XCLOUD_TERMINAL_PLUGIN_MANIFEST),
    writePluginFileCommand("package.json", XCLOUD_TERMINAL_PLUGIN_PACKAGE),
    writePluginFileCommand("index.js", XCLOUD_TERMINAL_PLUGIN_INDEX),
    `echo "Installed xCloud remote helper in $PLUGIN_DIR"`,
  ].join(" && ");
  const installDependency = `if [ ! -f "$OPENCLAW_ROOT/node_modules/@lydell/node-pty/package.json" ]; then echo "Installing @lydell/node-pty in $OPENCLAW_ROOT"; npm install --prefix "$OPENCLAW_ROOT" --no-save --omit=dev @lydell/node-pty@1.2.0-beta.12; fi`;
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
    "openclaw config set plugins.entries.xcloud-terminal.enabled true --strict-json",
    "openclaw config set gateway.controlUi.allowedOrigins '[\"http://localhost:1420\",\"http://127.0.0.1:1420\",\"tauri://localhost\",\"http://tauri.localhost\"]' --strict-json",
    "openclaw gateway restart",
    "echo \"xCloud remote helper updated.\"",
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
        "IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0)",
        "echo \"URL: ws://$IP:18789\"",
      ]
    : [
        "HOST=$(hostname -I 2>/dev/null | awk '{print $1}' || hostname)",
        "echo \"Host: $HOST\"",
        "echo \"SSH tunnel: ssh -N -L 18790:127.0.0.1:18789 root@$HOST\"",
        "echo \"URL: ws://127.0.0.1:18790\"",
      ];
  return [
    "unset npm_config_prefix",
    "if ! command -v npm >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then SUDO=\"\"; [ \"$(id -u)\" -eq 0 ] || SUDO=\"sudo\"; $SUDO apt-get update && $SUDO apt-get install -y curl ca-certificates gnupg openssl build-essential python3 && curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; else curl -fsSL https://openclaw.ai/install.sh | bash; fi; fi",
    "npm install -g openclaw@latest",
    "TOKEN=$(openssl rand -hex 24)",
    buildRemoteHelperFilesCommand(),
    onboardCommand,
    "openclaw devices approve --latest >/dev/null 2>&1 && echo \"Approved pending OpenClaw device request.\" || true",
    "openclaw config set plugins.entries.xcloud-terminal.enabled true --strict-json || echo \"Warning: could not enable the xCloud terminal helper automatically.\"",
    "openclaw config set gateway.controlUi.allowedOrigins '[\"http://localhost:1420\",\"http://127.0.0.1:1420\",\"tauri://localhost\",\"http://tauri.localhost\"]' --strict-json || echo \"Warning: could not update Control UI allowed origins automatically.\"",
    "openclaw gateway restart || echo \"Warning: gateway restart reported a problem; run openclaw gateway status.\"",
    "openclaw gateway status || true",
    ...printConnection,
    "echo \"Token: $TOKEN\"",
  ].join(" && ");
}

const DISPLAY_REMOTE_SETUP_COMMAND = [
  "# installs Node/npm when missing",
  "npm install -g openclaw@latest",
  "# installs the xCloud remote terminal helper",
  "openclaw onboard --gateway-bind loopback ...",
  "openclaw gateway restart",
  "echo SSH tunnel, URL, and Token",
].join("\n");

const DISPLAY_REMOTE_HELPER_UPDATE_COMMAND = [
  "# for an engine that is already connected",
  "install/update xCloud remote terminal helper",
  "openclaw gateway restart",
  "keep current URL and Token",
].join("\n");

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
  const [copiedScript, setCopiedScript] = useState<"setup" | "helper" | null>(null);
  const [selectedEngineView, setSelectedEngineView] = useState<EngineMode | null>(null);

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
          const canSave = isMini ? Boolean(url.trim() && token.trim()) : Boolean(vpsSshHost.trim() && token.trim());

          return (
            <div>
              <div className="flex justify-center py-4">
                <img src={isMini ? macMiniLogo : cloudServerLogo} alt="" className="h-16 w-16 object-contain" />
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
                  <pre className="flex-1 min-w-0 rounded-xl bg-[#262626] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">{DISPLAY_REMOTE_SETUP_COMMAND}</pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(installCmd);
                      setCopiedScript("setup");
                      setTimeout(() => setCopiedScript(null), 2000);
                    }}
                    className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                  >
                    {copiedScript === "setup" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Helper repair */}
              <div className="py-4 border-b border-border/50">
                <h4 className="text-[13px] font-medium mb-1">Repair / update remote helper</h4>
                <p className="text-xs text-text-muted mb-3">
                  Use this when this {title.toLowerCase()} is already connected. It keeps the current URL and token.
                </p>
                <div className="flex items-center gap-2">
                  <pre className="flex-1 min-w-0 rounded-xl bg-[#262626] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">{DISPLAY_REMOTE_HELPER_UPDATE_COMMAND}</pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(helperUpdateCmd);
                      setCopiedScript("helper");
                      setTimeout(() => setCopiedScript(null), 2000);
                    }}
                    className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                  >
                    {copiedScript === "helper" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
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
