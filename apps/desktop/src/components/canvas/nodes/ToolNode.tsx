import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";

interface ToolNodeData {
  label: string;
  tools: string[];
  count: number;
}

export function ToolNode({ data }: NodeProps) {
  const d = data as unknown as ToolNodeData;
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!bg-border !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-text-muted" />
        <div>
          <div className="text-xs font-medium text-text">{d.label}</div>
          <div className="text-[10px] text-text-muted">{d.count} tools</div>
        </div>
      </div>
    </div>
  );
}
