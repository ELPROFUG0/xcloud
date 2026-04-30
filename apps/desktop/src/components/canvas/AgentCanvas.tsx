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
import { X, ArrowLeft, Layout, Code, Terminal, FolderOpen, Plus, RefreshCw, ExternalLink } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { TriggerNode } from "./nodes/TriggerNode";
import { ToolNode } from "./nodes/ToolNode";
import { AgentNode } from "./nodes/AgentNode";
import { IdentityNode } from "./nodes/IdentityNode";
import { MemoryNode } from "./nodes/MemoryNode";
import { SoulNode } from "./nodes/SoulNode";
import { ModelNode } from "./nodes/ModelNode";
import { SkillNode } from "./nodes/SkillNode";

interface AgentCanvasProps {
  engine: BrowserEngine;
  agentId: string;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: Array<{ id: string; label: string; description: string }>;
}

interface AgentData {
  identity: { name: string; emoji: string; creature: string; vibe: string };
  soul: { traits: string[] };
  model: { provider: string; model: string; contextWindow: number };
  tools: ToolGroup[];
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
  const get = (key: string) => {
    const m = content.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
    return m?.[1]?.trim() ?? "";
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

export function AgentCanvas({ engine, agentId }: AgentCanvasProps) {
  const [agentData, setAgentData] = useState<AgentData>({
    identity: { name: "", emoji: "", creature: "", vibe: "" },
    soul: { traits: [] },
    model: { provider: "", model: "", contextWindow: 0 },
    tools: [],
    skills: [],
    memoryFiles: [],
  });
  const [tab, setTab] = useState<"canvas" | "ui">("canvas");
  const [detail, setDetail] = useState<DetailPanel | null>(null);
  const [detailHistory, setDetailHistory] = useState<DetailPanel[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uiView, setUiView] = useState<"menu" | "create" | "preview">("menu");
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [devServerLoading, setDevServerLoading] = useState(false);

  const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;

  // Load agent data
  const loadData = useCallback(async () => {
    const data: AgentData = {
      identity: { name: agentId, emoji: "", creature: "", vibe: "" },
      soul: { traits: [] },
      model: { provider: "", model: "", contextWindow: 0 },
      tools: [],
      skills: [],
      memoryFiles: [],
    };

    try {
      const c = await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home });
      data.identity = parseIdentity(c);
    } catch { /* */ }

    try {
      const c = await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home });
      data.soul.traits = parseSoul(c);
    } catch { /* */ }

