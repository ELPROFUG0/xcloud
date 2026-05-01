"use client";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import {
  CheckCircleIcon, ChevronDownIcon, ClockIcon,
  WrenchIcon, XCircleIcon, Loader2Icon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { CodeBlock } from "./code-block";
import type { BundledLanguage } from "shiki";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose my-2 w-full rounded-lg border border-white/6", className)}
    {...props}
  />
);

export type ToolState = "running" | "done" | "error" | "pending";

const statusLabels: Record<ToolState, string> = {
  running: "Running",
  pending: "Pending",
  done: "Completed",
  error: "Error",
};

const statusIcons: Record<ToolState, ReactNode> = {
  running: <Loader2Icon className="size-3.5 animate-spin text-accent" />,
  pending: <ClockIcon className="size-3.5 text-text-muted" />,
  done: <CheckCircleIcon className="size-3.5 text-emerald-500" />,
  error: <XCircleIcon className="size-3.5 text-red-500" />,
};

export const getStatusBadge = (status: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-[10px] border-none" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  state,
  icon,
  ...props
}: {
  title: string;
  state: ToolState;
  icon?: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof CollapsibleTrigger>, "title">) => (
  <CollapsibleTrigger
    className={cn("flex w-full items-center justify-between gap-3 px-3 py-2", className)}
    {...props}
  >
    <div className="flex items-center gap-2">
      {icon ?? <WrenchIcon className="size-3.5 text-text-muted" />}
      <span className="font-medium text-[12px] text-text/80">{title}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-3.5 text-text-muted transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export const ToolContent = ({ className, ...props }: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent className={cn("space-y-3 px-3 pb-3", className)} {...props} />
);

export const ToolInput = ({ className, input, ...props }: { input: unknown; className?: string } & ComponentProps<"div">) => (
  <div className={cn("space-y-1.5 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-text-muted/50 text-[10px] uppercase tracking-wider">Parameters</h4>
    <div className="rounded-md overflow-hidden">
      <CodeBlock code={JSON.stringify(input, null, 2)} language={"json" as BundledLanguage} />
    </div>
  </div>
);

export const ToolOutput = ({ className, output, error, ...props }: {
  output?: string | object | null;
  error?: string | null;
  className?: string;
} & ComponentProps<"div">) => {
  if (!output && !error) return null;

  const displayCode = typeof output === "string"
    ? output
    : typeof output === "object" && output !== null
    ? JSON.stringify(output, null, 2)
    : "";

  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <h4 className="font-medium text-text-muted/50 text-[10px] uppercase tracking-wider">
        {error ? "Error" : "Result"}
      </h4>
      <div className={cn("overflow-x-auto rounded-md", error ? "bg-red-500/5" : "")}>
        {error && <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>}
        {displayCode && <CodeBlock code={displayCode} language={"json" as BundledLanguage} />}
      </div>
    </div>
  );
};
