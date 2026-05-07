import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback, memo } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { ToolCallBadge } from "./ToolCallBadge";
import { Blocks, Check, Clock, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { AgentAvatar } from "../ui/AgentAvatar";
import { Shimmer } from "../ai-elements/shimmer";
import { ThinkingBlock } from "./ThinkingBlock";
import type { ChatMessage } from "@/types/chat";
import type { AgentInfo } from "@/hooks/use-agents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockFilename, CodeBlockActions, CodeBlockCopyButton } from "../ai/code-block";
import type { BundledLanguage } from "shiki";
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
  initialPrompt?: string;
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

export function ChatPanel({ engine, agentId = "main", sessionKey: externalSessionKey, agentName, agents = [], sidebarCollapsed, isFullscreen, onRefresh, initialPrompt }: ChatPanelProps) {
  const defaultSessionKey = externalSessionKey ?? (agentId === "main" ? "main" : `agent:${agentId}:main`);
  const [activeSession, setActiveSession] = useState(defaultSessionKey);

  useEffect(() => {
    setActiveSession(defaultSessionKey);
  }, [defaultSessionKey]);

  const { messages, isStreaming, loading, send } = useChat({ engine, sessionKey: activeSession });
  const sentInitialPromptRef = useRef<string | null>(null);

  const pages = useMemo(() => paginate(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(0);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionList, setSessionList] = useState<Array<{ key: string; preview: string; updatedAt: number }>>([]);
  const sessionsRef = useRef<HTMLDivElement>(null);

  // Load sessions for this agent
  useEffect(() => {
    if (!showSessions) return;
    (async () => {
      try {
        const result = await engine.rpc("sessions.list", {}) as Record<string, unknown>;
        const raw = result.sessions as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined;
        const list: Array<{ key: string; preview: string; updatedAt: number }> = [];
        if (Array.isArray(raw)) {
          for (const s of raw) {
            const key = s.key as string;
            if (!key) continue;
            const sAgentId = key === "main" ? "main" : key.startsWith("agent:") ? key.split(":")[1] : "main";
            if (sAgentId !== agentId) continue;
            list.push({ key, preview: (s.preview as string) ?? (s.title as string) ?? key.split(":").pop() ?? key, updatedAt: (s.updatedAt as number) ?? 0 });
          }
        } else if (raw && typeof raw === "object") {
          for (const [key, s] of Object.entries(raw)) {
            const sAgentId = key === "main" ? "main" : key.startsWith("agent:") ? key.split(":")[1] : "main";
            if (sAgentId !== agentId) continue;
            list.push({ key, preview: (s.preview as string) ?? (s.title as string) ?? key.split(":").pop() ?? key, updatedAt: (s.updatedAt as number) ?? 0 });
          }
        }
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        setSessionList(list);
      } catch { /* */ }
    })();
  }, [showSessions, engine, agentId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showSessions) return;
    const handler = (e: MouseEvent) => {
      if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) setShowSessions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSessions]);

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
  const isEmptyChat = pages.length === 0 && !isStreaming;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dismissedNewChatSuggestions") ?? "[]") as string[];
      return new Set(saved);
    } catch {
      return new Set();
    }
  });

  const heroSuggestions = useMemo(() => [
    {
      id: "specialist-agent",
      icon: MessageCircle,
      text: "Create a specialist agent for a repeated workflow",
      prompt: "Help me create a specialist agent for a workflow I do repeatedly. Ask me the right questions, then configure the agent.",
    },
    {
      id: "first-automation",
      icon: Sparkles,
      text: "Design the first useful automation for this workspace",
      prompt: "Suggest and build a practical first automation for this workspace. Keep it simple and useful.",
    },
    {
      id: "connect-tools",
      icon: Blocks,
      text: "Connect tools and capabilities for this agent",
      prompt: "Review this agent and recommend the tools, skills, and integrations it should have. Then help me add them.",
    },
  ], []);
  const visibleHeroSuggestions = heroSuggestions.filter(item => !dismissedSuggestions.has(item.id));

  const dismissSuggestion = useCallback((id: string) => {
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("dismissedNewChatSuggestions", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleEmojiSelect = useCallback(async (emoji: string) => {
    setShowEmojiPicker(false);
    await updateAgentEmoji(agentId, emoji);
    onRefresh?.();
  }, [agentId, onRefresh]);

  useEffect(() => {
    if (loading || !initialPrompt || sentInitialPromptRef.current === initialPrompt) return;
    sentInitialPromptRef.current = initialPrompt;
    void send(initialPrompt);
  }, [initialPrompt, loading, send]);

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
          <span className="text-[13px] font-medium text-text">{isEmptyChat ? "New chat" : displayName}</span>
          {!isEmptyChat && (
            <span className="text-[13px] font-semibold" style={{ color: "#ffffff" }}>/ {activeSession === "main" ? "Main" : activeSession.split(":").pop() ?? activeSession}</span>
          )}
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

        {/* Sessions button */}
        <div className="relative ml-auto" ref={sessionsRef}>
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
            title="Conversations"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>

          {showSessions && (
            <div className="absolute right-0 top-full mt-2 z-30 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]">
              <div className="max-h-56 overflow-y-auto overscroll-contain p-1.5">
                <button
                  onClick={() => {
                    const id = crypto.randomUUID().slice(0, 8);
                    const newKey = agentId === "main" ? `main:${id}` : `agent:${agentId}:${id}`;
                    setActiveSession(newKey);
                    setShowSessions(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/6 mb-0.5"
                >
                  <Plus className="h-3.5 w-3.5 text-text-muted" />
                  <span className="text-[11px] font-medium text-text">New conversation</span>
                </button>
                {sessionList.length === 0 ? (
                  <div className="px-3 py-2 text-center text-[10px] text-text-muted/40">No previous conversations</div>
                ) : (
                  sessionList.map((s) => {
                    const label = s.key === "main" ? "Main" : s.key.split(":").pop() ?? s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => { setActiveSession(s.key); setShowSessions(false); }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/6 ${activeSession === s.key ? "bg-white/8" : ""}`}
                      >
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${activeSession === s.key ? "bg-emerald-400" : "bg-text-muted/40"}`} />
                        <span className="flex-1 truncate text-[11px] font-medium text-text">{label}</span>
                        {s.updatedAt > 0 && (
                          <span className="shrink-0 text-[9px] text-text-muted/30">
                            {(() => {
                              const diff = Date.now() - s.updatedAt;
                              const mins = Math.floor(diff / 60000);
                              if (mins < 1) return "now";
                              if (mins < 60) return `${mins}m`;
                              const hours = Math.floor(mins / 60);
                              if (hours < 24) return `${hours}h`;
                              return `${Math.floor(hours / 24)}d`;
                            })()}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Messages — centered like ChatGPT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmptyChat && (
          <div className="flex min-h-full items-center justify-center px-8 pb-[10vh] pt-8">
            <div className="w-full max-w-[760px] animate-[fadeBlurIn_180ms_ease-out]">
              <h1 className="mb-7 text-center text-[28px] font-semibold leading-tight tracking-normal text-text">
                What should we build in {displayName}?
              </h1>

              <ChatInput
                onSend={send}
                disabled={!engine.connected}
                engine={engine}
                variant="hero"
                contextLabel={displayName}
                contextEmoji={currentAgent?.emoji}
                contextAvatar={currentAgent?.avatar}
                contextIsMain={currentAgent?.isDefault}
                agentOptions={agents}
                selectedAgentId={agentId}
              />

              {visibleHeroSuggestions.length > 0 && (
                <div className="mt-4 divide-y divide-white/[0.06]">
                  {visibleHeroSuggestions.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id} className="group flex items-center gap-2 px-4 py-3 text-text-muted transition-colors hover:text-text">
                        <button
                          onClick={() => send(item.prompt)}
                          disabled={!engine.connected}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left text-[13px] disabled:opacity-40"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.text}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissSuggestion(item.id)}
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-text-muted/70 opacity-0 transition-all hover:bg-white/[0.14] hover:text-text group-hover:opacity-100"
                          aria-label="Hide suggestion"
                          title="Hide suggestion"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
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
                      {msg.thinking && (
                        <ThinkingBlock thinking={msg.thinking} isStreaming={msg.isStreaming && !msg.content} />
                      )}
                      <div className="text-[13px] leading-relaxed text-text prose-chat">
                        {msg.content ? (
                          <MessageBubbleContent content={msg.content} />
                        ) : msg.isStreaming ? (
                          <Shimmer className="text-[13px]" duration={1.5}>Thinking...</Shimmer>
                        ) : null}
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
      {!isEmptyChat && (
        <div className="mx-auto w-full max-w-3xl">
          <ChatInput onSend={send} disabled={!engine.connected} engine={engine} />
        </div>
      )}
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownComponents: any = {
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href));
          }
        }}
        className="text-accent underline underline-offset-2 hover:text-accent-hover cursor-pointer"
      >
        {children}
      </a>
    );
  },
  pre({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  },
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const codeStr = String(children).replace(/\n$/, "");
    if (match) {
      return (
        <CodeBlock code={codeStr} language={match[1] as BundledLanguage}>
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename>{match[1]}</CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      );
    }
    return <code className={className}>{children}</code>;
  },
};

const MessageBubbleContent = memo(function MessageBubbleContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
});
