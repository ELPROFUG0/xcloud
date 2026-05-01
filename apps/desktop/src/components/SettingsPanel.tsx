import { useState, useCallback } from "react";
import { useTheme, type ThemeName, type ThemeColors } from "@/hooks/use-theme";
import { RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";
import { PROVIDERS } from "@/types/provider";
import {
  Key, CheckCircle, AlertCircle,
  Cpu, ChevronLeft, Check, Search, X, Settings2, Radio,
} from "lucide-react";
import telegramLogo from "@/assets/channels/telegram.svg";
import whatsappLogo from "@/assets/channels/whatsapp.svg";
import discordLogo from "@/assets/channels/discord.svg";
import slackLogo from "@/assets/channels/slack.svg";
import signalLogo from "@/assets/channels/signal.svg";
import imessageLogo from "@/assets/channels/imessage.svg";
import matrixLogo from "@/assets/channels/matrix.svg";
import teamsLogo from "@/assets/channels/teams.svg";
import googleChatLogo from "@/assets/channels/google-chat.svg";

// Provider logos
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

interface SettingsPanelProps {
  engine: BrowserEngine;
  section?: Section;
  onBack?: () => void;
}

type Section = "models" | "keys" | "channels" | "appearance" | "general";

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
  { id: "channels", label: "Channels", icon: Radio },
  { id: "general", label: "General", icon: Settings2 },
];

interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "select" | "number" | "toggle";
  options?: string[];
  description?: string;
}

interface ChannelConfig {
  id: string;
  name: string;
  logo: string;
  fields: ChannelField[];
  advancedFields?: ChannelField[];
  description: string;
}

