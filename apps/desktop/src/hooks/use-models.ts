import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine, ModelInfo } from "@/lib/engine";
import type { AgentInfo } from "@/hooks/use-agents";
import allModelsData from "@/data/all-models.json";

// Full catalog of all OpenClaw models (hardcoded)
const ALL_MODELS: ModelInfo[] = (allModelsData as Array<{ id: string; name: string; provider: string; contextWindow?: number; input?: string[] }>).map((m) => ({
  id: m.id,
  name: m.name,
  provider: m.provider,
  contextWindow: m.contextWindow,
  input: m.input,
}));

const OPENAI_CODEX_OAUTH_MODELS = new Set([
  "openai-codex/gpt-5.5",
]);
const MAIN_AGENT_ID = "main";

interface ProviderGroup {
  provider: string;
  models: ModelInfo[];
}

interface UseModelsReturn {
  models: ModelInfo[];
  providers: ProviderGroup[];
  currentModel: string | null;
  loading: boolean;
  error: string | null;
  setModel: (modelId: string) => Promise<void>;
}

interface UseModelsOptions {
  agentId?: string | null;
  agents?: AgentInfo[];
}

function getAgentList(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const agents = config.agents as Record<string, unknown> | undefined;
  return Array.isArray(agents?.list) ? agents.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function getDefaultModel(config: Record<string, unknown>): string | null {
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  return resolveModelValue(defaults?.model);
}

function getAgentModel(config: Record<string, unknown>, agentId: string): string | null {
  const agent = getAgentList(config).find((item) => item.id === agentId);
  return resolveModelValue(agent?.model);
}

function resolveModelValue(model: unknown): string | null {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const primary = (model as Record<string, unknown>).primary;
    return typeof primary === "string" ? primary : null;
  }
  return null;
}

function getEffectiveModel(config: Record<string, unknown>, agentId?: string | null): string | null {
  if (agentId) {
    const primary = getAgentModel(config, agentId);
    if (primary) return primary;
  }
  const mainPrimary = getAgentModel(config, MAIN_AGENT_ID);
  if (mainPrimary) return mainPrimary;
  return getDefaultModel(config);
}

function buildKnownAgentList(config: Record<string, unknown>, knownAgents: AgentInfo[] | undefined): Array<Record<string, unknown>> {
  const existing = getAgentList(config).map((agent) => ({ ...agent }));
  const seen = new Set(existing.map((agent) => agent.id).filter((id): id is string => typeof id === "string"));
  for (const agent of knownAgents ?? []) {
    if (seen.has(agent.id)) continue;
    existing.push({
      id: agent.id,
      default: agent.isDefault,
      workspace: agent.workspace || undefined,
      model: agent.model,
    });
    seen.add(agent.id);
  }
  return existing;
}

function buildModelPatch(config: Record<string, unknown>, modelId: string, agentId: string | null | undefined, knownAgents: AgentInfo[] | undefined): Record<string, unknown> {
  const targetAgentId = agentId ?? MAIN_AGENT_ID;

  const list = buildKnownAgentList(config, knownAgents);
  const index = list.findIndex((agent) => agent.id === targetAgentId);
  const agentConfig: Record<string, unknown> = index >= 0 ? { ...list[index]! } : { id: targetAgentId };
  const existingModel = agentConfig.model && typeof agentConfig.model === "object" ? agentConfig.model as Record<string, unknown> : {};
  agentConfig.model = { ...existingModel, primary: modelId };

  if (index >= 0) list[index] = agentConfig;
  else list.push(agentConfig);

  if (targetAgentId === MAIN_AGENT_ID) {
    return {
      agents: {
        defaults: { model: { primary: modelId } },
        list,
      },
    };
  }

  return { agents: { list } };
}

function modelKey(model: ModelInfo): string {
  const id = model.id.includes("/") ? model.id.split("/").pop()! : model.id;
  return `${model.provider}/${id}`;
}

function normalizeProvider(provider: string): string {
  return provider === "codex" ? "openai-codex" : provider;
}

function normalizeModelId(modelId: string | null): string | null {
  return modelId?.replace(/^codex\//, "openai-codex/") ?? null;
}

function normalizeModelForUi(model: ModelInfo): ModelInfo {
  const provider = normalizeProvider(model.provider);
  const id = normalizeModelId(model.id) ?? model.id;

  return {
    ...model,
    id,
    provider,
  };
}

function mergeWithCatalog(modelList: ModelInfo[]): ModelInfo[] {
  const merged: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of [...modelList, ...ALL_MODELS].map(normalizeModelForUi)) {
    if (model.provider === "openai-codex" && !OPENAI_CODEX_OAUTH_MODELS.has(modelKey(model))) {
      continue;
    }
    const key = modelKey(model);
    if (seen.has(key)) continue;
    merged.push(model);
    seen.add(key);
  }

  return merged;
}

export function useModels(engine: BrowserEngine, options: UseModelsOptions = {}): UseModelsReturn {
  const { agentId, agents: knownAgents } = options;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [, setConfigHash] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load models and current config on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [modelList, configResult] = await Promise.all([
          engine.listModels(),
          engine.rpc("config.get", {}),
        ]);

        if (cancelled) return;

        setModels(mergeWithCatalog(modelList));

        const config = (configResult as { config?: Record<string, unknown>; hash?: string });
        setConfigHash((config.hash as string) ?? "");

        setCurrentModel(normalizeModelId(getEffectiveModel(config.config ?? configResult, agentId)));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load models");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [engine, agentId]);

  // Group models by provider
  const providers: ProviderGroup[] = (() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return Array.from(map.entries())
      .map(([provider, models]) => ({ provider, models }))
      .sort((a, b) => a.provider.localeCompare(b.provider));
  })();

  // Change model via config.patch
  const setModel = useCallback(async (nextModelId: string) => {
    const modelId = normalizeModelId(nextModelId) ?? nextModelId;
    try {
      const configResult = await engine.rpc("config.get", {});
      const hash = (configResult as { hash?: string }).hash ?? "";
      const config = (configResult as { config?: Record<string, unknown> }).config ?? configResult;
      const patch = JSON.stringify(buildModelPatch(config, modelId, agentId, knownAgents));
      await engine.patchConfig(patch, hash);
    } catch {
      // Gateway restarts after config patch — expected
    }
    // Always update locally and notify canvas
    setCurrentModel(modelId);
    window.dispatchEvent(new CustomEvent("xcloud-model-changed", { detail: { agentId: agentId ?? MAIN_AGENT_ID, modelId } }));
  }, [engine, agentId, knownAgents]);

  return { models, providers, currentModel, loading, error, setModel };
}
