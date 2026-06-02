import { BaseDirectory, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BrowserEngine } from "@/lib/engine";

export const MAIN_AGENT_ID = "main";
const MAIN_AGENT_DEFAULT_IDENTITY_MD = `# IDENTITY.md

- **Name:** Main
- **Role:** Global xCloud main agent for this OpenClaw engine.
- **Vibe:** Practical, direct, helpful, and context-aware.
- **Emoji:**

You are the global Main agent for this engine. You coordinate normal chats, agents, tools, automations, channels, integrations, memory, and app work unless the user is explicitly inside a named xCloud workspace.
`;

const MAIN_AGENT_AGENTS_MARKER_START = "<!-- XCLOUD_MAIN_AGENT_START -->";
const MAIN_AGENT_AGENTS_MARKER_END = "<!-- XCLOUD_MAIN_AGENT_END -->";
const MAIN_AGENT_AGENTS_APPEND = `${MAIN_AGENT_AGENTS_MARKER_START}

## xCloud Main Agent

You are the global Main agent for this OpenClaw engine.

- Your agent id is \`main\`.
- Your display name is \`Main\` unless the user intentionally changes your identity.
- The OpenClaw "workspace" folder is your durable home directory. Do not introduce yourself as being inside a named xCloud workspace/project unless the current chat is explicitly scoped to one.
- Named xCloud workspaces are separate project spaces with their own workspace-scoped main agents.

${MAIN_AGENT_AGENTS_MARKER_END}
`;

export interface OpenClawAgentFile {
  name: string;
  path?: string;
  missing?: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export interface OpenClawAgentPatch {
  agentId: string;
  name?: string;
  workspace?: string;
  model?: string;
  emoji?: string;
  avatar?: string;
}

export function getAgentWorkspaceDir(agentId: string) {
  return agentId === MAIN_AGENT_ID ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function nodeHeredocCommand(script: string) {
  return `(node <<'NODE'\n${script}\nNODE\n)`;
}

function assertSafeHomeRelativePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\0") || path.split("/").some((part) => part === "..")) {
    throw new Error(`Unsafe home-relative path: ${path}`);
  }
}

function isPlaceholderIdentity(content: string) {
  const value = content.trim();
  return !value
    || value.includes("_Fill this in during your first conversation._")
    || value.includes("_(pick something you like)_")
    || value.includes("_(AI? robot? familiar?")
    || /^\s*-?\s*\*\*Name:\*\*\s*(?:\r?\n\s*_\(|$)/im.test(value);
}

export function buildMainAgentDefaultsCommand() {
  const payload = encodeBase64Utf8(JSON.stringify({
    identityMd: MAIN_AGENT_DEFAULT_IDENTITY_MD,
    agentsAppend: MAIN_AGENT_AGENTS_APPEND,
    markerStart: MAIN_AGENT_AGENTS_MARKER_START,
  }));
  return nodeHeredocCommand(`const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const payload = JSON.parse(Buffer.from("${payload}", "base64").toString("utf8"));
const workspace = path.join(os.homedir(), ".openclaw", "workspace");
const identityPath = path.join(workspace, "IDENTITY.md");
const agentsPath = path.join(workspace, "AGENTS.md");
function isPlaceholderIdentity(content) {
  const value = String(content || "").trim();
  return !value
    || value.includes("_Fill this in during your first conversation._")
    || value.includes("_(pick something you like)_")
    || value.includes("_(AI? robot? familiar?")
    || /^\\s*-?\\s*\\*\\*Name:\\*\\*\\s*(?:\\r?\\n\\s*_\\(|$)/im.test(value);
}
fs.mkdirSync(workspace, { recursive: true });
let identity = "";
try { identity = fs.readFileSync(identityPath, "utf8"); } catch {}
if (isPlaceholderIdentity(identity)) {
  fs.writeFileSync(identityPath, payload.identityMd, "utf8");
}
let agents = "";
try { agents = fs.readFileSync(agentsPath, "utf8"); } catch {}
if (!agents.includes(payload.markerStart)) {
  const next = agents.trimEnd() + (agents.trim() ? "\\n\\n" : "") + payload.agentsAppend;
  fs.writeFileSync(agentsPath, next, "utf8");
}`);
}

export async function retryEngineRpc(
  engine: BrowserEngine,
  method: string,
  params: Record<string, unknown> = {},
  attempts = 5,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await engine.rpc(method, params);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await delay(300 + attempt * 250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runRemoteShell(engine: BrowserEngine, command: string, timeoutMs = 20_000) {
  const spawned = await retryEngineRpc(engine, "xcloud.pty.spawn", { command, cols: 80, rows: 24 }, 2);
  const id = typeof spawned.id === "string" ? spawned.id : "";
  if (!id) throw new Error("Remote command did not return a PTY id.");

  let lastSeq = 0;
  let output = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await delay(250);
    const result = await retryEngineRpc(engine, "xcloud.pty.read", { id, after: lastSeq }, 2);
    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== "object") continue;
      const record = chunk as Record<string, unknown>;
      if (typeof record.seq === "number") lastSeq = Math.max(lastSeq, record.seq);
      if (typeof record.data === "string") output += record.data;
    }
    if (result.exited === true) {
      if (result.exitCode === 0 || result.exitCode == null) return output;
      throw new Error(output.trim() || `Remote command exited with ${String(result.exitCode)}`);
    }
  }

  await retryEngineRpc(engine, "xcloud.pty.kill", { id }, 1).catch(() => {});
  throw new Error("Remote command timed out.");
}

