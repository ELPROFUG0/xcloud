import { cn } from "@/lib/cn";
import type { CodeChangeInfo, ToolCallInfo } from "@/types/chat";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Terminal, FileText, Search, Globe, Code,
  FolderOpen, Pencil, Database, Zap, ChevronDown, FileDiff,
  type LucideIcon,
} from "lucide-react";
import { Shimmer } from "../ai-elements/shimmer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";

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

function summarizeChanges(changes: CodeChangeInfo[]) {
  return changes.reduce(
    (total, change) => ({
      additions: total.additions + change.additions,
      deletions: total.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function displayPath(path: string) {
  return path
    .replace(/^\/Users\/[^/]+\/Downloads\/unicore\//, "")
    .replace(/^\/Users\/[^/]+\/\.openclaw\/workspace\//, "~/.openclaw/workspace/")
    .replace(/^\/Users\/[^/]+\//, "~/");
}

function splitDisplayPath(path: string) {
  const display = displayPath(path);
  const index = display.lastIndexOf("/");
  if (index < 0) return { dir: "", file: display };
  return {
    dir: display.slice(0, index + 1),
    file: display.slice(index + 1),
  };
}

function CodeDiffView({ diff }: { diff: string }) {
  let files: ReturnType<typeof parseDiff> = [];
  try {
    files = parseDiff(diff, { nearbySequences: "zip" });
  } catch {
    files = [];
  }

  if (!files.length) {
    return (
      <pre className="max-h-[360px] overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-text-muted/75">
        {diff}
      </pre>
    );
  }

  return (
    <div className="code-change-diff max-h-[360px] overflow-auto">
      {files.map((file, fileIndex) => (
        <Diff
          key={`${file.oldRevision}-${file.newRevision}-${fileIndex}`}
          viewType="unified"
          diffType={file.type}
          hunks={file.hunks}
          gutterType="default"
        >
          {(hunks) => hunks.map((hunk) => (
            <Hunk key={hunk.content} hunk={hunk} />
          ))}
        </Diff>
      ))}
    </div>
  );
}

function CodeChangeFileRow({ change, index }: { change: CodeChangeInfo; index: number }) {
  const [open, setOpen] = useState(false);
  const pathParts = splitDisplayPath(change.path);

  return (
    <div>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`code-change-diff-${index}`}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={displayPath(change.path)}>
          {pathParts.dir && <span className="text-text-muted/55">{pathParts.dir}</span>}
          <span className="text-text">{pathParts.file}</span>
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-emerald-300">+{change.additions}</span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-red-300">-{change.deletions}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-text-muted/45 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div id={`code-change-diff-${index}`} className="border-t border-white/[0.06] bg-[#101010]">
          {change.diff ? (
            <CodeDiffView diff={change.diff} />
          ) : (
            <div className="px-3 py-3 text-[12px] text-text-muted/70">
              Diff no disponible para este evento; sólo se recibió el archivo modificado.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeChangeArtifact({ changes }: { changes: CodeChangeInfo[] }) {
  const totals = summarizeChanges(changes);

  return (
    <div className="my-3 flex max-h-[460px] flex-col overflow-hidden rounded-lg bg-[#222] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.055] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text">
          <FileDiff className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate">{changes.length} {changes.length === 1 ? "file" : "files"} changed</span>
          <span className="flex shrink-0 items-center gap-1 font-mono">
            <span className="text-emerald-300">+{totals.additions}</span>
            <span className="text-red-300">-{totals.deletions}</span>
          </span>
        </div>
      </div>

      <div className="min-h-0 divide-y divide-white/[0.055] overflow-y-auto">
        {changes.map((change, index) => (
          <CodeChangeFileRow key={`${change.path}-${index}`} change={change} index={index} />
        ))}
      </div>
    </div>
  );
}

export function ToolCallBadge({ tool, textContent, isTextStreaming }: ToolCallBadgeProps) {
  const hasChanges = Boolean(tool.changes?.length);
  const Icon = hasChanges ? FileDiff : getToolIcon(tool.name);
  const isRunning = tool.status === "running";
  const isDone = tool.status === "done";
  const hasOutput = !!tool.output?.trim();
  const hasText = !!textContent;
  const canExpand = hasOutput || hasChanges || hasText || isTextStreaming;
  const changeTotals = tool.changes ? summarizeChanges(tool.changes) : null;

  const label = tool.title
    ? tool.title.replace(/^(exec|read|write|edit|search|grep|glob)\s*/i, "").trim() || tool.name
    : tool.name;
  const displayLabel = hasChanges && tool.changes && changeTotals
    ? `${tool.changes.length} ${tool.changes.length === 1 ? "file" : "files"} changed`
    : label;

  if (hasChanges && tool.changes) {
    return <CodeChangeArtifact changes={tool.changes} />;
  }

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
              <Shimmer className="text-[12px]" duration={2}>{displayLabel !== tool.name ? displayLabel : ""}</Shimmer>
            </span>
          ) : (
            <span className="flex-1 truncate text-[12px] text-text-muted/70">
              {displayLabel !== tool.name ? displayLabel : ""}
            </span>
          )}

          {hasChanges && changeTotals && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
              <span className="text-emerald-300">+{changeTotals.additions}</span>
              <span className="text-red-300">-{changeTotals.deletions}</span>
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
