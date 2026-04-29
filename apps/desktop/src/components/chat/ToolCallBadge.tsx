import { cn } from "@/lib/cn";
import type { ToolCallInfo } from "@/types/chat";
import { Wrench, Check, AlertCircle, Loader2 } from "lucide-react";

interface ToolCallBadgeProps {
  tool: ToolCallInfo;
}

const statusIcon = {
  running: Loader2,
  done: Check,
  error: AlertCircle,
} as const;

export function ToolCallBadge({ tool }: ToolCallBadgeProps) {
  const Icon = statusIcon[tool.status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs",
        "border-tool-border bg-tool-bg text-text-muted",
      )}
    >
      <Wrench className="h-3 w-3" />
      <span>{tool.name}</span>
      <Icon
        className={cn(
          "h-3 w-3",
          tool.status === "running" && "animate-spin",
          tool.status === "done" && "text-emerald-400",
          tool.status === "error" && "text-red-400",
        )}
      />
    </div>
  );
}
