import type { BrowserEngine } from "@/lib/engine";
import { engineScopedStorageKey } from "@/lib/engine-storage";

export const AGENT_VISUALS_CHANGED_EVENT = "xcloud-agent-visuals-changed";

const AGENT_VISUAL_OVERRIDES_KEY = "xcloudAgentVisualOverrides";

export interface AgentVisualOverride {
  emoji?: string;
  avatar?: string;
  updatedAt?: number;
}

type AgentVisualPatch = {
  emoji?: string | null;
  avatar?: string | null;
};

function storageKey(engine: BrowserEngine) {
  return engineScopedStorageKey(AGENT_VISUAL_OVERRIDES_KEY, engine);
}

function readOverrides(engine: BrowserEngine): Record<string, AgentVisualOverride> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(engine)) ?? "{}") as Record<string, AgentVisualOverride>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getAgentVisualOverride(engine: BrowserEngine, agentId: string): AgentVisualOverride | undefined {
  return readOverrides(engine)[agentId];
}

export function setAgentVisualOverride(engine: BrowserEngine, agentId: string, patch: AgentVisualPatch) {
  const overrides = readOverrides(engine);
  const next: AgentVisualOverride = { ...(overrides[agentId] ?? {}), updatedAt: Date.now() };

  if ("emoji" in patch) {
    if (patch.emoji) next.emoji = patch.emoji;
    else delete next.emoji;
    if (patch.emoji) delete next.avatar;
  }

  if ("avatar" in patch) {
    if (patch.avatar) next.avatar = patch.avatar;
    else delete next.avatar;
    if (patch.avatar) delete next.emoji;
  }

  if (!next.emoji && !next.avatar) delete overrides[agentId];
  else overrides[agentId] = next;

  localStorage.setItem(storageKey(engine), JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent(AGENT_VISUALS_CHANGED_EVENT, {
    detail: { agentId, engineScope: engine.storageScope },
  }));
}
