import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import { BrainIcon, ChevronDown } from "lucide-react";
import { Shimmer } from "../ai-elements/shimmer";

interface ThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ thinking, isStreaming = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2">
      <CollapsibleTrigger className="flex items-center gap-2 text-text-muted text-[12px] transition-colors hover:text-text">
        <BrainIcon className="h-3.5 w-3.5" />
        {isStreaming ? (
          <Shimmer className="text-[12px]" duration={1.5}>Thinking...</Shimmer>
        ) : (
          <span>Thought process</span>
        )}
        <ChevronDown className={cn(
          "h-3.5 w-3.5 transition-transform",
          open && "rotate-180",
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-[collapsible-up_250ms_cubic-bezier(0.4,0,0.2,1)] data-[state=open]:animate-[collapsible-down_300ms_cubic-bezier(0.4,0,0.2,1)]">
        <div className="mt-2 rounded-lg bg-[#1D1D1D] px-3 py-2.5 text-[12px] leading-relaxed text-text-muted/70 font-mono whitespace-pre-wrap">
          {thinking}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
