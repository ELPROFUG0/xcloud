import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";

interface AgentNodeData {
  label: string;
  status: string;
}

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  return (
    <div className="flex items-center gap-2 rounded-xl border-2 border-accent bg-surface px-4 py-3 shadow-lg shadow-accent/10 cursor-pointer hover:shadow-accent/20 transition-shadow">
      <Handle type="target" position={Position.Top} className="!bg-accent !border-0 !w-2 !h-2" />
      <Bot className="h-4 w-4 text-accent" />
      <div>
        <div className="text-xs font-semibold text-text">{d.label}</div>
        <div className="text-[10px] text-text-muted">agent</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-accent !border-0 !w-2 !h-2" />
    </div>
  );
}
