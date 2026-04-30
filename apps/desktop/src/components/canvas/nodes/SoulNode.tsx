import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Heart } from "lucide-react";

interface SoulNodeData {
  label: string;
  traits: string[];
}

export function SoulNode({ data }: NodeProps) {
  const d = data as unknown as SoulNodeData;
  return (
    <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-3 min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!bg-rose-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Heart className="h-3.5 w-3.5 text-rose-400" />
        <div>
          <div className="text-xs font-medium text-text">{d.label}</div>
          <div className="text-[10px] text-text-muted">personality</div>
        </div>
      </div>
      {d.traits.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {d.traits.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full bg-rose-900/30 px-1.5 py-0.5 text-[8px] text-rose-300/60">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