export async function runRemoteEngineShell(engine: BrowserEngine, command: string, timeoutMs = 20_000) {
  if (!engine.isRemote) throw new Error("runRemoteEngineShell requires a remote engine.");
  return runRemoteShell(engine, command, timeoutMs);
}

export async function ensureRemoteMainAgentDefaults(engine: BrowserEngine) {
  if (!engine.isRemote) return;
  const identity = await readOpenClawAgentFile(engine, MAIN_AGENT_ID, "IDENTITY.md", "");
  const agents = await readOpenClawAgentFile(engine, MAIN_AGENT_ID, "AGENTS.md", "");
  if (!isPlaceholderIdentity(identity) && agents.includes(MAIN_AGENT_AGENTS_MARKER_START)) return;
  await runRemoteShell(engine, buildMainAgentDefaultsCommand(), 20_000);
}

function extractMarkedPayload(output: string, marker: string) {
  const match = output.match(new RegExp(`${marker}_START__([A-Za-z0-9+/=]*)__${marker}_END__`));
  return match?.[1] ? decodeBase64Utf8(match[1]) : "";
}

export async function readEngineHomeText(engine: BrowserEngine, relativePath: string, fallback = "") {
  if (!engine.isRemote) {
    return readTextFile(relativePath, { baseDir: BaseDirectory.Home }).catch(() => fallback);
  }

  assertSafeHomeRelativePath(relativePath);
  const payload = encodeBase64Utf8(JSON.stringify({ relativePath }));
  const command = nodeHeredocCommand(`const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const payload = JSON.parse(Buffer.from("${payload}", "base64").toString("utf8"));
const root = os.homedir();
const target = path.resolve(root, payload.relativePath);
if (!target.startsWith(root + path.sep)) process.exit(64);
let content = "";
try { content = fs.readFileSync(target, "utf8"); } catch {}
process.stdout.write("__XCLOUD_FILE_START__" + Buffer.from(content, "utf8").toString("base64") + "__XCLOUD_FILE_END__");`);
  try {
    const output = await runRemoteShell(engine, command);
    const content = extractMarkedPayload(output, "XCLOUD_FILE");
    return content || fallback;
  } catch {
    return fallback;
  }
}

