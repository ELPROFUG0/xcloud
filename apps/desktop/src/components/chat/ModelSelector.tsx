import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, Star, ChevronDown, Eye, Brain, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Anthropic, OpenAI, Gemini, Mistral, Groq, DeepSeek, Fireworks,
  OpenRouter, XAI, Cerebras, HuggingFace, GithubCopilot, Ollama, Bedrock,
  Azure, Together, Perplexity, Cohere, Replicate, Meta, Nvidia, Cloudflare,
  SambaNova, DeepInfra, Minimax, Moonshot, Baichuan, Yi, Zhipu, Qwen,
  AlibabaCloud, Kimi, Doubao, Stepfun, SiliconCloud, Novita, LeptonAI,
  Hyperbolic, Lambda, OpenCode, OpenClaw, Aws, Claude, Codex, Stability,
  Inception, Inflection, Ai21, Voyage, Jina, Upstage, Nebius, Featherless,
  Inference, LmStudio, Anyscale, Baseten, CentML, Friendli, Parasail, PPIO,
  Venice, Kluster, Straico, SpeedAI, WorkersAI, VertexAI, Spark,
  Vercel, ByteDance, Volcengine, Wenxin, Baidu, BaiduCloud, Tencent, TencentCloud,
  Huawei, HuaweiCloud, SenseNova, Tiangong, ChatGLM, InternLM, Grok, Microsoft,
  IBM, Apple, Snowflake, Nova, PaLM, Dbrx, Antigravity,
} from "@lobehub/icons";
import type { ModelInfo } from "@/lib/engine";

// ── Provider icon mapping ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROVIDER_ICONS: Record<string, any> = {
  anthropic: Anthropic, openai: OpenAI, google: Gemini, gemini: Gemini,
  "google-vertex": VertexAI, mistral: Mistral, groq: Groq, deepseek: DeepSeek,
  fireworks: Fireworks, openrouter: OpenRouter, xai: XAI, cerebras: Cerebras,
  huggingface: HuggingFace, "github-copilot": GithubCopilot, ollama: Ollama,
  "amazon-bedrock": Bedrock, aws: Aws, "azure-openai-responses": Azure, azure: Azure,
  together: Together, perplexity: Perplexity, cohere: Cohere, replicate: Replicate,
  meta: Meta, nvidia: Nvidia, cloudflare: Cloudflare, sambanova: SambaNova,
  "deep-infra": DeepInfra, deepinfra: DeepInfra, novita: Novita, "lepton-ai": LeptonAI,
  hyperbolic: Hyperbolic, lambda: Lambda, nebius: Nebius, featherless: Featherless,
  inference: Inference, baseten: Baseten, centml: CentML, friendli: Friendli,
  parasail: Parasail, ppio: PPIO, venice: Venice, kluster: Kluster, straico: Straico,
  "speed-ai": SpeedAI, "workers-ai": WorkersAI, anyscale: Anyscale,
  minimax: Minimax, moonshot: Moonshot, baichuan: Baichuan, yi: Yi, zhipu: Zhipu,
  qwen: Qwen, "alibaba-cloud": AlibabaCloud, alibabacloud: AlibabaCloud, kimi: Kimi,
  doubao: Doubao, stepfun: Stepfun, "silicon-cloud": SiliconCloud, siliconcloud: SiliconCloud,
  spark: Spark, stability: Stability, inception: Inception, inflection: Inflection,
  ai21: Ai21, voyage: Voyage, jina: Jina, upstage: Upstage,
  "lm-studio": LmStudio, lmstudio: LmStudio,
  vercel: Vercel, "vercel-ai-gateway": Vercel, bytedance: ByteDance, byteplus: ByteDance,
  "byteplus-plan": ByteDance, volcengine: Volcengine, wenxin: Wenxin, qianfan: Wenxin,
  baidu: Baidu, "baidu-cloud": BaiduCloud, tencent: Tencent, "tencent-cloud": TencentCloud,
  "tencent-tokenhub": Tencent, huawei: Huawei, "huawei-cloud": HuaweiCloud,
  sensenova: SenseNova, tiangong: Tiangong, chatglm: ChatGLM, internlm: InternLM,
  grok: Grok, microsoft: Microsoft, ibm: IBM, apple: Apple, snowflake: Snowflake,
  nova: Nova, palm: PaLM, dbrx: Dbrx, "google-antigravity": Antigravity,
  "kimi-coding": Kimi, "opencode-go": OpenCode, "stepfun-plan": Stepfun,
  opencode: OpenCode, openclaw: OpenClaw, claude: Claude, codex: OpenAI,
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", "openai-codex": "OpenAI Codex", codex: "OpenAI Codex", google: "Google", "amazon-bedrock": "AWS Bedrock",
  "azure-openai-responses": "Azure OpenAI", mistral: "Mistral", groq: "Groq", deepseek: "DeepSeek",
  fireworks: "Fireworks", openrouter: "OpenRouter", "github-copilot": "GitHub Copilot", xai: "xAI",
  cerebras: "Cerebras", huggingface: "Hugging Face", ollama: "Ollama",
};

