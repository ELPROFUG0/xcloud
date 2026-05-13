import { useMemo, useRef, useState, useEffect, useCallback, useLayoutEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { AgentInfo } from "@/hooks/use-agents";
import { getWorkspaceDir, type WorkspaceInfo } from "@/hooks/use-workspaces";
import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import { AgentUIContent, useAgentUI } from "./AgentUI";
import type { DetailPanel } from "./AgentCanvas";
import { ContinuousTabs } from "./ContinuousTabs";

interface WorkspaceCanvasProps {
  workspace: WorkspaceInfo;
  agents: AgentInfo[];
  onNodeDetail?: (detail: DetailPanel | null) => void;
}

interface WorkspaceNode {
  id: string;
  label: string;
  size: number;
  kind: "workspace" | "agent" | "ui" | "chat" | "context";
}

interface WorkspaceLink {
  source: string;
  target: string;
}

export function WorkspaceCanvas({ workspace, agents, onNodeDetail }: WorkspaceCanvasProps) {
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const draggingNode = useRef<string | null>(null);
  const hoverIntensity = useRef(0);
  const labelOffsets = useRef<Record<string, number>>({});
  const animFrameRef = useRef<number>(0);
  const [, forceRender] = useState(0);
  const workspaceUI = useAgentUI("main", ".openclaw/workspace");
  const canvasTabs = useMemo(() => [
    { id: "canvas" as const, label: "Canvas" },
    { id: "ui" as const, label: "UI" },
  ], []);
  const agentsSignature = agents
    .map((agent) => `${agent.id}\u001f${agent.name ?? ""}\u001f${agent.isDefault ? "1" : "0"}`)
    .join("\u001e");

  const agentNodes = useMemo(() => agents.map((agent) => ({
    id: `agent:${agent.id}`,
    label: agent.name ?? agent.id,
    size: agent.isDefault ? 6 : 5,
    kind: "agent" as const,
  })), [agentsSignature]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    let frameId = 0;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      const next = {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setDimensions((current) => (
          current.width === next.width && current.height === next.height ? current : next
        ));
      });
    });
    obs.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frameId);
      obs.disconnect();
    };
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

    for (const agent of agentNodes) {
      nodes.push(agent);
      links.push({ source: "workspace", target: agent.id });
    }

    return { nodes, links };
  }, [agentNodes, workspace.name]);

  useEffect(() => {
    if (!graphRef.current) return;
    setTimeout(() => graphRef.current?.zoomToFit(360, 64), 220);
  }, [graphData.nodes.length]);

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      const target = hoveredNode ? 1 : 0;
      const previous = hoverIntensity.current;
      hoverIntensity.current += (target - previous) * 0.1;
      if (Math.abs(hoverIntensity.current - target) > 0.005) {
        forceRender((value) => value + 1);
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        hoverIntensity.current = target;
        forceRender((value) => value + 1);
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [hoveredNode]);

  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const set = new Set<string>([hoveredNode]);
    graphData.links.forEach((link) => {
      const source = typeof link.source === "object" ? (link.source as any).id : link.source;
      const target = typeof link.target === "object" ? (link.target as any).id : link.target;
      if (source === hoveredNode) set.add(target);
      if (target === hoveredNode) set.add(source);
    });
    return set;
  }, [graphData.links, hoveredNode]);

  const readWorkspaceFile = useCallback(async (file: string) => {
    const dir = getWorkspaceDir(workspace.id);
    return readTextFile(`${dir}/${file}`, { baseDir: BaseDirectory.Home }).catch(() => `No ${file}`);
  }, [workspace.id]);

  const readAgentFile = useCallback(async (agentId: string, file: string) => {
    return readTextFile(`.openclaw/workspace/${agentId}/${file}`, { baseDir: BaseDirectory.Home }).catch(() => "");
  }, []);

  const showNodeDetail = useCallback(async (node: WorkspaceNode) => {
    if (!onNodeDetail) return;

    if (node.id === "workspace") {
      onNodeDetail({
        title: `${workspace.name} Overview`,
        type: "info",
        content: `**Workspace:** ${workspace.name}\n\n**ID:** ${workspace.id}\n\n**Linked agents:** ${agents.length}\n\nThis is the project-level canvas. Use it to inspect workspace context, goals, team structure, UI, and linked agents without entering an individual agent chat.`,
      });
      return;
    }

    if (node.id === "chat") {
      onNodeDetail({
        title: "Workspace Main",
        type: "info",
        content: `The workspace main agent coordinates this workspace's general chat, durable memory, goals, team setup, and handoff decisions.\n\nOpen the Workspace Main node in the Team Tree to continue its latest conversation.`,
      });
      return;
    }

    if (node.id === "ui") {
      onNodeDetail({
        title: "Workspace UI",
        type: "info",
        content: workspaceUI.repoPath
          ? `**UI workspace:** ${workspaceUI.repoPath}\n\nUse the UI tab to preview or edit the workspace-level interface.`
          : "No workspace UI has been created yet.",
      });
      return;
    }

    if (node.id === "context") {
      const files = await Promise.all([
        ["Workspace instructions", "AGENTS.md"],
        ["Team", "TEAM.md"],
        ["Goals", "GOALS.md"],
        ["Memory", "MEMORY.md"],
      ].map(async ([label, file]) => {
        const content = await readWorkspaceFile(file);
        return `# ${label} (${file})\n\n${content}`;
      }));
      onNodeDetail({
        title: `${workspace.name} Context`,
        type: "markdown",
        content: files.join("\n\n---\n\n"),
      });
      return;
    }

    const fileByNode: Record<string, { title: string; file: string }> = {
      memory: { title: "Workspace Memory", file: "MEMORY.md" },
      team: { title: "Workspace Team", file: "TEAM.md" },
      goals: { title: "Workspace Goals", file: "GOALS.md" },
    };
    const fileInfo = fileByNode[node.id];
    if (fileInfo) {
      onNodeDetail({
        title: fileInfo.title,
        type: "markdown",
        content: await readWorkspaceFile(fileInfo.file),
      });
      return;
    }

    if (node.id.startsWith("agent:")) {
      const agentId = node.id.slice(6);
      const agent = agents.find((item) => item.id === agentId);
      const [identity, brief] = await Promise.all([
        readAgentFile(agentId, "IDENTITY.md"),
        readAgentFile(agentId, "PROJECT_BRIEF.md"),
      ]);
      onNodeDetail({
        title: agent?.name ?? agentId,
        type: "markdown",
        content: [
          `# ${agent?.name ?? agentId}`,
          `**ID:** ${agentId}`,
          agent?.isDefault ? "**Role:** Workspace Main" : "**Role:** Linked workspace agent",
          identity ? `## Identity\n\n${identity}` : "",
          brief ? `## Project Brief\n\n${brief}` : "",
        ].filter(Boolean).join("\n\n"),
      });
    }
  }, [agents, onNodeDetail, readAgentFile, readWorkspaceFile, workspace.id, workspace.name, workspaceUI.repoPath]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as WorkspaceNode & { x: number; y: number };
    const isCenter = n.kind === "workspace";
    const isBranch = n.size >= 5 && !isCenter;
    const isLeaf = n.size < 5;
    const r = isCenter ? 10 : isBranch ? 6 : 3.5;
    const isHovered = hoveredNode === n.id;
    const isConnected = connectedNodes.has(n.id);
    const isDimmed = hoveredNode && !isHovered && !isConnected;
    const t = hoverIntensity.current;

    let brightness: number;
    if (isHovered) {
      brightness = isCenter ? 255 : isBranch ? 245 : 236;
    } else if (isConnected && hoveredNode) {
      brightness = isCenter ? 250 : isBranch ? 235 : 225;
    } else if (isDimmed) {
      const normal = isCenter ? 240 : isBranch ? 224 : 208;
      const dimmed = isCenter ? 80 : isBranch ? 60 : 45;
      brightness = Math.round(normal + (dimmed - normal) * t);
    } else {
      brightness = isCenter ? 240 : isBranch ? 224 : 208;
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    ctx.fill();

    if (globalScale > 0.35) {
      const targetOffset = (isHovered || (isConnected && hoveredNode)) ? 0 : hoveredNode ? -1.5 : 0;
      const previous = labelOffsets.current[n.id] ?? 0;
      const offset = previous + (targetOffset - previous) * 0.15;
      labelOffsets.current[n.id] = offset;

      const labelAlpha = isHovered ? 1 : (isConnected && hoveredNode) ? 0.85 : isDimmed ? Math.max(0, 1 - t * 0.8) : 1;
      let labelBrightness: number;
      if (isHovered) {
        labelBrightness = 240;
      } else if (isConnected && hoveredNode) {
        labelBrightness = 210;
      } else if (isDimmed) {
        const normal = isLeaf ? 136 : 187;
        labelBrightness = Math.round(normal + (40 - normal) * t);
      } else {
        labelBrightness = isLeaf ? 170 : 210;
      }

      ctx.font = `${isLeaf ? "400" : "500"} ${isCenter ? 4 : isBranch ? 3.5 : 3}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = `rgb(${labelBrightness}, ${labelBrightness}, ${labelBrightness})`;
      ctx.fillText(n.label, n.x, n.y + r + 2 + offset);
      ctx.globalAlpha = 1;
    }
  }, [connectedNodes, hoveredNode]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg px-3 gap-2">
        <ContinuousTabs
          groupId={`workspace-canvas-tabs-${workspace.id}`}
          tabs={canvasTabs}
          activeId={tab}
          onChange={(nextTab) => {
            setTab(nextTab);
            if (nextTab === "ui" && workspaceUI.repoPath && workspaceUI.uiView === "menu" && !workspaceUI.devServerUrl) {
              workspaceUI.launchPreview();
            }
          }}
        />
        <div className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{workspace.name}</div>
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
            linkColor={(link: any) => {
              if (!hoveredNode) return "#3a3a3a";
              const source = typeof link.source === "object" ? link.source.id : link.source;
              const target = typeof link.target === "object" ? link.target.id : link.target;
              if (source === hoveredNode || target === hoveredNode) return "#888888";
              return "#2a2a2a";
            }}
            linkWidth={1}
            onNodeHover={(node: any) => {
              if (!draggingNode.current) setHoveredNode(node ? (node as WorkspaceNode).id : null);
            }}
            onNodeClick={(node: any) => {
              const workspaceNode = node as WorkspaceNode;
              void showNodeDetail(workspaceNode);
              if (workspaceNode.id === "ui") setTab("ui");
            }}
            onNodeDrag={(node: any) => {
              draggingNode.current = (node as WorkspaceNode).id;
              setHoveredNode((node as WorkspaceNode).id);
            }}
            onNodeDragEnd={() => {
              draggingNode.current = null;
            }}
            d3AlphaDecay={0.04}
            d3VelocityDecay={0.3}
            cooldownTicks={120}
          />
        </div>
      ) : (
        <AgentUIContent {...workspaceUI} />
      )}
    </div>
  );
}
