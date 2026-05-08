import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { AgentInfo } from "@/hooks/use-agents";
import type { WorkspaceInfo } from "@/hooks/use-workspaces";
import { AgentUIContent, AgentUIHeaderControls, useAgentUI } from "./AgentUI";

interface WorkspaceCanvasProps {
  workspace: WorkspaceInfo;
  agents: AgentInfo[];
  onSelectAgent?: (agentId: string) => void;
}

interface WorkspaceNode {
  id: string;
  label: string;
  size: number;
  kind: "workspace" | "agent" | "ui" | "chat" | "context";
  emoji?: string;
  avatar?: string;
}

interface WorkspaceLink {
  source: string;
  target: string;
}

export function WorkspaceCanvas({ workspace, agents, onSelectAgent }: WorkspaceCanvasProps) {
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const workspaceUI = useAgentUI("main", ".openclaw/workspace");

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [tab]);

  const graphData = useMemo(() => {
    const nodes: WorkspaceNode[] = [
      { id: "workspace", label: workspace.name, size: 11, kind: "workspace" },
      { id: "chat", label: "General chat", size: 5, kind: "chat" },
      { id: "ui", label: "Workspace UI", size: 5, kind: "ui" },
      { id: "context", label: "Context", size: 5, kind: "context" },
      { id: "memory", label: "Memory", size: 4, kind: "context" },
      { id: "team", label: "Team", size: 4, kind: "context" },
      { id: "goals", label: "Goals", size: 4, kind: "context" },
    ];
    const links: WorkspaceLink[] = [
      { source: "workspace", target: "chat" },
      { source: "workspace", target: "ui" },
      { source: "workspace", target: "context" },
      { source: "context", target: "memory" },
      { source: "context", target: "team" },
      { source: "context", target: "goals" },
    ];

    for (const agent of agents) {
      nodes.push({
        id: `agent:${agent.id}`,
        label: agent.name ?? agent.id,
        size: agent.isDefault ? 6 : 5,
        kind: "agent",
        emoji: agent.emoji,
        avatar: agent.avatar,
      });
      links.push({ source: "workspace", target: `agent:${agent.id}` });
    }

    return { nodes, links };
  }, [workspace.name, agents]);

  useEffect(() => {
    if (!graphRef.current) return;
    setTimeout(() => graphRef.current?.zoomToFit(360, 64), 220);
  }, [graphData.nodes.length]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as WorkspaceNode & { x: number; y: number };
    const isHovered = hoveredNode === n.id;
    const isDimmed = hoveredNode && !isHovered;
    const r = n.size;
    const brightness = isHovered ? 255 : isDimmed ? 92 : n.kind === "workspace" ? 240 : 214;

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    ctx.fill();

    if (n.kind === "agent" && n.emoji) {
      ctx.font = `${r * 1.2}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.emoji, n.x, n.y + 0.5);
    }

    if (globalScale > 0.35) {
      ctx.font = `${n.kind === "workspace" ? "500" : "400"} ${n.kind === "workspace" ? 4.2 : 3.3}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isDimmed ? "#666" : "#d7d7d7";
      ctx.fillText(n.label, n.x, n.y + r + 3);
    }
  }, [hoveredNode]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg px-3 gap-2">
        <div className="flex rounded-lg border border-border text-[10px]">
          <button onClick={() => setTab("canvas")} className={`px-3 py-1 transition-colors ${tab === "canvas" ? "bg-surface-hover text-text" : "text-text-muted"}`}>
            Canvas
          </button>
          <button
            onClick={() => { setTab("ui"); if (workspaceUI.repoPath && workspaceUI.uiView === "menu" && !workspaceUI.devServerUrl) workspaceUI.launchPreview(); }}
            className={`px-3 py-1 transition-colors ${tab === "ui" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            UI
          </button>
        </div>
        <div className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{workspace.name}</div>
        {tab === "ui" && <AgentUIHeaderControls uiView={workspaceUI.uiView} repoPath={workspaceUI.repoPath} devServerUrl={workspaceUI.devServerUrl} setUiView={workspaceUI.setUiView} />}
      </div>

      {tab === "canvas" ? (
        <div ref={containerRef} className="min-h-0 flex-1">
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="transparent"
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              const r = (node as WorkspaceNode).size + 5;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkColor={() => "#3a3a3a"}
            linkWidth={1}
            onNodeHover={(node: any) => setHoveredNode(node ? (node as WorkspaceNode).id : null)}
            onNodeClick={(node: any) => {
              const id = (node as WorkspaceNode).id;
              if (id.startsWith("agent:")) onSelectAgent?.(id.slice(6));
              if (id === "ui") setTab("ui");
            }}
            d3AlphaDecay={0.045}
            d3VelocityDecay={0.34}
            cooldownTicks={120}
          />
        </div>
      ) : (
        <AgentUIContent {...workspaceUI} />
      )}
    </div>
  );
}
