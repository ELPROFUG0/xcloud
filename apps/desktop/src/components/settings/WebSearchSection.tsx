import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Globe2, XCircle } from "lucide-react";
import type { BrowserEngine } from "@/lib/engine";
import { patchOpenClawConfig, readOpenClawConfig } from "@/lib/openclaw-store";
import { cn } from "@/lib/cn";
import braveLogo from "@/assets/search-providers/brave.svg";
import perplexityLogo from "@/assets/search-providers/perplexity.svg";
import exaLogo from "@/assets/search-providers/exa.png";
import tavilyLogo from "@/assets/search-providers/tavily.png";
import firecrawlLogo from "@/assets/search-providers/firecrawl.png";
import duckduckgoLogo from "@/assets/search-providers/duckduckgo.svg";
import searxngLogo from "@/assets/search-providers/searxng.svg";
import moonshotLogo from "@/assets/search-providers/moonshot.png";
import minimaxLogo from "@/assets/search-providers/minimax.svg";
import googleLogo from "@/assets/providers/google.svg";
import xaiLogo from "@/assets/providers/xai.svg";
import ollamaLogo from "@/assets/providers/ollama.svg";

type WebSearchProvider = {
  id: string;
  name: string;
  description: string;
  logo: string;
  requiresApiKey?: boolean;
  supportsBaseUrl?: boolean;
  apiKeyPlaceholder?: string;
};

const PROVIDERS: WebSearchProvider[] = [
  { id: "brave", name: "Brave Search", logo: braveLogo, description: "Fast, general web search. Good default.", requiresApiKey: true, apiKeyPlaceholder: "BSA..." },
  { id: "perplexity", name: "Perplexity", logo: perplexityLogo, description: "Answer-oriented search with citations.", requiresApiKey: true, apiKeyPlaceholder: "pplx-..." },
  { id: "exa", name: "Exa", logo: exaLogo, description: "Semantic search for research and discovery.", requiresApiKey: true },
  { id: "tavily", name: "Tavily", logo: tavilyLogo, description: "Agent-focused search and page extraction.", requiresApiKey: true, apiKeyPlaceholder: "tvly-..." },
  { id: "firecrawl", name: "Firecrawl", logo: firecrawlLogo, description: "Search plus clean crawl/extraction.", requiresApiKey: true },
  { id: "google", name: "Gemini / Google", logo: googleLogo, description: "Google-backed search through the Google provider.", requiresApiKey: true },
  { id: "xai", name: "Grok / xAI", logo: xaiLogo, description: "xAI search provider.", requiresApiKey: true, apiKeyPlaceholder: "xai-..." },
  { id: "moonshot", name: "Kimi / Moonshot", logo: moonshotLogo, description: "Moonshot Kimi search provider.", requiresApiKey: true },
  { id: "minimax", name: "MiniMax", logo: minimaxLogo, description: "MiniMax search provider.", requiresApiKey: true },
  { id: "duckduckgo", name: "DuckDuckGo", logo: duckduckgoLogo, description: "No-key web search for simple browsing.", requiresApiKey: false },
  { id: "searxng", name: "SearXNG", logo: searxngLogo, description: "Self-hosted metasearch endpoint.", requiresApiKey: false, supportsBaseUrl: true, apiKeyPlaceholder: "https://search.example.com" },
  { id: "ollama", name: "Ollama", logo: ollamaLogo, description: "Local provider path for offline-friendly setups.", requiresApiKey: false, supportsBaseUrl: true, apiKeyPlaceholder: "http://localhost:11434" },
];

