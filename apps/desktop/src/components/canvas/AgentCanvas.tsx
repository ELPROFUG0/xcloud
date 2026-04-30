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
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
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
  skills: string[];
  memoryFiles: string[];
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

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });
}

/** Parse IDENTITY.md */
function parseIdentity(content: string) {
  const get = (key: string) => {
    const m = content.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, "i"));
    return m?.[1]?.trim() ?? "";
  };
  return { name: get("Name"), emoji: get("Emoji"), creature: get("Creature"), vibe: get("Vibe") };
}

/** Parse SOUL.md — extract core traits */
function parseSoul(content: string): string[] {
  const traits: string[] = [];
  const matches = content.matchAll(/\*\*([^*]+)\*\*/g);
  for (const m of matches) {
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
  const [tab, setTab] = useState<"canvas" | "logs">("canvas");

  // Load all agent data
  const loadData = useCallback(async () => {
    // Workspace path: main uses root, others use subfolder
    const wsPath = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;

    const data: AgentData = {
      identity: { name: agentId, emoji: "", creature: "", vibe: "" },
      soul: { traits: [] },
      model: { provider: "", model: "", contextWindow: 0 },
      tools: [],
      skills: [],
      memoryFiles: [],
    };

    // Identity
    try {
      const content = await readTextFile(`${wsPath}/IDENTITY.md`, { baseDir: BaseDirectory.Home });
      data.identity = parseIdentity(content);
    } catch { /* */ }

    // Soul
    try {
      const content = await readTextFile(`${wsPath}/SOUL.md`, { baseDir: BaseDirectory.Home });
      data.soul.traits = parseSoul(content);
    } catch { /* */ }

    // Tools
    try {
      const result = await engine.rpc("tools.catalog", {});
      data.tools = (result as { groups?: ToolGroup[] }).groups ?? [];
    } catch { /* */ }

    // Model from config
    try {
      const result = await engine.rpc("config.get", {});
      const config = (result as { config?: Record<string, unknown> }).config ?? result;
      const agents = config.agents as Record<string, unknown> | undefined;

      // Check agent-specific model first, then defaults
      let primary = "";
      const agentList = agents?.list as Array<Record<string, unknown>> | undefined;
      if (agentList) {
        const thisAgent = agentList.find(a => a.id === agentId);
        const agentModel = thisAgent?.model as Record<string, unknown> | undefined;
        primary = (agentModel?.primary as string) ?? "";
      }
      if (!primary) {
        const defaults = agents?.defaults as Record<string, unknown> | undefined;
        const modelConfig = defaults?.model as Record<string, unknown> | undefined;
        primary = (modelConfig?.primary as string) ?? "";
      }

      if (primary) {
        const parts = primary.split("/");
        data.model = { provider: parts[0] ?? "", model: primary, contextWindow: 200000 };
      }
    } catch { /* */ }

    // Commands/Skills
    try {
      const commands = await engine.listCommands();
      data.skills = commands.slice(0, 20).map((c) => c.name);
    } catch { /* */ }

    // Memory files
    for (const file of ["MEMORY.md", "HEARTBEAT.md", "USER.md", "TOOLS.md"]) {
      try {
        const content = await readTextFile(`${wsPath}/${file}`, { baseDir: BaseDirectory.Home });
        if (content.trim()) data.memoryFiles.push(file);
      } catch { /* */ }
    }

    setAgentData(data);
  }, [engine, agentId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh on agent lifecycle end
  useEffect(() => {
    const unsub = engine.onEvent((frame) => {
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && data?.phase === "end") {
          loadData();
        }
      }
    });
    return unsub;
  }, [engine, loadData]);

  // Build graph
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    // Trigger
    rawNodes.push({
      id: "trigger",
      type: "trigger",
      data: { label: "Chat", triggerType: "conversation" },
      position: { x: 0, y: 0 },
    });

    // Agent (center)
    rawNodes.push({
      id: "agent",
      type: "agent",
      data: { label: agentData.identity.name || agentId, status: "active" },
      position: { x: 0, y: 0 },
    });
    rawEdges.push({ id: "e-trigger-agent", source: "trigger", target: "agent" });

    // Identity
    rawNodes.push({
      id: "identity",
      type: "identity",
      data: agentData.identity,
      position: { x: 0, y: 0 },
    });
    rawEdges.push({ id: "e-agent-identity", source: "agent", target: "identity" });

    // Model
    if (agentData.model.model) {
      rawNodes.push({
        id: "model",
        type: "model",
        data: agentData.model,
        position: { x: 0, y: 0 },
      });
      rawEdges.push({ id: "e-agent-model", source: "agent", target: "model" });
    }

    // Soul
    if (agentData.soul.traits.length > 0) {
      rawNodes.push({
        id: "soul",
        type: "soul",
        data: { label: "Soul", traits: agentData.soul.traits },
        position: { x: 0, y: 0 },
      });
      rawEdges.push({ id: "e-agent-soul", source: "agent", target: "soul" });
    }

    // Memory
    if (agentData.memoryFiles.length > 0) {
      rawNodes.push({
        id: "memory",
        type: "memory",
        data: { label: "Memory", files: agentData.memoryFiles },
        position: { x: 0, y: 0 },
      });
      rawEdges.push({ id: "e-agent-memory", source: "agent", target: "memory" });
    }

    // Skills
    if (agentData.skills.length > 0) {
      rawNodes.push({
        id: "skills",
        type: "skill",
        data: { label: "Skills", count: agentData.skills.length, skills: agentData.skills },
        position: { x: 0, y: 0 },
      });
      rawEdges.push({ id: "e-agent-skills", source: "agent", target: "skills" });
    }

    return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges };
  }, [agentId, agentData]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg px-3">
        <div className="flex rounded-lg border border-border text-[10px]">
          <button
            onClick={() => setTab("canvas")}
            className={`px-3 py-1 transition-colors ${tab === "canvas" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            Canvas
          </button>
          <button
            onClick={() => setTab("logs")}
            className={`px-3 py-1 transition-colors ${tab === "logs" ? "bg-surface-hover text-text" : "text-text-muted"}`}
          >
            Logs
          </button>
        </div>
      </div>

      {tab === "canvas" ? (
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-text-muted">Agent logs will appear here during execution.</p>
        </div>
      )}
    </div>
  );
}

export default AgentCanvas;
