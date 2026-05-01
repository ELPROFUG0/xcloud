import type { AgentInfo } from "@/hooks/use-agents";
import { Bot, Search, MessageSquarePlus, Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

interface HomeScreenProps {
  agents: AgentInfo[];
  activeAgentId?: string | null;
  onSelectAgent: (id: string) => void;
}

export function HomeScreen({ agents, activeAgentId, onSelectAgent }: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const otherAgents = agents.filter((a) => a.id !== mainAgent?.id);

  return (
    <div className="flex h-full flex-col">
      {/* Top actions — padded for macOS traffic lights */}
      <div className="flex flex-col gap-1 px-3 pb-2 pt-14">
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
              <span className="text-[12px] font-medium text-text/90">
                Main
              </span>
            </div>
            <button
              onClick={() => onSelectAgent(mainAgent.id)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                activeAgentId === mainAgent.id ? "bg-white/8" : "hover:bg-white/6 active:bg-white/8",
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                {mainAgent.emoji ? (
                  <span className="text-sm">{mainAgent.emoji}</span>
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-text">
                  {mainAgent.name ?? mainAgent.id}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  mainAgent.status === "active" ? "bg-emerald-400" : "bg-text-muted/40",
                )} />
              </div>
            </button>
          </>
        )}

        {/* Other agents */}
        {otherAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">
                Agents
              </span>
            </div>
            {otherAgents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  activeAgentId === agent.id ? "bg-white/8" : "hover:bg-white/6 active:bg-white/8",
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-text-muted group-hover:text-text">
                  {agent.emoji ? (
                    <span className="text-sm">{agent.emoji}</span>
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-text/90 group-hover:text-text">
                    {agent.name ?? agent.id}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    agent.status === "active" ? "bg-emerald-400" : "bg-text-muted/40",
                  )} />
                </div>
              </button>
            ))}
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
