import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBadge } from "./ToolCallBadge";
import { ChatInput } from "./ChatInput";
import { ArrowLeft, Clock, Plus, ChevronDown, Bot } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/types/chat";
import type { AgentInfo } from "@/hooks/use-agents";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  agentName?: string;
  agents?: AgentInfo[];
  onSwitchAgent?: (id: string) => void;
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

export function ChatPanel({ engine, agentId = "main", agentName, agents = [], onSwitchAgent, onBack }: ChatPanelProps) {
  const defaultSessionKey = agentId === "main" ? "main" : `agent:${agentId}:main`;
  const [activeSession, setActiveSession] = useState(defaultSessionKey);

  // Reset session when agent changes
  useEffect(() => {
    setActiveSession(defaultSessionKey);
  }, [defaultSessionKey]);

  const { messages, isStreaming, send } = useChat({ engine, sessionKey: activeSession });
  const [showHistory, setShowHistory] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);

  // Load sessions list
  const loadSessions = useCallback(async () => {
    try {
      const result = await engine.rpc("sessions.list", {});
      const raw = result as Record<string, unknown>;
      // sessions.list may return sessions in different formats
      const all: SessionEntry[] = [];
      const sessions = raw.sessions as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined;

      if (Array.isArray(sessions)) {
        for (const s of sessions) {
          all.push({ key: s.key as string, updatedAt: s.updatedAt as number, kind: (s.kind as string) ?? "" });
        }
      } else if (sessions && typeof sessions === "object") {
        // Could be a map of key → session
        for (const [key, s] of Object.entries(sessions)) {
          all.push({ key, updatedAt: (s as Record<string, unknown>).updatedAt as number, kind: "" });
        }
      }

      const list = all
        .filter(s => {
          if (!s.key) return false;
          // Only show sessions for this agent
          const prefix = agentId === "main" ? "agent:main:" : `agent:${agentId}:`;
          return s.key === "main" || s.key.startsWith(prefix);
        })
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

  // Close agent picker on click outside
  useEffect(() => {
    if (!showAgentPicker) return;
    function handleClick(e: MouseEvent) {
      if (agentBtnRef.current?.contains(e.target as Node)) return;
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAgentPicker]);

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

  const currentAgent = agents.find(a => a.id === agentId);
  const displayName = currentAgent?.name ?? agentName ?? agentId;
  const lastPageIndex = pages.length - 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative flex h-9 shrink-0 items-center justify-between border-b border-white/5 px-3">
        <div className="flex items-center gap-1.5">
          {onBack && (
            <button onClick={onBack} className="text-text-muted transition-colors hover:text-text mr-1">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Agent avatar + name (clickable to switch) */}
          <button
            ref={agentBtnRef}
            onClick={() => { setShowAgentPicker(!showAgentPicker); setShowHistory(false); }}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-hover"
          >
            <div className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px]",
              currentAgent?.isDefault ? "bg-accent" : "bg-surface-hover",
            )}>
              {currentAgent?.emoji ? (
                <span className="text-[11px] leading-none">{currentAgent.emoji}</span>
              ) : (
                <Bot className="h-3 w-3" />
              )}
            </div>
            <span className="text-[12px] font-medium">{displayName}</span>
            {agents.length > 1 && <ChevronDown className={cn("h-2.5 w-2.5 text-text-muted transition-transform", showAgentPicker && "rotate-180")} />}
          </button>

          {isStreaming && <span className="text-[10px] text-text-muted ml-1">typing...</span>}
        </div>

        <button
          onClick={() => { setShowHistory(!showHistory); setShowAgentPicker(false); if (!showHistory) loadSessions(); }}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
            showHistory ? "bg-container text-text" : "text-text-muted hover:text-text",
          )}
          title="Chat history"
        >
          <Clock className="h-3.5 w-3.5" />
        </button>

        {/* Agent picker dropdown */}
        {showAgentPicker && agents.length > 1 && (
          <div
            ref={agentPickerRef}
            className="absolute left-2 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
          >
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[11px] font-medium text-text-muted">Switch Agent</span>
            </div>
            <div className="max-h-[40vh] overflow-y-auto overflow-x-hidden p-1">
              {agents.map((agent) => {
                const isActive = agent.id === agentId;
                return (
                  <button
                    key={agent.id}
                    onClick={() => {
                      if (!isActive && onSwitchAgent) {
                        onSwitchAgent(agent.id);
                      }
                      setShowAgentPicker(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                      isActive ? "bg-surface-hover text-text" : "hover:bg-surface-hover/50 text-text-muted",
                    )}
                  >
                    <div className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px]",
                      agent.isDefault ? "bg-accent" : "bg-surface-hover",
                    )}>
                      {agent.emoji ? (
                        <span className="text-[12px] leading-none">{agent.emoji}</span>
                      ) : (
                        <Bot className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[11px] truncate", isActive && "font-medium")}>
                        {agent.name ?? agent.id}
                      </div>
                      <div className="text-[9px] text-text-muted">
                        {agent.model?.primary?.split("/").pop() ?? "no model"}
                      </div>
                    </div>
                    {agent.isDefault && (
                      <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[8px] font-medium text-accent">main</span>
                    )}
                    <div className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      agent.status === "active" ? "bg-emerald-400" : "bg-text-muted",
                    )} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

              {/* Responses — tools as inline badges, text as normal messages */}
              {page.responses.map((msg) =>
                msg.role === "tool" && msg.tool ? (
                  <div key={msg.id} className="px-4 py-1 pl-[52px]">
                    <ToolCallBadge tool={msg.tool} />
                  </div>
                ) : (
                  <MessageBubble key={msg.id} message={msg} />
                ),
              )}
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
