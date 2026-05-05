import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentInfo } from "@/hooks/use-agents";
import type { SessionInfo } from "@/hooks/use-sessions";
import { formatRelativeTime } from "@/hooks/use-sessions";
import { Search, MessageSquarePlus, Download, MoreHorizontal, Pin } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmojiPicker } from "../ui/EmojiPicker";
import { AgentAvatar } from "../ui/AgentAvatar";
import { updateAgentEmoji } from "@/lib/update-identity";

interface HomeScreenProps {
  agents: AgentInfo[];
  activeAgentId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectSession?: (agentId: string, sessionKey: string) => void;
  getAgentSessions?: (agentId: string) => SessionInfo[];
  isFullscreen?: boolean;
  onRefresh?: () => Promise<void>;
  onOpenSettings?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  working: "bg-blue-400",
  completed: "bg-emerald-400",
  idle: "bg-text-muted/40",
};

function SetupGuide({ mainAgent, agents, onSelectAgent, onOpenSettings }: { mainAgent: AgentInfo; agents: AgentInfo[]; onSelectAgent: (id: string) => void; onOpenSettings?: () => void }) {
  const [viewIdx, setViewIdx] = useState(0);

  const hasName = !!(mainAgent.name && mainAgent.name !== mainAgent.id);
  const hasIntegrations = (() => { try { return JSON.parse(localStorage.getItem("composioConnected") ?? "[]").length > 0; } catch { return false; } })();
  const hasSubAgents = agents.length > 1;

  const completed = (hasName ? 1 : 0) + (hasIntegrations ? 1 : 0) + (hasSubAgents ? 1 : 0);
  if (completed >= 3) return null;

  const steps = [
    { done: hasName, emoji: "✨", title: "Name your agent", description: "Ask it to pick a name and personality", action: () => onSelectAgent(mainAgent.id) },
    { done: hasIntegrations, emoji: "🔌", title: "Connect your apps", description: "Link Gmail, Notion, Slack and more", action: () => onOpenSettings?.() },
    { done: hasSubAgents, emoji: "🤖", title: "Create a sub-agent", description: "Ask your agent to create a specialist", action: () => onSelectAgent(mainAgent.id) },
  ];

  const step = steps[viewIdx] ?? steps[0]!;

  return (
    <div className="shrink-0 px-3 pb-2">
      <button
        onClick={() => setViewIdx((viewIdx + 1) % 3)}
        className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.06] p-4 text-left transition-all hover:from-white/[0.08] hover:to-white/[0.04] hover:border-white/[0.1]"
        style={{ transform: "rotate(-1deg)" }}
      >
        {/* Decorative dots */}
        <div className="absolute top-2.5 right-3 flex gap-1">
          <div className={cn("h-1 w-1 rounded-full", hasName ? "bg-accent" : "bg-accent/30")} />
          <div className={cn("h-1 w-1 rounded-full", hasIntegrations ? "bg-emerald-400" : "bg-emerald-400/30")} />
          <div className={cn("h-1 w-1 rounded-full", hasSubAgents ? "bg-amber-400" : "bg-amber-400/30")} />
        </div>

        {/* Circle progress + content */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 relative h-10 w-10 mt-0.5">
            <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15" fill="none" stroke="white" strokeWidth="2.5"
                strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 - (completed / 3) * 2 * Math.PI * 15}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px]">{step.emoji}</span>
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <p className={cn("text-[12px] font-semibold leading-tight", step.done ? "text-text-muted line-through" : "text-text")}>
              {step.title}
            </p>
            <p className="text-[10px] text-text-muted mt-1 leading-snug">
              {step.description}
            </p>
          </div>
        </div>

        {/* Bottom: progress bars + counter */}
        <div className="flex items-center gap-3 mt-3">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 w-6 rounded-full transition-all duration-300",
                  steps[i]!.done ? "bg-white/40" : i === viewIdx ? "bg-white/25" : "bg-white/[0.07]"
                )}
              />
            ))}
          </div>
          <span className="text-[9px] text-text-muted/50">{completed}/3</span>
        </div>
      </button>

      {/* Action button */}
      {!step.done && (
        <button
          onClick={step.action}
          className="w-full mt-1.5 rounded-xl bg-white/[0.05] py-1.5 text-[10px] text-text-muted hover:bg-white/[0.08] hover:text-text transition-colors"
        >
          {viewIdx === 0 ? "Open chat" : viewIdx === 1 ? "Open integrations" : "Open chat"}
        </button>
      )}
    </div>
  );
}

