import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
// ReactMarkdown removed — detail panel moved to sidebar
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
// lucide icons removed — detail panel moved to sidebar
import { useAgentUI, AgentUIHeaderControls, AgentUIContent } from "./AgentUI";

export interface DetailPanel {
  title: string;
  type: "markdown" | "list" | "info";
  content: string;
  items?: Array<{ label: string; file?: string; description?: string }>;
}

interface AgentCanvasProps {
  engine: BrowserEngine;
  agentId: string;
  agentAvatar?: string;
  savedViewport?: { x: number; y: number; zoom: number };
  onViewportChange?: (vp: { x: number; y: number; zoom: number }) => void;
  onNodeDetail?: (detail: DetailPanel | null) => void;
}

interface AgentData {
  identity: { name: string; emoji: string; creature: string; vibe: string };
  soul: { traits: string[] };
  model: { provider: string; model: string; contextWindow: number };
  skills: Array<{ name: string; description: string }>;
  memoryFiles: string[];
  integrations: string[];
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
  integrations: "#4EDD44",
  "ui-repo": "#3b82f6",
};

function isPlaceholder(v: string): boolean {
  if (!v) return true;
  if (v.startsWith("_(")) return true;
  if (v.includes("pick something") || v.includes("pick one") || v.includes("fill this")) return true;
  if (v.includes("workspace-relative") || v.includes("data URI") || v.includes("feels right")) return true;
  return false;
}

