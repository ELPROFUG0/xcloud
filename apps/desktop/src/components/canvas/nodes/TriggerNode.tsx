import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

interface TriggerNodeData {
  label: string;
  triggerType: string;
}

export function TriggerNode({ data }: NodeProps) {
  const d = data as unknown as TriggerNodeData;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-700 bg-amber-950/50 px-4 py-3 cursor-pointer hover:border-amber-500 transition-colors">
      <Zap className="h-4 w-4 text-amber-400" />
      <div>
        <div className="text-xs font-semibold text-text">{d.label}</div>
        <div className="text-[10px] text-text-muted">{d.triggerType}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !border-0 !w-2 !h-2" />
    </div>
  );
}