interface WebSearchSectionProps {
  engine: BrowserEngine;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nestedString(root: Record<string, unknown>, path: string[]) {
  let current: unknown = root;
  for (const part of path) current = asRecord(current)[part];
  return typeof current === "string" ? current : "";
}

function nestedBoolean(root: Record<string, unknown>, path: string[], fallback = false) {
  let current: unknown = root;
  for (const part of path) current = asRecord(current)[part];
  return typeof current === "boolean" ? current : fallback;
}

function nestedNumber(root: Record<string, unknown>, path: string[], fallback: number) {
  let current: unknown = root;
  for (const part of path) current = asRecord(current)[part];
  return typeof current === "number" && Number.isFinite(current) ? current : fallback;
}

function providerIsConfigured(config: Record<string, unknown>, item: WebSearchProvider) {
  const entry = asRecord(asRecord(asRecord(config.plugins).entries)[item.id]);
  const pluginEnabled = entry.enabled === true;
  const webSearch = asRecord(asRecord(entry.config).webSearch);
  const hasApiKey = typeof webSearch.apiKey === "string" && webSearch.apiKey.trim().length > 0;
  const hasBaseUrl = typeof webSearch.baseUrl === "string" && webSearch.baseUrl.trim().length > 0;

  if (item.requiresApiKey) return pluginEnabled && hasApiKey;
  if (item.supportsBaseUrl) return pluginEnabled && hasBaseUrl;
  return pluginEnabled;
}

export function WebSearchSection({ engine }: WebSearchSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState("brave");
  const [expandedProvider, setExpandedProvider] = useState("brave");
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [maxResults, setMaxResults] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0]!,
    [provider],
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { config } = await readOpenClawConfig(engine);
      const configuredProvider = nestedString(config, ["tools", "web", "search", "provider"]) || "brave";
      const knownProvider = PROVIDERS.some((item) => item.id === configuredProvider) ? configuredProvider : "brave";
      setEnabled(nestedBoolean(config, ["tools", "web", "search", "enabled"], false));
      setProvider(knownProvider);
      setExpandedProvider(knownProvider);
      setConfiguredProviders(PROVIDERS.filter((item) => providerIsConfigured(config, item)).map((item) => item.id));
      setMaxResults(nestedNumber(config, ["tools", "web", "search", "maxResults"], 5));
      setApiKey(nestedString(config, ["plugins", "entries", knownProvider, "config", "webSearch", "apiKey"]));
      setBaseUrl(nestedString(config, ["plugins", "entries", knownProvider, "config", "webSearch", "baseUrl"]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (loading) return;
    void (async () => {
      try {
        const { config } = await readOpenClawConfig(engine);
        setApiKey(nestedString(config, ["plugins", "entries", expandedProvider, "config", "webSearch", "apiKey"]));
        setBaseUrl(nestedString(config, ["plugins", "entries", expandedProvider, "config", "webSearch", "baseUrl"]));
      } catch {
        setApiKey("");
        setBaseUrl("");
      }
    })();
  }, [engine, expandedProvider, loading]);

