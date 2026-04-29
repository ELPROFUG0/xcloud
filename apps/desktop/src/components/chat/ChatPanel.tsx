import { useEffect, useRef } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ArrowLeft, Loader2 } from "lucide-react";

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
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
        {onBack && (
          <button
            onClick={onBack}
            className="text-text-muted transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="text-[12px] font-medium">{displayName}</span>
        {isStreaming && <span className="text-[10px] text-text-muted">typing...</span>}
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

      <ChatInput
        onSend={send}
        disabled={!engine.connected}
        engine={engine}
      />
    </div>
  );
}