function fmtProvider(id: string): string {
  return PROVIDER_NAMES[id] ?? id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatModelName(raw: string): string {
  const id = raw.split("/").pop() ?? raw;
  const claudeMatch = id.match(/claude-(\w+)-([\d]+)-([\d]+)/);
  if (claudeMatch) {
    const name = claudeMatch[1]!.charAt(0).toUpperCase() + claudeMatch[1]!.slice(1);
    return `${name} ${claudeMatch[2]}.${claudeMatch[3]}`;
  }
  if (id.startsWith("gpt-")) {
    return id.replace("gpt-", "GPT-").split("-").map(w =>
      w === "mini" ? "Mini" : w === "turbo" ? "Turbo" : w
    ).join(" ").replace("GPT ", "GPT-");
  }
  if (id.startsWith("gemini-")) return id.replace("gemini-", "Gemini ").replace(/-/g, " ");
  return id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Capabilities ────────────────────────────────────────────────────────────
const REASONING = ["o1", "o3", "o4", "deepseek-r1", "deepseek-reasoner", "r1", "claude-3-7", "claude-opus-4", "claude-sonnet-4", "qwq", "qwen3", "gemini-2.5", "grok-3"];
const PDF = ["claude-3", "claude-opus", "claude-sonnet", "claude-haiku", "gpt-4o", "gpt-4-turbo", "gpt-5", "gemini-2", "gemini-1.5"];
function hasVision(m: ModelInfo) { return m.input?.some(i => i.includes("image")) ?? false; }
function hasReasoning(m: ModelInfo) { return m.reasoning || REASONING.some(r => m.id.toLowerCase().includes(r)); }
function hasPDF(m: ModelInfo) { return PDF.some(p => m.id.toLowerCase().includes(p)); }
function getCostTier(m: ModelInfo): number {
  const id = m.id.toLowerCase();
  if (id.includes("o1-pro") || id.includes("o3-pro") || id.includes("gpt-5.5") || id.includes("opus-4-6")) return 4;
  if (id.includes("opus") || id.includes("gpt-5") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return 3;
  if (id.includes("sonnet") || id.includes("gpt-4o") || id.includes("pro") || id.includes("gemini-2.5")) return 2;
  if (id.includes("haiku") || id.includes("mini") || id.includes("lite") || id.includes("micro") || id.includes("flash") || id.includes("nano")) return 0;
  return 1;
}

function ProviderIcon({ provider, size = 18 }: { provider: string; size?: number }) {
  const Icon = PROVIDER_ICONS[provider];
  if (!Icon) return <div style={{ width: size, height: size }} />;
  return <Icon size={size} />;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface ProviderGroup {
  provider: string;
  models: ModelInfo[];
}

interface ModelSelectorProps {
  open: boolean;
  closing?: boolean;
  onClose: () => void;
  providers: ProviderGroup[];
  currentModel: string | null;
  onSelectModel: (modelId: string) => void;
  placement?: "above" | "below";
}

// ── Model stats ─────────────────────────────────────────────────────────────
function getModelStats(m: ModelInfo): { speed: number; intelligence: number; tokenUsage: number; description: string } {
  const id = m.id.toLowerCase();
  // Speed: smaller/faster models = higher
  let speed = 3;
  if (id.includes("haiku") || id.includes("mini") || id.includes("flash") || id.includes("lite") || id.includes("nano") || id.includes("micro")) speed = 5;
  else if (id.includes("sonnet") || id.includes("gpt-4o") || id.includes("gemini-2.0")) speed = 4;
  else if (id.includes("pro") || id.includes("gpt-4-turbo")) speed = 3;
  else if (id.includes("opus") || id.includes("gpt-5") || id.includes("o1") || id.includes("o3")) speed = 2;
  else if (id.includes("o1-pro") || id.includes("o3-pro") || id.includes("gpt-5.5")) speed = 1;

  // Intelligence: larger/reasoning models = higher
  let intelligence = 3;
  if (id.includes("opus-4-6") || id.includes("opus-4-7") || id.includes("gpt-5.5") || id.includes("o3-pro")) intelligence = 5;
  else if (id.includes("opus") || id.includes("gpt-5") || id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("gemini-2.5")) intelligence = 5;
  else if (id.includes("sonnet") || id.includes("gpt-4o") || id.includes("pro") || id.includes("deepseek-r1")) intelligence = 4;
  else if (id.includes("haiku") || id.includes("mini") || id.includes("flash")) intelligence = 2;
  else if (id.includes("nano") || id.includes("micro") || id.includes("lite")) intelligence = 1;

  // Token usage: bigger models = more tokens
  let tokenUsage = 3;
  if (id.includes("opus") || id.includes("gpt-5") || id.includes("o1-pro") || id.includes("o3-pro")) tokenUsage = 5;
  else if (id.includes("o1") || id.includes("o3") || id.includes("o4")) tokenUsage = 4;
  else if (id.includes("sonnet") || id.includes("gpt-4o") || id.includes("pro")) tokenUsage = 3;
  else if (id.includes("haiku") || id.includes("mini") || id.includes("flash")) tokenUsage = 2;
  else if (id.includes("nano") || id.includes("micro") || id.includes("lite")) tokenUsage = 1;

  // Description
  let description = "General-purpose language model.";
  if (id.includes("haiku") || id.includes("mini") || id.includes("flash") || id.includes("lite")) description = "Fast, lightweight model optimized for speed and cost efficiency.";
  else if (id.includes("opus")) description = "Most capable model with deep reasoning and analysis.";
  else if (id.includes("sonnet")) description = "Balanced model with strong performance and efficiency.";
  else if (id.includes("o1") || id.includes("o3") || id.includes("deepseek-r1")) description = "Advanced reasoning model for complex problem solving.";
  else if (id.includes("gpt-5")) description = "Frontier model with broad capabilities.";
  else if (id.includes("gpt-4o")) description = "Fast multimodal model with vision and text.";
  else if (id.includes("gemini-2.5")) description = "Google's advanced reasoning and multimodal model.";
  else if (id.includes("gemini-2.0") || id.includes("gemini-1.5")) description = "Multimodal model with long context support.";
  else if (id.includes("grok")) description = "xAI's conversational model with real-time knowledge.";
  else if (id.includes("deepseek")) description = "Open-source model with strong coding abilities.";
  else if (id.includes("mistral") || id.includes("mixtral")) description = "Efficient European model with multilingual support.";
  else if (id.includes("qwen")) description = "Alibaba's multilingual model with broad capabilities.";
  else if (id.includes("llama")) description = "Meta's open-source model family.";

  return { speed, intelligence, tokenUsage, description };
}

// ── Floating tooltip ────────────────────────────────────────────────────────
function ModelInfoTooltip({ model, provider, anchorRect }: { model: ModelInfo | null; provider: string; anchorRect: DOMRect | null }) {
  if (!model || !anchorRect) return null;

  let stats: ReturnType<typeof getModelStats>;
  try { stats = getModelStats(model); } catch { return null; }

  const Icon = PI[provider];
  let vision = false, reasoning = false, pdf = false;
  try { vision = hasVision(model); reasoning = hasReasoning(model); pdf = hasPDF(model); } catch {}

  // Clamp position to viewport
  const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - 220));
  const left = Math.min(anchorRect.right + 8, window.innerWidth - 280);

  return (
    <div
      className="fixed z-[100] pointer-events-none"
      style={{ top, left }}
    >
      <div className="w-[260px] rounded-lg border border-border bg-surface p-3.5 shadow-xl text-xs">
        {/* Header */}
        <div className="flex items-center gap-2">
          {Icon && <div className="text-text-muted"><Icon size={16} /></div>}
          <span className="font-semibold text-text">{formatModelName(model.name || model.id)}</span>
        </div>

        {/* Description */}
        <p className="mt-1.5 text-text-muted leading-relaxed">{stats.description}</p>

        {/* Capabilities */}
        {(vision || reasoning || pdf) && (
          <div className="mt-2 flex items-center gap-2">
            {vision && (
              <div className="flex items-center gap-1 text-teal-400/80">
                <Eye className="h-3 w-3" />
                <span className="text-[10px]">Vision</span>
              </div>
            )}
            {reasoning && (
              <div className="flex items-center gap-1 text-purple-400/80">
                <Brain className="h-3 w-3" />
                <span className="text-[10px]">Reasoning</span>
              </div>
            )}
            {pdf && (
              <div className="flex items-center gap-1 text-blue-400/80">
                <FileText className="h-3 w-3" />
                <span className="text-[10px]">PDF</span>
              </div>
            )}
          </div>
        )}

        {/* Bars */}
        <div className="mt-2.5 grid gap-1.5">
          {[
            { label: "Speed", value: stats.speed },
            { label: "Intelligence", value: stats.intelligence },
            { label: "Token usage", value: stats.tokenUsage },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-text-muted">{label}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className={cn(
                      "w-4 h-1 rounded-full",
                      i <= value ? "bg-accent" : "bg-white/8",
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Context window */}
        {model.contextWindow && (
          <div className="mt-2 flex items-center justify-between text-text-muted">
            <span>Context</span>
            <span className="font-mono">
              {model.contextWindow >= 1_000_000
                ? `${(model.contextWindow / 1_000_000).toFixed(0)}M tokens`
                : `${Math.round(model.contextWindow / 1000)}k tokens`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelSelector({ open, closing = false, onClose, providers, currentModel, onSelectModel, placement = "above" }: ModelSelectorProps) {
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [hoverY, setHoverY] = useState(0);
  const [hoveredModel, setHoveredModel] = useState<ModelInfo | null>(null);
  const [hoveredProvider, setHoveredProvider] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("modelFavorites") ?? "[]")); } catch { return new Set(); }
  });
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open || closing) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  // Focus search on open
  useEffect(() => {
    if (open && !closing) {
      setTimeout(() => searchRef.current?.focus(), 50);
      setSearch("");
    }
  }, [open]);

  // Auto-select provider of current model
  useEffect(() => {
    if (!open || activeProvider) return;
    if (currentModel) {
      const provider = providers.find(g =>
        g.models.some(m => m.id === currentModel || `${m.provider}/${m.id}` === currentModel)
      );
      if (provider) setActiveProvider(provider.provider);
    }
    if (!activeProvider && providers[0]) setActiveProvider(providers[0].provider);
  }, [open, providers, currentModel, activeProvider]);

  const toggleFavorite = (modelId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      localStorage.setItem("modelFavorites", JSON.stringify([...next]));
      return next;
    });
  };

  // Filter models based on search
  const displayModels = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const results: (ModelInfo & { _provider: string })[] = [];
      for (const g of providers) {
        for (const m of g.models) {
          if (m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || g.provider.toLowerCase().includes(q)) {
            results.push({ ...m, _provider: g.provider });
          }
        }
      }
      return results;
    }
    if (!activeProvider) return [];
    const group = providers.find(g => g.provider === activeProvider);
    return (group?.models ?? []).map(m => ({ ...m, _provider: activeProvider }));
  }, [search, activeProvider, providers]);

  // Favorites section
  const favoriteModels = useMemo(() => {
    if (search.trim()) return [];
    const results: (ModelInfo & { _provider: string })[] = [];
    for (const g of providers) {
      for (const m of g.models) {
        const fullId = m.id.includes("/") ? m.id : `${m.provider}/${m.id}`;
        if (favorites.has(fullId) || favorites.has(m.id)) {
          results.push({ ...m, _provider: g.provider });
        }
      }
    }
    return results;
  }, [providers, favorites, search]);

  const showFavorites = activeProvider === "__favorites" && !search.trim();
  const selectorWidth = 320;
  const selectorBodyHeight = 285;

  if (!open && !closing) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50",
        placement === "below" ? "left-0 top-full mt-0.5" : "bottom-full left-6 mb-2",
      )}
    >
      {/* Modal */}
      <div
        className={cn(
          "rounded-xl border border-border shadow-2xl",
          closing ? "animate-[popoverOut_140ms_ease-in_forwards]" : "animate-[slideUp_150ms_ease-out]",
        )}
        style={{
          background: "#141414",
          maxHeight: "min(350px, calc(100dvh - 14rem))",
          width: selectorWidth,
          overflow: "hidden",
        }}
      >
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
        <div className="flex flex-1 items-center border-b border-border/50 pb-1">
          <Search className="mr-2.5 h-3.5 w-3.5 shrink-0 text-text-muted/60" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="w-full bg-transparent py-0.5 text-[12px] text-text placeholder:text-text-muted/50 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-muted hover:text-text">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main content: sidebar + models */}
      <div className="flex" style={{ height: selectorBodyHeight }}>
        {/* Provider sidebar */}
        <div className="w-12 shrink-0 overflow-y-auto hide-scrollbar border-r border-border/30 bg-white/[0.02]">
          <div className="flex flex-col items-center gap-0.5 p-1">
            {/* Favorites */}
            <button
              onClick={() => { setActiveProvider("__favorites"); setSearch(""); }}
              className={cn(
                "group relative flex shrink-0 items-center justify-center rounded-xl transition-all hover:bg-white/[0.06]",
                "h-8 w-8",
              )}
              title="Favorites"
            >
              {activeProvider === "__favorites" && (
                <div className="absolute top-1/2 -right-1 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-accent" />
              )}
              <Star className={cn("h-3.5 w-3.5 transition-colors", activeProvider === "__favorites" ? "text-text fill-text" : "text-text-muted")} />
            </button>

            <div className="my-0.5 h-px w-6 bg-border/40" />

            {/* Provider icons */}
            {providers.map((g) => (
              <button
                key={g.provider}
                onClick={() => { setActiveProvider(g.provider); setSearch(""); }}
                className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all hover:bg-white/[0.06]"
                title={fmtProvider(g.provider)}
              >
                {activeProvider === g.provider && (
                  <div className="absolute top-1/2 -right-1 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-accent" />
                )}
                <div className={cn("transition-opacity", activeProvider === g.provider ? "opacity-100 text-text" : "opacity-60 text-text-muted group-hover:opacity-100 group-hover:text-text")}>
                  <ProviderIcon provider={g.provider} size={15} />
                </div>
              </button>
            ))}
          </div>

          {/* Scroll fade */}
          <div className="pointer-events-none sticky bottom-0 h-8 bg-gradient-to-t from-bg/80 to-transparent" />
        </div>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto hide-scrollbar p-1.5">
          {/* Provider header when no search */}
          {!search.trim() && activeProvider && activeProvider !== "__favorites" && (
            <div className="flex items-center gap-2 px-2 pb-2">
              <ProviderIcon provider={activeProvider} size={14} />
              <span className="text-xs font-medium text-text">{fmtProvider(activeProvider)}</span>
              <span className="text-[10px] text-text-muted">{displayModels.length} models</span>
            </div>
          )}

          {showFavorites && (
            <div className="flex items-center gap-2 px-2 pb-2">
              <Star className="h-3.5 w-3.5 text-text fill-text" />
              <span className="text-xs font-medium text-text">Favorites</span>
              <span className="text-[10px] text-text-muted">{favoriteModels.length}</span>
            </div>
          )}

          {search.trim() && (
            <div className="flex items-center gap-2 px-2 pb-2">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <span className="text-xs font-medium text-text">Results</span>
              <span className="text-[10px] text-text-muted">{displayModels.length}</span>
            </div>
          )}

          <div className="space-y-0.5">
            {(showFavorites ? favoriteModels : displayModels).map((model) => {
              const fullId = model.id.includes("/") ? model.id : `${model._provider}/${model.id}`;
              const isActive = currentModel === fullId || currentModel === model.id;
              const isFav = favorites.has(fullId) || favorites.has(model.id);

              const vision = hasVision(model);
              const reasoning = hasReasoning(model);
              const pdf = hasPDF(model);
              const cost = getCostTier(model);
              const hasCapabilities = vision || reasoning || pdf;

              return (
                <div key={model.id} className="group/item">
                  <button
                    onClick={() => { onSelectModel(fullId); onClose(); }}
                    onMouseEnter={(e) => {
                      const btn = e.currentTarget;
                      const container = ref.current;
                      if (container) {
                        setHoverY(btn.getBoundingClientRect().top - container.getBoundingClientRect().top);
                      }
                      setHoveredModel(model);
                      setHoveredProvider(model._provider);
                    }}
                    onMouseLeave={() => setHoveredModel(null)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 text-left transition-all hover:bg-white/[0.05]",
                      "py-1.5",
                      isActive && "bg-white/[0.06]",
                    )}
                  >
                    <div className={cn("shrink-0", isActive ? "text-text" : "text-text-muted/60")}>
                      <ProviderIcon provider={model._provider} size={14} />
                    </div>
                    <span className={cn("text-[12px] truncate flex-1", isActive ? "text-text font-medium" : "text-text")}>
                      {formatModelName(model.name || model.id)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(fullId); }}
                      className={cn("shrink-0 rounded p-0.5 transition-colors", isFav ? "text-yellow-500" : "text-text-muted/30 opacity-0 group-hover/item:opacity-100 hover:text-yellow-500")}
                    >
                      <Star className={cn("h-3 w-3", isFav && "fill-yellow-500")} />
                    </button>
                    {isActive && (
                      <div className="shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    )}
                  </button>
                </div>
              );
            })}

            {(showFavorites ? favoriteModels : displayModels).length === 0 && (
              <div className="py-8 text-center text-xs text-text-muted">
                {showFavorites ? "No favorites yet — star a model to add it" : "No models found"}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Tooltip — sibling of modal, NOT child of overflow:hidden */}
      {hoveredModel && (() => {
        const st = getModelStats(hoveredModel);
        const Icon = PROVIDER_ICONS[hoveredProvider];
        return (
          <div
            className="absolute pointer-events-none"
            ref={(el) => {
              if (!el) return;
              const modalH = ref.current?.firstElementChild?.getBoundingClientRect().height ?? 400;
              const tooltipH = el.getBoundingClientRect().height;
              el.style.top = Math.min(hoverY, modalH - tooltipH) + "px";
            }}
            style={{ left: selectorWidth + 6, width: 230 }}
          >
            <div className="rounded-lg border border-border p-3 shadow-xl text-xs" style={{ background: "#1a1a1a" }}>
              <div className="flex items-center gap-2">
                {Icon && <Icon size={14} />}
                <span className="font-semibold text-text">{formatModelName(hoveredModel.name || hoveredModel.id)}</span>
              </div>
              <p className="mt-1.5 text-text-muted leading-relaxed">{st.description}</p>
              <div className="mt-2 grid gap-1">
                {[{ l: "Speed", v: st.speed }, { l: "Intelligence", v: st.intelligence }, { l: "Token usage", v: st.tokenUsage }].map(({ l, v: val }) => (
                  <div key={l} className="flex items-center justify-between">
                    <span className="text-text-muted">{l}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className={cn("w-4 h-1 rounded-full", i <= val ? "bg-accent" : "bg-white/8")} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {hoveredModel.contextWindow && (
                <div className="mt-1.5 flex items-center justify-between text-text-muted">
                  <span>Context</span>
                  <span className="font-mono text-text/80">{hoveredModel.contextWindow >= 1_000_000 ? `${(hoveredModel.contextWindow / 1_000_000).toFixed(0)}M` : `${Math.round(hoveredModel.contextWindow / 1000)}k`}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Trigger button ──────────────────────────────────────────────────────────
interface ModelSelectorTriggerProps {
  currentModel: string | null;
  onClick: () => void;
  open: boolean;
}

export function ModelSelectorTrigger({ currentModel, onClick, open }: ModelSelectorTriggerProps) {
  const display = currentModel ? formatModelName(currentModel) : "Model";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-7 max-w-[230px] items-center gap-2 rounded-full px-2 py-1 text-[12px] transition-colors",
        "bg-[#333] text-[#999] hover:bg-white/[0.06] hover:text-[#bbb]",
      )}
    >
      <span className="max-w-[120px] truncate">{display}</span>
      <ChevronDown className={cn("h-3 w-3 opacity-50 transition-transform", open && "rotate-180")} />
    </button>
  );
}
