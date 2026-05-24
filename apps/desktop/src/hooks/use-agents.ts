import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { resolveAvatarUrl } from "@/lib/avatar";
import { ensureAgentDefaultAvatar, isAgentAvatarOptedOut } from "@/lib/update-identity";
import { engineScopedStorageKey } from "@/lib/engine-storage";
import { getStableDefaultAvatarUrl } from "@/lib/default-avatar";
import { AGENT_VISUALS_CHANGED_EVENT, getAgentVisualOverride } from "@/lib/agent-visuals";
import { ensureRemoteMainAgentDefaults, readOpenClawAgentFile } from "@/lib/openclaw-store";

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

interface AgentIdentityPayload {
  name?: string;
  emoji?: string;
  avatar?: string;
}

const MAIN_AGENT_ID = "main";
const DELETED_AGENTS_KEY = "xcloudDeletedAgents";
const seededRemoteMainDefaults = new Set<string>();

function readDeletedAgentIds(storageKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[];
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

function normalizeAgentDisplayName(agentId: string, name?: string) {
  if (agentId !== MAIN_AGENT_ID) return name;
  if (!name?.trim() || /^assistant$/i.test(name.trim())) return "Main";
  return name;
}

function isRenderableRemoteAvatar(avatar?: string) {
  return Boolean(avatar && /^(data:|blob:|https?:\/\/|\/assets\/|\/api\/)/.test(avatar));
}

function normalizeRemoteIdentity(value: unknown): AgentIdentityPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const identity: AgentIdentityPayload = {};
  if (typeof record.name === "string" && record.name.trim()) identity.name = record.name;
  if (typeof record.emoji === "string" && record.emoji.trim()) identity.emoji = record.emoji;
  if (typeof record.avatar === "string" && record.avatar.trim()) identity.avatar = record.avatar;
  return Object.keys(identity).length > 0 ? identity : undefined;
}

async function readRemoteMainIdentity(engine: BrowserEngine): Promise<AgentIdentityPayload | undefined> {
  const result = await engine.rpc("agent.identity.get", { agentId: MAIN_AGENT_ID, sessionKey: MAIN_AGENT_ID }).catch(() => null);
  return normalizeRemoteIdentity(result);
}

