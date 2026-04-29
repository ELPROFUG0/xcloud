import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";
import { PROVIDERS } from "@/types/provider";
import {
  Key, Save, Loader2, CheckCircle, AlertCircle,
  Cpu, ChevronLeft, Check, Search, X, Settings2,
} from "lucide-react";

interface SettingsPanelProps {
  engine: BrowserEngine;
  onBack?: () => void;
}

type Section = "models" | "keys" | "general";

interface KeyState {
  value: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google", "amazon-bedrock": "AWS Bedrock",
  "azure-openai-responses": "Azure OpenAI", mistral: "Mistral", groq: "Groq", deepseek: "DeepSeek",
  fireworks: "Fireworks", openrouter: "OpenRouter", "github-copilot": "GitHub Copilot", xai: "xAI",
  cerebras: "Cerebras", huggingface: "Hugging Face", ollama: "Ollama", minimax: "MiniMax",
  "google-vertex": "Google Vertex", codex: "Codex", "openai-codex": "OpenAI Codex",
  opencode: "OpenCode", "vercel-ai-gateway": "Vercel AI", volcengine: "Volcengine",
};
const fmtProvider = (id: string) =>
  PROVIDER_NAMES[id] ?? id.split("-").map(w => w[0]!.toUpperCase() + w.slice(1)).join(" ");

const SECTIONS: { id: Section; label: string; icon: typeof Cpu }[] = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "keys", label: "API Keys", icon: Key },
  { id: "general", label: "General", icon: Settings2 },
];

