import { cn } from "@/lib/cn";
import type { AgentInfo } from "@/hooks/use-agents";
import { Bot, MessageSquare } from "lucide-react";

interface AgentCardProps {
  agent: AgentInfo;
  isMain?: boolean;
  onClick: () => void;
}

export function AgentCard({ agent, isMain = false, onClick }: AgentCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition-all",
        "hover:border-accent/50 hover:bg-surface-hover hover:shadow-lg hover:shadow-accent/5",
        "active:scale-[0.98]",
        isMain && "col-span-full",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl",
          isMain ? "h-14 w-14 bg-accent" : "h-11 w-11 bg-surface-hover",
        )}
      >
        <Bot className={cn(isMain ? "h-7 w-7" : "h-5 w-5")} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-semibold", isMain ? "text-base" : "text-sm")}>
            {agent.name ?? agent.id}
          </span>
          {agent.isDefault && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-medium text-accent">
              main
            </span>
          )}
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <div className="mt-0.5 truncate text-xs text-text-muted">
          {agent.model?.primary?.split("/").pop() ?? "no model configured"}
        </div>
      </div>

      {/* Chat icon */}
      <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" />
    </button>
  );
}
