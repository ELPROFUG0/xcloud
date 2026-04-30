import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ArrowLeft, Loader2, Clock, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
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

interface SessionEntry {
  key: string;
  updatedAt: number;
  kind: string;
}

export function ChatPanel({ engine, agentId = "main", agentName, onBack }: ChatPanelProps) {
  const [activeSession, setActiveSession] = useState(agentId === "main" ? "main" : `agent:${agentId}:main`);
  const { messages, tools, isStreaming, send } = useChat({ engine, sessionKey: activeSession });
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

  // Load sessions list
  const loadSessions = useCallback(async () => {
    try {
      const result = await engine.rpc("sessions.list", {});
      const list = ((result as { sessions?: SessionEntry[] }).sessions ?? [])
        .filter(s => s.key.includes(agentId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(list);
    } catch { /* ignore */ }
  }, [engine, agentId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Close history on click outside
  useEffect(() => {
    if (!showHistory) return;
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showHistory]);

  // New session
  const newSession = useCallback(async () => {
    try {
      // Create a unique new session key
      const newKey = `agent:${agentId}:chat-${Date.now()}`;
      setActiveSession(newKey);
      setShowHistory(false);
      // Refresh sessions list after a moment
      setTimeout(loadSessions, 1000);
    } catch { /* ignore */ }
  }, [agentId, loadSessions]);

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

  // Calculate spacer: enough so last user msg reaches top,
  // but subtract its own height so responses don't hide behind it
  const userMsgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current || !lastPageRef.current) { setSpacerHeight(0); return; }
    const containerH = scrollRef.current.clientHeight;
    const lastPageH = lastPageRef.current.scrollHeight;
    const userMsgH = userMsgRef.current?.offsetHeight ?? 0;
    // Spacer = container - page content, but clamp so content stays below the sticky header
    const needed = Math.max(0, containerH - lastPageH + userMsgH);
    setSpacerHeight(needed);
  }, [messages]);

  const displayName = agentName ?? agentId;
  const lastPageIndex = pages.length - 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg px-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="text-text-muted transition-colors hover:text-text">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-[12px] font-medium">{displayName}</span>
          {isStreaming && <span className="text-[10px] text-text-muted">typing...</span>}
        </div>
        <button
          onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadSessions(); }}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
            showHistory ? "bg-container text-text" : "text-text-muted hover:text-text",
          )}
          title="Chat history"
        >
          <Clock className="h-3.5 w-3.5" />
        </button>

        {/* History dropdown */}
        {showHistory && (
          <div
            ref={historyRef}
            className="absolute right-2 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-[11px] font-medium text-text-muted">Sessions</span>
              <button
                onClick={newSession}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text"
              >
                <Plus className="h-3 w-3" /> New
              </button>
            </div>
            <div className="max-h-[40vh] overflow-y-auto overflow-x-hidden p-1">
              {sessions.length === 0 && (
                <div className="px-3 py-4 text-center text-[10px] text-text-muted">No sessions</div>
              )}
              {sessions.map((s) => {
                const isActive = s.key === activeSession;
                const date = new Date(s.updatedAt);
                const timeStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                const label = s.key.split(":").pop() ?? s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => { setActiveSession(s.key); setShowHistory(false); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      isActive ? "bg-surface-hover text-text" : "hover:bg-surface-hover/50 text-text-muted",
                    )}
                  >
                    <Clock className="h-3 w-3 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[11px] truncate", isActive && "font-medium")}>{label}</div>
                      <div className="text-[9px] text-text-muted">{timeStr}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
              <div className="sticky top-0 z-10 bg-bg" ref={isLast ? userMsgRef : undefined}>
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