  const save = useCallback(async (item = selectedProvider, activate = false) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      if (item.requiresApiKey && !apiKey.trim()) {
        throw new Error(`${item.name} requires an API key.`);
      }
      if (item.supportsBaseUrl && !baseUrl.trim()) {
        throw new Error(`${item.name} requires a Base URL.`);
      }

      const { config, hash } = await readOpenClawConfig(engine);
      const tools = asRecord(config.tools);
      const web = asRecord(tools.web);
      const search = asRecord(web.search);
      const plugins = asRecord(config.plugins);
      const entries = asRecord(plugins.entries);
      const currentEntry = asRecord(entries[item.id]);
      const currentEntryConfig = asRecord(currentEntry.config);
      const webSearch = asRecord(currentEntryConfig.webSearch);

      const nextWebSearch: Record<string, unknown> = {
        ...webSearch,
      };
      if (apiKey.trim()) nextWebSearch.apiKey = apiKey.trim();
      else delete nextWebSearch.apiKey;
      if (item.supportsBaseUrl && baseUrl.trim()) nextWebSearch.baseUrl = baseUrl.trim();
      else delete nextWebSearch.baseUrl;

      const nextEnabled = activate ? true : enabled;
      const nextProvider = activate ? item.id : provider;

      await patchOpenClawConfig(engine, {
        tools: {
          ...tools,
          web: {
            ...web,
            search: {
              ...search,
              enabled: nextEnabled,
              provider: nextProvider,
              maxResults: Math.max(1, Math.min(20, Math.round(maxResults))),
            },
          },
        },
        plugins: {
          ...plugins,
          entries: {
            ...entries,
            [item.id]: {
              ...currentEntry,
              enabled: true,
              config: {
                ...currentEntryConfig,
                webSearch: nextWebSearch,
              },
            },
          },
        },
      }, hash);

      setEnabled(nextEnabled);
      setProvider(nextProvider);
      setConfiguredProviders((current) => Array.from(new Set([...current, item.id])));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, enabled, engine, maxResults, provider, selectedProvider]);

  const activateConfiguredProvider = useCallback(async (item: WebSearchProvider) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { config, hash } = await readOpenClawConfig(engine);
      const tools = asRecord(config.tools);
      const web = asRecord(tools.web);
      const search = asRecord(web.search);

      await patchOpenClawConfig(engine, {
        tools: {
          ...tools,
          web: {
            ...web,
            search: {
              ...search,
              enabled: true,
              provider: item.id,
              maxResults: Math.max(1, Math.min(20, Math.round(maxResults))),
            },
          },
        },
      }, hash);

      setEnabled(true);
      setProvider(item.id);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [engine, maxResults]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
        <div>
          <h3 className="text-base font-semibold">Web Search</h3>
          <p className="mt-1 text-xs text-text-muted">Configure the provider agents use for internet search.</p>
        </div>
        <a
          href="https://docs.openclaw.ai/tools/web"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="border-b border-border/50 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Globe2 className={cn("h-5 w-5 shrink-0", enabled ? "text-emerald-400" : "text-text-muted")} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">Internet search</span>
                  <span className={cn("text-xs", enabled ? "text-emerald-400" : "text-text-muted")}>
                    {enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setEnabled((value) => !value)}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                enabled ? "bg-emerald-500" : "bg-text-muted/20",
              )}
              aria-label="Toggle web search"
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  enabled ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </div>

        <div className="py-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Provider</p>
          <p className="mb-2 text-xs text-text-muted">Configure providers, then choose which one agents should use.</p>
          <div className="divide-y divide-border/50">
            {PROVIDERS.map((item) => {
              const selected = provider === item.id;
              const configured = configuredProviders.includes(item.id);
              const expanded = expandedProvider === item.id;
              return (
                <div key={item.id}>
                  <button
                    onClick={() => {
                      setExpandedProvider((current) => current === item.id ? "" : item.id);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors",
                      selected ? "text-text" : "text-text-muted hover:text-text",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#262626]">
                        <img src={item.logo} alt="" className="h-[18px] w-[18px] object-contain" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{item.name}</span>
                          {item.requiresApiKey ? (
                            <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[10px] text-text-muted">API key</span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">No key</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selected && enabled && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          In use
                        </span>
                      )}
                      {configured && (!selected || !enabled) && (
                        <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[10px] text-text-muted">
                          Ready
                        </span>
                      )}
                      <ChevronDown className={cn("h-4 w-4 text-text-muted transition-transform", expanded && "rotate-180")} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="pb-4">
                      <div className="flex items-end gap-2 pl-11">
                        {item.requiresApiKey && (
                          <label className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs font-medium text-text-muted">API key</span>
                            <input
                              type="password"
                              value={apiKey}
                              onChange={(event) => setApiKey(event.target.value)}
                              placeholder={item.apiKeyPlaceholder ?? "Paste API key"}
                              className="w-full rounded-xl bg-[#262626] px-3 py-1.5 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none"
                            />
                          </label>
                        )}

                        {item.supportsBaseUrl && (
                          <label className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs font-medium text-text-muted">Base URL</span>
                            <input
                              type="text"
                              value={baseUrl}
                              onChange={(event) => setBaseUrl(event.target.value)}
                              placeholder={item.apiKeyPlaceholder ?? "http://localhost:11434"}
                              className="w-full rounded-xl bg-[#262626] px-3 py-1.5 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none"
                            />
                          </label>
                        )}

                        {!item.requiresApiKey && !item.supportsBaseUrl && (
                          <div className="min-w-0 flex-1 pb-1.5 text-xs text-text-muted">No API key required</div>
                        )}

                        {saved && <span className="pb-2 text-xs text-emerald-400">Saved</span>}
                        <button
                          onClick={() => save(item, true)}
                          disabled={loading || saving}
                          className="shrink-0 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text transition-colors hover:bg-[#303030] disabled:opacity-40"
                        >
                          {saving ? "..." : configured ? "Use" : item.requiresApiKey || item.supportsBaseUrl ? "Save & use" : "Activate"}
                        </button>
                        {configured && (!selected || !enabled) && (
                          <button
                            onClick={() => activateConfiguredProvider(item)}
                            disabled={loading || saving}
                            className="relative h-5 w-9 shrink-0 rounded-full bg-text-muted/20 transition-colors hover:bg-text-muted/30 disabled:opacity-40"
                            aria-label={`Use ${item.name}`}
                          >
                            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform" />
                          </button>
                        )}
                        {configured && selected && enabled && (
                          <span className="relative h-5 w-9 shrink-0 rounded-full bg-emerald-500">
                            <span className="absolute left-0.5 top-0.5 h-4 w-4 translate-x-4 rounded-full bg-white" />
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {expanded && error && (
                    <div className="pb-3 pl-11">
                      <div className="flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        <XCircle className="h-4 w-4" />
                        {error}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {loading && <p className="mt-3 text-xs text-text-muted">Loading config...</p>}
        </div>
      </div>
    </div>
  );
}
