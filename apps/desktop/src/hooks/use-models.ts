import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine, ModelInfo } from "@/lib/engine";
import allModelsData from "@/data/all-models.json";

// Full catalog of all OpenClaw models (hardcoded)
const ALL_MODELS: ModelInfo[] = (allModelsData as Array<{ id: string; name: string; provider: string; contextWindow?: number; input?: string[] }>).map((m) => ({
  id: m.id,
  name: m.name,
  provider: m.provider,
  contextWindow: m.contextWindow,
  input: m.input,
}));

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

export function useModels(engine: BrowserEngine): UseModelsReturn {
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

        // Merge: gateway models + full catalog (deduplicated by id)
        const seen = new Set(modelList.map((m) => m.id));
        const merged = [...modelList];
        for (const m of ALL_MODELS) {
          if (!seen.has(m.id)) {
            merged.push(m);
            seen.add(m.id);
          }
        }
        setModels(merged);

        const config = (configResult as { config?: Record<string, unknown>; hash?: string });
        setConfigHash((config.hash as string) ?? "");

        // Extract current model from config
        const agents = config.config?.agents as Record<string, unknown> | undefined;
        const defaults = agents?.defaults as Record<string, unknown> | undefined;
        const model = defaults?.model as Record<string, unknown> | undefined;
        const primary = (model?.primary as string) ?? null;
        setCurrentModel(primary);
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
  }, [engine]);

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
  const setModel = useCallback(async (modelId: string) => {
    try {
      // Get fresh config hash
      const configResult = await engine.rpc("config.get", {});
      const hash = (configResult as { hash?: string }).hash ?? "";

      const patch = JSON.stringify({
        agents: { defaults: { model: { primary: modelId } } },
      });

      await engine.patchConfig(patch, hash);
      setCurrentModel(modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change model");
    }
  }, [engine]);

  return { models, providers, currentModel, loading, error, setModel };
}
