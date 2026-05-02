import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { X, ArrowLeft } from "lucide-react";
import { useAgentUI, AgentUIHeaderControls, AgentUIContent } from "./AgentUI";

interface AgentCanvasProps {
  engine: BrowserEngine;
  agentId: string;
  savedViewport?: { x: number; y: number; zoom: number };
  onViewportChange?: (vp: { x: number; y: number; zoom: number }) => void;
}

interface AgentData {
  identity: { name: string; emoji: string; creature: string; vibe: string };
  soul: { traits: string[] };
  model: { provider: string; model: string; contextWindow: number };
  skills: Array<{ name: string; description: string }>;
  memoryFiles: string[];
}

interface DetailPanel {
  title: string;
  type: "markdown" | "list" | "info";
  content: string;
  items?: Array<{ label: string; file?: string; description?: string }>;
}

interface GraphNode {
  id: string;
  label: string;
  color: string;
  size: number;
  isCenter?: boolean;
  emoji?: string;
}

interface GraphLink {
  source: string;
  target: string;
}

const NODE_COLORS: Record<string, string> = {
  agent: "#6366f1",
  trigger: "#f59e0b",
  identity: "#a855f7",
  model: "#10b981",
  soul: "#f43f5e",
  memory: "#06b6d4",
  skills: "#f59e0b",
  "ui-repo": "#3b82f6",
};

function parseIdentity(content: string) {
  const get = (key: string) => content.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"))?.[1]?.trim() ?? "";
  return { name: get("Name"), emoji: get("Emoji"), creature: get("Creature"), vibe: get("Vibe") };
}

function parseSoul(content: string): string[] {
  const traits: string[] = [];
  for (const m of content.matchAll(/\*\*([^*]+)\*\*/g)) {
    const t = m[1]!.trim();
    if (t.length > 3 && t.length < 40 && !t.includes(":")) traits.push(t);
  }
  return traits.slice(0, 6);
}

