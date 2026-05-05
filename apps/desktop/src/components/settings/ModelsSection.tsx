import { useState } from "react";
import { Check, ChevronLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";

import anthropicLogo from "@/assets/providers/anthropic.svg";
import openaiLogo from "@/assets/providers/openai.svg";
import googleProvLogo from "@/assets/providers/google.svg";
import awsLogo from "@/assets/providers/aws.svg";
import azureLogo from "@/assets/providers/azure.svg";
import mistralLogo from "@/assets/providers/mistral.svg";
import groqLogo from "@/assets/providers/groq.svg";
import deepseekLogo from "@/assets/providers/deepseek.svg";
import fireworksLogo from "@/assets/providers/fireworks.svg";
import openrouterLogo from "@/assets/providers/openrouter.svg";
import xaiLogo from "@/assets/providers/xai.svg";
import cerebrasLogo from "@/assets/providers/cerebras.svg";
import huggingfaceLogo from "@/assets/providers/huggingface.svg";
import githubLogo from "@/assets/providers/github.svg";
import ollamaLogo from "@/assets/providers/ollama.svg";

const PROVIDER_LOGOS: Record<string, string> = {
  anthropic: anthropicLogo, openai: openaiLogo, google: googleProvLogo,
  "google-vertex": googleProvLogo, mistral: mistralLogo, groq: groqLogo,
  deepseek: deepseekLogo, fireworks: fireworksLogo, openrouter: openrouterLogo,
  xai: xaiLogo, cerebras: cerebrasLogo, "amazon-bedrock": awsLogo,
  "azure-openai-responses": azureLogo, huggingface: huggingfaceLogo,
  "github-copilot": githubLogo, ollama: ollamaLogo,
};

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

export { PROVIDER_LOGOS, PROVIDER_NAMES, fmtProvider };

interface ModelsSectionProps {
  engine: BrowserEngine;
}

export function ModelsSection({ engine }: ModelsSectionProps) {
  const { providers, currentModel, loading, setModel } = useModels(engine);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {selectedProvider && (
          <button
            onClick={() => { setSelectedProvider(null); setSearch(""); }}
            className="text-text-muted hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h3 className="text-base font-semibold">
          {selectedProvider ? fmtProvider(selectedProvider) : "Models"}
        </h3>
        {selectedProvider && (
          <span className="text-xs text-text-muted">{selectedModels.length} models</span>
        )}
      </div>

      {/* Search */}
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

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Providers list */}
        {!selectedProvider && (
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

        {/* Models list */}
        {selectedProvider && (
          <div className="space-y-1">
            {selectedModels.map((model) => {
              const fullId = model.id.includes("/") ? model.id : `${model.provider}/${model.id}`;
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
      </div>
    </div>
  );
}
