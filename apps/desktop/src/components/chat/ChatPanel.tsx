import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useChat } from "@/hooks/use-chat";
import type { AppToolHandler } from "@/hooks/use-chat";
import { Blocks, Clock, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { ChatInput } from "./ChatInput";
import { AgentAvatar } from "../ui/AgentAvatar";
import type { AgentInfo } from "@/hooks/use-agents";
import { EmojiPicker } from "../ui/EmojiPicker";
import { updateAgentEmoji } from "@/lib/update-identity";
import { setAgentVisualOverride } from "@/lib/agent-visuals";
import { ChatMessages } from "./ChatMessages";
import { paginate } from "./chat-message-utils";
import type { ImagePreviewState } from "./MessageAttachments";

interface ChatPanelProps {
  engine: BrowserEngine;
  agentId?: string;
  sessionKey?: string;
  agentName?: string;
  titleName?: string;
  workspaceName?: string;
  agents?: AgentInfo[];
  onSwitchAgent?: (id: string) => void;
  onSessionChange?: (sessionKey: string) => void;
  sidebarCollapsed?: boolean;
  isFullscreen?: boolean;
  onRefresh?: () => Promise<void>;
  initialPrompt?: string;
  initialPromptHidden?: boolean;
  terminalLift?: number;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
  reserveCanvasControlsSpace?: boolean;
  appTools?: AppToolHandler;
}

export function ChatPanel({ engine, agentId = "main", sessionKey: externalSessionKey, agentName, titleName, workspaceName, agents = [], onSessionChange, sidebarCollapsed, isFullscreen, onRefresh, initialPrompt, initialPromptHidden = false, terminalLift = 0, onToggleTerminal, terminalOpen = false, reserveCanvasControlsSpace = false, appTools }: ChatPanelProps) {
  const defaultSessionKey = externalSessionKey ?? (agentId === "main" ? "main" : `agent:${agentId}:main`);
  const [activeSession, setActiveSession] = useState(defaultSessionKey);

  useEffect(() => {
    setActiveSession(defaultSessionKey);
  }, [defaultSessionKey]);

  const { messages, isStreaming, loading, send, stop } = useChat({ engine, sessionKey: activeSession, appTools });
  const sentInitialPromptRef = useRef<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [imagePreviewClosing, setImagePreviewClosing] = useState(false);

  const pages = useMemo(() => paginate(messages), [messages]);
  const latestMessageScrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    return [
      messages.length,
      last?.id ?? "",
      last?.content.length ?? 0,
      last?.attachments?.map((attachment) => attachment.url).join("|") ?? "",
      last?.isStreaming ? "streaming" : "idle",
      last?.tool?.status ?? "",
      last?.tool?.output?.length ?? 0,
    ].join(":");
  }, [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const prevTerminalLiftRef = useRef(0);
  const prevMsgCount = useRef(0);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionList, setSessionList] = useState<Array<{ key: string; preview: string; updatedAt: number }>>([]);
  const sessionsRef = useRef<HTMLDivElement>(null);

  const openImagePreview = useCallback((preview: ImagePreviewState) => {
    setImagePreviewClosing(false);
    setImagePreview(preview);
  }, []);

  const closeImagePreview = useCallback(() => {
    if (!imagePreview || imagePreviewClosing) return;
    setImagePreviewClosing(true);
    window.setTimeout(() => {
      setImagePreview(null);
      setImagePreviewClosing(false);
    }, 160);
  }, [imagePreview, imagePreviewClosing]);

  useEffect(() => {
    if (!imagePreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeImagePreview();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imagePreview, closeImagePreview]);

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

  // Keep the newest message visible as assistant text streams in.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || messages.length === 0) {
      prevMsgCount.current = messages.length;
      return;
    }

    const isFirstLoad = prevMsgCount.current === 0;
    const messageCountChanged = prevMsgCount.current !== messages.length;
    const shouldFollow = isFirstLoad || isStreaming || messageCountChanged || pinnedToBottomRef.current;

    if (shouldFollow) {
      requestAnimationFrame(() => {
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior: isFirstLoad ? "instant" as ScrollBehavior : isStreaming ? "auto" : "smooth",
        });
      });
    }

    prevMsgCount.current = messages.length;
  }, [latestMessageScrollKey, isStreaming, messages.length]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const updatePinnedState = () => {
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 96;
    };

    const keepBottomPinned = () => {
      if (!pinnedToBottomRef.current) return;
      scrollEl.scrollTop = scrollEl.scrollHeight;
    };

    updatePinnedState();
    scrollEl.addEventListener("scroll", updatePinnedState, { passive: true });

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(keepBottomPinned);
    });
    observer.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener("scroll", updatePinnedState);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const isOpening = terminalLift > prevTerminalLiftRef.current;
    prevTerminalLiftRef.current = terminalLift;
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    const shouldPin = pinnedToBottomRef.current || (isOpening && distanceFromBottom < Math.max(160, terminalLift + 80));
    if (!shouldPin) return;

    pinnedToBottomRef.current = true;
    let frameId = 0;
    const startedAt = performance.now();

    const keepPinnedThroughTerminalAnimation = (now: number) => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
      if (now - startedAt < 420) {
        frameId = requestAnimationFrame(keepPinnedThroughTerminalAnimation);
      }
    };

    frameId = requestAnimationFrame(keepPinnedThroughTerminalAnimation);
    return () => cancelAnimationFrame(frameId);
  }, [terminalLift]);

  const currentAgent = agents.find(a => a.id === agentId);
  const displayName = titleName ?? currentAgent?.name ?? agentName ?? agentId;
  const isEmptyChat = pages.length === 0 && !isStreaming;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
    if (engine.isRemote) setAgentVisualOverride(engine, agentId, { emoji });
    else await updateAgentEmoji(agentId, emoji);
    onRefresh?.();
  }, [agentId, engine, onRefresh]);

  useEffect(() => {
    if (loading || !initialPrompt || sentInitialPromptRef.current === initialPrompt) return;
    sentInitialPromptRef.current = initialPrompt;
    void send(initialPrompt, { hidden: initialPromptHidden });
  }, [initialPrompt, initialPromptHidden, loading, send]);

  if (loading) {
    return <div className="flex h-full flex-col" aria-busy="true" />;
  }

  return (
    <div className="flex h-full flex-col animate-[fadeBlurInStable_220ms_ease-out]">
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
          <span className="text-[13px] font-medium text-text">{isEmptyChat ? "New conversation" : displayName}</span>
          {!isEmptyChat && (
            <span className="text-[13px] font-semibold" style={{ color: "#ffffff" }}>/ {activeSession === "main" ? "Main" : activeSession.split(":").pop() ?? activeSession}</span>
          )}
          {isStreaming && <span className="text-[10px] text-text-muted ml-1">typing...</span>}

          {showEmojiPicker && (
            <div className="absolute left-0 top-full mt-2 z-30">
              <EmojiPicker
                agentId={agentId}
                engine={engine}
                onSelect={handleEmojiSelect}
                onSelectImage={() => { setShowEmojiPicker(false); onRefresh?.(); }}
                onClose={() => setShowEmojiPicker(false)}
              />
            </div>
          )}
        </div>

        <div className={`ml-auto flex items-center gap-1 transition-[margin] duration-150 ease-out ${reserveCanvasControlsSpace ? "mr-6" : ""}`}>
          <button
            onClick={onToggleTerminal}
            disabled={!onToggleTerminal}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 ${
              terminalOpen ? "bg-white/10 text-text" : "text-text-muted hover:bg-white/8 hover:text-text"
            }`}
            title="Terminal"
            aria-label="Terminal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7.5 7.5L8.72654 8.55719C9.24218 9.00163 9.5 9.22386 9.5 9.5C9.5 9.77614 9.24218 9.99836 8.72654 10.4428L7.5 11.5" />
              <path d="M11.5 12.5H15.5" />
              <path d="M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95491C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95491 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.7367 5.06107 20.0451C6.3754 21 8.25027 21 12 21Z" />
            </svg>
          </button>

          {/* Sessions button */}
          <div className="relative" ref={sessionsRef}>
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
                      onSessionChange?.(newKey);
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
                          onClick={() => { setActiveSession(s.key); onSessionChange?.(s.key); setShowSessions(false); }}
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
        </div>
      </header>

      {/* Messages — centered like ChatGPT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto animate-[fadeBlurInStable_180ms_ease-out]">
        {isEmptyChat && (
          <div className="flex min-h-full items-center justify-center px-8 pb-[10vh] pt-8">
            <div className="w-full max-w-[760px] animate-[fadeBlurIn_180ms_ease-out]">
              <h1 className="mb-7 text-center text-[28px] font-semibold leading-tight tracking-normal text-text">
                {workspaceName ? `What should this workspace build next?` : `What should we build in ${displayName}?`}
              </h1>

              <ChatInput
                onSend={send}
                onStop={stop}
                isStreaming={isStreaming}
                disabled={!engine.connected || loading}
                engine={engine}
                variant="hero"
                contextLabel={displayName}
                contextEmoji={currentAgent?.emoji}
                contextAvatar={currentAgent?.avatar}
                contextIsMain={currentAgent?.isDefault}
                agentOptions={agents}
                selectedAgentId={agentId}
                placeholder={workspaceName ? `Give ${workspaceName} a team task` : undefined}
              />

              {visibleHeroSuggestions.length > 0 && (
                <div className="mt-4 divide-y divide-white/[0.06]">
                  {visibleHeroSuggestions.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id} className="group flex items-center gap-2 px-4 py-3 text-text-muted transition-colors hover:text-text">
                        <button
                          onClick={() => send(item.prompt)}
                          disabled={!engine.connected || loading}
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

        <ChatMessages pages={pages} engine={engine} onPreviewImage={openImagePreview} />
        <div ref={bottomRef} />
      </div>

      {/* Input — centered at bottom */}
      {!isEmptyChat && (
        <div className="mx-auto w-full max-w-3xl animate-[fadeBlurInStable_180ms_ease-out]">
          <ChatInput
            onSend={send}
            onStop={stop}
            isStreaming={isStreaming}
            disabled={!engine.connected || loading}
            engine={engine}
            contextLabel={displayName}
            contextEmoji={currentAgent?.emoji}
            contextAvatar={currentAgent?.avatar}
            contextIsMain={currentAgent?.isDefault}
            agentOptions={agents}
            selectedAgentId={agentId}
          />
        </div>
      )}

      {imagePreview && (
        <div
          className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-6 py-8 backdrop-blur-sm ${
            imagePreviewClosing
              ? "animate-[imagePreviewOverlayOut_160ms_ease-in_forwards]"
              : "animate-[imagePreviewOverlayIn_160ms_ease-out]"
          }`}
          onClick={closeImagePreview}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/16 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              closeImagePreview();
            }}
            aria-label="Close image preview"
          >
            <X className="h-4 w-4" />
          </button>
          <img
            src={imagePreview.url}
            alt={imagePreview.alt}
            className={`max-h-full max-w-full rounded-2xl object-contain shadow-2xl ${
              imagePreviewClosing
                ? "animate-[imagePreviewImageOut_160ms_ease-in_forwards]"
                : "animate-[imagePreviewImageIn_180ms_cubic-bezier(0.2,0.8,0.2,1)]"
            }`}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
