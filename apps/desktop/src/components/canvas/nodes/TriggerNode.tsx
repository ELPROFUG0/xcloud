import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";

export function TriggerNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Handle type="target" position={Position.Top} id="top" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Right} id="right" className="opacity-0! w-2! h-2!" />
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-800/60 bg-amber-950/30 cursor-pointer hover:border-amber-500/60 transition-colors">
        <MessageSquare className="h-5 w-5 text-amber-400" />
      </div>
      <span className="text-[10px] text-text-muted">{d.label || "Chat"}</span>
    </div>
  );
}
