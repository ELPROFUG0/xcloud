import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTwoFilesPatch } from "diff";
import type { BrowserEngine } from "@/lib/engine";
import type { ChatAttachment, ChatMessage, CodeChangeInfo, ToolCallInfo } from "@/types/chat";
import { emitAgUiEvents, openClawFrameToAgUiEvents, userMessageToAgUiEvents } from "@/lib/ag-ui-bridge";
import { executeRegisteredUiAction, getRegisteredUiTools } from "@/lib/ui-action-registry";
import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";

interface UseChatOptions {
  engine: BrowserEngine;
  sessionKey?: string;
  appTools?: AppToolHandler;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  loading: boolean;
  send: (message: string, options?: { hidden?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
}

const CHAT_HISTORY_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const HIDDEN_PROMPT_MARKER = "<!-- unicore:hidden-workspace-setup -->";
const HIDDEN_UI_ACTION_RESULT_MARKER = "<!-- unicore:hidden-ui-action-result -->";
const APP_CONTEXT_START = "<!-- unicore:app-context -->";
const APP_CONTEXT_END = "<!-- /unicore:app-context -->";
const UI_ACTION_DIRECTIVE_START = "<!-- xcloud:ui-action";
const UI_ACTION_DIRECTIVE_RE = /<!--\s*xcloud:ui-action\s+({[\s\S]*?})\s*-->/g;
const streamingUiDirectiveBuffers = new Map<string, string>();
const toolFileSnapshots = new Map<string, Promise<FileSnapshot | undefined>>();
const sessionFileSnapshots = new Map<string, Promise<FileSnapshot | undefined>>();

export interface AppToolRequest {
  name: "create_workspace" | "delete_workspace" | "list_workspaces" | "open_workspace";
  args: {
    name?: string;
    prompt?: string;
    workspaceId?: string;
  };
  sourceSessionKey: string;
}

export interface AppToolResult {
  message: string;
  output?: string;
}

export type AppToolHandler = (request: AppToolRequest) => Promise<AppToolResult>;

type FileSnapshot = {
  root: string;
  files: Map<string, string>;
};

/** Build a readable title from tool name + arguments */
function buildToolTitle(name: string, args?: Record<string, unknown>): string {
  if (!args) return name;
  if ((name === "exec" || name === "shell" || name === "bash") && args.command) {
    const cmd = String(args.command).split("\n")[0]!.trim();
    return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
  }
  if ((name === "read" || name === "write" || name === "edit") && (args.path || args.file_path)) {
    const p = String(args.path ?? args.file_path);
    const short = p.split("/").slice(-2).join("/");
    return `${name} ${short}`;
  }
  if ((name === "search" || name === "grep") && (args.query || args.pattern)) {
    return `${name} "${args.query ?? args.pattern}"`;
  }
  if (name === "glob" && args.pattern) {
    return `find ${args.pattern}`;
  }
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getToolPath(name: string, args?: Record<string, unknown>, output?: string): string | undefined {
  const rawPath = args?.path ?? args?.file_path ?? args?.filename;
  if (typeof rawPath === "string" && rawPath.trim()) return rawPath.trim();

  const text = output ?? "";
  const patterns = [
    /(?:in|to)\s+([/\w .:@-]+\.[\w-]+)\.?$/m,
    /(?:Updated|Added|Deleted|Modified)\s+(.+?)\s*$/m,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  const titlePath = name.match(/(?:read|write|edit)\s+(.+)$/i)?.[1]?.trim();
  return titlePath || undefined;
}

function isShellTool(name: string) {
  const lower = name.toLowerCase();
  return lower.includes("exec") || lower.includes("shell") || lower.includes("bash");
}

function isCodeChangeTool(name: string) {
  const lower = name.toLowerCase();
  return isShellTool(name)
    || lower.includes("write")
    || lower.includes("edit")
    || lower.includes("patch")
    || lower.includes("apply");
}

function countDiffStats(diff?: string) {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (/^\s*\+\d+\s/.test(line) || (/^\+/.test(line) && !/^\+\+\+/.test(line))) additions += 1;
    if (/^\s*-\d+\s/.test(line) || (/^-/.test(line) && !/^---/.test(line))) deletions += 1;
  }
  return { additions, deletions };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellCd(dir: string) {
  if (dir === "~") return 'cd "$HOME"';
  if (dir.startsWith("~/")) return `cd "$HOME"/${shellQuote(dir.slice(2))}`;
  return `cd ${shellQuote(dir)}`;
}

function unquoteShellPath(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function dirname(path: string) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function getCommandText(args?: Record<string, unknown>) {
  const command = args?.command ?? args?.cmd ?? args?.input;
  return typeof command === "string" ? command : undefined;
}

function inferCommandCwd(args?: Record<string, unknown>) {
  const cwd = args?.cwd ?? args?.workdir ?? args?.workingDirectory;
  if (typeof cwd === "string" && cwd.trim()) return cwd.trim();

  const command = getCommandText(args);
  const cdMatch = command?.match(/(?:^|[;&|]\s*)cd\s+((?:"[^"]+")|(?:'[^']+')|(?:[^\s;&|]+))/);
  const cdPath = cdMatch?.[1] ? unquoteShellPath(cdMatch[1]) : undefined;
  if (cdPath) return cdPath;

  const absolutePath = command?.match(/\/Users\/[^'"\s;&|]+/)?.[0];
  return absolutePath ? dirname(absolutePath) : undefined;
}

async function gitRootForDir(dir: string): Promise<string | undefined> {
  const rootCmd = `${shellCd(dir)} && git rev-parse --show-toplevel 2>/dev/null`;
  const root = (await invoke<string>("run_shell", { cmd: rootCmd }).catch(() => "")).trim();
  return root || undefined;
}

async function resolvedDir(dir: string): Promise<string | undefined> {
  const resolved = (await invoke<string>("run_shell", { cmd: `${shellCd(dir)} && pwd -P` }).catch(() => "")).trim();
  return resolved || undefined;
}

async function gitDiffForPath(path: string): Promise<string | undefined> {
  if (!path.startsWith("/")) return undefined;

  const dir = dirname(path);
  const root = await gitRootForDir(dir);
  if (!root) return undefined;

  const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const diffCmd = [
    shellCd(root),
    `git diff --no-ext-diff --no-color --unified=80 -- ${shellQuote(rel)}`,
    `git diff --cached --no-ext-diff --no-color --unified=80 -- ${shellQuote(rel)}`,
  ].join(" && ");
  const diff = (await invoke<string>("run_shell", { cmd: diffCmd }).catch(() => "")).trimEnd();
  return diff || undefined;
}

async function fileSnapshotForDir(dir: string | undefined): Promise<FileSnapshot | undefined> {
  if (!dir) return undefined;
  const root = await resolvedDir(dir);
  if (!root) return undefined;

  const filesCmd = [
    shellCd(root),
    "find . \\( -path './.git' -o -path './node_modules' -o -path './.next' -o -path './dist' -o -path './build' -o -path './coverage' \\) -prune -o -type f -size -256k -print",
  ].join(" && ");
  const rels = (await invoke<string>("run_shell", { cmd: filesCmd }).catch(() => ""))
    .split("\n")
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .filter((rel) => /\.(?:[cm]?[jt]sx?|css|scss|sass|html|json|md|mdx|yml|yaml|txt|env|svg)$/.test(rel));

  const files = new Map<string, string>();
  for (const rel of rels.slice(0, 400)) {
    const content = await invoke<string>("run_shell", {
      cmd: `${shellCd(root)} && cat ${shellQuote(rel)} 2>/dev/null`,
    }).catch(() => "");
    files.set(rel, content);
  }

  return { root, files };
}

function buildUnifiedDiff(path: string, before: string, after: string, kind: CodeChangeInfo["kind"]) {
  const oldPath = kind === "added" ? "/dev/null" : `a/${path}`;
  const newPath = kind === "deleted" ? "/dev/null" : `b/${path}`;
  const patch = createTwoFilesPatch(oldPath, newPath, before, after, "", "", {
    context: 3,
    stripTrailingCr: true,
  }).trimEnd();
  return [`diff --git a/${path} b/${path}`, patch].join("\n");
}

function fileChangeKind(before: FileSnapshot, after: FileSnapshot, rel: string): CodeChangeInfo["kind"] {
  if (!before.files.has(rel)) return "added";
  if (!after.files.has(rel)) return "deleted";
  return "modified";
}

async function buildFileChangesSinceSnapshot(snapshotPromise: Promise<FileSnapshot | undefined> | undefined) {
  const before = await snapshotPromise;
  if (!before) return undefined;
  const after = await fileSnapshotForDir(before.root);
  if (!after) return undefined;

  const changes: CodeChangeInfo[] = [];
  const rels = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const rel of rels) {
    const beforeContent = before.files.get(rel) ?? "";
    const afterContent = after.files.get(rel) ?? "";
    if (beforeContent === afterContent) continue;

    const kind = fileChangeKind(before, after, rel);
    const diff = buildUnifiedDiff(rel, beforeContent, afterContent, kind);
    const stats = countDiffStats(diff);
    changes.push({
      path: `${after.root}/${rel}`,
      diff,
      additions: stats.additions,
      deletions: stats.deletions,
      kind,
    });
  }

  return changes.length ? changes : undefined;
}

async function hydrateCodeChangesWithGitDiff(changes: CodeChangeInfo[] | undefined): Promise<CodeChangeInfo[] | undefined> {
  if (!changes?.length) return changes;

  const hydrated = await Promise.all(changes.map(async (change) => {
    if (change.diff) return change;
    const diff = await gitDiffForPath(change.path);
    if (!diff) return change;
    const stats = countDiffStats(diff);
    return {
      ...change,
      diff,
      additions: stats.additions || change.additions,
      deletions: stats.deletions || change.deletions,
    };
  }));

  return hydrated;
}

function pathsMatch(changePath: string, candidatePath: string) {
  if (changePath === candidatePath) return true;
  return changePath.endsWith(`/${candidatePath}`) || candidatePath.endsWith(`/${changePath}`);
}

async function hydrateCodeChangesWithSnapshotDiff(sessionKey: string, changes: CodeChangeInfo[] | undefined) {
  const gitHydrated = await hydrateCodeChangesWithGitDiff(changes);
  if (!gitHydrated?.some((change) => !change.diff)) return gitHydrated;

  const fileSnapshot = sessionFileSnapshots.get(sessionKey);
  const fileChanges = await buildFileChangesSinceSnapshot(fileSnapshot);
  if (!fileChanges?.length) return gitHydrated;

  return gitHydrated.map((change) => {
    if (change.diff) return change;
    const snapshotChange = fileChanges.find((candidate) => pathsMatch(change.path, candidate.path));
    return snapshotChange ? { ...change, ...snapshotChange } : change;
  });
}

function buildCodeChangeFromTool(params: {
  name: string;
  args?: Record<string, unknown>;
  output?: string;
  details?: Record<string, unknown>;
}): CodeChangeInfo[] | undefined {
  const lowerName = params.name.toLowerCase();
  const details = params.details;
  const diff = typeof details?.diff === "string" ? details.diff : undefined;
  const path = getToolPath(params.name, params.args, params.output);

  if (diff && path) {
    const stats = countDiffStats(diff);
    return [{
      path,
      diff,
      firstChangedLine: typeof details?.firstChangedLine === "number" ? details.firstChangedLine : undefined,
      additions: stats.additions,
      deletions: stats.deletions,
      kind: lowerName.includes("delete") ? "deleted" : "modified",
    }];
  }

  if ((lowerName.includes("write") || lowerName.includes("edit")) && path && params.output?.toLowerCase().includes("successfully")) {
    return [{
      path,
      additions: lowerName.includes("write") ? 1 : 0,
      deletions: 0,
      kind: lowerName.includes("write") ? "added" : "modified",
    }];
  }

  return undefined;
}

function buildCodeChangesFromPatchSummary(data: Record<string, unknown>): CodeChangeInfo[] | undefined {
  const changes: CodeChangeInfo[] = [];
  for (const [key, kind] of [
    ["added", "added"],
    ["modified", "modified"],
    ["deleted", "deleted"],
  ] as const) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const path = typeof item === "string"
        ? item
        : isRecord(item) && typeof item.path === "string"
          ? item.path
          : undefined;
      if (!path) continue;
      changes.push({ path, additions: kind === "deleted" ? 0 : 1, deletions: kind === "deleted" ? 1 : 0, kind });
    }
  }
  return changes.length ? changes : undefined;
}

function mergeCodeChanges(existing: CodeChangeInfo[] | undefined, incoming: CodeChangeInfo[] | undefined) {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;

  const merged = new Map<string, CodeChangeInfo>();
  for (const change of existing) merged.set(change.path, change);
  for (const change of incoming) {
    const previous = merged.get(change.path);
    merged.set(change.path, {
      ...previous,
      ...change,
      diff: change.diff ?? previous?.diff,
      firstChangedLine: change.firstChangedLine ?? previous?.firstChangedLine,
      additions: change.additions || previous?.additions || 0,
      deletions: change.deletions || previous?.deletions || 0,
      kind: change.kind ?? previous?.kind,
    });
  }
  return Array.from(merged.values());
}

const CODE_CHANGE_CACHE_KEY = "xcloudCodeChangeDiffs";
const CODE_CHANGE_CACHE_LIMIT = 200;

type CodeChangeCache = Record<string, { updatedAt: number; changes: CodeChangeInfo[] }>;

function codeChangeCacheKey(sessionKey: string, toolCallId: string) {
  return `${sessionKey}::${toolCallId}`;
}

function readCodeChangeCache(): CodeChangeCache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CODE_CHANGE_CACHE_KEY) ?? "{}") as CodeChangeCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCodeChangeCache(cache: CodeChangeCache) {
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, CODE_CHANGE_CACHE_LIMIT);
  localStorage.setItem(CODE_CHANGE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function readCachedCodeChanges(sessionKey: string, toolCallId: string) {
  return readCodeChangeCache()[codeChangeCacheKey(sessionKey, toolCallId)]?.changes;
}

function cacheCodeChanges(sessionKey: string, toolCallId: string, changes: CodeChangeInfo[] | undefined) {
  if (!changes?.some((change) => change.diff)) return;
  const cache = readCodeChangeCache();
  const key = codeChangeCacheKey(sessionKey, toolCallId);
  cache[key] = {
    updatedAt: Date.now(),
    changes: mergeCodeChanges(cache[key]?.changes, changes) ?? changes,
  };
  writeCodeChangeCache(cache);
}

function attachCodeChangesToTool(sessionKey: string, toolCallId: string, changes: CodeChangeInfo[] | undefined) {
  if (!changes?.length) return;
  cacheCodeChanges(sessionKey, toolCallId, changes);
  updateChatMessages(sessionKey, (messages) =>
    messages.map((message) =>
      message.role === "tool" && message.tool?.id === toolCallId
        ? { ...message, tool: { ...message.tool!, changes: mergeCodeChanges(message.tool!.changes, changes) } }
        : message,
    ),
  );
}

async function startCodeChangeSnapshot(sessionKey: string, toolCallId: string, args?: Record<string, unknown>) {
  const inferred = inferCommandCwd(args);
  const uiRepoPath = await readUiRepoPath(extractAgentIdFromSessionKey(sessionKey));
  const targetDir = inferred ?? uiRepoPath ?? undefined;
  toolFileSnapshots.set(toolCallId, !inferred && sessionFileSnapshots.has(sessionKey)
    ? sessionFileSnapshots.get(sessionKey)!
    : fileSnapshotForDir(targetDir));
}

async function startSessionChangeSnapshots(sessionKey: string) {
  const uiRepoPath = await readUiRepoPath(extractAgentIdFromSessionKey(sessionKey));
  if (!uiRepoPath) return;

  const fileSnapshot = fileSnapshotForDir(uiRepoPath);
  sessionFileSnapshots.set(sessionKey, fileSnapshot);
  await fileSnapshot.catch(() => undefined);
}

async function detectFileChanges(fileSnapshot: Promise<FileSnapshot | undefined> | undefined) {
  return buildFileChangesSinceSnapshot(fileSnapshot);
}

function forgetCodeChangeSnapshot(toolCallId: string) {
  toolFileSnapshots.delete(toolCallId);
}

function attachDetectedCodeChanges(sessionKey: string, toolCallId: string) {
  const fileSnapshot = toolFileSnapshots.get(toolCallId);
  void detectFileChanges(fileSnapshot)
    .then((changes) => attachCodeChangesToTool(sessionKey, toolCallId, changes))
    .finally(() => forgetCodeChangeSnapshot(toolCallId));
}

function hasWorkspaceKeyword(message: string) {
  return /(?:workspace|work space|espacios?\s+de\s+trabajo)/i.test(message);
}

function hasListWorkspaceIntent(message: string) {
  const listVerb = "(?:lista|listar|mu[eé]strame|mostrar|show|list)";
  const workspaceNoun = "(?:workspaces?|work spaces?|espacios?\\s+de\\s+trabajo)";
  return new RegExp(`\\b${listVerb}\\b[^.!?\\n]{0,80}\\b${workspaceNoun}\\b`, "i").test(message)
    || new RegExp(`\\b${workspaceNoun}\\b[^.!?\\n]{0,80}\\b${listVerb}\\b`, "i").test(message);
}

function hasCreateWorkspaceIntent(message: string) {
  return /(?:crea|crear|create|nuevo|new|haz|hacer)\s+(?:un\s+|una\s+|nuevo\s+|nueva\s+)?(?:workspace|work space|espacio de trabajo)/i.test(message)
    || /(?:workspace|work space|espacio de trabajo)\s+(?:nuevo|new|llamado|named|de|para|for)\b/i.test(message);
}

function hasOpenWorkspaceIntent(message: string) {
  return /(?:abre|abrir|open|entra|entrar|contin[uú]a|continue|seguir|sigue|trabaja|work)\b[^.!?\n]{0,80}\b(?:workspace|work space|espacio de trabajo)/i.test(message)
    || /\b(?:workspace|work space|espacio de trabajo)\b[^.!?\n]{0,80}\b(?:abre|abrir|open|entra|entrar|contin[uú]a|continue|seguir|sigue|trabaja|work)\b/i.test(message);
}

function findWorkspaceRequest(message: string): string | null {
  const text = message.trim();
  if (!hasWorkspaceKeyword(text)) return null;
  if (!hasCreateWorkspaceIntent(text)) return null;

  const quoted = text.match(/["“']([^"”']{2,60})["”']/)?.[1]?.trim();
  if (quoted) return quoted;

  const named = text.match(/(?:workspace|work space|espacio de trabajo)\s+(?:llamado|named|de|para|for)\s+([a-z0-9][\w\s.-]{1,50})/i)?.[1]?.trim();
  if (named) return named.replace(/[.!?].*$/, "").trim();

  return "New workspace";
}

function extractWorkspaceName(text: string): string | null {
  const quoted = text.match(/["“']([^"”']{2,60})["”']/)?.[1]?.trim();
  if (quoted) return quoted;

  const named = text.match(/(?:workspace|work space|espacio de trabajo)(?:\s+(?:llamado|named|de|para|for))?\s+([a-z0-9][\w\s.-]{1,50})/i)?.[1]?.trim();
  if (named) return named.replace(/[.!?].*$/, "").trim();

  return null;
}

function extractWorkspaceIdFromSessionKey(sessionKey: string) {
  return sessionKey.match(/^agent:workspace-([^:]+):/)?.[1] ?? null;
}

function extractAgentIdFromSessionKey(sessionKey: string) {
  if (sessionKey === "main") return "main";
  return sessionKey.match(/^agent:([^:]+):/)?.[1] ?? "main";
}

function agentWorkspacePath(agentId: string) {
  return agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
}

function stripAppContext(content: string) {
  let next = content;
  while (next.includes(APP_CONTEXT_START) && next.includes(APP_CONTEXT_END)) {
    const start = next.indexOf(APP_CONTEXT_START);
    const end = next.indexOf(APP_CONTEXT_END, start);
    if (start < 0 || end < 0) break;
    next = `${next.slice(0, start)}${next.slice(end + APP_CONTEXT_END.length)}`;
  }
  return next.trim();
}

const MEDIA_LINE_RE = /(?:^|\n)[ \t]*MEDIA:[ \t]*`?([^\n`]+)`?[ \t]*(?=\n|$)/gi;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i;

function filenameFromUrl(url: string) {
  const clean = url.split("?")[0]?.split("#")[0] ?? url;
  const name = clean.split("/").pop()?.trim();
  return name ? decodeURIComponent(name) : undefined;
}

function isImageLikeUrl(url: string, mediaType?: string) {
  return mediaType?.startsWith("image/") || IMAGE_EXT_RE.test(url) || url.includes("/api/chat/media/outgoing/");
}

function extractMediaAttachmentsFromText(text: string, idPrefix: string) {
  const attachments: ChatAttachment[] = [];
  let index = 0;
  const visible = text.replace(MEDIA_LINE_RE, (_match, rawSource: string) => {
    const source = rawSource.trim();
    if (isImageLikeUrl(source)) {
      attachments.push({
        id: `${idPrefix}-media-${index++}`,
        type: "file",
        url: source,
        mediaType: "image/*",
        filename: filenameFromUrl(source),
      });
    }
    return "\n";
  }).trim();
  return { visible, attachments };
}

function imageAttachmentFromBlock(block: Record<string, unknown>, id: string): ChatAttachment | undefined {
  const url = typeof block.url === "string" ? block.url : undefined;
  if (!url) return undefined;
  const mediaType = typeof block.mimeType === "string"
    ? block.mimeType
    : typeof block.mediaType === "string"
      ? block.mediaType
      : "image/*";
  if (!isImageLikeUrl(url, mediaType)) return undefined;

  return {
    id,
    type: "file",
    url,
    mediaType,
    filename: typeof block.filename === "string" ? block.filename : filenameFromUrl(url),
    alt: typeof block.alt === "string" ? block.alt : undefined,
    width: typeof block.width === "number" ? block.width : undefined,
    height: typeof block.height === "number" ? block.height : undefined,
  };
}

function attachmentKey(attachment: ChatAttachment) {
  const fileKey = attachment.filename || attachment.alt || attachment.url.split("/").pop() || attachment.url;
  return `${attachment.mediaType ?? ""}:${fileKey}`;
}

function isImageAttachment(attachment: ChatAttachment) {
  return (attachment.mediaType ?? "").startsWith("image/") || isImageLikeUrl(attachment.url, attachment.mediaType);
}

function isGatewayMediaAttachment(attachment: ChatAttachment) {
  return attachment.url.includes("/api/chat/media/outgoing/");
}

function isLocalMediaAttachment(attachment: ChatAttachment) {
  const url = attachment.url.trim();
  if (isGatewayMediaAttachment(attachment)) return false;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return false;
  return url.startsWith("/") || url.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(url);
}

function dedupeAttachments(attachments: ChatAttachment[]) {
  const gatewayImages = attachments.filter((attachment) => isImageAttachment(attachment) && isGatewayMediaAttachment(attachment));
  const localImages = attachments.filter((attachment) => isImageAttachment(attachment) && isLocalMediaAttachment(attachment));
  const normalizedAttachments = gatewayImages.length > 0
    ? attachments.filter((attachment) => !isImageAttachment(attachment) || isGatewayMediaAttachment(attachment))
    : localImages.length > 0
      ? attachments.filter((attachment) => !isImageAttachment(attachment) || isLocalMediaAttachment(attachment))
      : attachments;
  const seen = new Set<string>();
  return normalizedAttachments.filter((attachment) => {
    const key = attachmentKey(attachment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMessageContent(content: unknown, idPrefix: string) {
  let text = "";
  let thinking = "";
  const attachments: ChatAttachment[] = [];

  if (typeof content === "string") {
    const parsed = extractMediaAttachmentsFromText(content, idPrefix);
    text = parsed.visible;
    attachments.push(...parsed.attachments);
  } else if (Array.isArray(content)) {
    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        const parsed = extractMediaAttachmentsFromText(block.text, `${idPrefix}-text-${index}`);
        text += parsed.visible;
        attachments.push(...parsed.attachments);
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        thinking += `${thinking ? "\n" : ""}${block.thinking}`;
      } else if (block.type === "image") {
        const attachment = imageAttachmentFromBlock(block, `${idPrefix}-image-${index}`);
        if (attachment) attachments.push(attachment);
      }
    }
  }

  return { text, thinking, attachments: dedupeAttachments(attachments) };
}

function mergeAttachments(existing: ChatAttachment[] | undefined, incoming: ChatAttachment[] | undefined) {
  if (!existing?.length) return incoming;
  if (!incoming?.length) return existing;

  const all = [...existing, ...incoming];
  const gatewayImages = all.filter((attachment) => isImageAttachment(attachment) && isGatewayMediaAttachment(attachment));
  if (gatewayImages.length > 0) {
    const nonGatewayImages = all.filter((attachment) =>
      !isImageAttachment(attachment) || !isGatewayMediaAttachment(attachment),
    );
    return dedupeAttachments([...nonGatewayImages, ...gatewayImages]);
  }

  const localImages = all.filter((attachment) => isImageAttachment(attachment) && isLocalMediaAttachment(attachment));
  if (localImages.length > 0) {
    const nonImages = all.filter((attachment) => !isImageAttachment(attachment));
    return dedupeAttachments([...nonImages, ...localImages]);
  }

  return dedupeAttachments(all);
}

function coalesceAssistantMediaMessages(messages: ChatMessage[]) {
  const coalesced: ChatMessage[] = [];
  for (const message of messages) {
    const previous = coalesced[coalesced.length - 1];
    const shouldMerge = message.role === "assistant"
      && previous?.role === "assistant"
      && Boolean(message.attachments?.length)
      && Math.abs(message.timestamp - previous.timestamp) < 10_000
      && (!message.content.trim() || message.content.trim() === previous.content.trim());

    if (shouldMerge) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        content: previous.content || message.content,
        attachments: mergeAttachments(previous.attachments, message.attachments),
        timestamp: Math.max(previous.timestamp, message.timestamp),
      };
    } else {
      coalesced.push(message);
    }
  }
  return coalesced;
}

async function readUiRepoPath(agentId: string) {
  const configPath = `${agentWorkspacePath(agentId)}/ui-config.json`;
  const content = await readTextFile(configPath, { baseDir: BaseDirectory.Home }).catch(() => "");
  if (!content.trim()) return null;
  try {
    const config = JSON.parse(content) as { repoPath?: string };
    return config.repoPath?.trim() || null;
  } catch {
    return null;
  }
}

async function buildXCloudAppContext(sessionKey: string) {
  const agentId = extractAgentIdFromSessionKey(sessionKey);
  const uiRepoPath = await readUiRepoPath(agentId);
  const uiTools = getRegisteredUiTools(agentId);
  const workspacePath = agentWorkspacePath(agentId);
  const uiLines = uiRepoPath
    ? [
        `- Connected UI repo: ${uiRepoPath}`,
        `- UI bridge guide in that repo: ${uiRepoPath}/XCLOUD-UI.md`,
        "- If asked to change the UI/interface/preview, edit the connected UI repo.",
      ]
    : [
        "- No connected UI repo is currently configured for this agent.",
        "- If asked to change the UI/interface/preview, ask the user to connect or create an Agent UI first.",
      ];

  return [
    "xCloud app context for this turn:",
    "- You are running inside the xCloud desktop app.",
    "- The app has a Chat panel, an Agent Canvas tab, and an Agent UI tab.",
    "- The Canvas tab is the visual map/settings surface for this agent inside xCloud; do not confuse it with a source-code canvas library.",
    "- The UI tab previews a web app connected to this agent.",
    `- Current agent id: ${agentId}`,
    `- Current agent workspace: ~/${workspacePath}`,
    ...uiLines,
    "- Connected UI repos receive realtime agent state through window.xcloud.agent and AG-UI events.",
    uiTools.length
      ? `- The connected UI registered these frontend tools: ${uiTools.map((tool) => `${tool.name}${tool.description ? ` (${tool.description})` : ""}`).join(", ")}.`
      : "- The connected UI has not registered frontend tools yet.",
    "- To ask xCloud to execute a registered UI tool, include a hidden HTML directive exactly like: <!-- xcloud:ui-action {\"instruction\":\"what to do\",\"preferredTool\":\"optionalToolName\"} -->",
    "- Do not show that directive to the user as prose; it is consumed by xCloud.",
    "- Prefer the running xCloud preview/dev server while iterating on UI.",
    "- Do not run npm run build repeatedly after small UI edits; run it at most once near the end unless the user asks or a build failed.",
    "- Do not ask the user to paste hidden bridge instructions; the app manages the bridge automatically.",
  ].join("\n");
}

function extractUiActionDirectives(content: string) {
  const actions: Array<{ instruction: string; preferredTool?: string }> = [];
  const visible = content.replace(UI_ACTION_DIRECTIVE_RE, (_match, rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson) as { instruction?: unknown; preferredTool?: unknown };
      if (typeof parsed.instruction === "string" && parsed.instruction.trim()) {
        actions.push({
          instruction: parsed.instruction.trim(),
          ...(typeof parsed.preferredTool === "string" && parsed.preferredTool.trim()
            ? { preferredTool: parsed.preferredTool.trim() }
            : {}),
        });
      }
    } catch {
      // Leave malformed directives out of the visible transcript.
    }
    return "";
  }).trim();
  return { visible, actions };
}

function streamingDirectiveKey(sessionKey: string, runId?: string) {
  return `${sessionKey}:${runId ?? "active"}`;
}

function stripUiActionDirectivesForStreaming(sessionKey: string, runId: string | undefined, content: string) {
  const key = streamingDirectiveKey(sessionKey, runId);
  let rest = content;
  let visible = "";
  let buffered = streamingUiDirectiveBuffers.get(key) ?? "";

  while (rest.length > 0) {
    if (buffered) {
      buffered += rest;
      const end = buffered.indexOf("-->");
      if (end === -1) {
        streamingUiDirectiveBuffers.set(key, buffered);
        return visible;
      }
      rest = buffered.slice(end + 3);
      buffered = "";
      streamingUiDirectiveBuffers.delete(key);
      continue;
    }

    const start = rest.indexOf(UI_ACTION_DIRECTIVE_START);
    if (start === -1) {
      visible += rest;
      rest = "";
      continue;
    }

    visible += rest.slice(0, start);
    buffered = rest.slice(start);
    rest = "";
    const end = buffered.indexOf("-->");
    if (end !== -1) {
      rest = buffered.slice(end + 3);
      buffered = "";
      streamingUiDirectiveBuffers.delete(key);
    }
  }

  if (buffered) streamingUiDirectiveBuffers.set(key, buffered);
  return visible;
}

function parseHiddenUiActionTool(content: string, timestamp: number, index: number): ToolCallInfo | null {
  if (!content.includes(HIDDEN_UI_ACTION_RESULT_MARKER) && !content.startsWith("xCloud UI action result:")) return null;
  const toolName = content.match(/^- Tool:\s*(.+)$/m)?.[1]?.trim() || "xcloud_ui_action";
  const ok = content.match(/^- OK:\s*(.+)$/m)?.[1]?.trim() !== "false";
  const message = content.match(/^- Message:\s*(.+)$/m)?.[1]?.trim();
  const output = content.match(/^- Output:\s*([\s\S]+)$/m)?.[1]?.trim() ?? message;

  return {
    id: `ui-action-history-${index}-${timestamp}`,
    name: toolName,
    title: toolName,
    status: ok ? "done" : "error",
    output,
    timestamp,
  };
}

async function executeUiActionDirectives(sessionKey: string, actions: Array<{ instruction: string; preferredTool?: string }>) {
  if (actions.length === 0) return;
  const agentId = extractAgentIdFromSessionKey(sessionKey);
  for (const action of actions) {
    const toolCallId = `ui-action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    updateChatMessages(sessionKey, (messages) => [
      ...messages,
      {
        id: `tool-${toolCallId}`,
        role: "tool" as const,
        content: "",
        timestamp: Date.now(),
        tool: {
          id: toolCallId,
          name: action.preferredTool ?? "xcloud_ui_action",
          title: action.instruction,
          status: "running",
          timestamp: Date.now(),
        },
      },
    ]);

    const result = await executeRegisteredUiAction({ agentId, ...action }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      output: undefined,
      toolName: action.preferredTool,
    }));
    const output = result.output == null
      ? result.message
      : typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);

    updateChatMessages(sessionKey, (messages) =>
      messages.map((message) =>
        message.role === "tool" && message.tool?.id === toolCallId
          ? {
              ...message,
              tool: {
                ...message.tool,
                name: result.toolName ?? message.tool.name,
                status: result.ok ? "done" : "error",
                output,
              },
            }
          : message,
      ),
    );

    window.dispatchEvent(new CustomEvent("xcloud-ui-action-result-for-agent", {
      detail: {
        sessionKey,
        message: [
          HIDDEN_UI_ACTION_RESULT_MARKER,
          "xCloud UI action result:",
          `- Tool: ${result.toolName ?? action.preferredTool ?? "xcloud_ui_action"}`,
          `- OK: ${result.ok ? "true" : "false"}`,
          `- Message: ${result.message}`,
          output ? `- Output: ${output}` : "",
        ].filter(Boolean).join("\n"),
      },
    }));
  }
}

