import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles } from "lucide-react";

interface SkillNodeData {
  label: string;
  count: number;
  skills: string[];
}

export function SkillNode({ data }: NodeProps) {
  const d = data as unknown as SkillNodeData;
  return (
    <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 min-w-[140px] cursor-pointer hover:border-amber-500/60 transition-colors">
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        <div>
          <div className="text-xs font-medium text-text">{d.label}</div>
          <div className="text-[10px] text-text-muted">{d.count} skills</div>
        </div>
      </div>
      {d.skills.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {d.skills.slice(0, 4).map((s) => (
            <div key={s} className="text-[10px] text-amber-200/70 truncate">{s}</div>
          ))}
          {d.skills.length > 4 && (
            <div className="text-[10px] text-amber-300/50">+{d.skills.length - 4} more</div>
          )}
        </div>
      )}
    </div>
  );
}
