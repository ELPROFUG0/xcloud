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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseDiff, type ChangeData } from "react-diff-view";

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

function findVerticalScrollParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
    if (canScroll) return parent;
    parent = parent.parentElement;
  }

  return null;
}

function isPinnedToScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

function useContainedWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const diffScroll = ref.current;
    if (!diffScroll) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

      const maxScrollTop = diffScroll.scrollHeight - diffScroll.clientHeight;
      if (maxScrollTop <= 0) return;

      const currentTop = diffScroll.scrollTop;
      const nextTop = Math.max(0, Math.min(maxScrollTop, currentTop + event.deltaY));

      diffScroll.scrollTop = nextTop;
      event.preventDefault();
      event.stopPropagation();
    };

    diffScroll.addEventListener("wheel", handleWheel, { passive: false });
    return () => diffScroll.removeEventListener("wheel", handleWheel);
  }, []);

  return ref;
}

function CodeDiffView({ diff }: { diff: string }) {
  const scrollRef = useContainedWheelScroll<HTMLDivElement>();
  let files: ReturnType<typeof parseDiff> = [];
  try {
    files = parseDiff(diff, { nearbySequences: "zip" });
  } catch {
    files = [];
  }

  if (!files.length) {
    return (
      <div ref={scrollRef} className="code-change-diff max-h-[360px] overflow-auto">
        <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed text-text-muted/75">
          {diff}
        </pre>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="code-change-diff max-h-[360px] overflow-auto">
      {files.map((file, fileIndex) => (
        <div
          key={`${file.oldRevision}-${file.newRevision}-${fileIndex}`}
          className="code-change-diff-file"
        >
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={`${hunk.content}-${hunkIndex}`}>
              <div className="code-change-diff-line code-change-diff-line-hunk">
                <span className="code-change-diff-line-number" />
                <code className="code-change-diff-line-code">{hunk.content}</code>
              </div>
              {hunk.changes.map((change, changeIndex) => (
                <div
                  key={`${change.type}-${getChangeLineNumber(change)}-${changeIndex}`}
                  className={cn(
                    "code-change-diff-line",
                    change.type === "insert" && "code-change-diff-line-insert",
                    change.type === "delete" && "code-change-diff-line-delete",
                  )}
                >
                  <span className="code-change-diff-line-number">
                    {getChangeLineNumber(change)}
                  </span>
                  <code className="code-change-diff-line-code">
                    {change.content}
                  </code>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function getChangeLineNumber(change: ChangeData) {
  if (change.type === "delete" || change.type === "insert") return change.lineNumber;
  return change.newLineNumber;
}

function CodeChangeFileRow({ change, index }: { change: CodeChangeInfo; index: number }) {
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const revealAtBottomRef = useRef(false);
  const pathParts = splitDisplayPath(change.path);

  useLayoutEffect(() => {
    if (!open || !revealAtBottomRef.current || !rowRef.current) return;

    const scrollParent = findVerticalScrollParent(rowRef.current);
    if (!scrollParent) return;

    let frameId = 0;
    let frameCount = 0;
    const keepAtBottom = () => {
      scrollParent.scrollTop = scrollParent.scrollHeight;
      frameCount += 1;
      if (frameCount < 3) {
        frameId = requestAnimationFrame(keepAtBottom);
      }
    };

    frameId = requestAnimationFrame(keepAtBottom);
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  const toggleOpen = () => {
    const shouldOpen = !open;
    const scrollParent = rowRef.current ? findVerticalScrollParent(rowRef.current) : null;
    revealAtBottomRef.current = Boolean(shouldOpen && scrollParent && isPinnedToScrollBottom(scrollParent));
    setOpen(shouldOpen);
  };

  return (
    <div ref={rowRef}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls={`code-change-diff-${index}`}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={displayPath(change.path)}>
          {pathParts.dir && <span className="text-text-muted/55">{pathParts.dir}</span>}
          <span className="text-text">{pathParts.file}</span>
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[#01A241]">+{change.additions}</span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[#DE2E2A]">-{change.deletions}</span>
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
    <div className="my-3 flex flex-col overflow-hidden rounded-lg bg-[#222] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.055] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text">
          <FileDiff className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate">{changes.length} {changes.length === 1 ? "file" : "files"} changed</span>
          <span className="flex shrink-0 items-center gap-1 font-mono">
            <span className="text-[#01A241]">+{totals.additions}</span>
            <span className="text-[#DE2E2A]">-{totals.deletions}</span>
          </span>
        </div>
      </div>

      <div className="divide-y divide-white/[0.055] overflow-visible">
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
              <span className="text-[#01A241]">+{changeTotals.additions}</span>
              <span className="text-[#DE2E2A]">-{changeTotals.deletions}</span>
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