async function withXCloudAppContext(sessionKey: string, message: string) {
  const context = await buildXCloudAppContext(sessionKey);
  return `${APP_CONTEXT_START}\n${context}\n${APP_CONTEXT_END}\n\n${message}`;
}

function findAppToolRequest(message: string, sessionKey: string, hidden?: boolean): Omit<AppToolRequest, "sourceSessionKey"> | null {
  if (hidden) return null;
  const text = message.trim();
  const lower = text.toLowerCase();
  const workspaceId = extractWorkspaceIdFromSessionKey(sessionKey);

  // Workspace chats should behave like normal OpenClaw chats. The workspace
  // coordinator can call OpenClaw/plugin tools itself, so do not pre-empt the
  // user message with app-side shortcuts here.
  if (workspaceId) return null;

  if (!hasWorkspaceKeyword(text)) return null;

  if (hasListWorkspaceIntent(text)) {
    return { name: "list_workspaces", args: {} };
  }

  if (/(elimina|eliminar|borra|borrar|delete|remove)/.test(lower)) {
    const name = extractWorkspaceName(text);
    if (name) return { name: "delete_workspace", args: { name } };
  }

  if (hasOpenWorkspaceIntent(text)) {
    const name = extractWorkspaceName(text);
    if (name) return { name: "open_workspace", args: { name } };
  }

  const name = findWorkspaceRequest(text);
  if (name) return { name: "create_workspace", args: { name } };

  return null;
}

