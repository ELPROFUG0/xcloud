import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";
import { ChevronDown, ChevronLeft, Search, Cpu, X, Check, Loader2 } from "lucide-react";

interface ModelSelectorProps {
  engine: BrowserEngine;
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI API",
  google: "Google",
  "google-vertex": "Google Vertex",
  "google-antigravity": "Google Antigravity",
  "google-gemini-cli": "Gemini CLI",
  "amazon-bedrock": "AWS Bedrock",
  "azure-openai-responses": "Azure OpenAI",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot",
  xai: "xAI",
  ollama: "Ollama",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  huggingface: "Hugging Face",
  codex: "OpenAI Codex",
  "openai-codex": "OpenAI Codex",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  "vercel-ai-gateway": "Vercel AI",
  volcengine: "Volcengine",
  "volcengine-plan": "Volcengine Plan",
  tencent: "Tencent",
  "tencent-tokenhub": "Tencent TokenHub",
  "byteplus": "BytePlus",
  "byteplus-plan": "BytePlus Plan",
  "kimi-coding": "Kimi Coding",
  zai: "ZAI",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: "Requires an OpenAI API key.",
  "openai-codex": "Uses your ChatGPT/Codex access, not an OpenAI API key.",
  codex: "Uses your ChatGPT/Codex access, not an OpenAI API key.",
};

function formatProvider(id: string): string {
  return PROVIDER_NAMES[id] ?? id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function ModelSelector({ engine }: ModelSelectorProps) {
  const { providers, currentModel, loading, setModel } = useModels(engine);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Focus search when entering model list
  useEffect(() => {
    if (isOpen && selectedProvider) searchRef.current?.focus();
  }, [isOpen, selectedProvider]);

  function closeDropdown() {
    setIsOpen(false);
    setSelectedProvider(null);
    setSearch("");
  }

  // Filter providers by search (when on provider list)
  const filteredProviders = useMemo(() => {
    if (!search.trim()) return providers;
    const q = search.toLowerCase();
    return providers.filter(
      (g) =>
        formatProvider(g.provider).toLowerCase().includes(q) ||
        g.provider.toLowerCase().includes(q),
    );
  }, [providers, search]);

  // Filter models by search (when inside a provider)
  const filteredModels = useMemo(() => {
    if (!selectedProvider) return [];
    const group = providers.find((g) => g.provider === selectedProvider);
    if (!group) return [];
    if (!search.trim()) return group.models;
    const q = search.toLowerCase();
    return group.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [providers, selectedProvider, search]);

  async function handleSelect(modelId: string) {
    setSwitching(true);
    await setModel(modelId);
    setSwitching(false);
    closeDropdown();
  }

  const currentDisplay = currentModel
    ? currentModel.split("/").pop() ?? currentModel
    : "No model";

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => { setIsOpen(!isOpen); setSelectedProvider(null); setSearch(""); }}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5",
          "text-xs text-text-muted transition-colors",
          "hover:border-accent hover:text-text",
          "disabled:opacity-50",
        )}
      >
        <Cpu className="h-3 w-3" />
        <span className="max-w-[160px] truncate">{loading ? "Loading..." : currentDisplay}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 mt-1 w-80",
            "rounded-xl border border-border bg-surface shadow-2xl",
            "max-h-[70vh] overflow-hidden flex flex-col",
          )}
        >
          {/* Header with back button when inside a provider */}
          {selectedProvider ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={() => { setSelectedProvider(null); setSearch(""); }}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-semibold">{formatProvider(selectedProvider)}</span>
              <span className="text-[10px] text-text-muted">
                {filteredModels.length} models
              </span>
            </div>
          ) : (
            <div className="border-b border-border px-3 py-2">
              <span className="text-xs font-semibold">Select Provider</span>
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              ref={searchRef}
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

          {/* Switching indicator */}
          {switching && (
            <div className="flex items-center gap-2 border-b border-border bg-accent/10 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
              <span className="text-xs text-accent">Switching model...</span>
            </div>
          )}

          {/* Content */}
          <div className="overflow-y-auto">
            {/* Provider list */}
            {!selectedProvider && (
              <>
                {filteredProviders.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-text-muted">
                    No providers found
                  </div>
                )}
                {filteredProviders.map((group) => {
                  const hasActiveModel = group.models.some(
                    (m) =>
                      currentModel === `${m.provider}/${m.id}` ||
                      currentModel === m.id ||
                      currentModel?.startsWith(group.provider + "/"),
                  );

                  return (
                    <button
                      key={group.provider}
                      onClick={() => { setSelectedProvider(group.provider); setSearch(""); }}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2.5 text-left text-xs",
                        "transition-colors hover:bg-surface-hover",
                        hasActiveModel && "bg-accent/5",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {hasActiveModel && <Check className="h-3 w-3 text-accent" />}
                        <div className="min-w-0">
                          <span className={cn("block font-medium", hasActiveModel && "text-accent")}>
                            {formatProvider(group.provider)}
                          </span>
                          {PROVIDER_DESCRIPTIONS[group.provider] && (
                            <span className="block truncate text-[10px] text-text-muted">
                              {PROVIDER_DESCRIPTIONS[group.provider]}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted">{group.models.length}</span>
                        <ChevronDown className="h-3 w-3 -rotate-90 text-text-muted" />
                      </div>
                    </button>
                  );
                })}
              </>
            )}

            {/* Model list for selected provider */}
            {selectedProvider && (
              <>
                {filteredModels.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-text-muted">
                    No models found
                  </div>
                )}
                {filteredModels.map((model) => {
                  const fullId = model.id.includes("/") ? model.id : `${model.provider}/${model.id}`;
                  const isActive = currentModel === fullId || currentModel === model.id;

                  return (
                    <button
                      key={model.id}
                      onClick={() => handleSelect(fullId)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs",
                        "transition-colors hover:bg-surface-hover",
                        isActive && "bg-accent/10",
                      )}
                    >
                      {isActive ? (
                        <Check className="h-3 w-3 shrink-0 text-accent" />
                      ) : (
                        <div className="h-3 w-3 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={cn("truncate font-medium", isActive && "text-accent")}>
                          {model.name || model.id}
                        </div>
                        <div className="truncate text-text-muted">{model.id}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {model.reasoning && (
                          <span className="rounded bg-amber-900/30 px-1 py-0.5 text-[9px] text-amber-400">
                            reasoning
                          </span>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
