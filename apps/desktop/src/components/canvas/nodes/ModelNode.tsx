import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cpu } from "lucide-react";

interface ModelNodeData {
  provider: string;
  model: string;
  contextWindow: number;
}

export function ModelNode({ data }: NodeProps) {
  const d = data as unknown as ModelNodeData;
  const shortModel = d.model?.split("/").pop() ?? d.model;
  const ctxK = d.contextWindow ? `${Math.round(d.contextWindow / 1000)}k` : "";
  return (
    <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!bg-emerald-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 text-emerald-400" />
        <div>
          <div className="text-xs font-medium text-text">{shortModel}</div>
          <div className="text-[10px] text-text-muted">{d.provider}{ctxK ? ` · ${ctxK} ctx` : ""}</div>
        </div>
      </div>
    </div>
  );
}
