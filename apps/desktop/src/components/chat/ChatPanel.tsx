import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { AgentAvatar } from "../ui/AgentAvatar";
import type { ChatMessage } from "@/types/chat";
import type { AgentInfo } from "@/hooks/use-agents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmojiPicker } from "../ui/EmojiPicker";
import { updateAgentEmoji } from "@/lib/update-identity";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  sessionKey?: string;
  agentName?: string;
  agents?: AgentInfo[];
  onSwitchAgent?: (id: string) => void;
  sidebarCollapsed?: boolean;
  isFullscreen?: boolean;
  onRefresh?: () => Promise<void>;
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

export function ChatPanel({ engine, agentId = "main", sessionKey: externalSessionKey, agentName, agents = [], sidebarCollapsed, isFullscreen, onRefresh }: ChatPanelProps) {
  const defaultSessionKey = externalSessionKey ?? (agentId === "main" ? "main" : `agent:${agentId}:main`);
  const [activeSession, setActiveSession] = useState(defaultSessionKey);

  useEffect(() => {
    setActiveSession(defaultSessionKey);
  }, [defaultSessionKey]);

  const { messages, isStreaming, loading, send } = useChat({ engine, sessionKey: activeSession });

  const pages = useMemo(() => paginate(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);

  // Scroll to bottom instantly on mount, smoothly on new messages
  useLayoutEffect(() => {
    if (messages.length > 0) {
      const isFirstLoad = prevMsgCount.current === 0;
      if (isFirstLoad) {
        // Instant scroll before paint — no visible jump
        bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      } else {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        });
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const currentAgent = agents.find(a => a.id === agentId);
  const displayName = currentAgent?.name ?? agentName ?? agentId;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleEmojiSelect = useCallback(async (emoji: string) => {
    setShowEmojiPicker(false);
    await updateAgentEmoji(agentId, emoji);
    onRefresh?.();
  }, [agentId, onRefresh]);

  if (loading) {
    return <div className="flex h-full flex-col bg-bg" />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-9 shrink-0 items-center px-4 border-b border-border" style={{ paddingLeft: sidebarCollapsed ? (isFullscreen ? 50 : 110) : undefined, transition: "padding-left 150ms ease" }}>
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="shrink-0 rounded-lg transition-opacity hover:opacity-80"
            title="Change avatar"
          >
            <AgentAvatar emoji={currentAgent?.emoji} avatar={currentAgent?.avatar} isMain={currentAgent?.isDefault} />
          </button>
          <span className="text-[13px] font-medium text-text">{displayName}</span>
          {isStreaming && <span className="text-[10px] text-text-muted ml-1">typing...</span>}

          {showEmojiPicker && (
            <div className="absolute left-0 top-full mt-2 z-30">
              <EmojiPicker
                agentId={agentId}
                onSelect={handleEmojiSelect}
                onSelectImage={() => { setShowEmojiPicker(false); onRefresh?.(); }}
                onClose={() => setShowEmojiPicker(false)}
              />
            </div>
          )}
        </div>
      </header>

      {/* Messages — centered like ChatGPT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {pages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-text-muted">
            <AgentAvatar emoji={currentAgent?.emoji} avatar={currentAgent?.avatar} isMain={currentAgent?.isDefault} size="lg" />
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
                      <div className="mt-1">
                        <AgentAvatar emoji={currentAgent?.emoji} avatar={currentAgent?.avatar} isMain={currentAgent?.isDefault} />
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
