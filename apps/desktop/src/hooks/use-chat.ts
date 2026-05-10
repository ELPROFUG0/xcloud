import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import type { ChatMessage, ToolCallInfo } from "@/types/chat";

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
const engineEventBridges = new WeakSet<BrowserEngine>();
const engineSubscribedSessions = new WeakMap<BrowserEngine, Set<string>>();

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
  if (!last.content.trim() && !last.thinking) return messages.slice(0, -1);
  return [...messages.slice(0, -1), { ...last, isStreaming: false }];
}

function applyFinalAssistantText(messages: ChatMessage[], text: string): ChatMessage[] {
  if (!text.trim()) return finishStreamingAssistant(messages);

  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    const currentText = last.content.trim();
    const finalText = text.trim();
    if (last.isStreaming || currentText === finalText || finalText.startsWith(currentText) || currentText.startsWith(finalText)) {
      return [
        ...messages.slice(0, -1),
        { ...last, content: text, isStreaming: false },
      ];
    }
  }

  return [
    ...finishStreamingAssistant(messages),
    { id: `assistant-${Date.now()}`, role: "assistant", content: text, timestamp: Date.now() },
  ];
}

function isSameHistoryMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== b.role) return false;
  if (a.role === "tool" || b.role === "tool") return a.tool?.id !== undefined && a.tool?.id === b.tool?.id;
  return a.content === b.content && Math.abs((a.timestamp ?? 0) - (b.timestamp ?? 0)) < 60_000;
}

function mergeHistoryWithLive(loaded: ChatMessage[], live: ChatMessage[]) {
  if (live.length === 0) return loaded;
  if (loaded.length === 0) return live;

  const merged = [...loaded];
  for (const message of live) {
    if (message.id.startsWith("history-") && merged.some((loadedMessage) => isSameHistoryMessage(loadedMessage, message))) continue;
    if (merged.some((loadedMessage) => isSameHistoryMessage(loadedMessage, message))) continue;
    if (message.isStreaming || message.id.startsWith("user-") || message.id.startsWith("assistant-") || message.id.startsWith("tool-")) {
      merged.push(message);
    }
  }
  return merged;
}

function parseHistoryMessages(history: Array<{ role: string; content: unknown; timestamp?: number }>): ChatMessage[] {
  const toolOutputs = new Map<string, string>();
  const parsed: Array<{ role: string; content: string; thinking?: string; tools: ToolCallInfo[]; timestamp: number }> = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.role === "toolResult" && Array.isArray(m.content)) {
      const text = (m.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join("");
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
    if (m.role !== "user" && m.role !== "assistant") continue;

    let content = "";
    let thinking = "";
    const msgTools: ToolCallInfo[] = [];

    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      const blocks = m.content as Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: Record<string, unknown> }>;
      content = blocks
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join("");

      thinking = blocks
        .filter(b => b.type === "thinking" && b.thinking)
        .map(b => b.thinking)
        .join("\n");

      if (m.role === "assistant") {
        for (const block of blocks) {
          if (block.type === "toolCall" && block.name) {
            const toolId = block.id ?? `${block.name}-hist-${i}`;
            msgTools.push({
              id: toolId,
              name: block.name,
              title: buildToolTitle(block.name, block.arguments),
              output: toolOutputs.get(toolId),
              status: "done",
              timestamp: m.timestamp ?? Date.now(),
            });
          }
        }
      }
    }

    parsed.push({ role: m.role, content, thinking, tools: msgTools, timestamp: m.timestamp ?? Date.now() });
  }

  const loaded: ChatMessage[] = [];
  let pendingTools: ToolCallInfo[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]!;

    if (p.role === "user" && p.content.includes(HIDDEN_PROMPT_MARKER)) continue;

    if (p.role === "user" && p.content.length > 0) {
      loaded.push({
        id: `history-${i}`,
        role: "user",
        content: p.content,
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

      if (p.content.length > 0 || p.thinking) {
        loaded.push({
          id: `history-${i}`,
          role: "assistant",
          content: p.content,
          thinking: p.thinking || undefined,
          timestamp: p.timestamp,
        });
      }
    }
  }

  return loaded;
}

