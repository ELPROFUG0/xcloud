import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layout } from "lucide-react";

export function UINode(_props: NodeProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Handle type="target" position={Position.Top} id="top" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0! w-2! h-2!" />
      <Handle type="target" position={Position.Right} id="right" className="opacity-0! w-2! h-2!" />
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue-800/60 bg-blue-950/30 cursor-pointer hover:border-blue-500/60 transition-colors">
        <Layout className="h-5 w-5 text-blue-400" />
      </div>
      <span className="text-[10px] text-text-muted">UI</span>
    </div>
  );
}