export function useAgents(engine: BrowserEngine): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedId, setSelectedId] = useState("main");
  const [loading, setLoading] = useState(true);
  const deletedAgentsKey = engineScopedStorageKey(DELETED_AGENTS_KEY, engine);

  const refresh = useCallback(async () => {
    try {
      if (engine.isRemote && !seededRemoteMainDefaults.has(engine.storageScope)) {
        try {
          await ensureRemoteMainAgentDefaults(engine);
          seededRemoteMainDefaults.add(engine.storageScope);
        } catch {
          // Try again on the next refresh; remote engines can still be reconnecting here.
        }
      }
      const result = await engine.rpc("agents.list", {}).catch(() => ({ agents: [] }));
      const payload = result as {
        defaultId?: string;
        agents?: Array<{
          id: string;
          name?: string;
          emoji?: string;
          avatar?: string;
          identity?: AgentIdentityPayload;
          workspace?: string;
          model?: string | { primary?: string };
        }>;
      };

      const localAgents = engine.isRemote ? [] : await readLocalConfigAgents();
      const deletedAgentIds = readDeletedAgentIds(deletedAgentsKey);
      const merged = [...(payload.agents ?? [])];
      const seenIds = new Set(merged.map((agent) => agent.id));
      const remoteMainIdentity = engine.isRemote ? await readRemoteMainIdentity(engine) : undefined;
      for (const localAgent of localAgents) {
        if (seenIds.has(localAgent.id)) continue;
        merged.push(localAgent);
        seenIds.add(localAgent.id);
      }

      if (engine.isRemote && remoteMainIdentity) {
        const mainAgent = merged.find((agent) => agent.id === MAIN_AGENT_ID);
        if (mainAgent) {
          mainAgent.identity = { ...mainAgent.identity, ...remoteMainIdentity };
          mainAgent.name = remoteMainIdentity.name ?? mainAgent.name;
          mainAgent.emoji = remoteMainIdentity.emoji ?? mainAgent.emoji;
          mainAgent.avatar = remoteMainIdentity.avatar ?? mainAgent.avatar;
        }
      }

      if (engine.isRemote && !seenIds.has(MAIN_AGENT_ID)) {
        merged.unshift({
          id: MAIN_AGENT_ID,
          name: remoteMainIdentity?.name,
          emoji: remoteMainIdentity?.emoji,
          avatar: remoteMainIdentity?.avatar,
          identity: remoteMainIdentity,
        });
        seenIds.add(MAIN_AGENT_ID);
      }

      const rawDefaultId = payload.defaultId ?? localAgents.find((agent) => agent.default)?.id ?? MAIN_AGENT_ID;
      const defaultId = merged.some((agent) => agent.id === MAIN_AGENT_ID) ? MAIN_AGENT_ID : rawDefaultId;
      const list: AgentInfo[] = merged.filter((a) => !deletedAgentIds.has(a.id)).map((a) => ({
        id: a.id,
        name: normalizeAgentDisplayName(a.id, a.identity?.name ?? a.name),
        emoji: a.identity?.emoji ?? a.emoji,
        avatar: a.identity?.avatar ?? a.avatar,
        workspace: a.workspace ?? "",
        model: normalizeAgentModel(a.model),
        isDefault: a.id === defaultId,
        status: "active" as const,
      }));

      const enriched = await Promise.all(list.map(async (agent) => {
        const wsPath = agent.isDefault
          ? ".openclaw/workspace/IDENTITY.md"
          : `.openclaw/workspace/${agent.id}/IDENTITY.md`;
        const content = engine.isRemote
          ? await readOpenClawAgentFile(engine, agent.id, "IDENTITY.md")
          : await readTextFile(wsPath, { baseDir: BaseDirectory.Home }).catch(() => "");
        const identity = parseIdentity(content);
        const visualOverride = engine.isRemote ? getAgentVisualOverride(engine, agent.id) : undefined;
        const defaultAvatar = !engine.isRemote && !agent.isDefault && !identity.avatar && !isAgentAvatarOptedOut(agent.id)
          ? await ensureAgentDefaultAvatar(agent.id).catch(() => undefined)
          : undefined;
        const emoji = visualOverride?.emoji ?? identity.emoji ?? agent.emoji;
        const avatarField = visualOverride?.avatar ?? identity.avatar ?? defaultAvatar;
        const avatar = avatarField
          ? engine.isRemote && !isRenderableRemoteAvatar(avatarField)
            ? undefined
            : await resolveAvatarUrl(agent.id, avatarField).catch(() => undefined)
          : undefined;
        return {
          ...agent,
          name: normalizeAgentDisplayName(agent.id, identity.name ?? agent.name),
          emoji,
          avatar: avatar ?? (isRenderableRemoteAvatar(agent.avatar) ? agent.avatar : !emoji ? getStableDefaultAvatarUrl(`${engine.storageScope}:${agent.id}`) : agent.avatar),
        };
      }));

      setAgents((prev) => agentsEqual(prev, enriched) ? prev : enriched);

      // If selected agent no longer exists, fallback to default
      if (!list.find((a) => a.id === selectedId)) {
        setSelectedId(list.find((a) => a.id === defaultId)?.id ?? list.find((a) => a.id === MAIN_AGENT_ID)?.id ?? list[0]?.id ?? defaultId);
      }
    } catch {
      // Keep existing agents on error
    } finally {
      setLoading(false);
    }
  }, [deletedAgentsKey, engine, selectedId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setAgents([]);
    setSelectedId("main");
    setLoading(true);
  }, [engine.storageScope]);

  useEffect(() => {
    const handleDeletedAgentsChanged = () => void refresh();
    window.addEventListener("xcloud-deleted-agents-changed", handleDeletedAgentsChanged);
    window.addEventListener("xcloud-agents-local-config-changed", handleDeletedAgentsChanged);
    window.addEventListener(AGENT_VISUALS_CHANGED_EVENT, handleDeletedAgentsChanged);
    return () => {
      window.removeEventListener("xcloud-deleted-agents-changed", handleDeletedAgentsChanged);
      window.removeEventListener("xcloud-agents-local-config-changed", handleDeletedAgentsChanged);
      window.removeEventListener(AGENT_VISUALS_CHANGED_EVENT, handleDeletedAgentsChanged);
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
