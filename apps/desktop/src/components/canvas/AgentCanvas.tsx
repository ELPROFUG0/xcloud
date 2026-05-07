import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
// ReactMarkdown removed — detail panel moved to sidebar
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import orbOverlayUrl from "@/assets/orb-overlay.png?url";
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
  onCanvasSettings?: () => void;
}

interface AgentData {
  identity: { name: string; emoji: string; creature: string; vibe: string };
  soul: { traits: string[] };
  model: { provider: string; model: string; contextWindow: number };
  skills: Array<{ name: string; description: string }>;
  memoryFiles: string[];
  integrations: Array<{ slug: string; logo: string }>;
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

export function AgentCanvas({ engine, agentId, agentAvatar, onNodeDetail, onCanvasSettings }: AgentCanvasProps) {
  const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  const [agentData, setAgentData] = useState<AgentData>({
    identity: { name: "", emoji: "", creature: "", vibe: "" },
    soul: { traits: [] },
    model: { provider: "", model: "", contextWindow: 0 },
    skills: [],
    memoryFiles: [],
    integrations: (() => { try { const d = JSON.parse(localStorage.getItem("composioConnected") ?? "[]"); return d.map((i: unknown) => typeof i === "string" ? { slug: i, logo: "" } : i); } catch { return []; } })(),
  });
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const [showLabels, setShowLabels] = useState(() => localStorage.getItem("canvasShowLabels") !== "false");
  const [useOrbs, setUseOrbs] = useState(() => localStorage.getItem("canvasUseOrbs") === "true");
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
  const orbImg = useRef<HTMLImageElement | null>(null);
  const integrationLogos = useRef<Record<string, HTMLImageElement>>({});

  // Load orb image
  useEffect(() => {
    const img = new Image();
    img.onload = () => { orbImg.current = img; };
    img.src = orbOverlayUrl;
  }, []);

  // Load integration logos from localStorage data URLs
  useEffect(() => {
    for (const app of agentData.integrations) {
      if (!app.logo || integrationLogos.current[app.slug]) continue;
      const img = new Image();
      img.onload = () => { integrationLogos.current[app.slug] = img; };
      img.src = app.logo;
    }
  }, [agentData.integrations]);

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
      integrations: (() => { try { const d = JSON.parse(localStorage.getItem("composioConnected") ?? "[]"); return d.map((i: unknown) => typeof i === "string" ? { slug: i, logo: "" } : i); } catch { return []; } })(),
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
      const detail = (e as CustomEvent).detail as string | { agentId?: string | null; modelId?: string };
      const eventAgentId = typeof detail === "string" ? null : detail.agentId;
      const modelId = typeof detail === "string" ? detail : detail.modelId;
      if (!modelId || (eventAgentId && eventAgentId !== agentId)) return;
      setAgentData((prev) => ({
        ...prev,
        model: { ...prev.model, model: modelId, provider: modelId.split("/")[0] ?? "" },
      }));
    };
    const onIntegrationChanged = () => {
      setAgentData((prev) => ({
        ...prev,
        integrations: (() => { try { const d = JSON.parse(localStorage.getItem("composioConnected") ?? "[]"); return d.map((i: unknown) => typeof i === "string" ? { slug: i, logo: "" } : i); } catch { return []; } })(),
      }));
    };
    const onCanvasSettingsChanged = () => {
      setShowLabels(localStorage.getItem("canvasShowLabels") !== "false");
      setUseOrbs(localStorage.getItem("canvasUseOrbs") === "true");
      // Force canvas repaint
      if (graphRef.current) {
        graphRef.current.d3ReheatSimulation();
      }
    };
    window.addEventListener("xcloud-model-changed", onModelChanged);
    window.addEventListener("xcloud-integration-changed", onIntegrationChanged);
    window.addEventListener("xcloud-canvas-settings", onCanvasSettingsChanged);
    return () => {
      unsubEvent(); unsubState();
      window.removeEventListener("xcloud-model-changed", onModelChanged);
      window.removeEventListener("xcloud-integration-changed", onIntegrationChanged);
      window.removeEventListener("xcloud-canvas-settings", onCanvasSettingsChanged);
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
    const seenIntegrations = new Set<string>();
    agentData.integrations.forEach((app) => {
      if (seenIntegrations.has(app.slug)) return;
      seenIntegrations.add(app.slug);
      const label = app.slug.charAt(0).toUpperCase() + app.slug.slice(1).replace(/_/g, " ");
      nodes.push({ id: `int-${app.slug}`, label, color: NODE_COLORS.integrations!, size: 5 });
      links.push({ source: "agent", target: `int-${app.slug}` });
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

    // Orb node
    if (useOrbs && orbImg.current) {
      const orbSize = r * 3.5;
      // Background circle to blend with canvas bg
      ctx.beginPath();
      ctx.arc(n.x, n.y, orbSize / 2, 0, 2 * Math.PI);
      ctx.fillStyle = "#141414";
      ctx.fill();
      // Orb overlay
      ctx.globalAlpha = brightness / 255;
      ctx.drawImage(orbImg.current, n.x - orbSize / 2, n.y - orbSize / 2, orbSize, orbSize);
      ctx.globalAlpha = 1;
    } else {
      // Classic white circle with hover dimming
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
      ctx.fill();
    }

    // Avatar or emoji on center node (only in orb mode)
    if (useOrbs && n.isCenter) {
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

    // Branch node icons (only in orb mode)
    const iconNodes = ["trigger", "identity", "model", "soul", "memory", "skills"];
    if (useOrbs && iconNodes.includes(n.id) && !n.isCenter) {
      const s = r * 0.7;
      ctx.strokeStyle = "white";
      ctx.fillStyle = "white";
      ctx.lineWidth = s * 0.15;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (n.id === "trigger") {
        // Chat bubble
        ctx.beginPath();
        ctx.moveTo(n.x - s, n.y - s * 0.7);
        ctx.lineTo(n.x + s, n.y - s * 0.7);
        ctx.quadraticCurveTo(n.x + s * 1.2, n.y - s * 0.7, n.x + s * 1.2, n.y - s * 0.2);
        ctx.lineTo(n.x + s * 1.2, n.y + s * 0.3);
        ctx.quadraticCurveTo(n.x + s * 1.2, n.y + s * 0.7, n.x + s * 0.7, n.y + s * 0.7);
        ctx.lineTo(n.x - s * 0.2, n.y + s * 0.7);
        ctx.lineTo(n.x - s * 0.7, n.y + s * 1.1);
        ctx.lineTo(n.x - s * 0.7, n.y + s * 0.7);
        ctx.quadraticCurveTo(n.x - s * 1.2, n.y + s * 0.7, n.x - s * 1.2, n.y + s * 0.2);
        ctx.lineTo(n.x - s * 1.2, n.y - s * 0.2);
        ctx.quadraticCurveTo(n.x - s * 1.2, n.y - s * 0.7, n.x - s, n.y - s * 0.7);
        ctx.stroke();
      } else if (n.id === "identity") {
        // Person
        ctx.beginPath();
        ctx.arc(n.x, n.y - s * 0.4, s * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y + s * 1.1, s * 0.9, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
      } else if (n.id === "model") {
        // CPU/chip
        ctx.strokeRect(n.x - s * 0.5, n.y - s * 0.5, s, s);
        for (let i = -1; i <= 1; i += 2) {
          ctx.beginPath(); ctx.moveTo(n.x + i * s * 0.5, n.y - s * 0.8); ctx.lineTo(n.x + i * s * 0.5, n.y - s * 0.5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(n.x + i * s * 0.5, n.y + s * 0.5); ctx.lineTo(n.x + i * s * 0.5, n.y + s * 0.8); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(n.x - s * 0.8, n.y + i * s * 0.25); ctx.lineTo(n.x - s * 0.5, n.y + i * s * 0.25); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(n.x + s * 0.5, n.y + i * s * 0.25); ctx.lineTo(n.x + s * 0.8, n.y + i * s * 0.25); ctx.stroke();
        }
      } else if (n.id === "soul") {
        // Heart
        ctx.beginPath();
        ctx.moveTo(n.x, n.y + s * 0.7);
        ctx.bezierCurveTo(n.x - s * 1.2, n.y - s * 0.2, n.x - s * 0.6, n.y - s * 1, n.x, n.y - s * 0.3);
        ctx.bezierCurveTo(n.x + s * 0.6, n.y - s * 1, n.x + s * 1.2, n.y - s * 0.2, n.x, n.y + s * 0.7);
        ctx.stroke();
      } else if (n.id === "memory") {
        // Brain/database
        ctx.beginPath();
        ctx.ellipse(n.x, n.y - s * 0.5, s * 0.7, s * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(n.x - s * 0.7, n.y - s * 0.5); ctx.lineTo(n.x - s * 0.7, n.y + s * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(n.x + s * 0.7, n.y - s * 0.5); ctx.lineTo(n.x + s * 0.7, n.y + s * 0.5); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, s * 0.7, s * 0.3, 0, 0, Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(n.x, n.y + s * 0.5, s * 0.7, s * 0.3, 0, 0, Math.PI);
        ctx.stroke();
      } else if (n.id === "skills") {
        // Sparkle/star
        const pts = 4;
        ctx.beginPath();
        for (let i = 0; i < pts * 2; i++) {
          const angle = (i * Math.PI) / pts - Math.PI / 2;
          const dist = i % 2 === 0 ? s * 0.8 : s * 0.3;
          const px = n.x + Math.cos(angle) * dist;
          const py = n.y + Math.sin(angle) * dist;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Integration logo masked to squircle (only in orb mode)
    if (useOrbs && n.id.startsWith("int-")) {
      const slug = n.id.slice(4);
      const logo = integrationLogos.current[slug];
      if (logo) {
        const s = r * 1.8;
        const cr = s * 0.25;
        const x = n.x - s / 2;
        const y = n.y - s / 2;
        ctx.save();
        // Squircle mask
        ctx.beginPath();
        ctx.moveTo(x + cr, y);
        ctx.arcTo(x + s, y, x + s, y + s, cr);
        ctx.arcTo(x + s, y + s, x, y + s, cr);
        ctx.arcTo(x, y + s, x, y, cr);
        ctx.arcTo(x, y, x + s, y, cr);
        ctx.closePath();
        ctx.clip();
        // Draw logo filling the entire mask
        ctx.drawImage(logo, x, y, s, s);
        ctx.restore();
      }
    }

    // Label — hide when zoomed out or labels disabled
    if (showLabels && globalScale > 0.4) {
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
  }, [hoveredNode, connectedNodes, showLabels, useOrbs]);

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
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg px-3 gap-2">
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
        <div className="flex-1" />
        {tab === "ui" && <AgentUIHeaderControls uiView={agentUI.uiView} repoPath={agentUI.repoPath} devServerUrl={agentUI.devServerUrl} setUiView={agentUI.setUiView} />}
      </div>

      {/* Content */}
      {tab === "canvas" ? (
        <div className="relative flex flex-1 min-h-0" style={{ opacity: dataLoaded ? 1 : 0, transition: "opacity 300ms" }}>
          {onCanvasSettings && (
            <button
              onClick={onCanvasSettings}
              className="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-[#1F1F1F] text-white transition-colors hover:bg-[#2a2a2a]"
              title="Canvas settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z" strokeLinecap="round" />
                <path d="M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z" />
              </svg>
            </button>
          )}
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
