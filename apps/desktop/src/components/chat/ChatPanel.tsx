import { useEffect, useRef } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ModelSelector } from "@/components/ModelSelector";
import { Loader2, Wifi, Settings } from "lucide-react";

interface ChatPanelProps {
  engine: BrowserEngine;
  onOpenSettings: () => void;
}

export function ChatPanel({ engine, onOpenSettings }: ChatPanelProps) {
  const { messages, tools, isStreaming, send } = useChat({ engine });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tools]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <h1 className="text-sm font-semibold">Agent Studio</h1>
        <div className="flex items-center gap-3">
          <ModelSelector engine={engine} />
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-text"
            title="API Keys"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1.5 text-xs">
            <Wifi className="h-3 w-3 text-emerald-400" />
            <span className="text-text-muted">Connected</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
            <div className="text-4xl opacity-30">&gt;_</div>
            <p className="text-sm">Start a conversation with your agent</p>
          </div>
        )}

        <div className="mx-auto max-w-3xl py-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Active tool calls */}
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-2">
              {tools.map((tool) => (
                <ToolCallBadge key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {/* Thinking indicator */}
          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.content === "" && (
            <div className="flex items-center gap-2 px-4 py-2 text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Agent is thinking...</span>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={send} disabled={!engine.connected} />
    </div>
  );
}
