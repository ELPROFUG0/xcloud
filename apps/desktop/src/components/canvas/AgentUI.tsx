import { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { FolderOpen, Plus, RefreshCw, ExternalLink, ArrowLeft, ArrowRight, X, ChevronDown, MoreHorizontal, Share2, Copy, Check } from "lucide-react";
import { XCLOUD_AG_UI_EVENT, xcloudCapabilities } from "@/lib/ag-ui-bridge";
import { setRegisteredUiTools, type XCloudUiToolDefinition, type XCloudUiActionResult } from "@/lib/ui-action-registry";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";

import cursorLogo from "@/assets/editors/cursor.svg";
import vscodeLogo from "@/assets/editors/vscode.svg";
import windsurfLogo from "@/assets/editors/windsurf.svg";
import claudeCodeLogo from "@/assets/editors/claude-code.svg";
import itermLogo from "@/assets/editors/iterm.png";
import zedLogo from "@/assets/editors/zed.svg";
import terminalLogo from "@/assets/editors/terminal.svg";
import codexLogo from "@/assets/editors/codex.svg";
import opencodeLogo from "@/assets/editors/opencode.svg";
import antigravityLogo from "@/assets/editors/antigravity.png";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

type ShareTunnelState = {
  status: "idle" | "preparing" | "starting" | "ready" | "error";
  url?: string;
  pid?: number;
  logPath?: string;
  targetUrl?: string;
  error?: string;
};

type AgentUiConfig = {
  repoPath?: string;
  port?: number;
  ownerAgentId?: string;
  openInPreview?: boolean;
  updatedAt?: string;
};

const TRY_CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
function isShareableLocalUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function cloudflaredInstallScript() {
  return `set -e
BIN_DIR="$HOME/.openclaw/bin"
BIN="$BIN_DIR/cloudflared"
mkdir -p "$BIN_DIR"
if [ -x "$BIN" ]; then
  echo "$BIN"
  exit 0
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
KEY="$OS:$ARCH"
case "$KEY" in
  darwin:arm64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
    ARCHIVE="1"
    ;;
  darwin:x86_64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
    ARCHIVE="1"
    ;;
  linux:x86_64|linux:amd64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    ARCHIVE="0"
    ;;
  linux:aarch64|linux:arm64)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    ARCHIVE="0"
    ;;
  *)
    echo "Temporary share links are not supported on $OS/$ARCH yet." >&2
    exit 2
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to prepare temporary share links." >&2
  exit 3
fi

TMP_DIR="\${TMPDIR:-/tmp}/xcloud-cloudflared-$$"
mkdir -p "$TMP_DIR"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [ "$ARCHIVE" = "1" ]; then
  curl -fsSL --connect-timeout 15 --max-time 180 "$URL" -o "$TMP_DIR/cloudflared.tgz"
  tar -xzf "$TMP_DIR/cloudflared.tgz" -C "$TMP_DIR"
  FOUND="$(find "$TMP_DIR" -type f -name cloudflared | head -1)"
  if [ -z "$FOUND" ]; then
    echo "Downloaded cloudflared archive did not contain a binary." >&2
    exit 4
  fi
  cp "$FOUND" "$BIN"
else
  curl -fsSL --connect-timeout 15 --max-time 180 "$URL" -o "$BIN"
fi

chmod 755 "$BIN"
"$BIN" --version >/dev/null
echo "$BIN"`;
}

async function writeShellFile(path: string, content: string) {
  await invoke("run_shell", {
    cmd: `cat > ${shellQuote(path)} << 'XCLOUD_EOF'\n${content}\nXCLOUD_EOF`,
  });
}

const xcloudRuntimeJs = `(function () {
  if (window.xcloud && window.xcloud.__runtimeVersion) return;

  const agUiListeners = new Set();
  const hostListeners = new Set();
  const stateListeners = new Set();
  const uiTools = new Map();
  const state = {
    agentId: null,
    sessionKey: null,
    status: "idle",
    capabilities: null,
    lastEvent: null,
    lastAction: null,
    lastError: null,
    lastToolResult: null,
    messages: [],
    activeTools: [],
    events: []
  };

  function emit(listeners, ...args) {
    for (const listener of Array.from(listeners)) {
      try { listener(...args); } catch (error) { console.error("[xcloud]", error); }
    }
  }

  function snapshot() {
    return {
      agentId: state.agentId,
      sessionKey: state.sessionKey,
      status: state.status,
      capabilities: state.capabilities,
      lastError: state.lastError,
      lastEvent: state.lastEvent,
      lastAction: state.lastAction,
      lastToolResult: state.lastToolResult,
      messages: state.messages.slice(),
      activeTools: state.activeTools.slice(),
      events: state.events.slice()
    };
  }

  function notifyState() {
    const next = snapshot();
    emit(stateListeners, next);
    window.dispatchEvent(new CustomEvent("xcloud:agent-state", { detail: next }));
    renderBindings(next);
  }

  function getMessage(messageId, role) {
    let message = state.messages.find((item) => item.id === messageId);
    if (!message) {
      message = { id: messageId, role: role || "assistant", content: "", done: false };
      state.messages.push(message);
    }
    if (role) message.role = role;
    return message;
  }

  function applyAgUiEvent(event) {
    if (!event || typeof event !== "object") return;
    const type = event.type;
    if (type === "RUN_STARTED") {
      state.status = "running";
      state.lastError = null;
      return;
    }
    if (type === "RUN_FINISHED") {
      state.status = "idle";
      state.activeTools = [];
      return;
    }
    if (type === "RUN_ERROR") {
      state.status = "error";
      state.lastError = event.message || "Run failed";
      state.activeTools = [];
      return;
    }
    if (type === "STATE_SNAPSHOT") {
      state.shared = event.snapshot || {};
      return;
    }
    if (type === "MESSAGES_SNAPSHOT") {
      state.messages = Array.isArray(event.messages) ? event.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
        done: true
      })) : [];
      return;
    }
    if (type === "CUSTOM" && event.name === "xcloud:capabilities") {
      state.capabilities = event.value || null;
      return;
    }
    if (type === "TEXT_MESSAGE_START") {
      state.status = event.role === "user" ? state.status : "responding";
      getMessage(event.messageId, event.role);
      return;
    }
    if (type === "TEXT_MESSAGE_CHUNK") {
      if (event.messageId) {
        const message = getMessage(event.messageId, event.role);
        if (event.delta) message.content += event.delta;
        message.done = false;
        if (message.role !== "user") state.status = "responding";
      }
      return;
    }
    if (type === "TEXT_MESSAGE_CONTENT") {
      const message = getMessage(event.messageId, event.role);
      message.content += event.delta || "";
      message.done = false;
      if (message.role !== "user") state.status = "responding";
      return;
    }
    if (type === "TEXT_MESSAGE_END") {
      const message = getMessage(event.messageId, event.role);
      message.done = true;
      return;
    }
    if (type === "TOOL_CALL_START") {
      state.status = "tool";
      if (!state.activeTools.some((tool) => tool.id === event.toolCallId)) {
        state.activeTools.push({ id: event.toolCallId, name: event.toolCallName || "tool", args: "" });
      }
      return;
    }
    if (type === "TOOL_CALL_ARGS") {
      const tool = state.activeTools.find((item) => item.id === event.toolCallId);
      if (tool) tool.args += event.delta || "";
      return;
    }
    if (type === "TOOL_CALL_CHUNK") {
      if (event.toolCallId && !state.activeTools.some((tool) => tool.id === event.toolCallId)) {
        state.activeTools.push({ id: event.toolCallId, name: event.toolCallName || "tool", args: "" });
      }
      const tool = state.activeTools.find((item) => item.id === event.toolCallId);
      if (tool && event.delta) tool.args += event.delta;
      state.status = "tool";
      return;
    }
    if (type === "TOOL_CALL_END") {
      state.activeTools = state.activeTools.filter((tool) => tool.id !== event.toolCallId);
      if (state.activeTools.length === 0) state.status = "responding";
      return;
    }
    if (type === "TOOL_CALL_RESULT") {
      state.lastToolResult = event;
      return;
    }
  }

  function latestAssistantMessage(next) {
    for (let index = next.messages.length - 1; index >= 0; index -= 1) {
      if (next.messages[index].role !== "user") return next.messages[index].content || "";
    }
    return "";
  }

  function renderBindings(next) {
    const root = document;
    const lastAssistant = latestAssistantMessage(next);
    root.querySelectorAll("[data-xcloud-status]").forEach((node) => { node.textContent = next.status; });
    root.querySelectorAll("[data-xcloud-last-message]").forEach((node) => { node.textContent = lastAssistant; });
    root.querySelectorAll("[data-xcloud-transcript]").forEach((node) => {
      node.innerHTML = "";
      for (const message of next.messages) {
        const item = document.createElement("div");
        item.dataset.xcloudMessageRole = message.role || "assistant";
        item.textContent = message.content || "";
        node.appendChild(item);
      }
    });
    root.querySelectorAll("[data-xcloud-tools]").forEach((node) => {
      node.textContent = next.activeTools.map((tool) => tool.name).join(", ");
    });
  }

  function publicTool(tool) {
    return {
      name: tool.name,
      description: tool.description,
      aliases: tool.aliases,
      parameters: tool.parameters
    };
  }

  function postRegisteredTools() {
    window.parent?.postMessage({
      type: "xcloud:ui-tools-registered",
      protocol: "ag-ui",
      agentId: state.agentId,
      tools: Array.from(uiTools.values()).map(publicTool)
    }, "*");
  }

  window.xcloud = {
    __runtimeVersion: "0.1.0",
    agent: {
      state,
      getState() {
        return snapshot();
      },
      getCapabilities() {
        return state.capabilities;
      },
      onAgUiEvent(listener) {
        agUiListeners.add(listener);
        return () => agUiListeners.delete(listener);
      },
      onHostInit(listener) {
        hostListeners.add(listener);
        return () => hostListeners.delete(listener);
      },
      onStateChange(listener) {
        stateListeners.add(listener);
        listener(snapshot());
        return () => stateListeners.delete(listener);
      },
      registerTool(tool) {
        if (!tool || typeof tool !== "object" || !tool.name) {
          throw new Error("xCloud UI tools require a name.");
        }
        uiTools.set(tool.name, tool);
        postRegisteredTools();
        return () => {
          uiTools.delete(tool.name);
          postRegisteredTools();
        };
      },
      registerTools(tools) {
        const cleanups = Array.isArray(tools) ? tools.map((tool) => this.registerTool(tool)) : [];
        return () => cleanups.forEach((cleanup) => cleanup());
      },
      on(type, listener) {
        if (type === "ag-ui:event" || type === "event") return this.onAgUiEvent(listener);
        if (type === "host:init" || type === "init") return this.onHostInit(listener);
        if (type === "state" || type === "agent-state") return this.onStateChange(listener);
        throw new Error("Unknown xCloud event type: " + type);
      }
    }
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "xcloud:agent-ui:init") {
      state.agentId = data.agentId || state.agentId;
      state.capabilities = data.capabilities || state.capabilities;
      emit(hostListeners, data);
      window.dispatchEvent(new CustomEvent("xcloud:agent-ui:init", { detail: data }));
      notifyState();
      postRegisteredTools();
      return;
    }

    if (data.type === "xcloud:capabilities") {
      state.agentId = data.agentId || state.agentId;
      state.capabilities = data.capabilities || null;
      notifyState();
      return;
    }

    if (data.type === "xcloud:ui-tool-call") {
      const callId = data.callId;
      const toolName = data.toolName;
      const tool = uiTools.get(toolName);
      if (!tool || typeof tool.execute !== "function") {
        window.parent?.postMessage({
          type: "xcloud:ui-tool-result",
          protocol: "ag-ui",
          agentId: state.agentId,
          callId,
          ok: false,
          error: "UI tool not found: " + toolName
        }, "*");
        return;
      }
      state.lastAction = { toolName, args: data.args || {}, instruction: data.instruction };
      notifyState();
      Promise.resolve()
        .then(() => tool.execute(data.args || {}, data))
        .then((result) => {
          window.parent?.postMessage({
            type: "xcloud:ui-tool-result",
            protocol: "ag-ui",
            agentId: state.agentId,
            callId,
            ok: true,
            result
          }, "*");
        })
        .catch((error) => {
          window.parent?.postMessage({
            type: "xcloud:ui-tool-result",
            protocol: "ag-ui",
            agentId: state.agentId,
            callId,
            ok: false,
            error: error?.message || String(error)
          }, "*");
        });
      return;
    }

    if (data.type === "xcloud:ag-ui:event") {
      state.agentId = data.agentId || state.agentId;
      state.sessionKey = data.sessionKey || state.sessionKey;
      state.lastEvent = data.event || null;
      state.events.push(data);
      if (state.events.length > 250) state.events.shift();
      applyAgUiEvent(data.event);
      emit(agUiListeners, data.event, data);
      window.dispatchEvent(new CustomEvent("xcloud:ag-ui:event", { detail: data }));
      notifyState();
    }
  });
})();`;

const xcloudAgUiModule = `export function subscribeXCloudAgUi(handler) {
  if (window.xcloud?.agent?.onAgUiEvent) {
    return window.xcloud.agent.onAgUiEvent(handler);
  }
  const listener = (event) => {
    if (event.data?.type === "xcloud:ag-ui:event") handler(event.data.event, event.data);
    if (event.detail?.type === "xcloud:ag-ui:event") handler(event.detail.event, event.detail);
  };
  window.addEventListener("message", listener);
  window.addEventListener("xcloud:ag-ui:event", listener);
  return () => {
    window.removeEventListener("message", listener);
    window.removeEventListener("xcloud:ag-ui:event", listener);
  };
}

export function subscribeXCloudHost(handler) {
  if (window.xcloud?.agent?.onHostInit) {
    return window.xcloud.agent.onHostInit(handler);
  }
  const listener = (event) => {
    if (event.data?.type === "xcloud:agent-ui:init") handler(event.data);
    if (event.detail?.type === "xcloud:agent-ui:init") handler(event.detail);
  };
  window.addEventListener("message", listener);
  window.addEventListener("xcloud:agent-ui:init", listener);
  return () => {
    window.removeEventListener("message", listener);
    window.removeEventListener("xcloud:agent-ui:init", listener);
  };
}

export function getXCloudAgentState() {
  return window.xcloud?.agent?.getState?.() ?? window.xcloud?.agent?.state ?? null;
}

export function getXCloudCapabilities() {
  return window.xcloud?.agent?.getCapabilities?.() ?? getXCloudAgentState()?.capabilities ?? null;
}

export function subscribeXCloudAgentState(handler) {
  if (window.xcloud?.agent?.onStateChange) {
    return window.xcloud.agent.onStateChange(handler);
  }
  const listener = (event) => handler(event.detail ?? null);
  window.addEventListener("xcloud:agent-state", listener);
  return () => window.removeEventListener("xcloud:agent-state", listener);
}

export function registerXCloudUiTool(tool) {
  if (!window.xcloud?.agent?.registerTool) {
    throw new Error("xCloud runtime is not ready.");
  }
  return window.xcloud.agent.registerTool(tool);
}

export function registerXCloudUiTools(tools) {
  if (!window.xcloud?.agent?.registerTools) {
    throw new Error("xCloud runtime is not ready.");
  }
  return window.xcloud.agent.registerTools(tools);
}
`;

const xcloudReactRuntime = `"use client";

import { useEffect } from "react";

function installXCloudRuntime() {
${xcloudRuntimeJs.split("\n").map((line) => `  ${line}`).join("\n")}
}

export default function XCloudRuntime() {
  useEffect(() => {
    installXCloudRuntime();
  }, []);
  return null;
}
`;

const xcloudUiGuide = `# xCloud UI Bridge

This project is connected to xCloud as an agent UI.

Do not ask the user to paste setup code or install a separate realtime package.
xCloud automatically installs the runtime and forwards live agent events into
this app.

## Built-in API

\`\`\`js
const state = window.xcloud.agent.getState();

window.xcloud.agent.onStateChange((state) => {
  // state.status: "idle" | "running" | "responding" | "tool" | "error"
  // state.messages: [{ id, role, content, done }]
  // state.activeTools: [{ id, name, args }]
});
\`\`\`

## Static HTML bindings

These update automatically when the agent talks or uses tools:

\`\`\`html
<span data-xcloud-status></span>
<div data-xcloud-last-message></div>
<div data-xcloud-transcript></div>
<div data-xcloud-tools></div>
\`\`\`

## Raw AG-UI events

Use this only when you need lower-level control:

\`\`\`js
window.xcloud.agent.onAgUiEvent((event) => {
  console.log(event.type, event);
});
\`\`\`

## Verification

- Prefer the already-running xCloud preview/dev server while iterating.
- Do not run \`npm run build\` repeatedly after small UI edits.
- Run a production build at most once near the end of a meaningful change, unless
  the user explicitly asks for repeated build checks or a previous build failed.
`;

async function ensureRealtimeBridge(repoPath: string) {
  const cleanPath = repoPath.replace(/\/$/, "");
  await writeShellFile(`${cleanPath}/xcloud-runtime.js`, xcloudRuntimeJs).catch(() => {});
  await writeShellFile(`${cleanPath}/xcloud-ag-ui.js`, xcloudAgUiModule).catch(() => {});
  await writeShellFile(`${cleanPath}/XCLOUD-UI.md`, xcloudUiGuide).catch(() => {});
  await invoke("run_shell", { cmd: `[ -d ${shellQuote(`${cleanPath}/public`)} ] && cp ${shellQuote(`${cleanPath}/xcloud-runtime.js`)} ${shellQuote(`${cleanPath}/public/xcloud-runtime.js`)} || true` }).catch(() => {});

  const patchScript = `
const fs = require("fs");
const path = require("path");
const root = ${JSON.stringify(cleanPath)};

function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
function write(file, content) { fs.writeFileSync(path.join(root, file), content); }
function ensureDir(file) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); }

const runtimeComponent = ${JSON.stringify(xcloudReactRuntime)};
const viteRuntime = ${JSON.stringify(xcloudRuntimeJs)};

function patchNext(layoutFile) {
  const runtimeFile = path.join(path.dirname(layoutFile), "xcloud-runtime.tsx");
  ensureDir(runtimeFile);
  write(runtimeFile, runtimeComponent);
  let content = read(layoutFile);
  if (!content.includes("XCloudRuntime")) {
    content = 'import XCloudRuntime from "./xcloud-runtime";\\n' + content;
    content = content.replace(/<body([^>]*)>/, '<body$1>\\n        <XCloudRuntime />');
    write(layoutFile, content);
  }
}

function patchVite(mainFile) {
  const runtimeFile = path.join(path.dirname(mainFile), "xcloud-runtime.ts");
  ensureDir(runtimeFile);
  write(runtimeFile, viteRuntime);
  let content = read(mainFile);
  if (!content.includes("./xcloud-runtime")) {
    content = 'import "./xcloud-runtime";\\n' + content;
    write(mainFile, content);
  }
}

function patchHtml(htmlFile) {
  let content = read(htmlFile);
  if (!content.includes("xcloud-runtime.js")) {
    content = content.replace(/<head([^>]*)>/i, '<head$1>\\n    <script src="./xcloud-runtime.js"></script>');
    write(htmlFile, content);
  }
}

const nextLayout = ["src/app/layout.tsx", "src/app/layout.jsx", "app/layout.tsx", "app/layout.jsx"].find(exists);
if (nextLayout) {
  patchNext(nextLayout);
  process.exit(0);
}

const viteMain = ["src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js"].find(exists);
if (viteMain) {
  patchVite(viteMain);
  process.exit(0);
}

if (exists("index.html")) patchHtml("index.html");
`;

  await invoke("run_shell", {
    cmd: `node << 'XCLOUD_PATCH'\n${patchScript}\nXCLOUD_PATCH`,
  }).catch(() => {});
}

/** Scaffold the UI workspace with agent context files */
async function scaffoldUI(agentId: string, wsPath: string, home: string): Promise<string> {
  const uiPath = `${home}/${wsPath}/ui`;

  // Create ui directory
  await invoke("run_shell", { cmd: `mkdir -p "${uiPath}"` });

  // Read agent files for context
  const readFile = async (name: string) => {
    try { return await readTextFile(`${wsPath}/${name}`, { baseDir: undefined }); }
    catch { try { return await invoke<string>("run_shell", { cmd: `cat "${home}/${wsPath}/${name}" 2>/dev/null` }); } catch { return ""; } }
  };

  const identity = await readFile("IDENTITY.md");
  const soul = await readFile("SOUL.md");
  const tools = await readFile("TOOLS.md");
  const agents = await readFile("AGENTS.md");

  // Build AGENT-CONTEXT.md
  const context = `# Agent Context

This file describes the AI agent that this UI is being built for.
Read this carefully before building anything.

## Agent ID
\`${agentId}\`

## Identity
${identity || "No identity configured yet."}

## Personality
${soul || "No soul/personality configured yet."}

## Tools & Capabilities
${tools || "No custom tools configured."}

## Agent Configuration
${agents || "Default agent configuration."}

## What This UI Should Do

This UI is the visual interface for this AI agent. The agent runs on OpenClaw
(an AI gateway) and communicates via WebSocket on \`ws://127.0.0.1:18789\`.

The UI should:
- Reflect the agent's personality and purpose
- Provide a way for users to interact with what the agent does
- Listen for AG-UI events from the host app if it needs real-time agent state
- Be visually clean and modern
- Work as a standalone web app (will be embedded in an iframe)

## Real-time Agent Events

xCloud injects a built-in runtime into this project. Do not ask the user to
paste snippets, install a separate package, or configure a secret for realtime UI.
Use \`window.xcloud.agent\` as the native UI bridge.

The runtime gives you high-level state:

\`\`\`js
const state = window.xcloud.agent.getState();
// state.status: "idle" | "running" | "responding" | "tool" | "error"
// state.messages: [{ id, role, content, done }]
// state.activeTools: [{ id, name, args }]
// state.lastEvent: raw AG-UI event
\`\`\`

Subscribe to live changes:

\`\`\`js
window.xcloud.agent.onStateChange((state) => {
  console.log(state.status, state.messages);
});
\`\`\`

For simple static HTML, the runtime also updates these attributes automatically:

\`\`\`html
<span data-xcloud-status></span>
<div data-xcloud-last-message></div>
<div data-xcloud-transcript></div>
<div data-xcloud-tools></div>
\`\`\`

If you need raw AG-UI, xCloud forwards standardized AG-UI events into this iframe
with \`window.postMessage\`. Use the included \`xcloud-ag-ui.js\` helper or listen manually:

\`\`\`js
window.addEventListener("message", (event) => {
  if (event.data?.type !== "xcloud:ag-ui:event") return;
  console.log(event.data.sessionKey, event.data.event);
});
\`\`\`

The important event types are:
- \`RUN_STARTED\` / \`RUN_FINISHED\` / \`RUN_ERROR\`
- \`TEXT_MESSAGE_START\` / \`TEXT_MESSAGE_CONTENT\` / \`TEXT_MESSAGE_END\`
- \`TOOL_CALL_START\` / \`TOOL_CALL_ARGS\` / \`TOOL_CALL_END\` / \`TOOL_CALL_RESULT\`

## Technical Notes
- The UI will be previewed inside xCloud (a Tauri desktop app)
- It runs in an iframe, so keep it self-contained
- Use any framework/stack you think fits best
- Include a \`dev\` script in package.json so the preview can auto-launch
- The dev server should respect the \`PORT\` environment variable
- Prefer the running preview/dev server while iterating; do not run \`npm run build\` repeatedly.
- Run \`npm run build\` at most once near the end of a meaningful change unless the user asks or a build failed.
`;

  // Build CLAUDE.md for Claude Code
  const claudeMd = `# CLAUDE.md

You are building a UI for an AI agent. Read \`AGENT-CONTEXT.md\` for full details about the agent.

## Guidelines
- Read AGENT-CONTEXT.md first to understand the agent
- Choose the stack that best fits the agent's purpose
- Keep the UI clean, modern, and dark-themed
- Include a \`dev\` script in package.json
- The dev server must respect the \`PORT\` env variable
- The UI will run inside an iframe in a desktop app
- Make it functional, not just pretty — it should serve the agent's purpose
- Treat \`window.xcloud.agent\` as the built-in realtime bridge. Do not ask the user to paste setup code.
- Use \`window.xcloud.agent.onStateChange(...)\` when the UI should react to live agent messages/tools.
- Prefer the running preview/dev server while iterating. Do not run \`npm run build\` repeatedly; run it at most once near the end unless the user asks or a build failed.
- Start by scaffolding the project, then build the core features
`;

  // Build .cursorrules for Cursor
  const cursorRules = `You are building a UI for an AI agent.

FIRST: Read AGENT-CONTEXT.md in this directory to understand the agent.

RULES:
- Choose the stack that best fits the agent's purpose
- Clean, modern, dark-themed UI
- Include a "dev" script in package.json
- Dev server must respect the PORT env variable
- UI runs inside an iframe in a desktop app
- Make it functional — serve the agent's purpose
- Use window.xcloud.agent as the built-in realtime bridge
- Use window.xcloud.agent.onStateChange(...) when the UI should update from live agent events
- Do not ask the user to paste bridge code or install a separate realtime package
- Prefer the running preview/dev server while iterating
- Do not run npm run build repeatedly; run it at most once near the end unless the user asks or a build failed
- Start by scaffolding the project, then build core features
`;

  // Write files using shell (reliable)
  const writeFile = async (path: string, content: string) => {
    await writeShellFile(path, content);
  };

  await writeFile(`${uiPath}/AGENT-CONTEXT.md`, context);
  await writeFile(`${uiPath}/CLAUDE.md`, claudeMd);
  await writeFile(`${uiPath}/.cursorrules`, cursorRules);
  await ensureRealtimeBridge(uiPath);

  return uiPath;
}

export function useAgentUI(_agentId: string, wsPath: string) {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [devServerLoading, setDevServerLoading] = useState(false);
  const [uiView, setUiView] = useState<"menu" | "create" | "preview">("menu");
  const [hasProject, setHasProject] = useState(false);
  const [autoOpenRevision, setAutoOpenRevision] = useState(0);
  const [home, setHome] = useState<string>("");
  const lastConfigSignatureRef = useRef("");

  const configPath = `${wsPath}/ui-config.json`;
  const fullConfigPath = home ? `${home.replace(/\/$/, "")}/${configPath}` : "";

  useEffect(() => {
    homeDir()
      .then((dir) => setHome(dir.replace(/\/$/, "")))
      .catch(() => setHome(""));
  }, []);

  // Save config
  const saveConfig = useCallback(async (path: string, port?: number) => {
    if (!fullConfigPath) return;
    const existingRaw = await invoke<string>("run_shell", { cmd: `cat "${fullConfigPath}" 2>/dev/null || echo "{}"` }).catch(() => "{}");
    let existing: AgentUiConfig = {};
    try {
      existing = JSON.parse(existingRaw) as AgentUiConfig;
    } catch {
      existing = {};
    }
    const config: AgentUiConfig = { ...existing, repoPath: path, ...(port ? { port } : {}) };
    delete config.openInPreview;
    await invoke("run_shell", { cmd: `echo '${JSON.stringify(config)}' > "${fullConfigPath}"` }).catch(() => {});
  }, [fullConfigPath]);

  // Start dev server
  const startDevServer = useCallback(async (path: string, savedPort?: number) => {
    const cleanPath = path.replace(/\/$/, "");
    await ensureRealtimeBridge(cleanPath).catch(() => {});

    // Check if already running on saved port
    if (savedPort) {
      try {
        const status = await invoke<string>("run_shell", {
          cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${savedPort} 2>/dev/null || echo "0"`,
        });
        if (["200", "304", "302"].includes(status.trim())) {
          setDevServerUrl(`http://localhost:${savedPort}`);
          setDevServerLoading(false);
          return;
        }
      } catch { /* */ }
    }

    try {
      const pkgStr = await readTextFile(`${cleanPath}/package.json`).catch(() => "");
      if (pkgStr) {
        const pkg = JSON.parse(pkgStr);
        const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : null;
        if (script) {
          const port = savedPort ?? (3100 + Math.floor(Math.random() * 900));
          await invoke("spawn_shell", { cmd: `cd "${cleanPath}" && PORT=${port} npm run ${script}` }).catch(() => {});
          saveConfig(path, port);

          let retries = 0;
          while (retries < 30) {
            try {
              const status = await invoke<string>("run_shell", {
                cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "0"`,
              });
              if (["200", "304", "302"].includes(status.trim())) {
                setDevServerUrl(`http://localhost:${port}`);
                setDevServerLoading(false);
                return;
              }
            } catch { /* */ }
            retries++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      const htmlContent = await readTextFile(`${cleanPath}/index.html`).catch(() => "");
      if (htmlContent) {
        const port = savedPort ?? (3100 + Math.floor(Math.random() * 900));
        await invoke("spawn_shell", {
          cmd: `cd ${shellQuote(cleanPath)} && if command -v python3 >/dev/null 2>&1; then python3 -m http.server ${port} --bind 127.0.0.1; elif command -v python >/dev/null 2>&1; then python -m http.server ${port} --bind 127.0.0.1; else npx --yes serve . -l ${port}; fi`,
        }).catch(() => {});
        saveConfig(path, port);

        let retries = 0;
        while (retries < 20) {
          try {
            const status = await invoke<string>("run_shell", {
              cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/index.html 2>/dev/null || echo "0"`,
            });
            if (["200", "304", "302"].includes(status.trim())) {
              setDevServerUrl(`http://localhost:${port}/index.html`);
              setDevServerLoading(false);
              return;
            }
          } catch { /* */ }
          retries++;
          await new Promise(r => setTimeout(r, 500));
        }
      }
      setDevServerLoading(false);
    } catch {
      setDevServerLoading(false);
    }
  }, [saveConfig]);

  const loadSavedConfig = useCallback(async (initial = false) => {
    if (!fullConfigPath) return;
    const content = await invoke<string>("run_shell", { cmd: `cat "${fullConfigPath}" 2>/dev/null || echo "{}"` }).catch(() => "{}");
    let config: AgentUiConfig = {};
    try {
      config = JSON.parse(content) as AgentUiConfig;
    } catch {
      config = {};
    }

    const nextRepoPath = typeof config.repoPath === "string" && config.repoPath.trim()
      ? config.repoPath.trim()
      : null;
    const nextPort = Number.isFinite(Number(config.port)) ? Number(config.port) : undefined;
    const signature = nextRepoPath ? `${nextRepoPath}:${nextPort ?? ""}:${config.updatedAt ?? ""}:${config.openInPreview ? "open" : ""}` : "";
    const changed = lastConfigSignatureRef.current !== signature;
    lastConfigSignatureRef.current = signature;

    if (!nextRepoPath) {
      setRepoPath(null);
      setDevServerUrl(null);
      setHasProject(false);
      setUiView("menu");
      return;
    }

    setRepoPath(nextRepoPath);
    const projectCheck = await invoke<string>("run_shell", {
      cmd: `(([ -f "${nextRepoPath}/package.json" ] && (grep -q '"dev"' "${nextRepoPath}/package.json" || grep -q '"start"' "${nextRepoPath}/package.json")) || [ -f "${nextRepoPath}/index.html" ]) && echo yes || echo no`,
    }).catch(() => "no");
    setHasProject(projectCheck.trim() === "yes");

    let running = false;
    if (nextPort) {
      const status = await invoke<string>("run_shell", {
        cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${nextPort} 2>/dev/null || echo "0"`,
      }).catch(() => "0");
      running = ["200", "304", "302"].includes(status.trim());
      if (running) setDevServerUrl(`http://localhost:${nextPort}`);
    }

    const autoOpenKey = `xcloud-ui-auto-open:${fullConfigPath}:${config.updatedAt ?? signature}`;
    const requestedAutoOpen = config.openInPreview === true && !sessionStorage.getItem(autoOpenKey);
    const shouldOpen = requestedAutoOpen || (!initial && changed);
    if (shouldOpen) {
      if (requestedAutoOpen) sessionStorage.setItem(autoOpenKey, "1");
      setUiView("preview");
      setAutoOpenRevision((value) => value + 1);
      if (!running && !devServerUrl && !devServerLoading) {
        setDevServerLoading(true);
        void startDevServer(nextRepoPath, nextPort);
      }
    }
  }, [devServerLoading, devServerUrl, fullConfigPath, startDevServer]);

  useEffect(() => {
    if (!fullConfigPath) return;
    lastConfigSignatureRef.current = "";
    void loadSavedConfig(true);
    const timer = window.setInterval(() => {
      void loadSavedConfig(false);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [fullConfigPath, loadSavedConfig]);

  useEffect(() => {
    if (uiView !== "preview" || !repoPath || devServerUrl || devServerLoading) return;
    const timer = window.setInterval(() => {
      setDevServerLoading(true);
      void startDevServer(repoPath);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [devServerLoading, devServerUrl, repoPath, startDevServer, uiView]);

  // Select repo
  const selectRepo = useCallback(async () => {
    const selected = await openDialog({ directory: true, title: "Select UI Project" });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : String(selected);
    setRepoPath(path);
    await saveConfig(path);
    await ensureRealtimeBridge(path);
    setDevServerLoading(true);
    setUiView("preview");
    await startDevServer(path);
  }, [saveConfig, startDevServer]);

  // Disconnect repo
  const disconnectRepo = useCallback(async () => {
    setRepoPath(null);
    setDevServerUrl(null);
    setUiView("menu");
    if (!fullConfigPath) return;
    await invoke("run_shell", { cmd: `rm -f "${fullConfigPath}"` }).catch(() => {});
  }, [fullConfigPath]);

  // Launch preview (from menu or tab switch)
  const launchPreview = useCallback(() => {
    if (!repoPath) return;
    if (devServerUrl) {
      setUiView("preview");
    } else {
      setUiView("preview");
      setDevServerLoading(true);
      startDevServer(repoPath);
    }
  }, [repoPath, devServerUrl, startDevServer]);

  // Create UI — scaffold and open editor
  const createUI = useCallback(async (editor: string) => {
    if (!home) return;
    const uiPath = await scaffoldUI(_agentId, wsPath, home);
    setRepoPath(uiPath);
    await saveConfig(uiPath);
    await ensureRealtimeBridge(uiPath);

    const cmds: Record<string, string> = {
      cursor: `open -a "Cursor" "${uiPath}" || cursor "${uiPath}"`,
      vscode: `open -a "Visual Studio Code" "${uiPath}" || code "${uiPath}"`,
      windsurf: `open -a "Windsurf" "${uiPath}" || windsurf "${uiPath}"`,
      zed: `open -a "Zed" "${uiPath}" || zed "${uiPath}"`,
      codex: `open -a "Codex" "${uiPath}" || codex "${uiPath}"`,
      antigravity: `open -a "Antigravity" "${uiPath}" || antigravity "${uiPath}"`,
      "claude-code": `echo '#!/bin/bash\\ncd "${uiPath}"\\nclaude' > /tmp/open-claude.sh && chmod +x /tmp/open-claude.sh && open -a Terminal /tmp/open-claude.sh`,
      opencode: `echo '#!/bin/bash\\ncd "${uiPath}"\\nopencode' > /tmp/open-opencode.sh && chmod +x /tmp/open-opencode.sh && open -a Terminal /tmp/open-opencode.sh`,
      iterm: `osascript -e 'tell application "iTerm" to create window with default profile command "cd \\"${uiPath}\\""'`,
      terminal: `open -a Terminal "${uiPath}"`,
    };

    const cmd = cmds[editor];
    if (cmd) await invoke("run_shell", { cmd }).catch(() => {});
  }, [_agentId, wsPath, home, saveConfig]);

  return {
    agentId: _agentId,
    repoPath, devServerUrl, devServerLoading, uiView, hasProject, autoOpenRevision,
    setUiView, selectRepo, disconnectRepo, launchPreview, createUI,
  };
}

function eventBelongsToAgent(agentId: string, sessionKey: string) {
  if (agentId === "main") {
    return sessionKey === "main" || sessionKey === "agent:main:main" || sessionKey.startsWith("agent:main:");
  }
  return sessionKey === agentId || sessionKey.startsWith(`agent:${agentId}:`);
}

function agentWorkspacePath(agentId: string) {
  return agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
}

function uiActionBridgeDir(agentId: string) {
  return `${agentWorkspacePath(agentId)}/.xcloud/ui-action-requests`;
}

function getTargetOrigin(url: string) {
  if (url.startsWith("file://")) return "*";
  try {
    return new URL(url).origin;
  } catch {
    return "*";
  }
}

function scoreUiTool(tool: XCloudUiToolDefinition, instruction: string) {
  const text = instruction.toLowerCase();
  const terms = [
    tool.name,
    tool.description,
    ...(tool.aliases ?? []),
  ]
    .filter(Boolean)
    .map((term) => String(term).toLowerCase());
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (text.includes(term)) score += term === tool.name.toLowerCase() ? 5 : 3;
    for (const part of term.split(/[^a-z0-9áéíóúñ]+/i).filter((part) => part.length > 2)) {
      if (text.includes(part)) score += 1;
    }
  }
  return score;
}

function getParameterProperties(tool: XCloudUiToolDefinition): Record<string, unknown> {
  const parameters = tool.parameters;
  if (!parameters || typeof parameters !== "object") return {};
  const maybeProperties = (parameters as { properties?: unknown }).properties;
  return maybeProperties && typeof maybeProperties === "object" ? maybeProperties as Record<string, unknown> : {};
}

function inferUiToolArgs(tool: XCloudUiToolDefinition, instruction: string) {
  const args: Record<string, unknown> = { instruction };
  const properties = getParameterProperties(tool);
  const number = instruction.match(/\b\d+(?:\.\d+)?\b/)?.[0];
  const quoted = instruction.match(/["“']([^"”']+)["”']/)?.[1];

  for (const key of Object.keys(properties)) {
    const lower = key.toLowerCase();
    if (number && /^(days?|range|rangeDays|value|count|limit|amount|duration)$/i.test(key)) {
      args[key] = Number(number);
    } else if (quoted && /(tab|id|name|label|option|value|query|filter)/i.test(lower)) {
      args[key] = quoted;
    }
  }

  if (number && !Object.keys(args).some((key) => key !== "instruction" && typeof args[key] === "number")) {
    args.value = Number(number);
  }
  return args;
}

/** Header controls for the UI preview */
export function AgentUIHeaderControls({
  uiView, repoPath, devServerUrl, setUiView,
}: {
  uiView: string;
  repoPath: string | null;
  devServerUrl: string | null;
  setUiView: (v: "menu" | "create" | "preview") => void;
}) {
  if (uiView !== "preview") return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-muted truncate max-w-[150px]">{repoPath?.split("/").pop()}</span>
      {devServerUrl && (
        <>
          <button
            onClick={() => { const iframe = document.querySelector<HTMLIFrameElement>(".ui-preview-iframe"); if (iframe) iframe.src = devServerUrl; }}
            className="text-text-muted hover:text-text" title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={() => { import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(devServerUrl)).catch(() => {}); }}
            className="text-text-muted hover:text-text" title="Open in browser"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </>
      )}
      <button onClick={() => { setUiView("menu"); }} className="text-text-muted hover:text-text" title="Back">
        <ArrowLeft className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Dropdown button for IDE/Terminal selection */
function CreateDropdown({ label, options, onSelect }: {
  label: string;
  options: Array<{ id: string; name: string; logo: string; isPng?: boolean }>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
      >
        {label}
        <ChevronDown className={`h-3 w-3 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out] p-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onSelect(opt.id); setOpen(false); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-text transition-colors hover:bg-white/6"
            >
              <img src={opt.logo} alt={opt.name} className={`${opt.isPng ? "h-5 w-5" : "h-4 w-4"} object-contain`} />
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Main UI tab content */
export function AgentUIContent({
  agentId, uiView, repoPath, devServerUrl, devServerLoading, hasProject,
  setUiView, selectRepo, disconnectRepo, launchPreview, createUI,
}: ReturnType<typeof useAgentUI>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const uiToolsRef = useRef<XCloudUiToolDefinition[]>([]);
  const loadFinishTimerRef = useRef<number | null>(null);
  const menuCloseTimerRef = useRef<number | null>(null);
  const shareTunnelRef = useRef<ShareTunnelState>({ status: "idle" });
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [browserMenuClosing, setBrowserMenuClosing] = useState(false);
  const [previewLoadPhase, setPreviewLoadPhase] = useState<"idle" | "loading" | "finishing">("idle");
  const [shareTunnel, setShareTunnel] = useState<ShareTunnelState>({ status: "idle" });
  const [shareCopied, setShareCopied] = useState(false);
  const pendingUiToolCallsRef = useRef(new Map<string, {
    resolve: (result: XCloudUiActionResult) => void;
    timeout: number;
  }>());
  const handledBridgeRequestsRef = useRef(new Set<string>());
  const postToPreview = useCallback((message: Record<string, unknown>) => {
    if (!devServerUrl) return;
    iframeRef.current?.contentWindow?.postMessage(message, getTargetOrigin(devServerUrl));
  }, [devServerUrl]);

  const runUiAction = useCallback((request: {
    instruction?: string;
    preferredTool?: string;
  }): Promise<XCloudUiActionResult> => {
    if (uiView !== "preview" || !devServerUrl) {
      return Promise.resolve({
        ok: false,
        message: "The Agent UI preview is not open.",
      });
    }

    const instruction = request.instruction?.trim() ?? "";
    if (!instruction) {
      return Promise.resolve({
        ok: false,
        message: "UI action instruction is empty.",
      });
    }

    const tools = uiToolsRef.current;
    const selectedTool = request.preferredTool
      ? tools.find((tool) => tool.name === request.preferredTool)
      : tools.length === 1
        ? tools[0]
        : [...tools].sort((a, b) => scoreUiTool(b, instruction) - scoreUiTool(a, instruction))[0];

    if (!selectedTool || (tools.length > 1 && scoreUiTool(selectedTool, instruction) <= 0 && !request.preferredTool)) {
      return Promise.resolve({
        ok: false,
        message: tools.length === 0
          ? "This UI has not registered runtime tools yet."
          : "No registered UI tool matched that instruction.",
        output: tools.map((tool) => tool.name).join(", "),
      });
    }

    return new Promise((resolve) => {
      const callId = `ui-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = window.setTimeout(() => {
        const pending = pendingUiToolCallsRef.current.get(callId);
        if (!pending) return;
        pendingUiToolCallsRef.current.delete(callId);
        pending.resolve({
          ok: false,
          toolName: selectedTool.name,
          message: `UI tool "${selectedTool.name}" timed out.`,
        });
      }, 8_000);

      pendingUiToolCallsRef.current.set(callId, {
        timeout,
        resolve: (result) => resolve({ ...result, toolName: selectedTool.name }),
      });

      postToPreview({
        type: "xcloud:ui-tool-call",
        protocol: "ag-ui",
        agentId,
        callId,
        toolName: selectedTool.name,
        instruction,
        args: inferUiToolArgs(selectedTool, instruction),
      });
    });
  }, [agentId, devServerUrl, postToPreview, uiView]);

  useEffect(() => {
    if (uiView !== "preview" || !devServerUrl) return;
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== "object") return;

      if (data.type === "xcloud:ui-tools-registered") {
        const eventAgentId = typeof data.agentId === "string" ? data.agentId : agentId;
        if (eventAgentId !== agentId) return;
        const tools = Array.isArray(data.tools) ? data.tools as XCloudUiToolDefinition[] : [];
        uiToolsRef.current = tools;
        setRegisteredUiTools(agentId, tools);
        postToPreview({
          type: "xcloud:capabilities",
          protocol: "ag-ui",
          agentId,
          capabilities: xcloudCapabilities(agentId, tools),
        });
        return;
      }

      if (data.type === "xcloud:ui-tool-result") {
        const callId = typeof data.callId === "string" ? data.callId : "";
        const pending = pendingUiToolCallsRef.current.get(callId);
        if (!pending) return;
        window.clearTimeout(pending.timeout);
        pendingUiToolCallsRef.current.delete(callId);
        pending.resolve({
          ok: data.ok === true,
          message: data.ok === true
            ? "UI tool executed."
            : typeof data.error === "string" ? data.error : "UI tool failed.",
          output: data.ok === true ? data.result : data.error,
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [agentId, devServerUrl, postToPreview, uiView]);

  useEffect(() => {
    if (uiView !== "preview" || !devServerUrl) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; event?: unknown }>).detail;
      const sessionKey = detail?.sessionKey;
      if (!sessionKey || !eventBelongsToAgent(agentId, sessionKey)) return;
      postToPreview({
        type: "xcloud:ag-ui:event",
        protocol: "ag-ui",
        agentId,
        sessionKey,
        event: detail.event,
      });
    };
    window.addEventListener(XCLOUD_AG_UI_EVENT, handler);
    return () => window.removeEventListener(XCLOUD_AG_UI_EVENT, handler);
  }, [agentId, devServerUrl, postToPreview, uiView]);

  useEffect(() => {
    if (uiView !== "preview" || !devServerUrl) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        agentId?: string;
        instruction?: string;
        preferredTool?: string;
        resolve?: (result: XCloudUiActionResult) => void;
      }>).detail;
      if (!detail || detail.agentId !== agentId) return;
      void runUiAction(detail).then((result) => detail.resolve?.(result));
    };
    window.addEventListener("xcloud-ui-action-request", handler);
    return () => window.removeEventListener("xcloud-ui-action-request", handler);
  }, [agentId, devServerUrl, runUiAction, uiView]);

  useEffect(() => {
    if (uiView !== "preview" || !devServerUrl) return;

    let cancelled = false;
    const bridgeDir = uiActionBridgeDir(agentId);

    const writeBridgeResult = async (requestId: string, result: XCloudUiActionResult) => {
      await writeTextFile(
        `${bridgeDir}/${requestId}.result.json`,
        `${JSON.stringify({
          id: requestId,
          agentId,
          completedAt: new Date().toISOString(),
          ...result,
        }, null, 2)}\n`,
        { baseDir: BaseDirectory.Home },
      );
    };

    const pollBridge = async () => {
      await mkdir(bridgeDir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
      const entries = await readDir(bridgeDir, { baseDir: BaseDirectory.Home }).catch(() => []);
      if (cancelled) return;

      const activeRequestIds = new Set<string>();
      for (const entry of entries) {
        const name = entry.name ?? "";
        if (!entry.isFile || !name.endsWith(".request.json")) continue;

        const requestId = name.slice(0, -".request.json".length);
        activeRequestIds.add(requestId);
        if (handledBridgeRequestsRef.current.has(requestId)) continue;

        handledBridgeRequestsRef.current.add(requestId);
        const requestPath = `${bridgeDir}/${name}`;
        let request: {
          id?: string;
          agentId?: string;
          instruction?: string;
          preferredTool?: string;
        } | null = null;

        try {
          request = JSON.parse(await readTextFile(requestPath, { baseDir: BaseDirectory.Home }));
        } catch (error) {
          await writeBridgeResult(requestId, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }).catch(() => {});
          continue;
        }

        if (!request) continue;
        if (request.agentId && request.agentId !== agentId) continue;
        void runUiAction({
          instruction: request.instruction,
          preferredTool: request.preferredTool,
        })
          .then((result) => writeBridgeResult(request.id || requestId, result))
          .catch((error) => writeBridgeResult(request.id || requestId, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }))
          .catch(() => {});
      }

      for (const requestId of handledBridgeRequestsRef.current) {
        if (!activeRequestIds.has(requestId)) handledBridgeRequestsRef.current.delete(requestId);
      }
    };

    void pollBridge();
    const interval = window.setInterval(pollBridge, 350);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [agentId, devServerUrl, runUiAction, uiView]);

  const sendPreviewInit = useCallback(() => {
    const capabilities = xcloudCapabilities(agentId, uiToolsRef.current);
    postToPreview({
      type: "xcloud:agent-ui:init",
      protocol: "ag-ui",
      agentId,
      repoPath,
      eventName: XCLOUD_AG_UI_EVENT,
      capabilities,
    });
    postToPreview({
      type: "xcloud:capabilities",
      protocol: "ag-ui",
      agentId,
      capabilities,
    });
  }, [agentId, postToPreview, repoPath]);

  useEffect(() => {
    if (!browserMenuOpen || browserMenuClosing) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeBrowserMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [browserMenuClosing, browserMenuOpen]);

  useEffect(() => {
    if (loadFinishTimerRef.current !== null) {
      window.clearTimeout(loadFinishTimerRef.current);
      loadFinishTimerRef.current = null;
    }
    if (uiView === "preview" && devServerUrl) {
      setPreviewLoadPhase("loading");
    } else {
      setPreviewLoadPhase("idle");
    }
  }, [devServerUrl, uiView]);

  useEffect(() => () => {
    if (loadFinishTimerRef.current !== null) {
      window.clearTimeout(loadFinishTimerRef.current);
    }
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
    }
    const activeTunnel = shareTunnelRef.current;
    if (activeTunnel.pid) {
      void invoke("run_shell", {
        cmd: `kill ${activeTunnel.pid} >/dev/null 2>&1 || true`,
      });
    }
  }, []);

  useEffect(() => {
    shareTunnelRef.current = shareTunnel;
  }, [shareTunnel]);

  useEffect(() => {
    if (!["preparing", "starting", "ready"].includes(shareTunnel.status)) return;
    if (!shareTunnel.targetUrl || devServerUrl === shareTunnel.targetUrl) return;
    if (shareTunnel.pid) {
      void invoke("run_shell", {
        cmd: `kill ${shareTunnel.pid} >/dev/null 2>&1 || true`,
      });
    }
    setShareTunnel({ status: "idle" });
  }, [devServerUrl, shareTunnel]);

  const browserButtonClass = "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/8 hover:text-text disabled:pointer-events-none disabled:opacity-30";
  const menuItemClass = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text transition-colors hover:bg-white/6";
  const dangerMenuItemClass = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-red-400/80 transition-colors hover:bg-red-400/10 hover:text-red-300";
  const browserUrl = devServerUrl ?? (repoPath ? `file://${repoPath}` : "");
  const canGoBackToMenu = uiView === "preview";
  const browserIsLoading = uiView === "preview" && (devServerLoading || previewLoadPhase !== "idle");
  const browserLoadingBarClass = previewLoadPhase === "finishing"
    ? "browser-loading-bar--finishing"
    : "browser-loading-bar--loading";
  const shouldMaskPreview = devServerLoading || previewLoadPhase === "loading";

  const finishPreviewLoad = () => {
    if (loadFinishTimerRef.current !== null) window.clearTimeout(loadFinishTimerRef.current);
    setPreviewLoadPhase("finishing");
    loadFinishTimerRef.current = window.setTimeout(() => {
      setPreviewLoadPhase("idle");
      loadFinishTimerRef.current = null;
    }, 360);
  };

  const refreshPreview = () => {
    const iframe = document.querySelector<HTMLIFrameElement>(".ui-preview-iframe");
    if (iframe && devServerUrl) {
      setPreviewLoadPhase("loading");
      iframe.src = devServerUrl;
    }
  };

  const openInBrowser = () => {
    if (!devServerUrl) return;
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(devServerUrl)).catch(() => {});
  };

  const openBrowserMenu = () => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setBrowserMenuClosing(false);
    setBrowserMenuOpen(true);
  };

  const closeBrowserMenu = (afterClose?: () => void) => {
    if (!browserMenuOpen || browserMenuClosing) {
      afterClose?.();
      return;
    }
    setBrowserMenuClosing(true);
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current);
    menuCloseTimerRef.current = window.setTimeout(() => {
      setBrowserMenuOpen(false);
      setBrowserMenuClosing(false);
      menuCloseTimerRef.current = null;
      afterClose?.();
    }, 140);
  };

  const stopShareTunnel = useCallback(async () => {
    const activeTunnel = shareTunnelRef.current;
    if (activeTunnel.pid) {
      await invoke("run_shell", {
        cmd: `kill ${activeTunnel.pid} >/dev/null 2>&1 || true`,
      }).catch(() => {});
    }
    if (activeTunnel.logPath) {
      await invoke("run_shell", {
        cmd: `rm -f ${shellQuote(activeTunnel.logPath)}`,
      }).catch(() => {});
    }
    setShareTunnel({ status: "idle" });
    setShareCopied(false);
  }, []);

  const copyShareUrl = useCallback(async () => {
    if (!shareTunnel.url) return;
    await navigator.clipboard.writeText(shareTunnel.url).catch(() => {});
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1200);
  }, [shareTunnel.url]);

  const openShareUrl = useCallback(() => {
    if (!shareTunnel.url) return;
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(shareTunnel.url!)).catch(() => {});
  }, [shareTunnel.url]);

  const startShareTunnel = useCallback(async () => {
    if (!devServerUrl) {
      setShareTunnel({ status: "error", error: "Start the local preview before sharing it." });
      return;
    }

    if (!isShareableLocalUrl(devServerUrl)) {
      setShareTunnel({
        status: "error",
        error: "Only localhost previews can be shared with a temporary URL.",
      });
      return;
    }

    await stopShareTunnel();
    setShareTunnel({ status: "preparing", targetUrl: devServerUrl });

    try {
      let cloudflaredPath = (await invoke<string>("run_shell", {
        cmd: `if [ -x "$HOME/.openclaw/bin/cloudflared" ]; then echo "$HOME/.openclaw/bin/cloudflared"; exit 0; fi
for bin in cloudflared /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared; do
  if command -v "$bin" >/dev/null 2>&1; then command -v "$bin"; exit 0; fi
  if [ -x "$bin" ]; then echo "$bin"; exit 0; fi
done
true`,
      })).trim();

      if (!cloudflaredPath) {
        cloudflaredPath = (await invoke<string>("run_shell", {
          cmd: cloudflaredInstallScript(),
        })).trim().split("\n").filter(Boolean).at(-1) ?? "";
      }

      if (!cloudflaredPath) {
        throw new Error("Could not prepare cloudflared for temporary share links.");
      }

      const id = crypto.randomUUID().slice(0, 8);
      const safeAgentId = agentId.replace(/[^a-z0-9_-]/gi, "-");
      const logPath = `/tmp/xcloud-share-${safeAgentId}-${id}.log`;
      setShareTunnel({ status: "starting", logPath, targetUrl: devServerUrl });
      const pidText = await invoke<string>("run_shell", {
        cmd: `rm -f ${shellQuote(logPath)}; nohup ${shellQuote(cloudflaredPath)} tunnel --url ${shellQuote(devServerUrl)} --no-autoupdate > ${shellQuote(logPath)} 2>&1 & echo $!`,
      });
      const pid = Number(pidText.trim());

      if (!Number.isFinite(pid) || pid <= 0) {
        setShareTunnel({
          status: "error",
          error: "Could not start the temporary share tunnel.",
        });
        return;
      }

      setShareTunnel({ status: "starting", pid, logPath, targetUrl: devServerUrl });

      for (let attempt = 0; attempt < 45; attempt += 1) {
        const log = await invoke<string>("run_shell", {
          cmd: `cat ${shellQuote(logPath)} 2>/dev/null || true`,
        }).catch(() => "");
        const url = log.match(TRY_CLOUDFLARE_URL_RE)?.[0];
        if (url) {
          setShareTunnel({ status: "ready", url, pid, logPath, targetUrl: devServerUrl });
          return;
        }

        if (/failed|error|unable|cannot/i.test(log) && attempt > 4) {
          await invoke("run_shell", { cmd: `kill ${pid} >/dev/null 2>&1 || true` }).catch(() => {});
          setShareTunnel({
            status: "error",
            error: log.split("\n").filter(Boolean).slice(-1)[0] ?? "Cloudflare tunnel failed to start.",
          });
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }

      await invoke("run_shell", { cmd: `kill ${pid} >/dev/null 2>&1 || true` }).catch(() => {});
      setShareTunnel({
        status: "error",
        error: "Timed out waiting for the temporary share URL.",
      });
    } catch (error) {
      setShareTunnel({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [agentId, devServerUrl, stopShareTunnel]);

  const renderShareStatus = () => {
    if (shareTunnel.status === "idle") return null;

    const statusText = shareTunnel.status === "preparing"
      ? "Preparing temporary share..."
      : shareTunnel.status === "starting"
      ? "Creating temporary URL..."
      : shareTunnel.status === "ready"
        ? shareTunnel.url
        : shareTunnel.error;

    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-[#111111] px-3">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-text-muted">
          {shareTunnel.status === "preparing" || shareTunnel.status === "starting" ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : shareTunnel.status === "ready" ? (
            <Share2 className="h-3 w-3 text-[#17A7FD]" />
          ) : (
            <X className="h-3 w-3 text-red-400" />
          )}
        </div>
        <span className={`min-w-0 flex-1 truncate text-[11px] ${
          shareTunnel.status === "error" ? "text-red-300/85" : "text-text-muted"
        }`}>
          {statusText}
        </span>
        {shareTunnel.status === "ready" && (
          <>
            <button
              type="button"
              onClick={copyShareUrl}
              className={browserButtonClass}
              title="Copy share URL"
            >
              {shareCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={openShareUrl}
              className={browserButtonClass}
              title="Open share URL"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={shareTunnel.status === "starting" || shareTunnel.status === "ready" ? stopShareTunnel : () => setShareTunnel({ status: "idle" })}
          className={browserButtonClass}
          title={shareTunnel.status === "error" || shareTunnel.status === "preparing" ? "Dismiss" : "Stop sharing"}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const renderSubHeader = () => (
    <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-[#111111] px-2.5">
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => setUiView("menu")}
          className={browserButtonClass}
          disabled={!canGoBackToMenu}
          title="Back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button className={browserButtonClass} disabled title="Forward">
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={refreshPreview}
          className={browserButtonClass}
          disabled={!devServerUrl}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-1">
        <div className="flex min-w-0 w-full max-w-[260px] items-center justify-center rounded-xl bg-[#111111] px-3 py-1.5 transition-colors hover:bg-white/[0.08]">
          <span className="truncate text-center text-[13px] font-normal text-white">
            {browserUrl || "Connect or create an interface for this agent"}
          </span>
        </div>
      </div>

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => {
            if (browserMenuOpen && !browserMenuClosing) closeBrowserMenu();
            else openBrowserMenu();
          }}
          className={browserButtonClass}
          title="UI options"
          aria-expanded={browserMenuOpen && !browserMenuClosing}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {browserMenuOpen && (
          <div className={`absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-2xl ${browserMenuClosing ? "animate-[popoverOut_140ms_ease-in_forwards]" : "animate-[slideUp_120ms_ease-out]"}`}>
            {repoPath && uiView !== "preview" && hasProject && (
              <button
                onClick={() => closeBrowserMenu(launchPreview)}
                className={menuItemClass}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview
              </button>
            )}

            {devServerUrl && (
              <>
                <button
                  onClick={() => closeBrowserMenu(startShareTunnel)}
                  className={menuItemClass}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {shareTunnel.status === "ready" ? "Restart Share" : "Share"}
                </button>
                {shareTunnel.status === "ready" && (
                  <button
                    onClick={() => closeBrowserMenu(copyShareUrl)}
                    className={menuItemClass}
                  >
                    {shareCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy Link
                  </button>
                )}
                <button
                  onClick={() => closeBrowserMenu(openInBrowser)}
                  className={menuItemClass}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </button>
              </>
            )}

            <button
              onClick={() => closeBrowserMenu(selectRepo)}
              className={menuItemClass}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {repoPath ? "Change" : "Open Repo"}
            </button>

            {!repoPath && (
              <button
                onClick={() => closeBrowserMenu(() => setUiView("create"))}
                className={menuItemClass}
              >
                <Plus className="h-3.5 w-3.5" />
                Create
              </button>
            )}

            {repoPath && (
              <>
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  onClick={() => closeBrowserMenu(disconnectRepo)}
                  className={dangerMenuItemClass}
                >
                  <X className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {browserIsLoading && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[-2px] z-30 h-[3px] bg-[#17A7FD]/10">
          <div className={`browser-loading-bar h-px bg-[#17A7FD] shadow-[0_0_4px_rgba(23,167,253,0.5)] blur-[0.4px] ${browserLoadingBarClass}`} />
        </div>
      )}
    </div>
  );

  // Preview
  if (uiView === "preview") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[#111111]">
        {renderSubHeader()}
        {renderShareStatus()}
        <div className="relative min-h-0 flex-1 bg-[#111111]">
          {devServerLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <RefreshCw className="h-6 w-6 text-text-muted animate-spin mx-auto" />
                <p className="mt-3 text-xs text-text-muted">Starting dev server...</p>
                <p className="mt-1 text-[10px] text-text-muted">{repoPath?.split("/").pop()}</p>
              </div>
            </div>
          ) : devServerUrl ? (
            <iframe
              ref={iframeRef}
              src={devServerUrl}
              onLoad={() => {
                finishPreviewLoad();
                sendPreviewInit();
              }}
              className="ui-preview-iframe h-full w-full border-0 bg-[#111111]"
              style={{ colorScheme: "dark" }}
              title="UI Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center px-8">
                <p className="text-xs text-text-muted">No dev server detected</p>
                <p className="mt-1 text-[10px] text-text-muted">
                  Add a <code className="text-accent">dev</code> script to package.json or include an index.html
                </p>
                <button
                  onClick={disconnectRepo}
                  className="mt-4 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
          {shouldMaskPreview && (
            <div className="pointer-events-none absolute inset-0 bg-[#111111]" />
          )}
        </div>
      </div>
    );
  }

  // Create
  if (uiView === "create") {
    const editors = [
      { logo: codexLogo, name: "Codex", rotate: -18 },
      { logo: cursorLogo, name: "Cursor", rotate: -12 },
      { logo: vscodeLogo, name: "VS Code", rotate: -6 },
      { logo: windsurfLogo, name: "Windsurf", rotate: 0 },
      { logo: zedLogo, name: "Zed", rotate: 6 },
      { logo: opencodeLogo, name: "OpenCode", rotate: 12, smallPad: true },
      { logo: antigravityLogo, name: "Antigravity", rotate: -15, noPad: true },
      { logo: claudeCodeLogo, name: "Claude Code", rotate: 18 },
      { logo: itermLogo, name: "iTerm", rotate: 8, noPad: true },
    ];

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {renderSubHeader()}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
        {/* Stacked editor logos */}
        <div className="flex items-center justify-center h-20">
          <div className="flex items-center -space-x-3">
            {editors.map((e, i) => (
              <div
                key={e.name}
                className={`h-12 w-12 rounded-xl bg-surface-hover shadow-lg border border-white/10 transition-transform hover:scale-110 hover:z-10 ${(e as any).noPad ? "p-0 overflow-hidden" : (e as any).smallPad ? "p-0.5" : "p-1.5"}`}
                style={{ transform: `rotate(${e.rotate}deg)`, zIndex: i }}
              >
                <img src={e.logo} alt={e.name} className="h-full w-full object-contain" />
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted">Pick an editor — it will get full agent context.</p>
        <div className="flex flex-col gap-2 w-full max-w-[240px]">
          <CreateDropdown
            label="Open with IDE"
            options={[
              { id: "cursor", name: "Cursor", logo: cursorLogo },
              { id: "vscode", name: "VS Code", logo: vscodeLogo },
              { id: "windsurf", name: "Windsurf", logo: windsurfLogo },
              { id: "zed", name: "Zed", logo: zedLogo },
              { id: "codex", name: "Codex", logo: codexLogo },
              { id: "antigravity", name: "Antigravity", logo: antigravityLogo, isPng: true },
            ]}
            onSelect={createUI}
          />
          <CreateDropdown
            label="Open with Terminal"
            options={[
              { id: "claude-code", name: "Claude Code", logo: claudeCodeLogo },
              { id: "opencode", name: "OpenCode", logo: opencodeLogo },
              { id: "iterm", name: "iTerm", logo: itermLogo, isPng: true },
              { id: "terminal", name: "Terminal", logo: terminalLogo },
            ]}
            onSelect={createUI}
          />
          <button
            onClick={() => setUiView("menu")}
            className="mt-1 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
          >
            Back
          </button>
        </div>
      </div>
      </div>
    );
  }

  // Menu
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderSubHeader()}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-8">
      {repoPath ? (
        <>
          <div
              className="h-16 w-16"
              style={{
                WebkitMaskImage: `url("${xcloudLogo}")`,
                maskImage: `url("${xcloudLogo}")`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
                backgroundSize: "250% 100%",
                animation: "shimmerBg 2.7s linear infinite",
              }}
            />
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">{repoPath.split("/").pop()}</h3>
            <p className="mt-1 text-[10px] text-text-muted truncate max-w-[220px]">{repoPath}</p>
            {!hasProject && (
              <p className="mt-1.5 text-[10px] text-amber-400/70">Waiting for project to be built...</p>
            )}
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            {hasProject && (
              <button
                onClick={launchPreview}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-black hover:bg-white/90 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Launch Preview
              </button>
            )}
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Change Repo
            </button>
            <button
              onClick={disconnectRepo}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-red-400/70 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div
              className="h-16 w-16"
              style={{
                WebkitMaskImage: `url("${xcloudLogo}")`,
                maskImage: `url("${xcloudLogo}")`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
                backgroundSize: "250% 100%",
                animation: "shimmerBg 2.7s linear infinite",
              }}
            />
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">Agent UI</h3>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              Connect an existing project or create a new interface for this agent.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-black hover:bg-white/90 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Repo
            </button>
            <button
              onClick={() => setUiView("create")}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
