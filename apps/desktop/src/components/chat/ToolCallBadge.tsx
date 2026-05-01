import { cn } from "@/lib/cn";
import type { ToolCallInfo } from "@/types/chat";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Terminal, FileText, Search, Globe, Code,
  FolderOpen, Pencil, Database, Zap, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { Shimmer } from "../ai-elements/shimmer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ToolCallBadgeProps {
  tool: ToolCallInfo;
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
  const hasOutput = !!tool.output?.trim();
  const hasText = !!textContent;
  const canExpand = hasOutput || hasText || isTextStreaming;

  const label = tool.title
    ? tool.title.replace(/^(exec|read|write|edit|search|grep|glob)\s*/i, "").trim() || tool.name
    : tool.name;

  return (
    <Collapsible>
      <div className="my-1.5 rounded-xl bg-[#1D1D1D] overflow-hidden transition-all">
        <CollapsibleTrigger
          className={cn(
            "relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/4",
            !canExpand && "cursor-default",
          )}
          disabled={!canExpand}
        >
          {/* Tool icon */}
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />

          {/* Tool name */}
          {isRunning ? (
            <Shimmer className="text-[12px] font-mono font-medium" duration={1.5}>{tool.name}</Shimmer>
          ) : (
            <code className="text-[12px] font-mono font-medium text-text">{tool.name}</code>
          )}

          {/* Label */}
          {isRunning ? (
            <span className="flex-1 truncate">
              <Shimmer className="text-[12px]" duration={2}>{label !== tool.name ? label : ""}</Shimmer>
            </span>
          ) : (
            <span className="flex-1 truncate text-[12px] text-text-muted/70">
              {label !== tool.name ? label : ""}
            </span>
          )}

          {/* Status */}
          {isRunning ? (
            <Shimmer className="text-[10px]" duration={1.5}>running...</Shimmer>
          ) : (
            <span className="shrink-0 text-[10px] text-text-muted/50">
              {isDone ? "done" : "error"}
            </span>
          )}

          {/* Chevron */}
          {canExpand && (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted/40 transition-transform group-data-[state=open]:rotate-180" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent
          className="overflow-hidden data-[state=closed]:animate-[collapsible-up_250ms_cubic-bezier(0.4,0,0.2,1)] data-[state=open]:animate-[collapsible-down_300ms_cubic-bezier(0.4,0,0.2,1)]"
        >
          <div className="mx-3 pb-2.5 pt-1 space-y-2.5">
            {/* Output */}
            {hasOutput && (
              <div>
                <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-muted/80">
                  {tool.output}
                </pre>
              </div>
            )}

            {/* Text response */}
            {(hasText || isTextStreaming) && (
              <div>
                {textContent ? (
                  <div className="text-[13px] leading-relaxed text-text prose-chat">
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
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
