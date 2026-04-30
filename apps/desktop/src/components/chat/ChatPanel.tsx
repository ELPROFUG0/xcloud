import { useEffect, useRef, useMemo, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/types/chat";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  agentName?: string;
  onBack?: () => void;
}

interface Page {
  userMessage: ChatMessage;
  responses: ChatMessage[];
}

function paginate(messages: ChatMessage[]): Page[] {
  const pages: Page[] = [];
  let current: Page | null = null;
  for (const msg of messages) {
    if (msg.role === "user") {
      current = { userMessage: msg, responses: [] };
      pages.push(current);
    } else if (current) {
      current.responses.push(msg);
    }
  }
  return pages;
}

export function ChatPanel({ engine, agentId = "main", agentName, onBack }: ChatPanelProps) {
  const sessionKey = agentId === "main" ? "main" : `agent:${agentId}:main`;
  const { messages, tools, isStreaming, send } = useChat({ engine, sessionKey });

  const pages = useMemo(() => paginate(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastPageRef = useRef<HTMLDivElement>(null);
  const prevPageCount = useRef(0);
  const [spacerHeight, setSpacerHeight] = useState(0);

  // Scroll to latest user message when a new one is sent
  useEffect(() => {
    if (pages.length > prevPageCount.current) {
      requestAnimationFrame(() => {
        lastPageRef.current?.scrollIntoView({ block: "start" });
      });
    }
    prevPageCount.current = pages.length;
  }, [pages.length]);

  // Calculate spacer: just enough so the last user msg can reach the top
  useEffect(() => {
    if (!scrollRef.current || !lastPageRef.current) { setSpacerHeight(0); return; }
    const containerH = scrollRef.current.clientHeight;
    const lastPageH = lastPageRef.current.scrollHeight;
    const needed = Math.max(0, containerH - lastPageH);
    setSpacerHeight(needed);
  }, [messages]);

  const displayName = agentName ?? agentId;
  const lastPageIndex = pages.length - 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
        {onBack && (
          <button onClick={onBack} className="text-text-muted transition-colors hover:text-text">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="text-[12px] font-medium">{displayName}</span>
        {isStreaming && <span className="text-[10px] text-text-muted">typing...</span>}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {pages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
            <div className="text-3xl opacity-30">&gt;_</div>
            <p className="text-sm">Start chatting with {displayName}</p>
          </div>
        )}

        {pages.map((page, pi) => {
          const isLast = pi === lastPageIndex;
          return (
            <div key={page.userMessage.id} ref={isLast ? lastPageRef : undefined}>
              {/* User message — sticky header */}
              <div className="sticky top-0 z-10 bg-bg">
                <MessageBubble message={page.userMessage} />
              </div>

              {/* Tools */}
              {isLast && tools.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-1.5">
                  {tools.map((tool) => (
                    <ToolCallBadge key={tool.id} tool={tool} />
                  ))}
                </div>
              )}

              {/* Thinking */}
              {isLast && isStreaming && page.responses.length > 0 &&
                page.responses[page.responses.length - 1]?.content === "" && (
                <div className="flex items-center gap-2 px-4 py-1.5 text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Thinking...</span>
                </div>
              )}

              {/* Responses */}
              {page.responses.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </div>
          );
        })}

        {/* Spacer — exactly enough so last msg reaches top, no more */}
        {spacerHeight > 0 && <div style={{ height: spacerHeight }} />}
      </div>

      <ChatInput onSend={send} disabled={!engine.connected} engine={engine} />
    </div>
  );
}
