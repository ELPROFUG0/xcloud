import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback, memo } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { ToolCallBadge } from "./ToolCallBadge";
import { Check } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { AgentAvatar } from "../ui/AgentAvatar";
import type { ChatMessage } from "@/types/chat";
import type { AgentInfo } from "@/hooks/use-agents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
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
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);

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
              <div
                className="flex flex-col items-end py-4"
                onMouseEnter={() => setHoveredMsgId(page.userMessage.id)}
                onMouseLeave={() => setHoveredMsgId(null)}
              >
                <div className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2 text-[13px] leading-relaxed text-text break-words overflow-hidden">
                  {page.userMessage.content}
                </div>
                <div className={`flex items-center gap-1 mt-1 ${hoveredMsgId === page.userMessage.id ? "visible" : "invisible"}`}>
                  <span className="text-[11px] text-text-muted/70">{formatTime(page.userMessage.timestamp)}</span>
                  <CopyButton text={page.userMessage.content} />
                </div>
              </div>

              {/* Agent responses */}
              <div className="py-4">
                {page.responses.map((msg) =>
                  msg.role === "tool" && msg.tool ? (
                    <div key={msg.id} className="py-1">
                      <ToolCallBadge tool={msg.tool} />
                    </div>
                  ) : (
                    <div
                      key={msg.id}
                      onMouseEnter={() => setHoveredMsgId(msg.id)}
                      onMouseLeave={() => setHoveredMsgId(null)}
                    >
                      <div className="text-[13px] leading-relaxed text-text prose-chat">
                        {msg.content ? (
                          <MessageBubbleContent content={msg.content} />
                        ) : (
                          <span className="text-text-muted italic">Thinking...</span>
                        )}
                        {msg.isStreaming && msg.content && (
                          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent" />
                        )}
                      </div>
                      {msg.content && (
                        <div className={`flex items-center gap-1 mt-1 ${hoveredMsgId === msg.id ? "visible" : "invisible"}`}>
                          <CopyButton text={msg.content} />
                          <span className="text-[11px] text-text-muted/70">{formatTime(msg.timestamp)}</span>
                        </div>
                      )}
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

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted/70 transition-colors hover:text-text hover:bg-white/8"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9L16 9C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16L9 15Z" />
          <path d="M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999" />
        </svg>
      )}
    </button>
  );
}

const MessageBubbleContent = memo(function MessageBubbleContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {content}
    </ReactMarkdown>
  );
});