function parseIdentity(content: string) {
  const get = (key: string) => {
    const m = content.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
    const v = m?.[1]?.trim() ?? "";
    return isPlaceholder(v) ? "" : v;
  };
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

export function AgentCanvas({ engine, agentId, agentAvatar, onNodeDetail }: AgentCanvasProps) {
  const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  const [agentData, setAgentData] = useState<AgentData>({
    identity: { name: "", emoji: "", creature: "", vibe: "" },
    soul: { traits: [] },
    model: { provider: "", model: "", contextWindow: 0 },
    skills: [],
    memoryFiles: [],
    integrations: (() => { try { return JSON.parse(localStorage.getItem("composioConnected") ?? "[]"); } catch { return []; } })(),
  });
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const draggingNode = useRef<string | null>(null);
  const hoverIntensity = useRef(0);
  const labelOffsets = useRef<Record<string, number>>({});
  const animFrameRef = useRef<number>(0);
  const [, forceRender] = useState(0);
  const avatarImg = useRef<HTMLImageElement | null>(null);
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  // Load avatar image
  useEffect(() => {
    if (!agentAvatar) { avatarImg.current = null; setAvatarLoaded(false); return; }
    const img = new Image();
    img.onload = () => { avatarImg.current = img; setAvatarLoaded(true); };
    img.onerror = () => { avatarImg.current = null; };
    img.src = agentAvatar;
  }, [agentAvatar]);

  // Animate hover intensity — force repaints during transition
  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      const target = hoveredNode ? 1 : 0;
      const prev = hoverIntensity.current;
      hoverIntensity.current += (target - prev) * 0.1;
      if (Math.abs(hoverIntensity.current - target) > 0.005) {
        forceRender((c) => c + 1);
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        hoverIntensity.current = target;
        forceRender((c) => c + 1);
      }
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
  }, [hoveredNode]);

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
      integrations: JSON.parse(localStorage.getItem("composioConnected") ?? "[]"),
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

  // Refresh on agent lifecycle end, config change, or reconnect
  useEffect(() => {
    const unsubEvent = engine.onEvent((frame) => {
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && data?.phase === "end") loadData();
      }
      if (event === "config.changed" || event === "config.patched") {
        loadData();
      }
    });
    // Reload data when engine reconnects
    const unsubState = engine.onStateChange((state) => {
      if (state === "connected") loadData();
    });
    // Update model node instantly when model changes (without waiting for gateway)
    const onModelChanged = (e: Event) => {
      const modelId = (e as CustomEvent).detail as string;
      setAgentData((prev) => ({
        ...prev,
        model: { ...prev.model, model: modelId, provider: modelId.split("/")[0] ?? "" },
      }));
    };
    const onIntegrationChanged = () => {
      setAgentData((prev) => ({
        ...prev,
        integrations: JSON.parse(localStorage.getItem("composioConnected") ?? "[]"),
      }));
    };
    window.addEventListener("xcloud-model-changed", onModelChanged);
    window.addEventListener("xcloud-integration-changed", onIntegrationChanged);
    return () => {
      unsubEvent(); unsubState();
      window.removeEventListener("xcloud-model-changed", onModelChanged);
      window.removeEventListener("xcloud-integration-changed", onIntegrationChanged);
    };
  }, [engine, loadData]);

  // Node click handler — sends detail to sidebar via callback
  const onNodeClick = useCallback(async (node: GraphNode) => {
    if (!onNodeDetail) return;
    try {
      if (node.id === "identity") {
        onNodeDetail({ title: "Identity", type: "markdown", content: await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home }).catch(() => "No IDENTITY.md") });
      } else if (node.id === "soul") {
        onNodeDetail({ title: "Soul", type: "markdown", content: await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home }).catch(() => "No SOUL.md") });
      } else if (node.id === "memory" || node.id.startsWith("memory-")) {
        const file = node.id.startsWith("memory-") ? node.id.slice(7) : null;
        if (file) {
          try {
            onNodeDetail({ title: file, type: "markdown", content: await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home }) });
          } catch {
            onNodeDetail({ title: file, type: "markdown", content: "Failed to load file" });
          }
        } else {
          onNodeDetail({ title: "Memory", type: "list", content: "", items: agentData.memoryFiles.map(f => ({ label: f })) });
        }
      } else if (node.id === "skills" || node.id.startsWith("skill-")) {
        const skillName = node.id.startsWith("skill-") ? node.id.slice(6) : null;
        if (skillName) {
          const skill = agentData.skills.find(s => s.name === skillName);
          onNodeDetail({ title: skillName, type: "info", content: skill?.description || "No description" });
        } else {
          onNodeDetail({ title: "Skills", type: "list", content: "", items: agentData.skills.map(s => ({ label: s.name, description: s.description })) });
        }
      } else if (node.id === "model") {
        const m = agentData.model;
        onNodeDetail({ title: "Model", type: "info", content: `**Provider:** ${m.provider}\n\n**Model:** ${m.model}\n\n**Context Window:** ${m.contextWindow.toLocaleString()} tokens` });
      } else if (node.id === "agent") {
        onNodeDetail({ title: "Agent Config", type: "markdown", content: await readTextFile(`${wsPath}/AGENTS.md`, { baseDir: BaseDirectory.Home }).catch(() => "No AGENTS.md") });
      } else if (node.id === "ui-repo") {
        setTab("ui");
        agentUI.launchPreview();
      } else if (node.id.startsWith("trait-")) {
        // traits don't have detail
      }
    } catch { /* */ }
  }, [wsPath, agentData, agentUI, onNodeDetail]);

  // Build graph data
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    nodes.push({ id: "agent", label: agentData.identity.name || agentId, color: NODE_COLORS.agent!, size: 10, isCenter: true, emoji: agentData.identity.emoji || undefined });
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
    agentData.integrations.forEach((slug) => {
      const label = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, " ");
      nodes.push({ id: `int-${slug}`, label, color: NODE_COLORS.integrations!, size: 5 });
      links.push({ source: "agent", target: `int-${slug}` });
    });
    if (agentUI.repoPath) {
      nodes.push({ id: "ui-repo", label: "UI", color: NODE_COLORS["ui-repo"]!, size: 5 });
      links.push({ source: "agent", target: "ui-repo" });
    }

    return { nodes, links };
  }, [agentId, agentData, agentUI.repoPath]);

  // Build neighbor set for hovered node
  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const set = new Set<string>();
    set.add(hoveredNode);
    graphData.links.forEach((link) => {
      const s = typeof link.source === "object" ? (link.source as any).id : link.source;
      const t = typeof link.target === "object" ? (link.target as any).id : link.target;
      if (s === hoveredNode) set.add(t);
      if (t === hoveredNode) set.add(s);
    });
    return set;
  }, [hoveredNode, graphData.links]);

  // Custom node rendering
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode & { x: number; y: number };
    const isLeaf = n.size <= 3;
    const isBranch = n.size >= 5 && n.size <= 6;
    const r = n.isCenter ? 10 : isBranch ? 6 : isLeaf ? 3.5 : 6;
    const isHovered = hoveredNode === n.id;
    const isConnected = connectedNodes.has(n.id);

    // Determine brightness based on hover state
    const t = hoverIntensity.current;
    const isDimmed = hoveredNode && !isHovered && !isConnected;

    let brightness: number;
    if (isHovered) {
      brightness = n.isCenter ? 255 : isBranch ? 245 : 236;
    } else if (isConnected && hoveredNode) {
      brightness = n.isCenter ? 250 : isBranch ? 235 : 225;
    } else if (isDimmed) {
      const normal = n.isCenter ? 240 : isBranch ? 224 : 208;
      const dimmed = n.isCenter ? 80 : isBranch ? 60 : 45;
      brightness = Math.round(normal + (dimmed - normal) * t);
    } else {
      brightness = n.isCenter ? 240 : isBranch ? 224 : 208;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    ctx.fill();

    // Avatar or emoji on center node
    if (n.isCenter) {
      if (avatarLoaded && avatarImg.current) {
        // Clip to circle and draw image
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r - 1, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(avatarImg.current, n.x - r + 1, n.y - r + 1, (r - 1) * 2, (r - 1) * 2);
        ctx.restore();
      } else if (n.emoji) {
        ctx.font = `${r * 1.2}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.emoji, n.x, n.y);
      }
    }

    // Label — hide when zoomed out
    if (globalScale > 0.4) {
      // Animate label slide: target is 0 when visible (hovered/connected), -1.5 when hidden
      const targetOffset = (isHovered || (isConnected && hoveredNode)) ? 0 : hoveredNode ? -1.5 : 0;
      const prev = labelOffsets.current[n.id] ?? 0;
      const offset = prev + (targetOffset - prev) * 0.15;
      labelOffsets.current[n.id] = offset;

      const labelAlpha = isHovered ? 1 : (isConnected && hoveredNode) ? 0.85 : isDimmed ? Math.max(0, 1 - t * 0.8) : 1;

      const fontSize = n.isCenter ? 4 : isBranch ? 3.5 : 3;
      ctx.font = `${isLeaf ? "400" : "500"} ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      let labelBrightness: number;
      if (isHovered) {
        labelBrightness = 240;
      } else if (isConnected && hoveredNode) {
        labelBrightness = 210;
      } else if (isDimmed) {
        const normalL = isLeaf ? 136 : 187;
        const dimmedL = 40;
        labelBrightness = Math.round(normalL + (dimmedL - normalL) * t);
      } else {
        labelBrightness = isLeaf ? 170 : 210;
      }
      ctx.globalAlpha = labelAlpha;
      ctx.fillStyle = `rgb(${labelBrightness}, ${labelBrightness}, ${labelBrightness})`;
      ctx.fillText(n.label, n.x, n.y + r + 2 + offset);
      ctx.globalAlpha = 1;
    }
  }, [hoveredNode, connectedNodes]);

  // Configure forces when graph ref is ready
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    // Vary link distance so child nodes don't overlap
    fg.d3Force("link")?.distance((link: any, i: number) => {
      const t = typeof link.target === "object" ? link.target.id : link.target;
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const isIntegration = t.startsWith("int-") || s.startsWith("int-");
      if (isIntegration) return 50 + (i % 3) * 8;
      const isLeafLink = t.includes("-") || s.includes("-");
      return isLeafLink ? 18 + (i % 3) * 6 : 30;
    });
    fg.d3Force("charge")?.strength(-60);
  });

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
          <div ref={containerRef} className="w-full">
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
              linkColor={(link: any) => {
                if (!hoveredNode) return "#3a3a3a";
                const s = typeof link.source === "object" ? link.source.id : link.source;
                const t = typeof link.target === "object" ? link.target.id : link.target;
                if (s === hoveredNode || t === hoveredNode) return "#888888";
                return "#2a2a2a";
              }}
              linkWidth={1}
              linkCurvature={0}
              onNodeClick={(node: any) => onNodeClick(node as GraphNode)}
              onNodeHover={(node: any) => {
                if (!draggingNode.current) setHoveredNode(node ? (node as GraphNode).id : null);
              }}
              onNodeDrag={(node: any) => {
                draggingNode.current = (node as GraphNode).id;
                setHoveredNode((node as GraphNode).id);
              }}
              onNodeDragEnd={() => {
                draggingNode.current = null;
              }}
              cooldownTicks={100}
              d3AlphaDecay={0.04}
              d3VelocityDecay={0.3}
              enableZoomInteraction={true}
              enablePanInteraction={true}
            />
          </div>
        </div>
      ) : (
        <AgentUIContent {...agentUI} />
      )}
    </div>
  );
}

export default AgentCanvas;