export async function writeEngineHomeText(engine: BrowserEngine, relativePath: string, content: string) {
  if (!engine.isRemote) {
    const parent = relativePath.split("/").slice(0, -1).join("/");
    if (parent) await mkdir(parent, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
    await writeTextFile(relativePath, content, { baseDir: BaseDirectory.Home });
    return;
  }

  assertSafeHomeRelativePath(relativePath);
  const payload = encodeBase64Utf8(JSON.stringify({ relativePath, content }));
  const command = nodeHeredocCommand(`const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const payload = JSON.parse(Buffer.from("${payload}", "base64").toString("utf8"));
const root = os.homedir();
const target = path.resolve(root, payload.relativePath);
if (!target.startsWith(root + path.sep)) process.exit(64);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, payload.content, "utf8");
process.stdout.write("__XCLOUD_FILE_START__b2s=__XCLOUD_FILE_END__");`);
  await runRemoteShell(engine, command);
}

export async function readOpenClawConfig(engine: BrowserEngine) {
  const result = await retryEngineRpc(engine, "config.get", {});
  return {
    hash: (result as { hash?: string }).hash ?? "",
    config: ((result as { config?: Record<string, unknown> }).config ?? result) as Record<string, unknown>,
  };
}

export async function patchOpenClawConfig(engine: BrowserEngine, patch: Record<string, unknown>, baseHash?: string) {
  const hash = baseHash ?? (await readOpenClawConfig(engine)).hash;
  if (!hash) return;
  await retryEngineRpc(engine, "config.patch", { raw: JSON.stringify(patch), baseHash: hash });
}

export async function readOpenClawAgentFile(
  engine: BrowserEngine,
  agentId: string,
  name: string,
  fallback = "",
) {
  if (engine.isRemote) {
    try {
      const result = await retryEngineRpc(engine, "agents.files.get", { agentId, name });
      const file = (result as { file?: OpenClawAgentFile }).file;
      if (!file || file.missing) return fallback;
      return typeof file.content === "string" ? file.content : fallback;
    } catch {
      return readEngineHomeText(engine, `${getAgentWorkspaceDir(agentId)}/${name}`, fallback);
    }
  }

  const path = `${getAgentWorkspaceDir(agentId)}/${name}`;
  return readTextFile(path, { baseDir: BaseDirectory.Home }).catch(() => fallback);
}

export async function writeOpenClawAgentFile(
  engine: BrowserEngine,
  agentId: string,
  name: string,
  content: string,
) {
  if (engine.isRemote) {
    try {
      await retryEngineRpc(engine, "agents.files.set", { agentId, name, content });
    } catch {
      await writeEngineHomeText(engine, `${getAgentWorkspaceDir(agentId)}/${name}`, content);
    }
    return;
  }

  const dir = getAgentWorkspaceDir(agentId);
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await writeTextFile(`${dir}/${name}`, content, { baseDir: BaseDirectory.Home });
}

export async function listOpenClawAgentFiles(engine: BrowserEngine, agentId: string): Promise<OpenClawAgentFile[]> {
  if (engine.isRemote) {
    try {
      const result = await retryEngineRpc(engine, "agents.files.list", { agentId });
      const files = (result as { files?: OpenClawAgentFile[] }).files;
      return Array.isArray(files) ? files : [];
    } catch {
      return [];
    }
  }

  const dir = getAgentWorkspaceDir(agentId);
  const entries = await readDir(dir, { baseDir: BaseDirectory.Home }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile && entry.name)
    .map((entry) => ({ name: entry.name! }));
}

export async function upsertOpenClawAgent(engine: BrowserEngine, patch: OpenClawAgentPatch) {
  const workspace = patch.workspace ?? `~/.openclaw/workspace/${patch.agentId}`;
  try {
    await retryEngineRpc(engine, "agents.create", {
      name: patch.agentId,
      workspace,
      ...(patch.model ? { model: patch.model } : {}),
      ...(patch.emoji ? { emoji: patch.emoji } : {}),
      ...(patch.avatar ? { avatar: patch.avatar } : {}),
    }, 3);
  } catch (error) {
    if (!/already exists|exists|duplicate/i.test(errorMessage(error))) throw error;
  }

  await retryEngineRpc(engine, "agents.update", {
    agentId: patch.agentId,
    ...(patch.name ? { name: patch.name } : {}),
    workspace,
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.emoji ? { emoji: patch.emoji } : {}),
    ...(patch.avatar ? { avatar: patch.avatar } : {}),
  }).catch(() => {});
}

export async function deleteOpenClawAgent(engine: BrowserEngine, agentId: string, deleteFiles = true) {
  try {
    await retryEngineRpc(engine, "agents.delete", { agentId, deleteFiles }, 3);
    return;
  } catch (error) {
    if (engine.isRemote) {
      if (/not found|unknown agent|missing/i.test(errorMessage(error))) return;
      throw error;
    }
  }

  const { config, hash } = await readOpenClawConfig(engine);
  const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
  const list = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return String((item as Record<string, unknown>).id ?? "") !== agentId;
    })
    : [];
  await patchOpenClawConfig(engine, { agents: { ...agentsConfig, list } }, hash).catch(() => {});
  await Promise.all([
    remove(`.openclaw/workspace/${agentId}`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {}),
    remove(`.openclaw/agents/${agentId}`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {}),
  ]);
}
