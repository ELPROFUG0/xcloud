import { useEffect, useRef } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ArrowLeft, Bot, Loader2 } from "lucide-react";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  agentName?: string;
  onBack?: () => void;
}

export function ChatPanel({ engine, agentId = "main", agentName, onBack }: ChatPanelProps) {
  const sessionKey = agentId === "main" ? "main" : `agent:${agentId}:main`;
  const { messages, tools, isStreaming, send } = useChat({ engine, sessionKey });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tools]);

  const displayName = agentName ?? agentId;

  return (
    <div className="flex h-full flex-col">
      {/* Header with back button */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">{displayName}</h1>
            <p className="text-[10px] text-text-muted">
              {isStreaming ? "typing..." : "online"}
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
            <div className="text-3xl opacity-30">&gt;_</div>
            <p className="text-sm">Start chatting with {displayName}</p>
          </div>
        )}

        <div className="mx-auto max-w-3xl py-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {tools.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-2">
              {tools.map((tool) => (
                <ToolCallBadge key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 px-4 py-2 text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Thinking...</span>
            </div>
          )}
        </div>
      </div>

      <ChatInput onSend={send} disabled={!engine.connected} />
    </div>
  );
}
