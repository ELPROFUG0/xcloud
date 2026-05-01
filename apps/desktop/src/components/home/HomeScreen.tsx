import { useState } from "react";
import type { AgentInfo } from "@/hooks/use-agents";
import type { SessionInfo } from "@/hooks/use-sessions";
import { formatRelativeTime } from "@/hooks/use-sessions";
import { Bot, Search, MessageSquarePlus, Download, Sparkles, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface HomeScreenProps {
  agents: AgentInfo[];
  activeAgentId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectSession?: (agentId: string, sessionKey: string) => void;
  getAgentSessions?: (agentId: string) => SessionInfo[];
  isFullscreen?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  working: "bg-blue-400",
  completed: "bg-emerald-400",
  idle: "bg-text-muted/40",
};

export function HomeScreen({ agents, activeAgentId, onSelectAgent, onSelectSession, getAgentSessions, isFullscreen }: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const otherAgents = agents.filter((a) => a.id !== mainAgent?.id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (agentId: string) => {
    setExpanded(prev => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  const renderAgent = (agent: AgentInfo, isMain: boolean) => {
    const sessions = getAgentSessions?.(agent.id) ?? [];
    const hasSessions = sessions.length > 0;
    const isExpanded = expanded[agent.id] ?? true;

    return (
      <div key={agent.id}>
        <div className="flex items-center">
          {/* Chevron toggle */}
          <button
            onClick={() => hasSessions && toggleExpand(agent.id)}
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-transform",
              hasSessions ? "hover:text-text cursor-pointer" : "opacity-0 cursor-default",
            )}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")} strokeWidth={2.5} />
          </button>

          {/* Agent row */}
          <button
            onClick={() => onSelectAgent(agent.id)}
            className={cn(
              "group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
              activeAgentId === agent.id ? "bg-white/8" : "hover:bg-white/6 active:bg-white/8",
            )}
          >
            <div className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
              isMain ? "bg-accent/15 text-accent" : "bg-white/5 text-text-muted group-hover:text-text",
            )}>
              {agent.emoji ? (
                <span className="text-xs">{agent.emoji}</span>
              ) : isMain ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                <Bot className="h-3 w-3" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-text">
                {agent.name ?? agent.id}
              </span>
            </div>
            <div className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              agent.status === "active" ? "bg-emerald-400" : "bg-text-muted/40",
            )} />
          </button>
        </div>

        {/* Sessions */}
        {hasSessions && isExpanded && (
          <div className="ml-[22px] border-l border-white/15 pl-1 mt-0.5 mb-1">
            {sessions.map((session) => (
              <button
                key={session.key}
                onClick={() => onSelectSession?.(agent.id, session.key)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/6"
              >
                <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_COLORS[session.status] ?? STATUS_COLORS.idle)} />
                <span className="flex-1 truncate text-[11px] text-text-muted">{session.preview}</span>
                <span className="shrink-0 text-[10px] text-text-muted/40">{formatRelativeTime(session.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
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
            {renderAgent(mainAgent, true)}
          </>
        )}

        {/* Other agents */}
        {otherAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">Agents</span>
            </div>
            {otherAgents.map((agent) => renderAgent(agent, false))}
          </>
        )}

        {/* Empty state */}
        {agents.length <= 1 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-text-muted/60">
              Ask the main agent to create new agents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