const CHANNELS: ChannelConfig[] = [
  {
    id: "telegram", name: "Telegram", logo: telegramLogo,
    description: "Connect your Telegram bot to receive and respond to messages.",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF...", type: "password" },
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "whatsapp", name: "WhatsApp", logo: whatsappLogo,
    description: "Connect WhatsApp to chat with your agent via phone.",
    fields: [
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"], description: 'Controls who can DM the agent. "pairing" requires a code.' },
      { key: "selfPhoneMode", label: "Self-Phone Mode", placeholder: "", type: "toggle", description: "Use your personal WhatsApp number as the bot." },
    ],
    advancedFields: [
      { key: "groupPolicy", label: "Group Policy", placeholder: "open", type: "select", options: ["open", "disabled", "allowlist"], description: "How to handle group messages." },
      { key: "replyToMode", label: "Reply Mode", placeholder: "off", type: "select", options: ["off", "first", "all", "batched"], description: "How the bot quotes messages in replies." },
      { key: "reactionLevel", label: "Reactions", placeholder: "ack", type: "select", options: ["off", "ack", "minimal", "extensive"], description: "Level of emoji reactions." },
      { key: "sendReadReceipts", label: "Read Receipts", placeholder: "", type: "toggle", description: "Send read receipts for incoming messages." },
      { key: "markdown", label: "Markdown", placeholder: "", type: "toggle", description: "Render markdown formatting in messages." },
      { key: "mediaMaxMb", label: "Max Media Size (MB)", placeholder: "50", type: "number", description: "Maximum media file size to accept." },
      { key: "messageDebounce", label: "Message Debounce (ms)", placeholder: "0", type: "number", description: "Batch rapid consecutive messages from same sender." },
      { key: "contextVisibility", label: "Context Visibility", placeholder: "all", type: "select", options: ["all", "allowlist", "allowlist_quote"], description: "Who can see message context." },
      { key: "chunkMode", label: "Chunk Mode", placeholder: "length", type: "select", options: ["length", "newline"], description: "How to split long messages." },
      { key: "blockStreaming", label: "Block Streaming", placeholder: "", type: "toggle", description: "Wait for full response before sending." },
      { key: "healthMonitor", label: "Health Monitor", placeholder: "", type: "toggle", description: "Monitor connection health automatically." },
    ],
  },
  {
    id: "discord", name: "Discord", logo: discordLogo,
    description: "Add your agent as a Discord bot in your server.",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "MTIz...", type: "password" },
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "slack", name: "Slack", logo: slackLogo,
    description: "Integrate your agent into Slack workspaces.",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", type: "password" },
      { key: "appToken", label: "App Token", placeholder: "xapp-...", type: "password" },
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "signal", name: "Signal", logo: signalLogo,
    description: "Secure messaging via Signal protocol.",
    fields: [
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "imessage", name: "iMessage", logo: imessageLogo,
    description: "Connect to iMessage (requires macOS with Messages app).",
    fields: [
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "matrix", name: "Matrix", logo: matrixLogo,
    description: "Decentralized messaging via Matrix protocol.",
    fields: [
      { key: "homeserver", label: "Homeserver", placeholder: "https://matrix.org", type: "text" },
      { key: "accessToken", label: "Access Token", placeholder: "syt_...", type: "password" },
      { key: "dmPolicy", label: "DM Policy", placeholder: "pairing", type: "select", options: ["pairing", "allowlist", "open", "disabled"] },
    ],
  },
  {
    id: "teams", name: "Microsoft Teams", logo: teamsLogo,
    description: "Add your agent to Microsoft Teams.",
    fields: [
      { key: "appId", label: "App ID", placeholder: "xxxxxxxx-xxxx-...", type: "text" },
      { key: "appPassword", label: "App Password", placeholder: "...", type: "password" },
    ],
  },
  {
    id: "google-chat", name: "Google Chat", logo: googleChatLogo,
    description: "Integrate with Google Chat workspaces.",
    fields: [
      { key: "credentials", label: "Service Account JSON", placeholder: '{"type":"service_account",...}', type: "password" },
    ],
  },
];

function renderChannelFields(
  fields: ChannelField[],
  channelId: string,
  values: Record<string, string>,
  _enabled: boolean,
  updateField: (channelId: string, field: string, value: string) => void,
  _setEnabled: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void,
) {
  return fields.map((field) => (
    <div key={field.key} className="flex items-center justify-between border-b border-border/50 py-3 last:border-0">
      <div className="min-w-0 flex-1 mr-4">
        <span className="text-sm text-text">{field.label}</span>
        {field.description && (
          <p className="text-xs text-text-muted mt-0.5 leading-tight">{field.description}</p>
        )}
      </div>
      <div className="shrink-0">
        {field.type === "select" ? (
          <select
            value={values[field.key] ?? field.placeholder}
            onChange={(e) => updateField(channelId, field.key, e.target.value)}
            className="rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text focus:outline-none appearance-none pr-7 cursor-pointer"
          >
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : field.type === "toggle" ? (
          <button
            onClick={() => updateField(channelId, field.key, values[field.key] === "true" ? "false" : "true")}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              values[field.key] === "true" ? "bg-emerald-500" : "bg-text-muted/20",
            )}
          >
            <div className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
              values[field.key] === "true" ? "translate-x-4" : "translate-x-0.5",
            )} />
          </button>
        ) : field.type === "number" ? (
          <input
            type="number"
            value={values[field.key] ?? field.placeholder}
            onChange={(e) => updateField(channelId, field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-20 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono text-right placeholder:text-text-muted focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        ) : (
          <input
            type={field.type ?? "text"}
            value={values[field.key] ?? ""}
            onChange={(e) => updateField(channelId, field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-48 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
          />
        )}
      </div>
    </div>
  ));
}

export function SettingsPanel({ engine, section: externalSection }: SettingsPanelProps) {
  const [internalSection, setSection] = useState<Section>("models");
  const section = externalSection ?? internalSection;
  const { providers, currentModel, loading, setModel } = useModels(engine);
  const { theme, setTheme, colors: themeColors, setColor, resetColor, isCustomized, contrast, setContrast } = useTheme();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [authLoading, setAuthLoading] = useState<Record<string, boolean>>({});
  const [authStatus, setAuthStatus] = useState<Record<string, string>>({});
  const [channelValues, setChannelValues] = useState<Record<string, Record<string, string>>>({});
  const [channelSaving, setChannelSaving] = useState<Record<string, boolean>>({});
  const [channelSaved, setChannelSaved] = useState<Record<string, boolean>>({});
  const [channelError, setChannelError] = useState<Record<string, string | null>>({});
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [channelEnabled, setChannelEnabled] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const updateChannelField = useCallback((channelId: string, field: string, value: string) => {
    setChannelValues((prev) => ({
      ...prev,
      [channelId]: { ...(prev[channelId] ?? {}), [field]: value },
    }));
  }, []);

  const saveChannel = useCallback(async (channelId: string) => {
    const values = channelValues[channelId] ?? {};
    const enabled = channelEnabled[channelId] ?? false;
    if (!enabled && Object.values(values).every(v => !v.trim())) return;

    setChannelSaving((prev) => ({ ...prev, [channelId]: true }));
    setChannelError((prev) => ({ ...prev, [channelId]: null }));
    try {
      const cfgRes = await engine.rpc("config.get", {});
      const hash = (cfgRes as { hash?: string }).hash ?? "";
      const channelConfig: Record<string, unknown> = { ...values };
      if (!enabled) channelConfig.enabled = false;
      await engine.patchConfig(
        JSON.stringify({ channels: { [channelId]: channelConfig } }),
        hash,
      );
      setChannelSaving((prev) => ({ ...prev, [channelId]: false }));
      setChannelSaved((prev) => ({ ...prev, [channelId]: true }));
      setTimeout(() => setChannelSaved((prev) => ({ ...prev, [channelId]: false })), 3000);
    } catch (err) {
      setChannelSaving((prev) => ({ ...prev, [channelId]: false }));
      setChannelError((prev) => ({ ...prev, [channelId]: err instanceof Error ? err.message : "Failed" }));
    }
  }, [channelValues, channelEnabled, engine]);

  const settingsContent = (
    <div className="flex-1 min-w-0 flex flex-col">
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
          {section === "channels" && selectedChannel && (
            <button
              onClick={() => setSelectedChannel(null)}
              className="text-text-muted hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h3 className="text-base font-semibold">
            {section === "models" && selectedProvider
              ? fmtProvider(selectedProvider)
              : section === "channels" && selectedChannel
              ? CHANNELS.find(c => c.id === selectedChannel)?.name ?? "Channel"
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
            <div>
              {/* Subscription logins */}
              <div className="mb-6">
                <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">Subscriptions</p>
                {[
                  { id: "github-copilot-login", name: "GitHub Copilot", logo: githubLogo, cmd: "openclaw models auth login-github-copilot", disconnectCmd: "openclaw models auth paste-token --provider github-copilot --token ''", description: "Use your Copilot subscription" },
                  { id: "codex-login", name: "OpenAI Codex", logo: openaiLogo, cmd: "openclaw models auth login --provider openai-codex", disconnectCmd: "openclaw models auth paste-token --provider openai-codex --token ''", description: "Use your Codex subscription" },
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between border-b border-border/50 py-3.5 last:border-0">
                    <div className="flex items-center gap-3 min-w-0 mr-4">
                      <img src={item.logo} alt={item.name} className="h-5 w-5 shrink-0" />
                      <div>
                        <span className="text-sm font-medium text-text">{item.name}</span>
                        <p className="text-xs text-text-muted">{item.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {authStatus[item.id] === "connected" ? (
                        <button
                          onClick={async () => {
                            setAuthLoading(p => ({ ...p, [item.id]: true }));
                            try {
                              await invoke("run_shell", { cmd: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 2>/dev/null && ${item.disconnectCmd}` });
                            } catch { /* */ }
                            setAuthStatus(p => ({ ...p, [item.id]: "" }));
                            setAuthLoading(p => ({ ...p, [item.id]: false }));
                          }}
                          disabled={authLoading[item.id]}
                          className="rounded-xl px-3 py-1.5 text-sm text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : authStatus[item.id] === "check-terminal" ? (
                        <button
                          onClick={async () => {
                            setAuthLoading(p => ({ ...p, [item.id]: true }));
                            try {
                              await invoke<string>("run_shell", { cmd: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 2>/dev/null && openclaw models status --probe 2>&1 | grep -i "${item.name.split(" ")[0]}"` });
                              setAuthStatus(p => ({ ...p, [item.id]: "connected" }));
                            } catch {
                              setAuthStatus(p => ({ ...p, [item.id]: "failed" }));
                            }
                            setAuthLoading(p => ({ ...p, [item.id]: false }));
                          }}
                          disabled={authLoading[item.id]}
                          className="rounded-xl bg-[#262626] px-4 py-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                        >
                          {authLoading[item.id] ? "..." : "Verify"}
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            setAuthLoading(p => ({ ...p, [item.id]: true }));
                            // Open terminal for TTY-based login
                            await invoke("run_shell", { cmd: `osascript -e 'tell application "Terminal" to do script "nvm use 24 && ${item.cmd}"'` }).catch(() => {});
                            setAuthStatus(p => ({ ...p, [item.id]: "check-terminal" }));
                            setAuthLoading(p => ({ ...p, [item.id]: false }));
                          }}
                          disabled={authLoading[item.id]}
                          className="rounded-xl bg-[#262626] px-4 py-1.5 text-sm text-text hover:text-white transition-colors disabled:opacity-50"
                        >
                          {authLoading[item.id] ? "..." :
                           authStatus[item.id] === "failed" ? "Retry" : "Login"}
                        </button>
                      )}
                      {authStatus[item.id] === "connected" && (
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">API Keys</p>
              {PROVIDERS.map((provider) => {
                const state = getKeyState(provider.envKey);
                const logo = PROVIDER_LOGOS[provider.id];
                return (
                  <div key={provider.id} className="flex items-center justify-between border-b border-border/50 py-3.5 last:border-0">
                    <div className="flex items-center gap-3 min-w-0 mr-4">
                      {logo && <img src={logo} alt={provider.name} className="h-5 w-5 shrink-0" />}
                      <span className="text-sm font-medium text-text">{provider.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="password"
                        value={state.value}
                        onChange={(e) => updateKey(provider.envKey, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveKey(provider.envKey)}
                        placeholder={provider.placeholder}
                        className="w-48 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
                      />
                      <button
                        onClick={() => saveKey(provider.envKey)}
                        disabled={!state.value.trim() || state.saving}
                        className="rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors disabled:opacity-30"
                      >
                        {state.saving ? "..." :
                         state.saved ? <CheckCircle className="h-4 w-4 text-emerald-400" /> :
                         "Save"}
                      </button>
                    </div>
                    {state.error && (
                      <div className="mt-1 text-xs text-red-400">{state.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Channels */}
          {section === "channels" && !selectedChannel && (
            <div className="space-y-1">
              {CHANNELS.map((ch) => {
                const enabled = channelEnabled[ch.id] ?? false;
                return (
                  <button
                    key={ch.id}
                    onClick={() => setSelectedChannel(ch.id)}
                    className="flex w-full items-center justify-between rounded-lg bg-container px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex items-center gap-3">
                      <img src={ch.logo} alt={ch.name} className="h-5 w-5" />
                      <span className="text-sm font-medium text-text">{ch.name}</span>
                    </div>
                    <div className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      enabled ? "bg-emerald-400" : "bg-text-muted/30",
                    )} />
                  </button>
                );
              })}
            </div>
          )}

          {/* Channel detail */}
          {section === "channels" && selectedChannel && (() => {
            const ch = CHANNELS.find(c => c.id === selectedChannel)!;
            const values = channelValues[ch.id] ?? {};
            const saving = channelSaving[ch.id] ?? false;
            const saved = channelSaved[ch.id] ?? false;
            const error = channelError[ch.id] ?? null;
            const enabled = channelEnabled[ch.id] ?? false;

            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <img src={ch.logo} alt={ch.name} className="h-7 w-7" />
                  <div>
                    <h4 className="text-sm font-medium">{ch.name}</h4>
                    <p className="text-[11px] text-text-muted">{ch.description}</p>
                  </div>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">Enabled</span>
                  <button
                    onClick={() => setChannelEnabled((prev) => ({ ...prev, [ch.id]: !enabled }))}
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors",
                      enabled ? "bg-emerald-500" : "bg-text-muted/20",
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                      enabled ? "translate-x-4" : "translate-x-0.5",
                    )} />
                  </button>
                </div>

                {/* Fields */}
                {renderChannelFields(ch.fields, ch.id, values, enabled, updateChannelField, setChannelEnabled)}

                {/* Advanced */}
                {ch.advancedFields && ch.advancedFields.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex w-full items-center justify-between py-3 text-sm text-text-muted hover:text-text transition-colors"
                    >
                      <span>Advanced</span>
                      <ChevronLeft className={cn("h-4 w-4 transition-transform", showAdvanced ? "rotate-90" : "-rotate-90")} />
                    </button>
                    {showAdvanced && (
                      <div className="rounded-lg bg-container/50 px-4 mb-2">
                        {renderChannelFields(ch.advancedFields, ch.id, values, enabled, updateChannelField, setChannelEnabled)}
                      </div>
                    )}
                  </>
                )}

                {/* Save */}
                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => saveChannel(ch.id)}
                    disabled={saving}
                    className="rounded-2xl bg-text text-bg px-8 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving ? "Saving..." : saved ? "Saved" : "Save"}
                  </button>
                </div>

                {error && (
                  <div className="flex items-center gap-1 text-[10px] text-red-400">
                    <AlertCircle className="h-3 w-3" />{error}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Appearance */}
          {section === "appearance" && (
            <div className="space-y-4">
              {/* Theme */}
              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-1">Theme</h4>
                <p className="text-xs text-text-muted mb-4">Choose your preferred color scheme</p>

                {/* Code preview */}
                <div className="grid grid-cols-2 gap-2 mb-4 rounded-lg overflow-hidden">
                  <div className="bg-[#1D1D1D] p-3 font-mono text-[11px] leading-relaxed">
                    <div><span className="text-text-muted/40">1</span>  <span className="text-[#d670ff]">const</span> <span className="text-[#61afef]">themePreview</span>: <span className="text-[#e5c07b]">ThemeConfig</span></div>
                    <div><span className="text-text-muted/40">2</span>    surface: <span className="text-[#98c379]">"sidebar"</span>,</div>
                    <div><span className="text-text-muted/40">3</span>    accent: <span className="text-[#98c379]">"#6366f1"</span>,</div>
                    <div><span className="text-text-muted/40">4</span>    contrast: <span className="text-[#d19a66]">42</span>,</div>
                    <div><span className="text-text-muted/40">5</span>  &#125;;</div>
                  </div>
                  <div className="bg-[#1D1D1D] p-3 font-mono text-[11px] leading-relaxed">
                    <div><span className="text-text-muted/40">1</span>  <span className="text-[#d670ff]">const</span> <span className="text-[#61afef]">themePreview</span>: <span className="text-[#e5c07b]">ThemeConfig</span></div>
                    <div><span className="text-text-muted/40">2</span>    surface: <span className="text-[#98c379]">"sidebar-elevated"</span>,</div>
                    <div><span className="text-text-muted/40">3</span>    accent: <span className="text-[#98c379]">"#818cf8"</span>,</div>
                    <div><span className="text-text-muted/40">4</span>    contrast: <span className="text-[#d19a66]">68</span>,</div>
                    <div><span className="text-text-muted/40">5</span>  &#125;;</div>
                  </div>
                </div>

                {/* Theme buttons */}
                <div className="flex gap-2">
                  {([
                    { id: "neutral" as ThemeName, label: "Neutral" },
                    { id: "blue" as ThemeName, label: "Blue" },
                  ]).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={cn(
                        "rounded-xl px-4 py-2 text-xs font-medium transition-all",
                        theme === t.id
                          ? "bg-text text-bg"
                          : "bg-surface text-text-muted hover:text-text",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Colors */}
              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-3">Colors</h4>
                {([
                  { label: "Accent", key: "accent" as keyof ThemeColors },
                  { label: "Chat bubble", key: "userBubble" as keyof ThemeColors },
                  { label: "Inline code", key: "inlineCodeColor" as keyof ThemeColors },
                ]).map((item, i, arr) => (
                  <div key={item.key} className={cn("flex items-center justify-between py-3", i < arr.length - 1 && "border-b border-border/50")}>
                    <span className="text-sm text-text">{item.label}</span>
                    <div className="flex items-center gap-2">
                      {isCustomized(item.key) && (
                        <button
                          onClick={() => resetColor(item.key)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-text hover:bg-white/8"
                          title="Reset to default"
                        >
                          <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
                        </button>
                      )}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <div className="relative h-5 w-5 rounded-full overflow-hidden" style={{ backgroundColor: themeColors[item.key] }}>
                          <input
                            type="color"
                            value={themeColors[item.key]}
                            onChange={(e) => setColor(item.key, e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                        </div>
                        <span className="rounded-lg bg-surface px-3 py-1.5 text-xs font-mono text-text-muted">{themeColors[item.key].toUpperCase()}</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              {/* Typography & Display */}
              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-3">Display</h4>

                <div className="flex items-center justify-between py-3 border-b border-border/50">
                  <span className="text-sm text-text">UI font</span>
                  <span className="text-xs text-text-muted">Inter</span>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-border/50">
                  <span className="text-sm text-text">Code font</span>
                  <span className="text-xs text-text-muted font-mono">JetBrains Mono</span>
                </div>

                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-text">Contrast</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                      className="w-32 accent-accent appearance-none h-1 rounded-full bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <span className="text-xs text-text-muted w-6 text-right">{contrast}</span>
                  </div>
                </div>
              </div>
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
  );

  if (externalSection) {
    return settingsContent;
  }

  return (
    <div className="flex h-full bg-surface">
      <div className="flex h-full w-52 shrink-0 flex-col bg-surface pt-6">
        <div className="px-5 mb-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Settings</h2>
        </div>
        <nav className="px-2 space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => { setSection(s.id); setSelectedProvider(null); setSelectedChannel(null); setSearch(""); }}
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
      {settingsContent}
    </div>
  );
}
