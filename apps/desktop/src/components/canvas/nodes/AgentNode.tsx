import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";

export function AgentNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  return (
    <div className="flex flex-col items-center gap-2">
      <Handle type="source" position={Position.Top} id="top" className="opacity-0! w-2! h-2!" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="opacity-0! w-2! h-2!" />
      <Handle type="source" position={Position.Left} id="left" className="opacity-0! w-2! h-2!" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0! w-2! h-2!" />
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent bg-surface shadow-lg shadow-accent/10 cursor-pointer hover:shadow-accent/20 transition-shadow">
        <Bot className="h-7 w-7 text-accent" />
      </div>
      <span className="text-xs font-medium text-text">{d.label}</span>
    </div>
  );
}