export function AgentCanvas({ engine, agentId }: AgentCanvasProps) {
  const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  const [agentData, setAgentData] = useState<AgentData>({
    identity: { name: "", emoji: "", creature: "", vibe: "" },
    soul: { traits: [] },
    model: { provider: "", model: "", contextWindow: 0 },
    skills: [],
    memoryFiles: [],
  });
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [detail, setDetail] = useState<DetailPanel | null>(null);
  const [detailHistory, setDetailHistory] = useState<DetailPanel[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Agent UI state
  const agentUI = useAgentUI(agentId, wsPath);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [tab]);

  // Load agent data
  const loadData = useCallback(async () => {
    const data: AgentData = {
      identity: { name: agentId, emoji: "", creature: "", vibe: "" },
      soul: { traits: [] },
      model: { provider: "", model: "", contextWindow: 0 },
      skills: [],
      memoryFiles: [],
    };

    try { data.identity = parseIdentity(await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home })); } catch { /* */ }
    try { data.soul.traits = parseSoul(await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home })); } catch { /* */ }

    try {
      const result = await engine.rpc("config.get", {});
      const config = (result as { config?: Record<string, unknown> }).config ?? result;
      const agents = config.agents as Record<string, unknown> | undefined;
      let primary = "";
      const agentList = agents?.list as Array<Record<string, unknown>> | undefined;
      if (agentList) {
        const thisAgent = agentList.find(a => a.id === agentId);
        primary = ((thisAgent?.model as Record<string, unknown>)?.primary as string) ?? "";
      }
      if (!primary) primary = ((agents?.defaults as Record<string, unknown>)?.model as Record<string, unknown>)?.primary as string ?? "";
      if (primary) data.model = { provider: primary.split("/")[0] ?? "", model: primary, contextWindow: 200000 };
    } catch { /* */ }

    try { data.skills = (await engine.listCommands()).slice(0, 20).map((c) => ({ name: c.name, description: c.description ?? "" })); } catch { /* */ }

    for (const file of ["MEMORY.md", "HEARTBEAT.md", "USER.md", "TOOLS.md", "AGENTS.md"]) {
      try { if ((await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home })).trim()) data.memoryFiles.push(file); } catch { /* */ }
    }

    setAgentData(data);
    setDataLoaded(true);
  }, [engine, agentId, wsPath]);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh on agent lifecycle end
  useEffect(() => {
    const unsub = engine.onEvent((frame) => {
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && data?.phase === "end") loadData();
      }
    });
    return unsub;
  }, [engine, loadData]);

  // Detail panel navigation
  const navigateTo = useCallback((panel: DetailPanel) => {
    setDetail((prev) => { if (prev) setDetailHistory((h) => [...h, prev]); return panel; });
  }, []);
  const goBack = useCallback(() => {
    setDetailHistory((h) => { if (!h.length) return h; setDetail(h[h.length - 1]!); return h.slice(0, -1); });
  }, []);
  const closeDetail = useCallback(() => { setDetail(null); setDetailHistory([]); }, []);

  const loadMemoryFile = useCallback(async (file: string) => {
    setDetailLoading(true);
    try { navigateTo({ title: file, type: "markdown", content: await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home }) }); }
    catch { navigateTo({ title: file, type: "markdown", content: "Failed to load file" }); }
    setDetailLoading(false);
  }, [wsPath, navigateTo]);

  // Node click handler
  const onNodeClick = useCallback(async (node: GraphNode) => {
    setDetailLoading(true);
    setDetailHistory([]);
    try {
      if (node.id === "identity") {
        setDetail({ title: "Identity", type: "markdown", content: await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home }).catch(() => "No IDENTITY.md") });
      } else if (node.id === "soul") {
        setDetail({ title: "Soul", type: "markdown", content: await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home }).catch(() => "No SOUL.md") });
      } else if (node.id === "memory" || node.id.startsWith("memory-")) {
        const file = node.id.startsWith("memory-") ? node.id.slice(7) : null;
        if (file) {
          await loadMemoryFile(file);
          setDetailLoading(false);
          return;
        } else {
          setDetail({ title: "Memory", type: "list", content: "", items: agentData.memoryFiles.map(f => ({ label: f, file: f })) });
        }
      } else if (node.id === "skills" || node.id.startsWith("skill-")) {
        const skillName = node.id.startsWith("skill-") ? node.id.slice(6) : null;
        if (skillName) {
          const skill = agentData.skills.find(s => s.name === skillName);
          setDetail({ title: skillName, type: "info", content: skill?.description || "No description" });
        } else {
          setDetail({ title: "Skills", type: "list", content: "", items: agentData.skills.map(s => ({ label: s.name, description: s.description })) });
        }
      } else if (node.id === "model") {
        const m = agentData.model;
        setDetail({ title: "Model", type: "info", content: `**Provider:** ${m.provider}\n\n**Model:** ${m.model}\n\n**Context Window:** ${m.contextWindow.toLocaleString()} tokens` });
      } else if (node.id === "agent") {
        setDetail({ title: "Agent Config", type: "markdown", content: await readTextFile(`${wsPath}/AGENTS.md`, { baseDir: BaseDirectory.Home }).catch(() => "No AGENTS.md") });
      } else if (node.id === "ui-repo") {
        setTab("ui");
        agentUI.launchPreview();
        setDetail(null);
      } else {
        setDetail(null);
      }
    } catch { setDetail(null); }
    setDetailLoading(false);
  }, [wsPath, agentData, agentUI]);

  // Build graph data
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    nodes.push({ id: "agent", label: agentData.identity.name || agentId, color: NODE_COLORS.agent!, size: 10, isCenter: true });
    nodes.push({ id: "trigger", label: "Chat", color: NODE_COLORS.trigger!, size: 5 });
    links.push({ source: "agent", target: "trigger" });

    nodes.push({ id: "identity", label: agentData.identity.name || "Identity", color: NODE_COLORS.identity!, size: 5, emoji: agentData.identity.emoji });
    links.push({ source: "agent", target: "identity" });

    if (agentData.model.model) {
      nodes.push({ id: "model", label: agentData.model.model.split("/").pop() ?? "Model", color: NODE_COLORS.model!, size: 5 });
      links.push({ source: "agent", target: "model" });
    }
    if (agentData.soul.traits.length > 0) {
      nodes.push({ id: "soul", label: "Soul", color: NODE_COLORS.soul!, size: 6 });
      links.push({ source: "agent", target: "soul" });
      agentData.soul.traits.forEach((trait, i) => {
        nodes.push({ id: `trait-${i}`, label: trait, color: NODE_COLORS.soul!, size: 3 });
        links.push({ source: "soul", target: `trait-${i}` });
      });
    }
    if (agentData.memoryFiles.length > 0) {
      nodes.push({ id: "memory", label: "Memory", color: NODE_COLORS.memory!, size: 6 });
      links.push({ source: "agent", target: "memory" });
      agentData.memoryFiles.forEach((file) => {
        const label = file.replace(".md", "");
        nodes.push({ id: `memory-${file}`, label, color: NODE_COLORS.memory!, size: 3 });
        links.push({ source: "memory", target: `memory-${file}` });
      });
    }
    if (agentData.skills.length > 0) {
      nodes.push({ id: "skills", label: "Skills", color: NODE_COLORS.skills!, size: 6 });
      links.push({ source: "agent", target: "skills" });
      agentData.skills.forEach((skill) => {
        nodes.push({ id: `skill-${skill.name}`, label: skill.name, color: NODE_COLORS.skills!, size: 3 });
        links.push({ source: "skills", target: `skill-${skill.name}` });
      });
    }
    if (agentUI.repoPath) {
      nodes.push({ id: "ui-repo", label: "UI", color: NODE_COLORS["ui-repo"]!, size: 5 });
      links.push({ source: "agent", target: "ui-repo" });
    }

    return { nodes, links };
  }, [agentId, agentData, agentUI.repoPath]);

  // Custom node rendering
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode & { x: number; y: number };
    const isLeaf = n.size <= 3;
    const isBranch = n.size >= 5 && n.size <= 6;
    const r = n.isCenter ? 14 : isBranch ? 9 : isLeaf ? 5 : 8;
    const isHovered = hoveredNode === n.id;

    // Glow effect
    if (isHovered || n.isCenter) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, 2 * Math.PI);
      ctx.fillStyle = n.color + (isHovered ? "30" : "15");
      ctx.fill();
    }

    // Circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = n.color + (isLeaf ? "15" : "20");
    ctx.fill();
    ctx.strokeStyle = n.color + (isHovered ? "cc" : isLeaf ? "50" : "80");
    ctx.lineWidth = (isLeaf ? 1 : 1.5) / globalScale;
    ctx.stroke();

    // Icon dot
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.isCenter ? 5 : isBranch ? 3 : 2, 0, 2 * Math.PI);
    ctx.fillStyle = n.color;
    ctx.fill();

    // Label
    const fontSize = (n.isCenter ? 11 : isBranch ? 9 : 7) / globalScale;
    ctx.font = `${isLeaf ? "400" : "500"} ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = isHovered ? "#e8e8e8" : isLeaf ? "#666666" : "#999999";
    ctx.fillText(n.label, n.x, n.y + r + 3 / globalScale);
  }, [hoveredNode]);

  // Center graph after data loads
  useEffect(() => {
    if (dataLoaded && graphRef.current) {
      setTimeout(() => {
        graphRef.current?.zoomToFit(400, 60);
      }, 500);
    }
  }, [dataLoaded]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg px-3">
        <div className="flex rounded-lg border border-border text-[10px]">
          <button onClick={() => setTab("canvas")} className={`px-3 py-1 transition-colors ${tab === "canvas" ? "bg-surface-hover text-text" : "text-text-muted"}`}>
            Canvas
          </button>
          <button
            onClick={() => { setTab("ui"); if (agentUI.repoPath && agentUI.uiView === "menu" && !agentUI.devServerUrl) agentUI.launchPreview(); else if (agentUI.devServerUrl) agentUI.setUiView("preview"); }}
            className={`px-3 py-1 transition-colors ${tab === "ui" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            UI
          </button>
        </div>
        {tab === "ui" && <AgentUIHeaderControls uiView={agentUI.uiView} repoPath={agentUI.repoPath} devServerUrl={agentUI.devServerUrl} setUiView={agentUI.setUiView} />}
      </div>

      {/* Content */}
      {tab === "canvas" ? (
        <div className="flex flex-1 min-h-0" style={{ opacity: dataLoaded ? 1 : 0, transition: "opacity 300ms" }}>
          <div ref={containerRef} className={detail ? "flex-1" : "w-full"}>
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="transparent"
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const r = (node as GraphNode).isCenter ? 14 : 8;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={() => "#27272a"}
              linkWidth={1}
              linkCurvature={0}
              onNodeClick={(node: any) => onNodeClick(node as GraphNode)}
              onNodeHover={(node: any) => setHoveredNode(node ? (node as GraphNode).id : null)}
              cooldownTicks={100}
              d3AlphaDecay={0.04}
              d3VelocityDecay={0.3}
              enableZoomInteraction={true}
              enablePanInteraction={true}
            />
          </div>

          {/* Detail panel */}
          {detail && (
            <div className="w-[280px] shrink-0 border-l border-border bg-bg overflow-hidden flex flex-col">
              <div className="flex h-9 items-center justify-between border-b border-border px-3">
                <div className="flex items-center gap-1.5">
                  {detailHistory.length > 0 && <button onClick={goBack} className="text-text-muted hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /></button>}
                  <span className="text-[11px] font-medium text-text">{detail.title}</span>
                </div>
                <button onClick={closeDetail} className="text-text-muted hover:text-text"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {detailLoading ? (
                  <div className="text-xs text-text-muted">Loading...</div>
                ) : detail.type === "markdown" || detail.type === "info" ? (
                  <div className="prose-chat text-[12px] leading-relaxed text-[#D4D4D4]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content}</ReactMarkdown>
                  </div>
                ) : detail.type === "list" ? (
                  <div className="space-y-0.5">
                    {detail.items?.map((item) => (
                      <button key={item.label} onClick={() => item.file && loadMemoryFile(item.file)}
                        className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors ${item.file ? "hover:bg-surface-hover cursor-pointer" : "hover:bg-surface-hover/50"}`}>
                        <span className="text-[11px] font-medium text-text truncate">{item.label}</span>
                        {item.description && <span className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2">{item.description}</span>}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : (
        <AgentUIContent {...agentUI} />
      )}
    </div>
  );
}

export default AgentCanvas;
