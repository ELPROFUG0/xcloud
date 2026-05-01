import { useEffect, useRef, useMemo, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { Bot } from "lucide-react";
import type { ChatMessage } from "@/types/chat";
import type { AgentInfo } from "@/hooks/use-agents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  agentName?: string;
  agents?: AgentInfo[];
  onSwitchAgent?: (id: string) => void;
  sidebarCollapsed?: boolean;
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

export function ChatPanel({ engine, agentId = "main", agentName, agents = [], sidebarCollapsed }: ChatPanelProps) {
  const defaultSessionKey = agentId === "main" ? "main" : `agent:${agentId}:main`;
  const [activeSession, setActiveSession] = useState(defaultSessionKey);

  useEffect(() => {
    setActiveSession(defaultSessionKey);
  }, [defaultSessionKey]);

  const { messages, isStreaming, send } = useChat({ engine, sessionKey: activeSession });

  const pages = useMemo(() => paginate(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const currentAgent = agents.find(a => a.id === agentId);
  const displayName = currentAgent?.name ?? agentName ?? agentId;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-9 shrink-0 items-center px-4 border-b border-border" style={{ paddingLeft: sidebarCollapsed ? 110 : undefined, transition: "padding-left 150ms ease" }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            {currentAgent?.emoji ? (
              <span className="text-xs">{currentAgent.emoji}</span>
            ) : (
              <Bot className="h-3 w-3" />
            )}
          </div>
          <span className="text-[13px] font-medium text-text">{displayName}</span>
          {isStreaming && <span className="text-[10px] text-text-muted ml-1">typing...</span>}
        </div>
      </header>

      {/* Messages — centered like ChatGPT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {pages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-text-muted">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
              {currentAgent?.emoji ? (
                <span className="text-2xl">{currentAgent.emoji}</span>
              ) : (
                <Bot className="h-6 w-6 text-accent" />
              )}
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-text">{displayName}</p>
              <p className="mt-1 text-sm text-text-muted">How can I help you today?</p>
            </div>
          </div>
        )}

        <div className="mx-auto w-full max-w-3xl px-6">
          {pages.map((page) => (
            <div key={page.userMessage.id}>
              {/* User message */}
              <div className="flex justify-end py-4">
                <div className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-3 text-[14px] leading-relaxed text-text">
                  {page.userMessage.content}
                </div>
              </div>

              {/* Agent responses */}
              <div className="py-4">
                {page.responses.map((msg) =>
                  msg.role === "tool" && msg.tool ? (
                    <div key={msg.id} className="py-1 pl-10">
                      <ToolCallBadge tool={msg.tool} />
                    </div>
                  ) : (
                    <div key={msg.id} className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-hover mt-1">
                        {currentAgent?.emoji ? (
                          <span className="text-sm">{currentAgent.emoji}</span>
                        ) : (
                          <Bot className="h-3.5 w-3.5 text-text-muted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-text prose-chat">
                        {msg.content ? (
                          <MessageBubbleContent content={msg.content} />
                        ) : (
                          <span className="text-text-muted italic">Thinking...</span>
                        )}
                        {msg.isStreaming && msg.content && (
                          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent" />
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input — centered at bottom */}
      <div className="mx-auto w-full max-w-3xl">
        <ChatInput onSend={send} disabled={!engine.connected} engine={engine} />
      </div>
    </div>
  );
}

function MessageBubbleContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  );
}
