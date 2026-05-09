import { useCallback, useEffect, useRef, useState } from "react";
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

export const HIDDEN_PROMPT_MARKER = "<!-- unicore:hidden-workspace-setup -->";

export interface AppToolRequest {
  name: "create_workspace" | "delete_workspace" | "list_workspaces";
  args: {
    name?: string;
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

function findWorkspaceRequest(message: string): string | null {
  const text = message.trim();
  const lower = text.toLowerCase();
  if (!/(workspace|work space|espacio de trabajo)/.test(lower)) return null;
  if (!/(crea|crear|create|nuevo|new|haz|hacer)/.test(lower)) return null;

  const quoted = text.match(/["“']([^"”']{2,60})["”']/)?.[1]?.trim();
  if (quoted) return quoted;

  const named = text.match(/(?:workspace|espacio de trabajo)(?:\s+(?:llamado|named|de|para|for))?\s+([a-z0-9][\w\s-]{1,50})/i)?.[1]?.trim();
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

function findAppToolRequest(message: string, sessionKey: string, hidden?: boolean): Omit<AppToolRequest, "sourceSessionKey"> | null {
  if (hidden) return null;
  const text = message.trim();
  const lower = text.toLowerCase();
  if (!/(workspace|work space|espacio de trabajo)/.test(lower)) return null;

  if (/(lista|listar|mu[eé]strame|mostrar|show|list)/.test(lower)) {
    return { name: "list_workspaces", args: {} };
  }

  if (/(elimina|eliminar|borra|borrar|delete|remove)/.test(lower)) {
    const name = extractWorkspaceName(text);
    if (name) return { name: "delete_workspace", args: { name } };
  }

  const name = findWorkspaceRequest(text);
  if (name) return { name: "create_workspace", args: { name } };

  return null;
}

export function useChat({ engine, sessionKey = "main", appTools }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const subscribedRef = useRef(false);

  // Reset when session changes
  useEffect(() => {
    setMessages([]);
    setIsStreaming(false);
    setLoading(true);
    subscribedRef.current = false;
  }, [sessionKey]);

  // Load history and subscribe
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (subscribedRef.current) return;

      // Load existing chat history from gateway
      try {
        const result = await engine.rpc("chat.history", { sessionKey });
        if (!cancelled) {
          const history = (result as { messages?: Array<{ role: string; content: unknown; timestamp?: number }> }).messages ?? [];

          // First pass: parse all messages, collect toolResult outputs
          const toolOutputs = new Map<string, string>();
          const parsed: Array<{ role: string; content: string; thinking?: string; tools: ToolCallInfo[]; timestamp: number }> = [];

          // Pre-scan for toolResult outputs (they follow assistant messages with toolCall)
          for (let i = 0; i < history.length; i++) {
            const m = history[i]!;
            if (m.role === "toolResult" && Array.isArray(m.content)) {
              const text = (m.content as Array<{ type: string; text?: string }>)
                .filter(b => b.type === "text" && b.text)
                .map(b => b.text)
                .join("");
              // Find the preceding toolCall to associate output
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

              // Extract thinking blocks
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

          // Second pass: build interleaved messages (tool messages + text messages)
          const loaded: ChatMessage[] = [];
          let pendingTools: ToolCallInfo[] = [];

          for (let i = 0; i < parsed.length; i++) {
            const p = parsed[i]!;

            if (p.role === "user" && p.content.includes(HIDDEN_PROMPT_MARKER)) {
              continue;
            }

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
              // Add tools as inline messages
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

              // Add text message if has content
              if (p.content.length > 0 || p.thinking) {
                loaded.push({
                  id: `history-${i}`,
                  role: "assistant",
                  content: p.content,
                  thinking: p.thinking || undefined,
                  timestamp: p.timestamp,
                });
              }
              continue;
            }

            // Tool-only messages: collect for next
            if (p.role === "assistant" && p.content.length === 0 && p.tools.length > 0) {
              pendingTools.push(...p.tools);
            }
          }

          setMessages(loaded);
          setLoading(false);
        }
      } catch {
        // History may not be available — that's OK
        if (!cancelled) setLoading(false);
      }

      try {
        await engine.subscribe(sessionKey);
        subscribedRef.current = true;
      } catch {
        // Subscription may fail — will retry on next render
      }
    }

    setup();

    const unsub = engine.onEvent((frame) => {
      if (cancelled) return;
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;

      // Only process events for this session
      const eventSessionKey = payload.sessionKey as string | undefined;
      if (eventSessionKey) {
        const myKey = sessionKey === "main" ? "agent:main:main" : sessionKey;
        if (eventSessionKey !== myKey && eventSessionKey !== sessionKey) return;
      }

      // Agent streaming deltas
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;

        if (stream === "assistant" && data?.delta) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + (data.delta as string) },
              ];
            }
            return prev;
          });
        }

        if (stream === "lifecycle") {
          const phase = (data as Record<string, unknown>)?.phase as string;
          if (phase === "start") setIsStreaming(true);
        }

        // Tool events — insert as inline messages
        if (stream === "item" && data?.kind === "tool") {
          const phase = data.phase as string;
          const name = (data.name as string) ?? "unknown";
          const title = (data.title as string) ?? name;
          const toolCallId = (data.toolCallId as string) ?? `${name}-${Date.now()}`;

          if (phase === "start") {
            const toolInfo: ToolCallInfo = { id: toolCallId, name, title, status: "running", timestamp: Date.now() };
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              // Insert tool before the streaming placeholder
              if (last?.isStreaming && last.content === "") {
                return [
                  ...prev.slice(0, -1),
                  { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo },
                  last,
                ];
              }
              return [
                ...prev,
                { id: `tool-${toolCallId}`, role: "tool" as const, content: "", timestamp: Date.now(), tool: toolInfo },
              ];
            });
          } else if (phase === "end") {
            const finalStatus = data.status === "completed" ? "done" : "error";
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "tool" && m.tool?.id === toolCallId
                  ? { ...m, tool: { ...m.tool!, status: finalStatus as ToolCallInfo["status"] } }
                  : m,
              ),
            );
          }
        }

        // Capture command output
        if (stream === "command_output" && data) {
          const toolCallId = data.toolCallId as string;
          const output = data.output as string | undefined;
          if (toolCallId && output) {
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "tool" && m.tool?.id === toolCallId
                  ? { ...m, tool: { ...m.tool!, output } }
                  : m,
              ),
            );
          }
        }
      }

      // Chat final — response complete
      if (event === "chat") {
        const state = payload.state as string;
        const message = payload.message as Record<string, unknown> | undefined;

        if (state === "final" && message?.role === "assistant") {
          setIsStreaming(false);

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

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: text || last.content, isStreaming: false },
              ];
            }
            return prev;
          });
        }
      }

    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [engine, sessionKey]);

  // Send message
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

      setMessages((prev) => [
        ...prev,
        ...(options?.hidden ? [] : [userMsg]),
        { id: streamId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
      ]);
      setIsStreaming(true);

      try {
        const appToolRequest = findAppToolRequest(content, sessionKey, options?.hidden);
        if (appToolRequest && appTools) {
          const toolCallId = `${appToolRequest.name}-${Date.now()}`;
          const toolTitle = appToolRequest.args.name ?? appToolRequest.name.replaceAll("_", " ");
          setMessages((prev) => [
            ...prev.slice(0, -1),
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
            prev[prev.length - 1]!,
          ]);

          const result = await appTools({
            ...appToolRequest,
            sourceSessionKey: sessionKey,
          });

          setMessages((prev) => prev.map((msg) => {
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
          }));
          setIsStreaming(false);
          return;
        }
        const isWorkspaceSession = sessionKey.includes("workspace-");
        const workspaceName = options?.hidden || isWorkspaceSession ? null : findWorkspaceRequest(content);
        if (workspaceName) {
          window.dispatchEvent(new CustomEvent("xcloud-create-workspace-request", {
            detail: { name: workspaceName, sourceSessionKey: sessionKey },
          }));
        }
        await engine.sendMessage(sessionKey, content.trim());
      } catch {
        setIsStreaming(false);
      }
    },
    [appTools, engine, sessionKey],
  );

  return { messages, isStreaming, loading, send };
}