export function SettingsPanel({ engine }: SettingsPanelProps) {
  const [section, setSection] = useState<Section>("models");
  const { providers, currentModel, loading, setModel } = useModels(engine);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [keys, setKeys] = useState<Record<string, KeyState>>({});

  const filteredProviders = providers.filter((g) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return fmtProvider(g.provider).toLowerCase().includes(q) ||
      g.models.some((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  });

  const selectedModels = selectedProvider
    ? (providers.find((g) => g.provider === selectedProvider)?.models ?? []).filter((m) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      })
    : [];

  const getKeyState = (envKey: string): KeyState =>
    keys[envKey] ?? { value: "", saving: false, saved: false, error: null };

  const updateKey = useCallback((envKey: string, value: string) => {
    setKeys((prev) => ({ ...prev, [envKey]: { value, saving: false, saved: false, error: null } }));
  }, []);

  const saveKey = useCallback(async (envKey: string) => {
    const state = keys[envKey];
    if (!state?.value.trim()) return;
    setKeys((prev) => ({ ...prev, [envKey]: { ...prev[envKey]!, saving: true, saved: false, error: null } }));
    try {
      const cfgRes = await engine.rpc("config.get", {});
      const hash = (cfgRes as { hash?: string }).hash ?? "";
      await engine.patchConfig(JSON.stringify({ env: { [envKey]: state.value.trim() } }), hash);
      setKeys((prev) => ({ ...prev, [envKey]: { ...prev[envKey]!, saving: false, saved: true, error: null } }));
      setTimeout(() => {
        setKeys((prev) => {
          const c = prev[envKey];
          return c?.saved ? { ...prev, [envKey]: { ...c, saved: false } } : prev;
        });
      }, 3000);
    } catch (err) {
      setKeys((prev) => ({
        ...prev, [envKey]: { ...prev[envKey]!, saving: false, error: err instanceof Error ? err.message : "Failed" },
      }));
    }
  }, [keys, engine]);

  return (
    <div className="flex h-full bg-surface">
      {/* Sidebar */}
      <div className="flex h-full w-44 shrink-0 flex-col bg-surface pt-6">
        <div className="px-5 mb-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Settings</h2>
        </div>
        <nav className="px-2 space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => { setSection(s.id); setSelectedProvider(null); setSearch(""); }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] transition-colors",
                  section === s.id
                    ? "bg-container text-text"
                    : "text-text-muted hover:text-text",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col bg-surface">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4">
          {section === "models" && selectedProvider && (
            <button
              onClick={() => { setSelectedProvider(null); setSearch(""); }}
              className="text-text-muted hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h3 className="text-base font-semibold">
            {section === "models" && selectedProvider
              ? fmtProvider(selectedProvider)
              : SECTIONS.find((s) => s.id === section)?.label}
          </h3>
          {section === "models" && selectedProvider && (
            <span className="text-xs text-text-muted">{selectedModels.length} models</span>
          )}
        </div>

        {/* Search (models) */}
        {section === "models" && (
          <div className="flex items-center gap-2 mx-6 mb-4 rounded-lg bg-container px-3 py-2">
            <Search className="h-3.5 w-3.5 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={selectedProvider ? "Search models..." : "Search providers..."}
              className="flex-1 bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-text-muted hover:text-text">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {/* Models: providers */}
          {section === "models" && !selectedProvider && (
            <div className="space-y-1">
              {loading && <div className="py-4 text-xs text-text-muted">Loading...</div>}
              {filteredProviders.map((group) => {
                const hasActive = group.models.some(
                  (m) => currentModel === `${m.provider}/${m.id}` || currentModel === m.id,
                );
                return (
                  <button
                    key={group.provider}
                    onClick={() => { setSelectedProvider(group.provider); setSearch(""); }}
                    className="flex w-full items-center justify-between rounded-lg bg-container px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex items-center gap-2">
                      {hasActive ? <Check className="h-3.5 w-3.5 text-accent" /> : <div className="h-3.5 w-3.5" />}
                      <span className={cn("text-[13px]", hasActive ? "text-accent font-medium" : "text-text")}>
                        {fmtProvider(group.provider)}
                      </span>
                    </div>
                    <span className="text-[11px] text-text-muted">{group.models.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Models: list */}
          {section === "models" && selectedProvider && (
            <div className="space-y-1">
              {selectedModels.map((model) => {
                const fullId = `${model.provider}/${model.id}`;
                const isActive = currentModel === fullId || currentModel === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={async () => { await setModel(fullId); }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg bg-container px-4 py-3 text-left transition-colors hover:bg-surface-hover",
                      isActive && "ring-1 ring-accent/30",
                    )}
                  >
                    {isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : <div className="h-3.5 w-3.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-[13px]", isActive ? "text-accent font-medium" : "text-text")}>
                        {model.name || model.id}
                      </div>
                      <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">{model.id}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {model.reasoning && (
                        <span className="rounded bg-amber-900/20 px-1.5 py-0.5 text-[9px] text-amber-400">reasoning</span>
                      )}
                      {model.contextWindow && (
                        <span className="text-[10px] text-text-muted">
                          {model.contextWindow >= 1_000_000
                            ? `${(model.contextWindow / 1_000_000).toFixed(0)}M`
                            : `${Math.round(model.contextWindow / 1000)}k`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* API Keys */}
          {section === "keys" && (
            <div className="space-y-3">
              <p className="text-[11px] text-text-muted mb-2">
                Keys are stored in the gateway config and never leave your machine.
              </p>
              {PROVIDERS.map((provider) => {
                const state = getKeyState(provider.envKey);
                return (
                  <div key={provider.id} className="rounded-lg bg-container p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[13px] font-medium">{provider.name}</span>
                      <span className="text-[10px] text-text-muted font-mono">{provider.envKey}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={state.value}
                        onChange={(e) => updateKey(provider.envKey, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveKey(provider.envKey)}
                        placeholder={provider.placeholder}
                        className="flex-1 rounded-md bg-bg border-0 px-3 py-2 text-xs text-text font-mono placeholder:text-text-muted focus:ring-1 focus:ring-accent/50 focus:outline-none"
                      />
                      <button
                        onClick={() => saveKey(provider.envKey)}
                        disabled={!state.value.trim() || state.saving}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg text-text-muted transition-colors hover:text-accent disabled:opacity-30"
                      >
                        {state.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                         state.saved ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> :
                         <Save className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    {state.error && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-red-400">
                        <AlertCircle className="h-3 w-3" />{state.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* General */}
          {section === "general" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-3">Gateway</h4>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">URL</span>
                    <span className="font-mono text-text">ws://127.0.0.1:18789</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Status</span>
                    <span className="text-emerald-400">Connected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Model</span>
                    <span className="font-mono text-text">{currentModel?.split("/").pop() ?? "none"}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-3">About</h4>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Agent Studio</span>
                    <span className="text-text">v0.1.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Engine</span>
                    <span className="text-text">OpenClaw (MIT)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