    try {
      const result = await engine.rpc("tools.catalog", {});
      data.tools = (result as { groups?: ToolGroup[] }).groups ?? [];
    } catch { /* */ }

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
      if (!primary) {
        primary = ((agents?.defaults as Record<string, unknown>)?.model as Record<string, unknown>)?.primary as string ?? "";
      }
      if (primary) {
        data.model = { provider: primary.split("/")[0] ?? "", model: primary, contextWindow: 200000 };
      }
    } catch { /* */ }

    try {
      const commands = await engine.listCommands();
      data.skills = commands.slice(0, 20).map((c) => ({ name: c.name, description: c.description ?? "" }));
    } catch { /* */ }

    for (const file of ["MEMORY.md", "HEARTBEAT.md", "USER.md", "TOOLS.md", "AGENTS.md"]) {
      try {
        const c = await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home });
        if (c.trim()) data.memoryFiles.push(file);
      } catch { /* */ }
    }

    setAgentData(data);
  }, [engine, agentId, wsPath]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // Navigate to a detail panel, pushing current to history
  const navigateTo = useCallback((panel: DetailPanel) => {
    setDetail((prev) => {
      if (prev) setDetailHistory((h) => [...h, prev]);
      return panel;
    });
  }, []);

  // Go back in history
  const goBack = useCallback(() => {
    setDetailHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setDetail(prev);
      return h.slice(0, -1);
    });
  }, []);

  // Close panel and clear history
  const closeDetail = useCallback(() => {
    setDetail(null);
    setDetailHistory([]);
  }, []);

  // Handle node click
  const onNodeClick = useCallback(async (_: unknown, node: Node) => {
    setDetailLoading(true);
    setDetailHistory([]);

    try {
      if (node.id === "identity") {
        const content = await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home }).catch(() => "No IDENTITY.md found");
        setDetail({ title: "Identity", type: "markdown", content });
      } else if (node.id === "soul") {
        const content = await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home }).catch(() => "No SOUL.md found");
        setDetail({ title: "Soul", type: "markdown", content });
      } else if (node.id === "memory") {
        setDetail({
          title: "Memory",
          type: "list",
          content: "",
          items: agentData.memoryFiles.map(f => ({ label: f, file: f })),
        });
      } else if (node.id === "skills") {
        setDetail({
          title: "Skills",
          type: "list",
          content: "",
          items: agentData.skills.map(s => ({ label: s.name, description: s.description })),
        });
      } else if (node.id === "model") {
        const m = agentData.model;
        setDetail({
          title: "Model",
          type: "info",
          content: `**Provider:** ${m.provider}\n\n**Model:** ${m.model}\n\n**Context Window:** ${m.contextWindow.toLocaleString()} tokens`,
        });
      } else if (node.id === "agent") {
        const content = await readTextFile(`${wsPath}/AGENTS.md`, { baseDir: BaseDirectory.Home }).catch(() => "No AGENTS.md found");
        setDetail({ title: "Agent Config", type: "markdown", content });
      } else {
        setDetail(null);
      }
    } catch {
      setDetail(null);
    }

    setDetailLoading(false);
  }, [wsPath, agentData]);

  // Load a memory file when clicked in the list
  const loadMemoryFile = useCallback(async (file: string) => {
    setDetailLoading(true);
    try {
      const content = await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home });
      navigateTo({ title: file, type: "markdown", content });
    } catch {
      navigateTo({ title: file, type: "markdown", content: "Failed to load file" });
    }
    setDetailLoading(false);
  }, [wsPath, navigateTo]);

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

    return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges };
  }, [agentId, agentData]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-bg px-3">
        <div className="flex rounded-lg border border-border text-[10px]">
          <button
            onClick={() => setTab("canvas")}
            className={`px-3 py-1 transition-colors ${tab === "canvas" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            Canvas
          </button>
          <button
            onClick={() => setTab("ui")}
            className={`px-3 py-1 transition-colors ${tab === "ui" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            UI
          </button>
        </div>

        {/* Preview controls in header */}
        {tab === "ui" && uiView === "preview" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted truncate max-w-[150px]">{repoPath?.split("/").pop()}</span>
            {devServerUrl && (
              <>
                <button onClick={() => setDevServerUrl(devServerUrl)} className="text-text-muted hover:text-text" title="Refresh">
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button
                  onClick={() => { import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(devServerUrl)).catch(() => {}); }}
                  className="text-text-muted hover:text-text" title="Open in browser"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </>
            )}
            <button onClick={() => { setUiView("menu"); setDevServerUrl(null); }} className="text-text-muted hover:text-text" title="Close preview">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {tab === "canvas" ? (
        <div className="flex flex-1 min-h-0">
          {/* Canvas */}
          <div className={detail ? "flex-1" : "w-full"}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              fitView
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{
                style: { stroke: "#27272a", strokeWidth: 1.5 },
                animated: true,
              }}
            >
              <Background color="#1c1c1f" gap={20} size={1} />
            </ReactFlow>
          </div>

          {/* Detail panel */}
          {detail && (
            <div className="w-[280px] shrink-0 border-l border-border bg-bg overflow-hidden flex flex-col">
              <div className="flex h-9 items-center justify-between border-b border-border px-3">
                <div className="flex items-center gap-1.5">
                  {detailHistory.length > 0 && (
                    <button onClick={goBack} className="text-text-muted hover:text-text">
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="text-[11px] font-medium text-text">{detail.title}</span>
                </div>
                <button onClick={closeDetail} className="text-text-muted hover:text-text">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {detailLoading ? (
                  <div className="text-xs text-text-muted">Loading...</div>
                ) : detail.type === "markdown" ? (
                  <div className="prose-chat text-[12px] leading-relaxed text-[#D4D4D4]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {detail.content}
                    </ReactMarkdown>
                  </div>
                ) : detail.type === "list" ? (
                  <div className="space-y-0.5">
                    {detail.items?.map((item) => (
                      <button
                        key={item.label}
                        onClick={() => item.file && loadMemoryFile(item.file)}
                        className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors ${
                          item.file ? "hover:bg-surface-hover cursor-pointer" : "hover:bg-surface-hover/50"
                        }`}
                      >
                        <span className="text-[11px] font-medium text-text truncate">{item.label}</span>
                        {item.description && (
                          <span className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2">{item.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : detail.type === "info" ? (
                  <div className="prose-chat text-[12px] leading-relaxed text-[#D4D4D4]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {detail.content}
                    </ReactMarkdown>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : (
        <UITab
          uiView={uiView}
          setUiView={setUiView}
          repoPath={repoPath}
          setRepoPath={setRepoPath}
          devServerUrl={devServerUrl}
          setDevServerUrl={setDevServerUrl}
          devServerLoading={devServerLoading}
          setDevServerLoading={setDevServerLoading}
          wsPath={wsPath}
        />
      )}
    </div>
  );
}

/** UI Tab — Open Repo, Create, or Preview */
function UITab({
  uiView, setUiView, repoPath, setRepoPath,
  devServerUrl, setDevServerUrl, devServerLoading, setDevServerLoading, wsPath,
}: {
  uiView: "menu" | "create" | "preview";
  setUiView: (v: "menu" | "create" | "preview") => void;
  repoPath: string | null;
  setRepoPath: (v: string | null) => void;
  devServerUrl: string | null;
  setDevServerUrl: (v: string | null) => void;
  devServerLoading: boolean;
  setDevServerLoading: (v: boolean) => void;
  wsPath: string;
}) {
  const selectRepo = async () => {
    const selected = await openDialog({ directory: true, title: "Select UI Project" });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : (selected as unknown as string);
    setRepoPath(path);
    setDevServerLoading(true);
    setUiView("preview");

    // Try to detect and start dev server
    const cleanPath = path.replace(/\/$/, "");
    try {
      // Read package.json using Tauri fs (works reliably)
      const pkgStr = await readTextFile(`${cleanPath}/package.json`).catch(() => "");

      if (pkgStr) {
        const pkg = JSON.parse(pkgStr);
        const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : null;

        if (script) {
          const port = 3100 + Math.floor(Math.random() * 900);

          // Start dev server via Rust command
          await invoke("spawn_shell", { cmd: `cd "${cleanPath}" && PORT=${port} npm run ${script}` }).catch(() => {});

          // Poll until server is ready
          let retries = 0;
          const checkReady = async () => {
            while (retries < 30) {
              try {
                const status = await invoke<string>("run_shell", { cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "0"` });
                const code = status.trim();
                if (code === "200" || code === "304" || code === "302") {
                  setDevServerUrl(`http://localhost:${port}`);
                  setDevServerLoading(false);
                  return;
                }
              } catch { /* */ }
              retries++;
              await new Promise(r => setTimeout(r, 1000));
            }
            setDevServerLoading(false);
          };
          checkReady();
          return;
        }
      }

      // Check for index.html
      const htmlContent = await readTextFile(`${cleanPath}/index.html`).catch(() => "");
      if (htmlContent) {
        setDevServerUrl(`file://${cleanPath}/index.html`);
        setDevServerLoading(false);
        return;
      }

      setDevServerLoading(false);
    } catch {
      setDevServerLoading(false);
    }
  };

  // Preview view
  if (uiView === "preview") {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1">
          {devServerLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <RefreshCw className="h-6 w-6 text-text-muted animate-spin mx-auto" />
                <p className="mt-3 text-xs text-text-muted">Starting dev server...</p>
                <p className="mt-1 text-[10px] text-text-muted">{repoPath?.split("/").pop()}</p>
              </div>
            </div>
          ) : devServerUrl ? (
            <iframe
              src={devServerUrl}
              className="w-full h-full border-0 bg-white"
              title="UI Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center px-8">
                <p className="text-xs text-text-muted">No dev server detected</p>
                <p className="mt-1 text-[10px] text-text-muted">Add a <code className="text-accent">dev</code> script to package.json or include an index.html</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Create view
  if (uiView === "create") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <button onClick={() => setUiView("menu")} className="absolute top-14 left-4 text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover">
          <Plus className="h-7 w-7 text-text-muted" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-sm font-medium text-text">Create UI</h3>
          <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
            Open the agent workspace in your editor to build its interface.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full max-w-[200px]">
          <button
            onClick={() => {
              const home = "/Users/contentmanager";
              window.open(`cursor://file${home}/${wsPath}`, "_blank");
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Code className="h-3.5 w-3.5" />
            Open with Cursor
          </button>
          <button
            onClick={() => {
              const home = "/Users/contentmanager";
              import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
                openUrl(`vscode://file${home}/${wsPath}`).catch(() => {});
              }).catch(() => {});
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Terminal className="h-3.5 w-3.5" />
            Open with Claude Code
          </button>
        </div>
        <p className="text-[10px] text-text-muted text-center leading-relaxed max-w-[240px]">
          Build the agent's UI without spending tokens.
        </p>
      </div>
    );
  }

  // Menu view (default)
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
        <Layout className="h-8 w-8 text-text-muted" />
      </div>
      <div className="text-center max-w-xs">
        <h3 className="text-sm font-medium text-text">Agent UI</h3>
        <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
          Connect an existing project or create a new interface for this agent.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[220px]">
        <button
          onClick={selectRepo}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open Repo
        </button>
        <button
          onClick={() => setUiView("create")}
          className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create
        </button>
      </div>
    </div>
  );
}

export default AgentCanvas;
