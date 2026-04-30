import { Handle, Position, type NodeProps } from "@xyflow/react";

interface IdentityNodeData {
  name: string;
  emoji: string;
  creature: string;
  vibe: string;
}

export function IdentityNode({ data }: NodeProps) {
  const d = data as unknown as IdentityNodeData;
  return (
    <div className="rounded-xl border border-purple-800/60 bg-purple-950/30 px-4 py-3 min-w-[160px]">
      <Handle type="target" position={Position.Top} className="!bg-purple-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-lg">{d.emoji || "🤖"}</span>
        <div>
          <div className="text-xs font-semibold text-text">{d.name || "Unknown"}</div>
          <div className="text-[10px] text-text-muted">{d.creature || "agent"}</div>
        </div>
      </div>
      {d.vibe && (
        <div className="mt-1.5 text-[9px] text-purple-300/60 leading-tight truncate max-w-[180px]">{d.vibe}</div>
      )}
    </div>
  );
}
