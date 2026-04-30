import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layout } from "lucide-react";

interface UINodeData {
  label: string;
  repoName: string;
  status: "connected" | "disconnected";
}

export function UINode({ data }: NodeProps) {
  const d = data as unknown as UINodeData;
  return (
    <div className="rounded-xl border border-blue-800/60 bg-blue-950/30 px-4 py-3 min-w-[140px] cursor-pointer hover:border-blue-500/60 transition-colors">
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Layout className="h-3.5 w-3.5 text-blue-400" />
        <div>
          <div className="text-xs font-medium text-text">{d.label}</div>
          <div className="text-[10px] text-text-muted">{d.repoName}</div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <div className={`h-1.5 w-1.5 rounded-full ${d.status === "connected" ? "bg-emerald-400" : "bg-text-muted"}`} />
        <span className="text-[9px] text-text-muted">{d.status}</span>
      </div>
    </div>
  );
}