interface ChatSessionState {
  messages: ChatMessage[];
  isStreaming: boolean;
  loading: boolean;
  historyLoaded: boolean;
  historyPromise?: Promise<void>;
}

const chatSessions = new Map<string, ChatSessionState>();
const chatSessionListeners = new Map<string, Set<() => void>>();
const runSessionKeys = new Map<string, string>();
const activeRunIdsBySession = new Map<string, Set<string>>();
const engineEventBridges = new WeakSet<BrowserEngine>();
const engineSubscribedSessions = new WeakMap<BrowserEngine, Set<string>>();
const stoppedSessionUntil = new Map<string, number>();
const STOP_EVENT_SUPPRESSION_MS = 60 * 60_000;
const STOPPED_HISTORY_KEY = "xcloudStoppedChatHistory";

function isStopSuppressed(sessionKey: string) {
  const until = stoppedSessionUntil.get(sessionKey);
  if (!until) return false;
  if (Date.now() > until) {
    stoppedSessionUntil.delete(sessionKey);
    return false;
  }
  return true;
}

function rememberActiveRun(sessionKey: string, runId: string | undefined) {
  if (!runId) return;
  const current = activeRunIdsBySession.get(sessionKey) ?? new Set<string>();
  current.add(runId);
  activeRunIdsBySession.set(sessionKey, current);
}

