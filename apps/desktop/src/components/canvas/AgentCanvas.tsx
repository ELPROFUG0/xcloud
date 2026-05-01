import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { X, ArrowLeft } from "lucide-react";
import { TriggerNode } from "./nodes/TriggerNode";
import { ToolNode } from "./nodes/ToolNode";
import { AgentNode } from "./nodes/AgentNode";
import { IdentityNode } from "./nodes/IdentityNode";
import { MemoryNode } from "./nodes/MemoryNode";
import { SoulNode } from "./nodes/SoulNode";
import { ModelNode } from "./nodes/ModelNode";
import { SkillNode } from "./nodes/SkillNode";
import { UINode } from "./nodes/UINode";
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

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  tool: ToolNode,
  agent: AgentNode,
  identity: IdentityNode,
  memory: MemoryNode,
  soul: SoulNode,
  model: ModelNode,
  skill: SkillNode,
  ui: UINode,
};

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 70, nodesep: 30 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }, sourcePosition: Position.Bottom, targetPosition: Position.Top };
  });
}

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

export function AgentCanvas({ engine, agentId, savedViewport, onViewportChange }: AgentCanvasProps) {
  const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;

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

  // Agent UI state
  const agentUI = useAgentUI(agentId, wsPath);

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
  const onNodeClick = useCallback(async (_: unknown, node: Node) => {
    setDetailLoading(true);
    setDetailHistory([]);
    try {
      if (node.id === "identity") {
        setDetail({ title: "Identity", type: "markdown", content: await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home }).catch(() => "No IDENTITY.md") });
      } else if (node.id === "soul") {
        setDetail({ title: "Soul", type: "markdown", content: await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home }).catch(() => "No SOUL.md") });
      } else if (node.id === "memory") {
        setDetail({ title: "Memory", type: "list", content: "", items: agentData.memoryFiles.map(f => ({ label: f, file: f })) });
      } else if (node.id === "skills") {
        setDetail({ title: "Skills", type: "list", content: "", items: agentData.skills.map(s => ({ label: s.name, description: s.description })) });
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

  // Build graph
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    rawNodes.push({ id: "trigger", type: "trigger", data: { label: "Chat", triggerType: "conversation" }, position: { x: 0, y: 0 } });
    rawNodes.push({ id: "agent", type: "agent", data: { label: agentData.identity.name || agentId, status: "active" }, position: { x: 0, y: 0 } });
    rawEdges.push({ id: "e-trigger-agent", source: "trigger", target: "agent" });

    rawNodes.push({ id: "identity", type: "identity", data: agentData.identity, position: { x: 0, y: 0 } });
    rawEdges.push({ id: "e-agent-identity", source: "agent", target: "identity" });

    if (agentData.model.model) {
      rawNodes.push({ id: "model", type: "model", data: agentData.model, position: { x: 0, y: 0 } });
      rawEdges.push({ id: "e-agent-model", source: "agent", target: "model" });
    }
    if (agentData.soul.traits.length > 0) {
      rawNodes.push({ id: "soul", type: "soul", data: { label: "Soul", traits: agentData.soul.traits }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: "e-agent-soul", source: "agent", target: "soul" });
    }
    if (agentData.memoryFiles.length > 0) {
      rawNodes.push({ id: "memory", type: "memory", data: { label: "Memory", files: agentData.memoryFiles }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: "e-agent-memory", source: "agent", target: "memory" });
    }
    if (agentData.skills.length > 0) {
      rawNodes.push({ id: "skills", type: "skill", data: { label: "Skills", count: agentData.skills.length, skills: agentData.skills.map(s => s.name) }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: "e-agent-skills", source: "agent", target: "skills" });
    }
    if (agentUI.repoPath) {
      rawNodes.push({ id: "ui-repo", type: "ui", data: { label: "UI", repoName: agentUI.repoPath.split("/").pop() ?? "repo", status: agentUI.devServerUrl ? "connected" : "disconnected" }, position: { x: 0, y: 0 } });
      rawEdges.push({ id: "e-agent-ui", source: "agent", target: "ui-repo" });
    }

    return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges };
  }, [agentId, agentData, agentUI.repoPath, agentUI.devServerUrl]);

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
        <div className="flex flex-1 min-h-0" style={{ opacity: dataLoaded ? 1 : 0 }}>
          <div className={detail ? "flex-1" : "w-full"}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ style: { stroke: "#27272a", strokeWidth: 1.5 }, animated: true }}
              defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
              onInit={(instance) => {
                if (!savedViewport) {
                  instance.fitView();
                }
              }}
              onMoveEnd={(_, viewport) => { onViewportChange?.(viewport); }}
            >
              <Background color="#1c1c1f" gap={20} size={1} />
            </ReactFlow>
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
