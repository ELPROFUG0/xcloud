import { Handle, Position, type NodeProps } from "@xyflow/react";
import { User } from "lucide-react";

export function IdentityNode({ data }: NodeProps) {
  const d = data as unknown as { name: string; emoji?: string };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Handle type="target" position={Position.Top} id="top" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Right} id="right" className="opacity-0! w-2! h-2!" />
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-purple-800/60 bg-purple-950/30 cursor-pointer hover:border-purple-500/60 transition-colors">
        {d.emoji ? (
          <span className="text-lg">{d.emoji}</span>
        ) : (
          <User className="h-5 w-5 text-purple-400" />
        )}
      </div>
      <span className="text-[10px] text-text-muted">{d.name || "Identity"}</span>
    </div>
  );
}