export function HomeScreen({ agents, activeAgentId, onSelectAgent, onSelectSession, getAgentSessions, isFullscreen, onRefresh, onOpenSettings }: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinnedAgents") ?? "[]"); } catch { return []; }
  });
  const togglePin = (id: string) => {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      localStorage.setItem("pinnedAgents", JSON.stringify(next));
      return next;
    });
  };
  const pinnedAgents = agents.filter(a => a.id !== mainAgent?.id && pinnedIds.includes(a.id));
  const otherAgents = agents.filter(a => a.id !== mainAgent?.id && !pinnedIds.includes(a.id));
  const [menuAgentId, setMenuAgentId] = useState<string | null>(null);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleExpand = (agentId: string) => {
    setExpanded(prev => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  // Close menu on click outside
  useEffect(() => {
    if (!menuAgentId) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuAgentId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuAgentId]);

  const handleEmojiSelect = useCallback(async (agentId: string, emoji: string) => {
    setShowEmojiFor(null);
    setMenuAgentId(null);
    await updateAgentEmoji(agentId, emoji);
    onRefresh?.();
  }, [onRefresh]);

  const renderAgent = (agent: AgentInfo, isMain: boolean) => {
    return (
      <div key={agent.id}>
        <div className="flex items-center">
          {/* Agent row */}
          <button
            onClick={() => onSelectAgent(agent.id)}
            className={cn(
              "group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 ml-1 text-left transition-colors",
              activeAgentId === agent.id ? "bg-white/8" : "hover:bg-white/6 active:bg-white/8",
            )}
          >
            <AgentAvatar emoji={agent.emoji} avatar={agent.avatar} isMain={isMain} />
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-text">
                {agent.name ?? agent.id}
              </span>
            </div>
            {/* Status dot — hidden on hover, replaced by 3 dots */}
            <div className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full group-hover:hidden",
              agent.status === "active" ? "bg-emerald-400" : "bg-text-muted/40",
            )} />
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuAgentId(menuAgentId === agent.id ? null : agent.id); }}
                className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              {/* Agent menu */}
              {menuAgentId === agent.id && (
                <div ref={menuRef} className="absolute right-0 top-full mt-1 z-30 w-40 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out] p-1">
                  {!isMain && (
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(agent.id); setMenuAgentId(null); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-hover"
                    >
                      <Pin className="h-3.5 w-3.5" />
                      {pinnedIds.includes(agent.id) ? "Unpin" : "Pin"}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowEmojiFor(agent.id); setMenuAgentId(null); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-hover"
                  >
                    Change emoji
                  </button>
                </div>
              )}

              {/* Emoji picker */}
              {showEmojiFor === agent.id && (
                <div className="absolute right-0 top-full mt-1 z-30">
                  <EmojiPicker
                    agentId={agent.id}
                    onSelect={(emoji) => handleEmojiSelect(agent.id, emoji)}
                    onSelectImage={() => { setShowEmojiFor(null); onRefresh?.(); }}
                    onClose={() => setShowEmojiFor(null)}
                  />
                </div>
              )}
            </div>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top actions — padded for macOS traffic lights */}
      <div className={`flex flex-col gap-1 px-3 pb-2 ${isFullscreen ? "pt-12" : "pt-14"}`}>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <MessageSquarePlus className="h-4 w-4" />
          <span className="text-[13px] font-medium">New chat</span>
        </button>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <Search className="h-4 w-4" />
          <span className="text-[13px] font-medium">Search</span>
        </button>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <Download className="h-4 w-4" />
          <span className="text-[13px] font-medium">Import agent</span>
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {/* Main agent */}
        {mainAgent && (
          <>
            <div className="px-2.5 pb-1 pt-3">
              <span className="text-[12px] font-medium text-text/90">Main</span>
            </div>
            <div className="space-y-0.5">
              {renderAgent(mainAgent, true)}
            </div>

          </>
        )}

        {/* Pinned agents */}
        {pinnedAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">Pinned</span>
            </div>
            <div className="space-y-0.5">
              {pinnedAgents.map((agent) => renderAgent(agent, false))}
            </div>
          </>
        )}

        {/* Other agents */}
        {otherAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">Agents</span>
            </div>
            <div className="space-y-0.5">
              {otherAgents.map((agent) => renderAgent(agent, false))}
            </div>
          </>
        )}

      </div>

      {/* Setup guide — bottom */}
      {mainAgent && (
        <SetupGuide mainAgent={mainAgent} agents={agents} onSelectAgent={onSelectAgent} onOpenSettings={onOpenSettings} />
      )}
    </div>
  );
}
