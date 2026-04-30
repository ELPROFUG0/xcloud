import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import type { ChatMessage, ToolCallInfo } from "@/types/chat";

interface UseChatOptions {
  engine: BrowserEngine;
  sessionKey?: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  tools: ToolCallInfo[];
  isStreaming: boolean;
  send: (message: string) => Promise<void>;
}

export function useChat({ engine, sessionKey = "main" }: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolCallInfo[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const subscribedRef = useRef(false);

  // Reset when session changes
  useEffect(() => {
    setMessages([]);
    setTools([]);
    setIsStreaming(false);
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
          const loaded: ChatMessage[] = history
            .filter(m => m.role === "user" || m.role === "assistant")
            .map((m, i) => {
              let content = "";
              if (typeof m.content === "string") {
                content = m.content;
              } else if (Array.isArray(m.content)) {
                content = (m.content as Array<{ type: string; text?: string }>)
                  .filter(b => b.type === "text" && b.text)
                  .map(b => b.text)
                  .join("");
              }
              return {
                id: `history-${i}`,
                role: m.role as "user" | "assistant",
                content,
                timestamp: m.timestamp ?? Date.now(),
              };
            })
            .filter(m => m.content.length > 0);
          setMessages(loaded);
        }
      } catch {
        // History may not be available — that's OK
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
      }

      // Chat final — response complete
      if (event === "chat") {
        const state = payload.state as string;
        const message = payload.message as Record<string, unknown> | undefined;

        if (state === "final" && message?.role === "assistant") {
          setIsStreaming(false);

          // Extract text from content blocks
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

      // Tool events
      if (event === "session.tool") {
        const tool = payload.tool as Record<string, unknown> | undefined;
        const status = (payload.status as string) ?? "running";
        const name = (tool?.name as string) ?? "unknown";

        setTools((prev) => {
          const existing = prev.find((t) => t.name === name && t.status === "running");
          if (existing && status !== "running") {
            return prev.map((t) =>
              t.id === existing.id ? { ...t, status: status as ToolCallInfo["status"] } : t,
            );
          }
          return [
            ...prev,
            { id: `${name}-${Date.now()}`, name, status: status as ToolCallInfo["status"], timestamp: Date.now() },
          ];
        });
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [engine, sessionKey]);

  // Send message
  const send = useCallback(
    async (content: string) => {
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
        userMsg,
        { id: streamId, role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
      ]);
      setTools([]);
      setIsStreaming(true);

      try {
        await engine.sendMessage(sessionKey, content.trim());
      } catch {
        setIsStreaming(false);
      }
    },
    [engine, sessionKey],
  );

  return { messages, tools, isStreaming, send };
}
