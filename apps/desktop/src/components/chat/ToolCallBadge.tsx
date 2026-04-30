import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ToolCallInfo } from "@/types/chat";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Terminal, FileText, Search, Globe, Code,
  FolderOpen, Pencil, Database, Zap, ChevronRight, type LucideIcon,
} from "lucide-react";

interface ToolCallBadgeProps {
  tool: ToolCallInfo;
  /** Text that belongs to this tool's response — shown inside the container */
  textContent?: string;
  isTextStreaming?: boolean;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  exec: Terminal, shell: Terminal, bash: Terminal,
  read: FileText, write: Pencil, edit: Pencil,
  search: Search, grep: Search, glob: FolderOpen,
  web: Globe, fetch: Globe, browse: Globe,
  code: Code, db: Database, sql: Database,
};

function getToolIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return Zap;
}

export function ToolCallBadge({ tool, textContent, isTextStreaming }: ToolCallBadgeProps) {
  const Icon = getToolIcon(tool.name);
  const isRunning = tool.status === "running";
  const isDone = tool.status === "done";
  const isError = tool.status === "error";
  const hasOutput = !!tool.output?.trim();
  const hasText = !!textContent;
  const [outputExpanded, setOutputExpanded] = useState(false);

  const label = tool.title
    ? tool.title.replace(/^(exec|read|write|edit|search|grep|glob)\s*/i, "").trim() || tool.name
    : tool.name;

  return (
    <div className={cn(
      "relative overflow-hidden rounded-lg transition-all duration-300",
      isRunning && "bg-tool-bg",
      isDone && "bg-[#1a1a1a]",
      isError && "bg-[#201414]",
    )}>
      {/* Shimmer */}
      {isRunning && (
        <div className="pointer-events-none absolute inset-0 animate-[shimmer_2s_ease-in-out_infinite]">
          <div className="h-full w-full bg-linear-to-r from-transparent via-white/6 to-transparent" />
        </div>
      )}

      {/* Left accent bar */}
      <div className={cn(
        "absolute left-0 top-0 h-full w-[2px] transition-colors duration-500",
        isRunning && "bg-accent/60",
        isDone && "bg-[#444]",
        isError && "bg-red-500/40",
      )} />

      {/* Header */}
      <button
        onClick={() => hasOutput && setOutputExpanded(!outputExpanded)}
        className={cn(
          "relative z-10 flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-left",
          hasOutput ? "cursor-pointer" : "cursor-default",
          isRunning && "text-[#8b8eff]",
          isDone && "text-[#666]",
          isError && "text-red-400/70",
        )}
      >
        {hasOutput && (
          <ChevronRight className={cn(
            "h-2.5 w-2.5 shrink-0 transition-transform duration-200",
            outputExpanded && "rotate-90",
          )} />
        )}

        {isRunning ? (
          <Icon className="h-3 w-3 shrink-0 animate-pulse" />
        ) : (
          <Icon className="h-3 w-3 shrink-0 opacity-50" />
        )}

        <span className={cn("truncate max-w-[300px]", isRunning && "font-medium")}>
          {label}
        </span>

        {isRunning && (
          <span className="ml-0.5 flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-accent/50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent/80" />
          </span>
        )}
      </button>

      {/* Command output (collapsible) */}
      {outputExpanded && hasOutput && (
        <div className="relative z-10 border-t border-border mx-3 py-2">
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-[#666]">
            {tool.output}
          </pre>
        </div>
      )}

      {/* Text response inside tool container */}
      {(hasText || isTextStreaming) && (
        <div className="relative z-10 border-t border-border mx-3 py-2">
          {textContent ? (
            <div className="text-[13px] leading-relaxed text-[#D4D4D4] prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {textContent}
              </ReactMarkdown>
              {isTextStreaming && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-accent" />
              )}
            </div>
          ) : isTextStreaming ? (
            <span className="text-text-muted italic text-[12px]">Thinking...</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
