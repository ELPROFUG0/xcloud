import { useState } from "react";
import type { AgentInfo } from "@/hooks/use-agents";
import { Bot, Search, Plus, Pin, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

interface HomeScreenProps {
  agents: AgentInfo[];
  onSelectAgent: (id: string) => void;
}

export function HomeScreen({ agents, onSelectAgent }: HomeScreenProps) {
  const [search, setSearch] = useState("");
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const otherAgents = agents.filter((a) => a.id !== mainAgent?.id);

  const filteredOthers = otherAgents.filter((a) => {
    if (!search) return true;
    const name = (a.name ?? a.id).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const showMain = !search || (mainAgent && (mainAgent.name ?? mainAgent.id).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      {/* Header — padded for macOS traffic lights */}
      <div className="flex items-center justify-between px-4 pb-2 pt-10">
        <h1 className="text-[13px] font-semibold text-text">Agents</h1>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
          title="Create agent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full bg-transparent text-xs text-text outline-none placeholder:text-text-muted/60"
          />
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {/* Pinned section — main agent */}
        {mainAgent && showMain && (
          <>
            <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-3">
              <Pin className="h-3 w-3 text-text-muted/60" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted/60">
                Main
              </span>
            </div>
            <button
              onClick={() => onSelectAgent(mainAgent.id)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/6 active:bg-white/8"
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
        {filteredOthers.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-4">
              <Bot className="h-3 w-3 text-text-muted/60" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted/60">
                Agents
              </span>
            </div>
            {filteredOthers.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/6 active:bg-white/8"
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
        {agents.length <= 1 && !search && (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-text-muted/60">
              Ask the main agent to create new agents.
            </p>
          </div>
        )}

        {/* No results */}
        {search && !showMain && filteredOthers.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-text-muted/60">
              No agents match "{search}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
