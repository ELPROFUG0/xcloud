import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { BrowserEngine } from "@/lib/engine";
import { TriggerNode } from "./nodes/TriggerNode";
import { ToolNode } from "./nodes/ToolNode";
import { AgentNode } from "./nodes/AgentNode";

interface AgentCanvasProps {
  engine: BrowserEngine;
  agentId: string;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: Array<{ id: string; label: string; description: string }>;
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  tool: ToolNode,
  agent: AgentNode,
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;

function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40 });

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

export function AgentCanvas({ engine, agentId }: AgentCanvasProps) {
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [tab, setTab] = useState<"canvas" | "logs">("canvas");

  // Fetch tools for this agent
  useEffect(() => {
    async function load() {
      try {
        const result = await engine.rpc("tools.catalog", {});
        const groups = (result as { groups?: ToolGroup[] }).groups ?? [];
        setToolGroups(groups);
      } catch {
        // Ignore errors
      }
    }
    load();
  }, [engine, agentId]);

  // Build graph from tools
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    // Agent node (center)
    rawNodes.push({
      id: "agent",
      type: "agent",
      data: { label: agentId, status: "active" },
      position: { x: 0, y: 0 },
    });

    // Trigger node
    rawNodes.push({
      id: "trigger-chat",
      type: "trigger",
      data: { label: "Chat", triggerType: "conversation" },
      position: { x: 0, y: 0 },
    });
    rawEdges.push({ id: "e-trigger-agent", source: "trigger-chat", target: "agent" });

    // Tool group nodes
    toolGroups.forEach((group) => {
      const nodeId = `group-${group.id}`;
      rawNodes.push({
        id: nodeId,
        type: "tool",
        data: {
          label: group.label,
          tools: group.tools.map((t) => t.id),
          count: group.tools.length,
        },
        position: { x: 0, y: 0 },
      });
      rawEdges.push({ id: `e-agent-${group.id}`, source: "agent", target: nodeId });
    });

    const laidOut = layoutGraph(rawNodes, rawEdges);
    return { nodes: laidOut, edges: rawEdges };
  }, [agentId, toolGroups]);

  return (
    <div className="flex h-full flex-col">
      {/* Tab toggle */}
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

      {/* Content */}
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
            <Controls
              showInteractive={false}
              style={{ background: "#141416", border: "1px solid #27272a", borderRadius: "8px" }}
            />
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

// Callback to prevent unnecessary re-renders
export default AgentCanvas;