function forgetActiveRun(sessionKey: string, runId: string | undefined) {
  if (!runId) return;
  const current = activeRunIdsBySession.get(sessionKey);
  if (!current) return;
  current.delete(runId);
  if (current.size === 0) activeRunIdsBySession.delete(sessionKey);
}

function getActiveRunIds(sessionKey: string) {
  return [...(activeRunIdsBySession.get(sessionKey) ?? new Set<string>())];
}

function readStoppedHistoryMarkers(): Record<string, { stoppedAt: number; runIds?: string[] }> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STOPPED_HISTORY_KEY) ?? "{}") as Record<string, { stoppedAt: number; runIds?: string[] }>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoppedHistoryMarkers(markers: Record<string, { stoppedAt: number; runIds?: string[] }>) {
  localStorage.setItem(STOPPED_HISTORY_KEY, JSON.stringify(markers));
}

function markSessionStoppedInHistory(sessionKey: string, runIds: string[]) {
  const markers = readStoppedHistoryMarkers();
  markers[sessionKey] = { stoppedAt: Date.now(), runIds };
  writeStoppedHistoryMarkers(markers);
}

function clearSessionStoppedHistory(sessionKey: string) {
  const markers = readStoppedHistoryMarkers();
  if (!markers[sessionKey]) return;
  delete markers[sessionKey];
  writeStoppedHistoryMarkers(markers);
}

