import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { resolveAvatarUrl } from "@/lib/avatar";

export interface AgentInfo {
  id: string;
  name?: string;
  emoji?: string;
  avatar?: string;
  workspace: string;
  model?: { primary?: string };
  isDefault?: boolean;
  status: "active" | "idle" | "error";
}

const DELETED_AGENTS_KEY = "xcloudDeletedAgents";

function readDeletedAgentIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_AGENTS_KEY) ?? "[]") as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

interface UseAgentsReturn {
  agents: AgentInfo[];
  selectedId: string;
  select: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}

/** Check if a value is a placeholder (not real content) */
function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith("_(") && v.endsWith(")_")) return true;
  if (v.startsWith("_(")) return true;
  if (v.includes("pick something") || v.includes("pick one") || v.includes("fill this")) return true;
  if (v.includes("workspace-relative") || v.includes("data URI")) return true;
  return false;
}

function extractIdentityField(content: string, field: "Name" | "Emoji" | "Avatar") {
  const fieldPattern = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^[^\\S\\r\\n]*-?[^\\S\\r\\n]*\\*\\*${fieldPattern}:\\*\\*[^\\S\\r\\n]*([^\\r\\n]*)[^\\S\\r\\n]*$`, "im"),
    new RegExp(`^[^\\S\\r\\n]*-?[^\\S\\r\\n]*\\*\\*${fieldPattern}\\*\\*:[^\\S\\r\\n]*([^\\r\\n]*)[^\\S\\r\\n]*$`, "im"),
    new RegExp(`^[^\\S\\r\\n]*-?[^\\S\\r\\n]*(?!\\*\\*)${fieldPattern}:[^\\S\\r\\n]*([^\\r\\n]*)[^\\S\\r\\n]*$`, "im"),
  ];

  for (const pattern of patterns) {
    const value = content.match(pattern)?.[1]?.trim();
    if (value && !isPlaceholder(value)) return value;
  }

  return undefined;
}

/** Parse IDENTITY.md frontmatter-style fields */
function parseIdentity(content: string): { name?: string; emoji?: string; avatar?: string } {
  const result: { name?: string; emoji?: string; avatar?: string } = {};
  result.name = extractIdentityField(content, "Name");
  result.emoji = extractIdentityField(content, "Emoji");
  result.avatar = extractIdentityField(content, "Avatar");
  return result;
}

type LocalConfigAgent = {
  id: string;
  name?: string;
  workspace?: string;
  model?: string | { primary?: string };
  default?: boolean;
};

type LocalConfig = {
  agents?: {
    list?: LocalConfigAgent[];
  };
};

async function readLocalConfigAgents() {
  try {
    const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
    const config = JSON.parse(raw) as LocalConfig;
    return (config.agents?.list ?? []).filter((agent): agent is LocalConfigAgent => Boolean(agent?.id));
  } catch {
    return [];
  }
}

function agentsEqual(a: AgentInfo[], b: AgentInfo[]) {
  if (a.length !== b.length) return false;
  return a.every((agent, index) => {
    const next = b[index]!;
    return agent.id === next.id
      && agent.name === next.name
      && agent.emoji === next.emoji
      && agent.avatar === next.avatar
      && agent.workspace === next.workspace
      && agent.model?.primary === next.model?.primary
      && agent.isDefault === next.isDefault
      && agent.status === next.status;
  });
}

function normalizeAgentModel(model: string | { primary?: string } | undefined): { primary?: string } | undefined {
  if (typeof model === "string") return { primary: model };
  if (model && typeof model === "object") return model;
  return undefined;
}

export function useAgents(engine: BrowserEngine): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedId, setSelectedId] = useState("main");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await engine.rpc("agents.list", {}).catch(() => ({ agents: [] }));
      const payload = result as {
        defaultId?: string;
        agents?: Array<{
          id: string;
          name?: string;
          workspace?: string;
          model?: string | { primary?: string };
        }>;
      };

      const localAgents = await readLocalConfigAgents();
      const deletedAgentIds = readDeletedAgentIds();
      const merged = [...(payload.agents ?? [])];
      const seenIds = new Set(merged.map((agent) => agent.id));
      for (const localAgent of localAgents) {
        if (seenIds.has(localAgent.id)) continue;
        merged.push(localAgent);
        seenIds.add(localAgent.id);
      }

      const defaultId = payload.defaultId ?? localAgents.find((agent) => agent.default)?.id ?? "main";
      const list: AgentInfo[] = merged.filter((a) => !deletedAgentIds.has(a.id)).map((a) => ({
        id: a.id,
        name: a.name,
        workspace: a.workspace ?? "",
        model: normalizeAgentModel(a.model),
        isDefault: a.id === defaultId,
        status: "active" as const,
      }));

      const enriched = await Promise.all(list.map(async (agent) => {
        const wsPath = agent.isDefault
          ? ".openclaw/workspace/IDENTITY.md"
          : `.openclaw/workspace/${agent.id}/IDENTITY.md`;
        const content = await readTextFile(wsPath, { baseDir: BaseDirectory.Home }).catch(() => "");
        const identity = parseIdentity(content);
        const avatar = identity.avatar
          ? await resolveAvatarUrl(agent.id, identity.avatar).catch(() => undefined)
          : undefined;
        return {
          ...agent,
          name: identity.name ?? agent.name,
          emoji: identity.emoji ?? agent.emoji,
          avatar: avatar ?? agent.avatar,
        };
      }));

      setAgents((prev) => agentsEqual(prev, enriched) ? prev : enriched);

      // If selected agent no longer exists, fallback to default
      if (!list.find((a) => a.id === selectedId)) {
        setSelectedId(defaultId);
      }
    } catch {
      // Keep existing agents on error
    } finally {
      setLoading(false);
    }
  }, [engine, selectedId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleDeletedAgentsChanged = () => void refresh();
    window.addEventListener("xcloud-deleted-agents-changed", handleDeletedAgentsChanged);
    window.addEventListener("xcloud-agents-local-config-changed", handleDeletedAgentsChanged);
    return () => {
      window.removeEventListener("xcloud-deleted-agents-changed", handleDeletedAgentsChanged);
      window.removeEventListener("xcloud-agents-local-config-changed", handleDeletedAgentsChanged);
    };
  }, [refresh]);

  // Auto-refresh when agent finishes responding (may have changed identity/name)
  useEffect(() => {
    const unsub = engine.onEvent((frame) => {
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;

      // Refresh after agent lifecycle ends or sessions change
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && data?.phase === "end") {
          refresh();
        }
      }
      if (event === "config.changed" || event === "config.patched") {
        refresh();
      }
    });
    return unsub;
  }, [engine, refresh]);

  useEffect(() => {
    const onModelChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | { agentId?: string | null; modelId?: string };
      const agentId = typeof detail === "string" ? null : detail.agentId;
      const modelId = typeof detail === "string" ? detail : detail.modelId;
      if (!modelId) return;
      setAgents((prev) =>
        prev.map((agent) =>
          !agentId || agent.id === agentId
            ? { ...agent, model: { ...agent.model, primary: modelId } }
            : agent,
        ),
      );
    };
    window.addEventListener("xcloud-model-changed", onModelChanged);
    return () => window.removeEventListener("xcloud-model-changed", onModelChanged);
  }, []);

  return { agents, selectedId, select: setSelectedId, refresh, loading };
}
