import type { AgentInfo } from "@/hooks/use-agents";
import { Bot, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";

interface HomeScreenProps {
  agents: AgentInfo[];
  onSelectAgent: (id: string) => void;
}

export function HomeScreen({ agents, onSelectAgent }: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const otherAgents = agents.filter((a) => a.id !== mainAgent?.id);

  return (
    <div className="flex h-full flex-col">
      {/* Agent rows */}
      <div className="flex-1 overflow-y-auto">
        {/* Main agent */}
        {mainAgent && (
          <button
            onClick={() => onSelectAgent(mainAgent.id)}
            className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-surface-hover active:bg-surface-hover/70"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{mainAgent.name ?? mainAgent.id}</span>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-medium text-accent">
                  main
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {mainAgent.model?.primary?.split("/").pop() ?? "no model"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <MessageSquare className="h-4 w-4 text-text-muted" />
            </div>
          </button>
        )}

        {/* Separator */}
        {otherAgents.length > 0 && (
          <div className="px-4 py-2 bg-bg">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Agents
            </span>
          </div>
        )}

        {/* Other agents */}
        {otherAgents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-hover active:bg-surface-hover/70"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-hover">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">{agent.name ?? agent.id}</span>
              <p className="text-[11px] text-text-muted">
                {agent.model?.primary?.split("/").pop() ?? "no model"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn(
                "h-2 w-2 rounded-full",
                agent.status === "active" ? "bg-emerald-400" : "bg-text-muted",
              )} />
              <MessageSquare className="h-4 w-4 text-text-muted" />
            </div>
          </button>
        ))}

        {/* Empty state */}
        {agents.length <= 1 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-text-muted">
              Ask the main agent to create new agents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