function shouldHideStoppedHistoryAssistant(sessionKey: string, timestamp?: number) {
  const marker = readStoppedHistoryMarkers()[sessionKey];
  if (!marker?.stoppedAt) return false;
  const messageTime = timestamp ?? Date.now();
  return messageTime >= marker.stoppedAt - 2_000;
}

function createEmptySessionState(): ChatSessionState {
  return {
    messages: [],
    isStreaming: false,
    loading: true,
    historyLoaded: false,
  };
}

function getChatSessionState(sessionKey: string): ChatSessionState {
  let state = chatSessions.get(sessionKey);
  if (!state) {
    state = createEmptySessionState();
    chatSessions.set(sessionKey, state);
  }
  return state;
}

function notifyChatSession(sessionKey: string) {
  chatSessionListeners.get(sessionKey)?.forEach((listener) => listener());
}

function emitChatSessionActivity(sessionKey: string, options?: { working?: boolean }) {
  window.dispatchEvent(new CustomEvent("xcloud-chat-session-activity", {
    detail: { sessionKey, ...options },
  }));
}

function emitChatSessionRead(sessionKey: string) {
  window.dispatchEvent(new CustomEvent("xcloud-chat-session-read", {
    detail: { sessionKey },
  }));
}

function subscribeChatSession(sessionKey: string, listener: () => void) {
  let listeners = chatSessionListeners.get(sessionKey);
  if (!listeners) {
    listeners = new Set();
    chatSessionListeners.set(sessionKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) chatSessionListeners.delete(sessionKey);
  };
}

function updateChatSession(sessionKey: string, updater: (state: ChatSessionState) => ChatSessionState) {
  const current = getChatSessionState(sessionKey);
  const next = updater(current);
  chatSessions.set(sessionKey, next);
  notifyChatSession(sessionKey);
}

function updateChatMessages(sessionKey: string, updater: (messages: ChatMessage[]) => ChatMessage[]) {
  updateChatSession(sessionKey, (state) => ({
    ...state,
    messages: updater(state.messages),
  }));
}

function matchesSessionKey(eventSessionKey: string, sessionKey: string) {
  if (eventSessionKey === sessionKey) return true;
  return sessionKey === "main" && eventSessionKey === "agent:main:main";
}

function resolveEventSessionKeys(payload: Record<string, unknown>) {
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;
  if (runId && runSessionKeys.has(runId)) return [runSessionKeys.get(runId)!];

  const eventSessionKey = payload.sessionKey as string | undefined;
  if (eventSessionKey) {
    for (const sessionKey of chatSessions.keys()) {
      if (matchesSessionKey(eventSessionKey, sessionKey)) {
        if (runId) runSessionKeys.set(runId, sessionKey);
        return [sessionKey];
      }
    }
    const resolvedSessionKey = eventSessionKey === "agent:main:main" ? "main" : eventSessionKey;
    if (runId) runSessionKeys.set(runId, resolvedSessionKey);
    return [resolvedSessionKey];
  }

  const streamingSessions = [...chatSessions.entries()]
    .filter(([, state]) => state.isStreaming)
    .map(([sessionKey]) => sessionKey);
  if (streamingSessions.length === 1) {
    if (runId) runSessionKeys.set(runId, streamingSessions[0]!);
    return streamingSessions;
  }
  return [];
}

function ensureStreamingAssistant(messages: ChatMessage[], content = ""): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.isStreaming) {
    return content ? [...messages.slice(0, -1), { ...last, content: last.content + content }] : messages;
  }
  return [
    ...messages,
    { id: `assistant-${Date.now()}`, role: "assistant", content, timestamp: Date.now(), isStreaming: true },
  ];
}

