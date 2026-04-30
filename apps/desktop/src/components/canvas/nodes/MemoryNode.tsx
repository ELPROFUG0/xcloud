import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Brain } from "lucide-react";

interface MemoryNodeData {
  label: string;
  files: string[];
}

export function MemoryNode({ data }: NodeProps) {
  const d = data as unknown as MemoryNodeData;
  return (
    <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/30 px-4 py-3 min-w-[140px] cursor-pointer hover:border-cyan-500/60 transition-colors">
      <Handle type="target" position={Position.Top} className="!bg-cyan-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Brain className="h-3.5 w-3.5 text-cyan-400" />
        <div>
          <div className="text-xs font-medium text-text">{d.label}</div>
          <div className="text-[10px] text-text-muted">{d.files.length} files</div>
        </div>
      </div>
      {d.files.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {d.files.slice(0, 3).map((f) => (
            <div key={f} className="text-[9px] text-cyan-300/50 truncate">{f}</div>
          ))}
          {d.files.length > 3 && (
            <div className="text-[9px] text-cyan-300/40">+{d.files.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}