function processChatEvent(sessionKey: string, event: string, payload: Record<string, unknown>) {
  if (event === "agent") {
    const stream = payload.stream as string;
    const data = payload.data as Record<string, unknown> | undefined;

    if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
      const delta = typeof data?.delta === "string" ? data.delta : "";
      const text = typeof data?.text === "string" ? data.text : "";
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
      const title = (data.title as string) ?? name;
      const toolCallId = (data.toolCallId as string) ?? `${name}-${Date.now()}`;

      if (phase === "start") {
        const toolInfo: ToolCallInfo = { id: toolCallId, name, title, status: "running", timestamp: Date.now() };
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
  }

  if (event === "chat") {
    const state = payload.state as string;
    const message = payload.message as Record<string, unknown> | undefined;

    if (state === "final" && message?.role === "assistant") {
      const content = message.content;
      let text = "";
      if (Array.isArray(content)) {
        text = (content as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text as string)
          .join("");
      } else if (typeof content === "string") {
        text = content;
      }

      updateChatSession(sessionKey, (current) => {
        return {
          ...current,
          messages: applyFinalAssistantText(current.messages, text),
          isStreaming: false,
          loading: false,
        };
      });
      emitChatSessionActivity(sessionKey, { working: false });
    } else if (state === "final") {
      updateChatSession(sessionKey, (current) => ({
        ...current,
        messages: finishStreamingAssistant(current.messages),
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
      processChatEvent(sessionKey, event, payload);
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

function ensureSessionHistory(engine: BrowserEngine, sessionKey: string) {
  const state = getChatSessionState(sessionKey);
  if (state.historyLoaded || state.historyPromise) return;

  const historyPromise = withTimeout(
    engine.rpc("chat.history", { sessionKey }),
    CHAT_HISTORY_TIMEOUT_MS,
    "chat.history",
  )
    .then((result) => {
      const history = (result as { messages?: Array<{ role: string; content: unknown; timestamp?: number }> }).messages ?? [];
      const loaded = parseHistoryMessages(history);
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
    return unsubscribe;
  }, [engine, sessionKey]);

  const send = useCallback(
    async (content: string, options?: { hidden?: boolean }) => {
      if (!content.trim()) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };

      const streamId = `assistant-${Date.now()}`;

      updateChatSession(sessionKey, (state) => ({
        ...state,
        loading: false,
        isStreaming: true,
        messages: [
          ...state.messages,
          ...(options?.hidden ? [] : [userMsg]),
          { id: streamId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
        ],
      }));
      emitChatSessionActivity(sessionKey, { working: true });

      try {
        const appToolRequest = findAppToolRequest(content, sessionKey, options?.hidden);
        if (appToolRequest && appTools) {
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
        const workspaceName = options?.hidden || isWorkspaceSession ? null : findWorkspaceRequest(content);
        if (workspaceName) {
          window.dispatchEvent(new CustomEvent("xcloud-create-workspace-request", {
            detail: { name: workspaceName, sourceSessionKey: sessionKey },
          }));
        }
        const result = await engine.sendMessage(sessionKey, content.trim());
        if (result.runId) runSessionKeys.set(result.runId, sessionKey);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        updateChatSession(sessionKey, (state) => ({
          ...state,
          isStreaming: false,
          messages: state.messages.map((msg) => {
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
                content: `No pude completar esa acción todavía: ${detail}`,
                isStreaming: false,
              };
            }
            return msg;
          }),
        }));
        emitChatSessionActivity(sessionKey, { working: false });
      }
    },
    [appTools, engine, sessionKey],
  );

  const state = getChatSessionState(sessionKey);
  return { messages: state.messages, isStreaming: state.isStreaming, loading: state.loading, send };
}