function setStreamingAssistantText(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.isStreaming) {
    return [...messages.slice(0, -1), { ...last, content: text }];
  }
  return [
    ...messages,
    { id: `assistant-${Date.now()}`, role: "assistant", content: text, timestamp: Date.now(), isStreaming: true },
  ];
}

function finishStreamingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant" || !last.isStreaming) return messages;
  if (!last.content.trim() && !last.thinking && !last.attachments?.length) return messages.slice(0, -1);
  return [...messages.slice(0, -1), { ...last, isStreaming: false }];
}

function dropStreamingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.isStreaming) return messages.slice(0, -1);
  return messages;
}

function applyFinalAssistantText(messages: ChatMessage[], text: string, attachments?: ChatAttachment[]): ChatMessage[] {
  if (!text.trim() && !attachments?.length) return finishStreamingAssistant(messages);

  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    const currentText = last.content.trim();
    const finalText = text.trim();
    if (last.isStreaming || currentText === finalText || finalText.startsWith(currentText) || currentText.startsWith(finalText)) {
      return [
        ...messages.slice(0, -1),
        { ...last, content: text, attachments: mergeAttachments(last.attachments, attachments), isStreaming: false },
      ];
    }
  }

  return [
    ...finishStreamingAssistant(messages),
    { id: `assistant-${Date.now()}`, role: "assistant", content: text, attachments, timestamp: Date.now() },
  ];
}

function isSameHistoryMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== b.role) return false;
  if (a.role === "tool" || b.role === "tool") return a.tool?.id !== undefined && a.tool?.id === b.tool?.id;
  const aAttachments = a.attachments?.map(attachmentKey).join("|") ?? "";
  const bAttachments = b.attachments?.map(attachmentKey).join("|") ?? "";
  return a.content === b.content && aAttachments === bAttachments && Math.abs((a.timestamp ?? 0) - (b.timestamp ?? 0)) < 60_000;
}

function isCompatibleHistoryMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== b.role) return false;
  if (a.role === "tool" || b.role === "tool") return isSameHistoryMessage(a, b);
  return a.content === b.content && Math.abs((a.timestamp ?? 0) - (b.timestamp ?? 0)) < 60_000;
}

function mergeHistoryWithLive(loaded: ChatMessage[], live: ChatMessage[]) {
  if (live.length === 0) return loaded;
  if (loaded.length === 0) return live;

  const merged = [...loaded];
  for (const message of live) {
    const compatibleIndex = merged.findIndex((loadedMessage) => isCompatibleHistoryMessage(loadedMessage, message));
    if (compatibleIndex >= 0) {
      const loadedMessage = merged[compatibleIndex]!;
      merged[compatibleIndex] = {
        ...loadedMessage,
        thinking: loadedMessage.thinking || message.thinking,
        attachments: mergeAttachments(loadedMessage.attachments, message.attachments),
      };
      continue;
    }
    if (message.isStreaming || message.id.startsWith("user-") || message.id.startsWith("assistant-") || message.id.startsWith("tool-")) {
      merged.push(message);
    }
  }
  return merged;
}

type HistoryMessage = {
  role: string;
  content: unknown;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  openclawAbort?: { aborted?: boolean };
};

function parseHistoryMessages(sessionKey: string, history: HistoryMessage[]): ChatMessage[] {
  const toolOutputs = new Map<string, string>();
  const toolChanges = new Map<string, CodeChangeInfo[]>();
  const parsed: Array<{ role: string; content: string; attachments?: ChatAttachment[]; thinking?: string; tools: ToolCallInfo[]; timestamp: number }> = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.openclawAbort?.aborted) continue;
    if (m.role === "assistant" && shouldHideStoppedHistoryAssistant(sessionKey, m.timestamp)) continue;
    if (m.role === "toolResult" && Array.isArray(m.content)) {
      const text = (m.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join("");
      if (m.toolCallId) {
        toolOutputs.set(m.toolCallId, text.slice(0, 500));
        const cachedChanges = readCachedCodeChanges(sessionKey, m.toolCallId);
        const changes = buildCodeChangeFromTool({
          name: m.toolName ?? "tool",
          output: text,
          details: isRecord(m.details) ? m.details : undefined,
        });
        const mergedChanges = mergeCodeChanges(changes, cachedChanges);
        if (mergedChanges) toolChanges.set(m.toolCallId, mergedChanges);
      }
      for (let j = i - 1; j >= 0; j--) {
        const prev = history[j]!;
        if (prev.role === "assistant" && Array.isArray(prev.content)) {
          const toolBlock = (prev.content as Array<{ type: string; id?: string }>)
            .find(b => b.type === "toolCall" && b.id);
          if (toolBlock?.id) {
            toolOutputs.set(toolBlock.id, text.slice(0, 500));
            break;
          }
        }
      }
    }
  }

  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.openclawAbort?.aborted) continue;
    if (m.role === "assistant" && shouldHideStoppedHistoryAssistant(sessionKey, m.timestamp)) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;

    let content = "";
    let thinking = "";
    let attachments: ChatAttachment[] = [];
    const msgTools: ToolCallInfo[] = [];

    const parsedContent = parseMessageContent(m.content, `history-${i}`);
    content = parsedContent.text;
    thinking = parsedContent.thinking;
    attachments = parsedContent.attachments;

    if (Array.isArray(m.content)) {
      const blocks = m.content as Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: Record<string, unknown> }>;
      if (m.role === "assistant") {
        for (const block of blocks) {
          if (block.type === "toolCall" && block.name) {
            const toolId = block.id ?? `${block.name}-hist-${i}`;
            const args = isRecord(block.arguments) ? block.arguments : undefined;
            const output = toolOutputs.get(toolId);
            const changes = mergeCodeChanges(
              toolChanges.get(toolId) ?? buildCodeChangeFromTool({ name: block.name, args, output }),
              readCachedCodeChanges(sessionKey, toolId),
            );
            msgTools.push({
              id: toolId,
              name: block.name,
              title: buildToolTitle(block.name, args),
              args,
              output,
              changes,
              status: "done",
              timestamp: m.timestamp ?? Date.now(),
            });
          }
        }
      }
    }

    parsed.push({ role: m.role, content, attachments, thinking, tools: msgTools, timestamp: m.timestamp ?? Date.now() });
  }

  const loaded: ChatMessage[] = [];
  let pendingTools: ToolCallInfo[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;

    if (p.role === "user" && (p.content.includes(HIDDEN_UI_ACTION_RESULT_MARKER) || p.content.startsWith("xCloud UI action result:"))) {
      const tool = parseHiddenUiActionTool(p.content, p.timestamp, i);
      if (tool) {
        loaded.push({
          id: `tool-${tool.id}`,
          role: "tool",
          content: "",
          timestamp: tool.timestamp,
          tool,
        });
      }
      continue;
    }

    if (p.role === "user" && p.content.includes(HIDDEN_PROMPT_MARKER)) continue;

    if (p.role === "user" && p.content.length > 0) {
      const visibleContent = stripAppContext(p.content);
      if (!visibleContent) continue;
      loaded.push({
        id: `history-${i}`,
        role: "user",
        content: visibleContent,
        timestamp: p.timestamp,
      });
      continue;
    }

    if (p.role === "assistant") {
      for (const tool of [...pendingTools, ...p.tools]) {
        loaded.push({
          id: `tool-${tool.id}`,
          role: "tool",
          content: "",
          timestamp: tool.timestamp,
          tool,
        });
      }
      pendingTools = [];

      const { visible } = extractUiActionDirectives(p.content);
      if (visible.length > 0 || p.thinking || p.attachments?.length) {
        loaded.push({
          id: `history-${i}`,
          role: "assistant",
          content: visible,
          attachments: p.attachments,
          thinking: p.thinking || undefined,
          timestamp: p.timestamp,
        });
      }
    }
  }

  return coalesceAssistantMediaMessages(loaded);
}

