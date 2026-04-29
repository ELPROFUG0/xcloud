import type { BrowserEngine } from "@/lib/engine";
import type { AgentInfo } from "@/hooks/use-agents";
import { ModelSelector } from "@/components/ModelSelector";
import { Bot, MessageSquare, Settings, Wifi } from "lucide-react";
import { cn } from "@/lib/cn";

interface HomeScreenProps {
  engine: BrowserEngine;
  agents: AgentInfo[];
  onSelectAgent: (id: string) => void;
  onOpenSettings: () => void;
}

export function HomeScreen({ engine, agents, onSelectAgent, onOpenSettings }: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const otherAgents = agents.filter((a) => a.id !== mainAgent?.id);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold">Agent Studio</h1>
          <div className="flex items-center gap-1.5 text-[10px]">
            <Wifi className="h-3 w-3 text-emerald-400" />
            <span className="text-text-muted">Connected</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector engine={engine} />
          <button
            onClick={onOpenSettings}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent hover:text-text"
            title="API Keys"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Agent rows */}
      <div className="flex-1 overflow-y-auto">
        {/* Main agent row */}
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

        {/* Other agent rows */}
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
            <p className="mt-1 text-[10px] text-text-muted">
              "Build me an agent that checks the weather every morning"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