function processChatEvent(engine: BrowserEngine, sessionKey: string, event: string, payload: Record<string, unknown>) {
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;

  if (isStopSuppressed(sessionKey)) {
    if (event === "chat") {
      const state = payload.state as string;
      if (state === "final" || state === "aborted" || state === "error") {
        forgetActiveRun(sessionKey, runId);
        updateChatSession(sessionKey, (current) => ({
          ...current,
          messages: dropStreamingAssistant(current.messages),
          isStreaming: false,
          loading: false,
        }));
        emitChatSessionActivity(sessionKey, { working: false });
      }
    }
    return;
  }

  rememberActiveRun(sessionKey, runId);
  emitAgUiEvents(sessionKey, openClawFrameToAgUiEvents(sessionKey, event, payload));

  if (event === "agent") {
    const stream = payload.stream as string;
    const data = payload.data as Record<string, unknown> | undefined;

    if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
      const delta = typeof data?.delta === "string"
        ? stripUiActionDirectivesForStreaming(sessionKey, runId, data.delta)
        : "";
      const text = typeof data?.text === "string"
        ? extractUiActionDirectives(data.text).visible
        : "";
      updateChatSession(sessionKey, (state) => ({
        ...state,
        isStreaming: true,
        loading: false,
        messages: delta
          ? ensureStreamingAssistant(state.messages, delta)
          : setStreamingAssistantText(state.messages, text),
      }));
      emitChatSessionActivity(sessionKey, { working: true });
    }

    if (stream === "lifecycle") {
      const phase = (data as Record<string, unknown>)?.phase as string;
      if (phase === "start") {
        updateChatSession(sessionKey, (state) => ({
          ...state,
          isStreaming: true,
          loading: false,
          messages: ensureStreamingAssistant(state.messages),
        }));
        emitChatSessionActivity(sessionKey, { working: true });
      }
      if (phase === "end") {
        updateChatSession(sessionKey, (state) => ({
          ...state,
          isStreaming: false,
          loading: false,
          messages: finishStreamingAssistant(state.messages),
        }));
        emitChatSessionActivity(sessionKey, { working: false });
      }
    }

    if (stream === "item" && data?.kind === "tool") {
      const phase = data.phase as string;
      const name = (data.name as string) ?? "unknown";
      const args = isRecord(data.args) ? data.args : undefined;
      const title = (data.title as string) ?? buildToolTitle(name, args);
      const toolCallId = (data.toolCallId as string) ?? `${name}-${Date.now()}`;

      if (phase === "start") {
        const toolInfo: ToolCallInfo = { id: toolCallId, name, title, args, status: "running", timestamp: Date.now() };
        if (isCodeChangeTool(name)) {
          void startCodeChangeSnapshot(sessionKey, toolCallId, args);
        }
        updateChatMessages(sessionKey, (messages) => {
          if (messages.some((message) => message.role === "tool" && message.tool?.id === toolCallId)) return messages;
          const last = messages[messages.length - 1];
          if (last?.isStreaming && last.content === "") {
            return [
              ...messages.slice(0, -1),
              { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo },
              last,
            ];
          }
          return [
            ...messages,
            { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo },
          ];
        });
        emitChatSessionActivity(sessionKey, { working: true });
      } else if (phase === "end") {
        const finalStatus = data.status === "completed" ? "done" : "error";
        updateChatMessages(sessionKey, (messages) =>
          messages.map((message) =>
            message.role === "tool" && message.tool?.id === toolCallId
              ? { ...message, tool: { ...message.tool!, status: finalStatus as ToolCallInfo["status"] } }
              : message,
          ),
        );
        if (isCodeChangeTool(name)) {
          attachDetectedCodeChanges(sessionKey, toolCallId);
        }
        emitChatSessionActivity(sessionKey, { working: true });
      }
    }

    if (stream === "command_output" && data) {
      const toolCallId = data.toolCallId as string;
      const output = data.output as string | undefined;
      if (toolCallId && output) {
        updateChatMessages(sessionKey, (messages) =>
          messages.map((message) =>
            message.role === "tool" && message.tool?.id === toolCallId
              ? { ...message, tool: { ...message.tool!, output } }
              : message,
          ),
        );
        emitChatSessionActivity(sessionKey, { working: true });
      }
    }

    if (stream === "tool" && data) {
      const phase = data.phase as string;
      const name = (data.name as string) ?? "unknown";
      const args = isRecord(data.args) ? data.args : undefined;
      const toolCallId = (data.toolCallId as string) ?? `${name}-${Date.now()}`;

      if (phase === "start") {
        const title = buildToolTitle(name, args);
        const toolInfo: ToolCallInfo = { id: toolCallId, name, title, args, status: "running", timestamp: Date.now() };
        if (isCodeChangeTool(name)) {
          void startCodeChangeSnapshot(sessionKey, toolCallId, args);
        }
        updateChatMessages(sessionKey, (messages) => {
          if (messages.some((message) => message.role === "tool" && message.tool?.id === toolCallId)) return messages;
          const last = messages[messages.length - 1];
          if (last?.isStreaming && last.content === "") {
            return [
              ...messages.slice(0, -1),
              { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo },
              last,
            ];
          }
          return [...messages, { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo }];
        });
      }

      if (phase === "result") {
        const result = isRecord(data.result) ? data.result : undefined;
        const output = result ? JSON.stringify(result) : undefined;
        const changes = buildCodeChangeFromTool({
          name,
          args,
          output,
          details: isRecord(result?.details) ? result.details : result,
        });
        updateChatMessages(sessionKey, (messages) =>
          messages.map((message) =>
            message.role === "tool" && message.tool?.id === toolCallId
              ? {
                  ...message,
                  tool: {
                    ...message.tool!,
                    args: args ?? message.tool!.args,
                    status: data.isError ? "error" : "done",
                    ...(changes ? { changes } : {}),
                  },
                }
              : message,
          ),
        );
        void hydrateCodeChangesWithSnapshotDiff(sessionKey, changes).then((hydrated) => {
          attachCodeChangesToTool(sessionKey, toolCallId, hydrated);
        });
        if (isCodeChangeTool(name)) {
          attachDetectedCodeChanges(sessionKey, toolCallId);
        }
      }
    }

    if (stream === "patch" && data) {
      const toolCallId = data.toolCallId as string | undefined;
      const changes = buildCodeChangesFromPatchSummary(data);
      if (toolCallId && changes) {
        updateChatMessages(sessionKey, (messages) =>
          messages.map((message) =>
            message.role === "tool" && message.tool?.id === toolCallId
              ? { ...message, tool: { ...message.tool!, changes: mergeCodeChanges(message.tool!.changes, changes) } }
              : message,
          ),
        );
        void hydrateCodeChangesWithSnapshotDiff(sessionKey, changes).then((hydrated) => {
          attachCodeChangesToTool(sessionKey, toolCallId, hydrated);
        });
      }
    }
  }

  if (event === "chat") {
    const state = payload.state as string;
    const message = payload.message as Record<string, unknown> | undefined;

    if (state === "final" && message?.role === "assistant") {
      forgetActiveRun(sessionKey, runId);
      const parsedContent = parseMessageContent(message.content, `final-${Date.now()}`);
      const text = parsedContent.text;

      const { visible, actions } = extractUiActionDirectives(text);
      streamingUiDirectiveBuffers.delete(streamingDirectiveKey(sessionKey, runId));
      updateChatSession(sessionKey, (current) => {
        return {
          ...current,
          messages: applyFinalAssistantText(current.messages, visible, parsedContent.attachments),
          isStreaming: false,
          loading: false,
        };
      });
      window.setTimeout(() => void refreshSessionHistory(engine, sessionKey), 350);
      void executeUiActionDirectives(sessionKey, actions);
      emitChatSessionActivity(sessionKey, { working: false });
    } else if (state === "final" || state === "aborted" || state === "error") {
      forgetActiveRun(sessionKey, runId);
      updateChatSession(sessionKey, (current) => ({
        ...current,
        messages: state === "aborted" ? dropStreamingAssistant(current.messages) : finishStreamingAssistant(current.messages),
        isStreaming: false,
        loading: false,
      }));
      emitChatSessionActivity(sessionKey, { working: false });
    }
  }
}

function ensureEngineEventBridge(engine: BrowserEngine) {
  if (engineEventBridges.has(engine)) return;
  engineEventBridges.add(engine);

  engine.onEvent((frame) => {
    const event = frame.event as string;
    const payload = frame.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    for (const sessionKey of resolveEventSessionKeys(payload)) {
      processChatEvent(engine, sessionKey, event, payload);
    }
  });
}

function ensureEngineSessionSubscription(engine: BrowserEngine, sessionKey: string) {
  let sessions = engineSubscribedSessions.get(engine);
  if (!sessions) {
    sessions = new Set();
    engineSubscribedSessions.set(engine, sessions);
  }
  if (sessions.has(sessionKey)) return;

  sessions.add(sessionKey);
  void engine.subscribe(sessionKey).catch(() => {
    sessions.delete(sessionKey);
  });
}

async function refreshSessionHistory(engine: BrowserEngine, sessionKey: string) {
  const result = await engine.rpc("chat.history", { sessionKey }).catch(() => null);
  const history = (result as { messages?: HistoryMessage[] } | null)?.messages;
  if (!history) return;

  const loaded = parseHistoryMessages(sessionKey, history);
  updateChatSession(sessionKey, (current) => ({
    ...current,
    messages: mergeHistoryWithLive(loaded, current.messages),
    loading: false,
    historyLoaded: true,
    historyPromise: undefined,
  }));
}

function ensureSessionHistory(engine: BrowserEngine, sessionKey: string) {
  const state = getChatSessionState(sessionKey);
  if (state.historyLoaded || state.historyPromise) return;

  const historyPromise = withTimeout(
    engine.rpc("chat.history", { sessionKey }),
    CHAT_HISTORY_TIMEOUT_MS,
    "chat.history",
  )
    .then((result) => {
      const history = (result as { messages?: HistoryMessage[] }).messages ?? [];
      const loaded = parseHistoryMessages(sessionKey, history);
      updateChatSession(sessionKey, (current) => {
        const hasLiveMessages = current.isStreaming || current.messages.some((message) => message.isStreaming || message.id.startsWith("user-") || message.id.startsWith("assistant-"));
        return {
          ...current,
          messages: hasLiveMessages ? mergeHistoryWithLive(loaded, current.messages) : loaded,
          loading: false,
          historyLoaded: true,
          historyPromise: undefined,
        };
      });
    })
    .catch(() => {
      updateChatSession(sessionKey, (current) => ({
        ...current,
        loading: false,
        historyLoaded: false,
        historyPromise: undefined,
      }));
    });

  chatSessions.set(sessionKey, {
    ...state,
    loading: true,
    historyPromise,
  });
  notifyChatSession(sessionKey);
}

export function useChat({ engine, sessionKey = "main", appTools }: UseChatOptions): UseChatReturn {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeChatSession(sessionKey, () => rerender((value) => value + 1));
    ensureEngineEventBridge(engine);
    ensureEngineSessionSubscription(engine, sessionKey);
    ensureSessionHistory(engine, sessionKey);
    emitChatSessionRead(sessionKey);
    const handleUiActionResult = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; message?: string }>).detail;
      if (detail?.sessionKey !== sessionKey || !detail.message) return;
      void engine.sendMessage(sessionKey, detail.message).catch(() => {});
    };
    window.addEventListener("xcloud-ui-action-result-for-agent", handleUiActionResult);
    return () => {
      unsubscribe();
      window.removeEventListener("xcloud-ui-action-result-for-agent", handleUiActionResult);
    };
  }, [engine, sessionKey]);

  const send = useCallback(
    async (content: string, options?: { hidden?: boolean }) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      stoppedSessionUntil.delete(sessionKey);
      clearSessionStoppedHistory(sessionKey);

      const appToolRequest = findAppToolRequest(trimmed, sessionKey, options?.hidden);
      const currentState = getChatSessionState(sessionKey);
      const isSteeringActiveRun = currentState.isStreaming && !appToolRequest;
      const streamId = isSteeringActiveRun ? null : `assistant-${Date.now()}`;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      updateChatSession(sessionKey, (state) => ({
        ...state,
        loading: false,
        isStreaming: true,
        messages: [
          ...state.messages,
          ...(options?.hidden ? [] : [userMsg]),
          ...(streamId ? [{ id: streamId, role: "assistant" as const, content: "", timestamp: Date.now(), isStreaming: true }] : []),
        ],
      }));
      if (!options?.hidden) emitAgUiEvents(sessionKey, userMessageToAgUiEvents(trimmed));
      emitChatSessionActivity(sessionKey, { working: true });

      try {
        if (appToolRequest && appTools && streamId) {
          const toolCallId = `${appToolRequest.name}-${Date.now()}`;
          const toolTitle = appToolRequest.args.name ?? appToolRequest.name.replaceAll("_", " ");
          updateChatMessages(sessionKey, (messages) => [
            ...messages.slice(0, -1),
            {
              id: `tool-${toolCallId}`,
              role: "tool",
              content: "",
              timestamp: Date.now(),
              tool: {
                id: toolCallId,
                name: appToolRequest.name,
                title: toolTitle,
                status: "running",
                timestamp: Date.now(),
              },
            },
            messages[messages.length - 1]!,
          ]);

          const result = await appTools({
            ...appToolRequest,
            sourceSessionKey: sessionKey,
          });

          updateChatSession(sessionKey, (state) => ({
            ...state,
            isStreaming: false,
            messages: state.messages.map((msg) => {
              if (msg.role === "tool" && msg.tool?.id === toolCallId) {
                return {
                  ...msg,
                  tool: {
                    ...msg.tool,
                    status: "done",
                    output: result.output ?? result.message,
                  },
                };
              }
              if (msg.id === streamId) {
                return {
                  ...msg,
                  content: result.message,
                  isStreaming: false,
                };
              }
              return msg;
            }),
          }));
          emitChatSessionActivity(sessionKey, { working: false });
          return;
        }
        const isWorkspaceSession = sessionKey.includes("workspace-");
        const workspaceName = options?.hidden || isWorkspaceSession || isSteeringActiveRun ? null : findWorkspaceRequest(trimmed);
        if (workspaceName) {
          window.dispatchEvent(new CustomEvent("xcloud-create-workspace-request", {
            detail: { name: workspaceName, sourceSessionKey: sessionKey },
          }));
        }
        if (!options?.hidden && !isSteeringActiveRun) {
          await startSessionChangeSnapshots(sessionKey);
        }
        const messageForEngine = options?.hidden ? trimmed : await withXCloudAppContext(sessionKey, trimmed);
        const result = await engine.sendMessage(sessionKey, messageForEngine);
        if (result.runId) {
          runSessionKeys.set(result.runId, sessionKey);
          rememberActiveRun(sessionKey, result.runId);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const errorMessage: ChatMessage = {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: `No pude completar esa acción todavía: ${detail}`,
          timestamp: Date.now(),
        };
        updateChatSession(sessionKey, (state) => ({
          ...state,
          isStreaming: isSteeringActiveRun ? state.isStreaming : false,
          messages: streamId ? state.messages.map((msg) => {
            if (msg.role === "tool" && msg.tool?.status === "running") {
              return {
                ...msg,
                tool: {
                  ...msg.tool,
                  status: "error",
                  output: detail,
                },
              };
            }
            if (msg.id === streamId) {
              return {
                ...msg,
                content: errorMessage.content,
                isStreaming: false,
              };
            }
            return msg;
          }) : [...state.messages, errorMessage],
        }));
        emitChatSessionActivity(sessionKey, { working: isSteeringActiveRun ? true : false });
      }
    },
    [appTools, engine, sessionKey],
  );

  const stop = useCallback(async () => {
    const current = getChatSessionState(sessionKey);
    if (!current.isStreaming) return;
    const activeRunIds = getActiveRunIds(sessionKey);
    stoppedSessionUntil.set(sessionKey, Date.now() + STOP_EVENT_SUPPRESSION_MS);
    markSessionStoppedInHistory(sessionKey, activeRunIds);

    updateChatSession(sessionKey, (state) => ({
      ...state,
      isStreaming: false,
      loading: false,
      messages: dropStreamingAssistant(state.messages),
    }));
    emitChatSessionActivity(sessionKey, { working: false });

    try {
      const runAbortResults = await Promise.all(activeRunIds.map((runId) => engine.abortChat(sessionKey, runId).catch(() => null)));
      const sessionAbortResult = await engine.abortChat(sessionKey).catch(() => null);
      const aborted = [...runAbortResults, sessionAbortResult].some((result) => result?.aborted);
      if (!aborted) await engine.sendMessage(sessionKey, "/stop");
    } catch {
      try {
        await engine.sendMessage(sessionKey, "/stop");
      } catch {
        // The optimistic local stop above keeps the UI responsive even if the gateway is already done.
      }
    }
  }, [engine, sessionKey]);

  const state = getChatSessionState(sessionKey);
  return { messages: state.messages, isStreaming: state.isStreaming, loading: state.loading, send, stop };
}
