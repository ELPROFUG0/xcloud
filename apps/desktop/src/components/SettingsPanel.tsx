import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import composioAppsData from "@/data/composio-apps.json";
import { useTheme, type ThemeName, type ThemeColors } from "@/hooks/use-theme";
import { RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";
import { PROVIDERS } from "@/types/provider";
import {
  Key, CheckCircle, AlertCircle,
  Cpu, ChevronLeft, Check, Search, X, Settings2, Radio, Server, Copy, Sparkles, Plug, Loader2, ExternalLink,
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

import cloudServerLogo from "@/assets/engine/cloud-server.png";
import macMiniLogo from "@/assets/engine/mac-mini.svg";
import localDesktopLogo from "@/assets/engine/local-desktop.svg";

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
  onPreviewOnboarding?: () => void;
}

type Section = "models" | "keys" | "channels" | "skills" | "integrations" | "engine" | "appearance" | "general";
type EngineMode = "local" | "mac-mini" | "vps";

interface SkillInfo {
  name: string;
  description: string;
  emoji?: string;
  author?: string;
  version?: string;
  installed?: boolean;
}

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
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "engine", label: "Engine", icon: Server },
  { id: "general", label: "General", icon: Settings2 },
];

interface ComposioApp {
  slug: string;
  name: string;
  logo: string;
  description: string;
  categories: string[];
  connected: boolean;
}

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

let skillsCache: SkillInfo[] = [];

export function SettingsPanel({ engine, section: externalSection, onPreviewOnboarding }: SettingsPanelProps) {
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
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  // Engine
  const [engineMode, setEngineModeState] = useState<EngineMode>(() =>
    (localStorage.getItem("engineMode") as EngineMode) ?? "local",
  );
  const setEngineMode = (m: EngineMode) => { setEngineModeState(m); localStorage.setItem("engineMode", m); };
  const [macMiniUrl, setMacMiniUrl] = useState(() => localStorage.getItem("engineMacMiniUrl") ?? "");
  const [macMiniToken, setMacMiniToken] = useState(() => localStorage.getItem("engineMacMiniToken") ?? "");
  const [vpsUrl, setVpsUrl] = useState(() => localStorage.getItem("engineVpsUrl") ?? "");
  const [vpsToken, setVpsToken] = useState(() => localStorage.getItem("engineVpsToken") ?? "");
  const [engineSaved, setEngineSaved] = useState(false);
  const [engineStatus, setEngineStatus] = useState<{ running: boolean; port: number; pid: number | null; managed: boolean } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [selectedEngineView, setSelectedEngineView] = useState<EngineMode | null>(null);

  // Skills
  const [skills, setSkills] = useState<SkillInfo[]>(skillsCache);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsFilter, setSkillsFilter] = useState<"all" | "ready" | "setup">("all");

  // Integrations (Composio)
  const [composioKey, setComposioKey] = useState(() => localStorage.getItem("composioApiKey") ?? "");
  const [composioApps, setComposioApps] = useState<ComposioApp[]>([]);
  const [composioLoading, setComposioLoading] = useState(false);
  const [composioError, setComposioError] = useState<string | null>(null);
  const [composioSearch, setComposioSearch] = useState("");

  // Load saved API keys from gateway config
  useEffect(() => {
    if (section !== "keys") return;
    engine.rpc("config.get", {}).then((res) => {
      const config = (res as { config?: Record<string, unknown> }).config;
      const env = (config?.env ?? {}) as Record<string, string>;
      const loaded: Record<string, KeyState> = {};
      for (const [k, v] of Object.entries(env)) {
        if (v && typeof v === "string") {
          // Mask the key: show first 8 chars + dots
          loaded[k] = { value: v, saving: false, saved: false, error: null };
        }
      }
      setKeys((prev) => ({ ...loaded, ...prev }));
    }).catch(() => {});
  }, [section, engine]);

  // Full Composio app catalog loaded from JSON + logos from CDN
  const COMPOSIO_CATALOG: ComposioApp[] = useMemo(() =>
    composioAppsData.map((a: { slug: string; name: string }) => ({
      slug: a.slug,
      name: a.name,
      logo: `https://logos.composio.dev/api/${a.slug}`,
      description: "",
      categories: [],
      connected: false,
    })),
  []);

  // Show apps and check connected status when key is present
  useEffect(() => {
    if (section !== "integrations" || !composioKey.trim()) {
      setComposioApps([]);
      return;
    }
    // Start with catalog
    setComposioApps(COMPOSIO_CATALOG);

    // Check connected status for popular apps via MCP
    (async () => {
      try {
        // Query a broad set of common toolkits to check connection status
        const checkSlugs = ["gmail", "slack", "notion", "github", "google_calendar", "google_drive",
          "discord", "twitter", "linkedin", "jira", "linear", "hubspot", "salesforce",
          "stripe", "shopify", "figma", "asana", "trello", "airtable", "dropbox"];

        const result = await invoke<string>("run_shell", {
          cmd: `curl -s -X POST "https://connect.composio.dev/mcp" -H "x-consumer-api-key: ${composioKey.trim()}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"COMPOSIO_MANAGE_CONNECTIONS","arguments":{"toolkits":[${checkSlugs.map(s => `{"name":"${s}","action":"list"}`).join(",")}]}}}'`,
        });

        const dataLine = result.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) return;

        const rpc = JSON.parse(dataLine.slice(5).trim());
        const contentText = rpc.result?.content?.[0]?.text ?? "";
        const inner = JSON.parse(contentText);
        const results = inner.data?.results ?? {};

        const connectedSlugs = new Set<string>();
        for (const [slug, info] of Object.entries(results)) {
          const toolkit = info as Record<string, unknown>;
          if (toolkit.status === "active") {
            connectedSlugs.add(slug);
          }
        }

        if (connectedSlugs.size > 0) {
          setComposioApps((prev) =>
            prev.map((a) => connectedSlugs.has(a.slug) ? { ...a, connected: true } : a)
          );
        }
      } catch { /* ignore — just won't show connected status */ }
    })();
  }, [section, composioKey, COMPOSIO_CATALOG]);

  const saveComposioKey = useCallback(async (key: string) => {
    setComposioKey(key);
    localStorage.setItem("composioApiKey", key);
    // Configure Composio MCP server in OpenClaw so agents can use connected apps
    if (key.trim()) {
      await invoke<string>("run_shell", {
        cmd: `sh -lc 'openclaw mcp set composio "{\\"transport\\":\\"streamable-http\\",\\"url\\":\\"https://connect.composio.dev/mcp\\",\\"headers\\":{\\"x-consumer-api-key\\":\\"${key.trim()}\\"}}"'`,
      }).catch(() => {});
    }
  }, []);

  const filteredComposioApps = useMemo(() => {
    if (!composioSearch.trim()) return composioApps;
    const q = composioSearch.toLowerCase();
    return composioApps.filter(a => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q));
  }, [composioApps, composioSearch]);

  const handleComposioConnect = useCallback(async (slug: string) => {
    if (!composioKey.trim()) return;
    try {
      // Call Composio MCP via Rust backend (avoids CORS)
      const result = await invoke<string>("run_shell", {
        cmd: `curl -s -X POST "https://connect.composio.dev/mcp" -H "x-consumer-api-key: ${composioKey.trim()}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"COMPOSIO_MANAGE_CONNECTIONS","arguments":{"toolkits":[{"name":"${slug}","action":"add"}]}}}'`,
      });

      // Parse SSE response
      const dataLine = result.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) throw new Error("No response from Composio");

      const rpcResponse = JSON.parse(dataLine.slice(5).trim());
      const contentText = rpcResponse.result?.content?.[0]?.text ?? "";
      const inner = JSON.parse(contentText);
      const redirectUrl = inner.data?.results?.[slug]?.redirect_url;

      if (redirectUrl) {
        await openUrl(redirectUrl);
        setComposioApps((prev) =>
          prev.map((a) => a.slug === slug ? { ...a, connected: true } : a)
        );
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (err) {
      setComposioError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [composioKey]);

  // Load skills by reading SKILL.md files directly (instant, no CLI overhead)
  useEffect(() => {
    if (section !== "skills") return;
    if (skillsCache.length > 0) { setSkills(skillsCache); return; }
    setSkillsLoading(true);

    // Read bundled + workspace skills directly from disk
    invoke<string>("run_shell", {
      cmd: `for d in $(find ~/.openclaw/workspace/skills/ ~/.openclaw/skills/ -maxdepth 1 -mindepth 1 -type d 2>/dev/null); do [ -f "$d/SKILL.md" ] && echo "===DIR:$(basename $d)===" && head -12 "$d/SKILL.md"; done`,
    }).then((output) => {
      const parsed: SkillInfo[] = [];
      const seen = new Set<string>();
      const blocks = output.split(/===DIR:([^=]+)===/);

      for (let i = 1; i < blocks.length; i += 2) {
        const dirName = blocks[i]!.trim();
        const content = blocks[i + 1] ?? "";
        const name = content.match(/^name:\s*(.+)/m)?.[1]?.trim().replace(/["']/g, "") ?? dirName;
        const desc = content.match(/description:\s*["']?([^"'\n|]+)/m)?.[1]?.trim() ?? "";
        const emoji = content.match(/emoji.*?["']([^"']+)["']/)?.[1] ?? content.match(/"emoji":\s*"([^"]+)"/)?.[1] ?? "";
        const author = content.match(/^author:\s*(.+)/m)?.[1]?.trim() ?? "";
        const version = content.match(/^version:\s*(.+)/m)?.[1]?.trim() ?? "";
        const isWorkspace = content.includes("workspace") || !output.includes("node_modules");

        if (!seen.has(name)) {
          seen.add(name);
          parsed.push({ name, description: desc.slice(0, 120), emoji, author, version, installed: false });
        }
      }

      // Show skills immediately, then check eligibility in background
      skillsCache = parsed;
      setSkills([...parsed]);
      setSkillsLoading(false);

      // Check eligibility via bundled openclaw in background
      invoke<string>("xcloud_run", { args: ["skills", "list", "--json"] }).catch(() => "{}").then((jsonOutput) => {
        try {
          const json = JSON.parse(jsonOutput);
          const list = json.skills ?? [];
          const eligibleSet = new Set<string>();
          const emojiMap = new Map<string, string>();
          const descMap = new Map<string, string>();
          for (const s of list as Array<{ name: string; eligible?: boolean; emoji?: string; description?: string }>) {
            if (s.eligible) eligibleSet.add(s.name);
            if (s.emoji) emojiMap.set(s.name, s.emoji);
            if (s.description) descMap.set(s.name, s.description);
          }
          for (const s of parsed) {
            s.installed = eligibleSet.has(s.name);
            if (emojiMap.has(s.name)) s.emoji = emojiMap.get(s.name);
            if (!s.description && descMap.has(s.name)) s.description = descMap.get(s.name)!.slice(0, 120);
          }
          skillsCache = [...parsed];
          setSkills([...parsed]);
        } catch { /* keep as-is */ }
      }).catch(() => {});
    }).catch(() => setSkillsLoading(false));
  }, [section]);

  useEffect(() => {
    if (section !== "engine") return;
    invoke<{ running: boolean; port: number; pid: number | null; managed: boolean }>("engine_status")
      .then(setEngineStatus).catch(() => {});
  }, [section]);

  useEffect(() => {
    if (!showThemeDropdown) return;
    function handleClick(e: MouseEvent) {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setShowThemeDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showThemeDropdown]);

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
    } catch {
      // Gateway restarts after config patch — "Connection closed" is expected
    }
    // Always mark as saved (the key was written before the gateway restarted)
    setKeys((prev) => ({ ...prev, [envKey]: { ...prev[envKey]!, saving: false, saved: true, error: null } }));
    setTimeout(() => {
      setKeys((prev) => {
        const c = prev[envKey];
        return c?.saved ? { ...prev, [envKey]: { ...c, saved: false } } : prev;
      });
    }, 3000);
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
    } catch {
      // Gateway restarts after config patch — expected
    }
    setChannelSaving((prev) => ({ ...prev, [channelId]: false }));
    setChannelSaved((prev) => ({ ...prev, [channelId]: true }));
    setTimeout(() => setChannelSaved((prev) => ({ ...prev, [channelId]: false })), 3000);
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
          {section === "engine" && selectedEngineView && (
            <button
              onClick={() => setSelectedEngineView(null)}
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
              : section === "engine" && selectedEngineView
              ? ({ local: "Local", "mac-mini": "Mac Mini", vps: "Cloud VPS" }[selectedEngineView])
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

          {/* API Keys */}
          {section === "keys" && (
            <div>
              {/* Subscription logins */}
              <div className="mb-6">
                <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">Subscriptions</p>
                {[
                  { id: "github-copilot-login", name: "GitHub Copilot", logo: githubLogo, cmdArgs: ["models", "auth", "login-github-copilot"], disconnectArgs: ["models", "auth", "paste-token", "--provider", "github-copilot", "--token", ""], description: "Use your Copilot subscription" },
                  { id: "codex-login", name: "OpenAI Codex", logo: openaiLogo, cmdArgs: ["models", "auth", "login", "--provider", "openai-codex"], disconnectArgs: ["models", "auth", "paste-token", "--provider", "openai-codex", "--token", ""], description: "Use your Codex subscription" },
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
                              await invoke<string>("xcloud_run", { args: item.disconnectArgs });
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
                              await invoke<string>("xcloud_run", { args: ["models", "status", "--probe"] });
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
                            // TTY-based login needs a terminal window
                            await invoke<string>("xcloud_run", { args: item.cmdArgs }).catch(() => {});
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

          {/* Skills */}
          {section === "skills" && (() => {
            const readyCount = skills.filter(s => s.installed).length;
            const setupCount = skills.filter(s => !s.installed).length;
            const filtered = skillsFilter === "all" ? skills : skillsFilter === "ready" ? skills.filter(s => s.installed) : skills.filter(s => !s.installed);

            return (
              <div>
                {/* Filter tabs */}
                <div className="flex gap-1 mb-3 items-center">
                  {([
                    { id: "all" as const, label: `All`, count: skills.length },
                    { id: "ready" as const, label: `Ready`, count: readyCount },
                    { id: "setup" as const, label: `Needs setup`, count: setupCount },
                  ]).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSkillsFilter(f.id)}
                      className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${skillsFilter === f.id ? "bg-white text-black" : "bg-container text-text-muted hover:text-text"}`}
                    >
                      {f.label} <span className={skillsFilter === f.id ? "text-black/50" : "text-text-muted/40"}>{f.count}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  {skillsLoading ? (
                    <div className="py-8 text-center text-xs text-text-muted">Loading skills...</div>
                  ) : filtered.length === 0 ? (
                    <div className="py-8 text-center">
                      <Sparkles className="h-8 w-8 text-text-muted/30 mx-auto mb-3" />
                      <p className="text-xs text-text-muted">No skills found</p>
                    </div>
                  ) : (
                    filtered.map((skill) => (
                      <div
                        key={skill.name}
                        className="rounded-lg bg-container px-4 py-3 transition-colors hover:bg-surface-hover"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-lg">
                            {skill.emoji || "⚡"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-text">{skill.name}</span>
                              {skill.version && <span className="text-[9px] text-text-muted/40">{skill.version}</span>}
                            </div>
                            <p className="text-[11px] text-text-muted leading-tight mt-0.5 truncate">{skill.description}</p>
                          </div>
                          <div className={`h-2 w-2 shrink-0 rounded-full ${skill.installed ? "bg-emerald-400" : "bg-amber-400"}`} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })()}

          {/* Engine: list view */}
          {section === "engine" && !selectedEngineView && (
            <div className="space-y-1">
              {([
                { id: "local" as EngineMode, label: "Local", desc: "This machine", img: localDesktopLogo },
                { id: "mac-mini" as EngineMode, label: "Mac Mini", desc: "Home server", img: macMiniLogo },
                { id: "vps" as EngineMode, label: "Cloud VPS", desc: "Cloud server", img: cloudServerLogo },
              ]).map(({ id, label, desc, img }) => {
                const active = engineMode === id;
                const configured = id === "local"
                  ? (engineStatus?.running ?? false)
                  : id === "mac-mini" ? !!macMiniUrl : !!vpsUrl;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedEngineView(id)}
                    className="flex w-full items-center justify-between rounded-lg bg-container px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-5 w-5 shrink-0 flex items-center justify-center">
                        <img src={img} alt={label} className="h-5 w-5 object-contain" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-text">{label}</span>
                        <span className="text-xs text-text-muted ml-2">{desc}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {active && <span className="text-xs text-text-muted">Active</span>}
                      <div className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        active && configured ? "bg-emerald-400" : active ? "bg-amber-400" : "bg-text-muted/30",
                      )} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Engine: Local detail */}
          {section === "engine" && selectedEngineView === "local" && (
            <div>
              <div className="flex justify-center py-4">
                <img src={localDesktopLogo} alt="Local" className="h-16 w-16 object-contain" />
              </div>

              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Active</span>
                <button
                  onClick={() => setEngineMode("local")}
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    engineMode === "local" ? "bg-emerald-500" : "bg-text-muted/20",
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                    engineMode === "local" ? "translate-x-4" : "translate-x-0.5",
                  )} />
                </button>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Status</span>
                <span className={cn("text-sm", engineStatus?.running ? "text-emerald-400" : "text-red-400")}>
                  {engineStatus?.running ? "Running" : "Stopped"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Port</span>
                <span className="text-sm font-mono text-text-muted">{engineStatus?.port ?? 18789}</span>
              </div>
              {engineStatus?.pid && (
                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">Process</span>
                  <span className="text-sm font-mono text-text-muted">PID {engineStatus.pid}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-text">Managed</span>
                <span className="text-sm text-text-muted">{engineStatus?.managed ? "By app" : "External"}</span>
              </div>
            </div>
          )}

          {/* Engine: Mac Mini / VPS detail */}
          {section === "engine" && (selectedEngineView === "mac-mini" || selectedEngineView === "vps") && (() => {
            const isMini = selectedEngineView === "mac-mini";
            const url = isMini ? macMiniUrl : vpsUrl;
            const token = isMini ? macMiniToken : vpsToken;
            const setUrl = isMini ? setMacMiniUrl : setVpsUrl;
            const setToken = isMini ? setMacMiniToken : setVpsToken;
            const installCmd = "curl -fsSL https://raw.githubusercontent.com/user/agent-studio/main/scripts/setup-remote.sh | bash";

            return (
              <div>
                <div className="flex justify-center py-4">
                  <img src={isMini ? macMiniLogo : cloudServerLogo} alt="" className="h-16 w-16 object-contain" />
                </div>

                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">Active</span>
                  <button
                    onClick={() => setEngineMode(selectedEngineView)}
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors",
                      engineMode === selectedEngineView ? "bg-emerald-500" : "bg-text-muted/20",
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                      engineMode === selectedEngineView ? "translate-x-4" : "translate-x-0.5",
                    )} />
                  </button>
                </div>
                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">URL</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setEngineSaved(false); }}
                    placeholder={isMini ? "ws://192.168.1.50:18789" : "ws://100.64.0.5:18789"}
                    className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between border-b border-border/50 py-3">
                  <span className="text-sm text-text">Token</span>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => { setToken(e.target.value); setEngineSaved(false); }}
                    placeholder="paste token"
                    className="w-52 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted text-right focus:outline-none"
                  />
                </div>

                {/* Setup script */}
                <div className="py-4 border-b border-border/50">
                  <h4 className="text-[13px] font-medium mb-1">
                    {isMini ? "Setup your Mac Mini" : "Setup your VPS"}
                  </h4>
                  <p className="text-xs text-text-muted mb-3">
                    {isMini
                      ? "Run this command on your Mac Mini. It will install the engine and output the URL and token."
                      : "SSH into your VPS and run this command. It will install the engine and output the URL and token."}
                  </p>
                  <div className="flex items-center gap-2">
                    <pre className="flex-1 min-w-0 rounded-xl bg-[#262626] px-3 py-2.5 text-[11px] font-mono text-text-muted leading-relaxed overflow-x-auto">{installCmd}</pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(installCmd);
                        setCopiedScript(true);
                        setTimeout(() => setCopiedScript(false), 2000);
                      }}
                      className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-[#262626] text-text-muted hover:text-text transition-colors"
                    >
                      {copiedScript ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Save */}
                <div className="flex justify-center pt-5">
                  <button
                    onClick={() => {
                      localStorage.setItem(isMini ? "engineMacMiniUrl" : "engineVpsUrl", url);
                      localStorage.setItem(isMini ? "engineMacMiniToken" : "engineVpsToken", token);
                      if (engineMode === selectedEngineView) localStorage.setItem("engineMode", selectedEngineView);
                      setEngineSaved(true);
                      setTimeout(() => setEngineSaved(false), 3000);
                    }}
                    disabled={!url.trim()}
                    className="rounded-2xl bg-text text-bg px-8 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30"
                  >
                    {engineSaved ? "Saved" : "Save"}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Appearance */}
          {section === "appearance" && (
            <div className="space-y-4">
              {/* Theme */}
              <div className="rounded-lg bg-container p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text">Theme</span>
                  <div className="relative" ref={themeDropdownRef}>
                    <button
                      onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                      className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 cursor-pointer transition-colors hover:bg-surface-hover"
                    >
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[8px] font-bold"
                        style={{ backgroundColor: themeColors.userBubble, color: themeColors.accent }}
                      >
                        Aa
                      </div>
                      <span className="text-xs font-mono text-text-muted">{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                    </button>

                    {showThemeDropdown && (
                      <div
                        className="absolute right-0 top-full mt-2 z-30 w-48 rounded-2xl p-1 shadow-2xl animate-[slideUp_150ms_ease-out]"
                        style={{
                          backgroundColor: "rgba(30, 30, 30, 0.85)",
                          backdropFilter: "blur(20px) saturate(180%)",
                          WebkitBackdropFilter: "blur(20px) saturate(180%)",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        {([
                          { id: "neutral" as ThemeName, label: "Neutral", accent: "#d4d4d8", bubble: "#1D1D1D" },
                          { id: "blue" as ThemeName, label: "Blue", accent: "#3b82f6", bubble: "#01366A" },
                          { id: "claude" as ThemeName, label: "Claude", accent: "#d97706", bubble: "#2c2417" },
                          { id: "cursor" as ThemeName, label: "Cursor", accent: "#22d3ee", bubble: "#0c2a33" },
                          { id: "emerald" as ThemeName, label: "Emerald", accent: "#10b981", bubble: "#132a1f" },
                          { id: "rose" as ThemeName, label: "Rose", accent: "#f43f5e", bubble: "#2a1318" },
                          { id: "purple" as ThemeName, label: "Purple", accent: "#a855f7", bubble: "#1e1530" },
                          { id: "sunset" as ThemeName, label: "Sunset", accent: "#f97316", bubble: "#2a1a0e" },
                        ]).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => { setTheme(t.id); setShowThemeDropdown(false); }}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors",
                              theme === t.id ? "bg-white/10" : "hover:bg-white/6",
                            )}
                          >
                            <div
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[8px] font-bold"
                              style={{ backgroundColor: t.bubble, color: t.accent }}
                            >
                              Aa
                            </div>
                            <span className="text-[11px] font-medium text-text">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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

          {/* Integrations */}
          {section === "integrations" && (
            <div className="space-y-4">
              {/* API Key */}
              <div className="rounded-lg bg-container p-4">
                <h4 className="text-[13px] font-medium mb-2">Composio API Key</h4>
                <p className="text-xs text-text-muted mb-3">
                  Get your free key at composio.dev — 20K calls/month free.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={composioKey}
                    onChange={(e) => saveComposioKey(e.target.value)}
                    placeholder="Paste your Composio API key"
                    className="flex-1 rounded-xl bg-[#262626] px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
                  />
                  <a
                    href="https://app.composio.dev/developers"
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs text-text-muted hover:text-text transition-colors"
                  >
                    Get Key <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {!composioKey.trim() ? (
                <div className="rounded-lg bg-container p-8 text-center">
                  <Plug size={32} className="mx-auto text-text-muted/30 mb-3" />
                  <p className="text-sm text-text-muted">Enter your Composio API key to see available integrations</p>
                </div>
              ) : composioLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-lg bg-container animate-pulse" />
                  ))}
                </div>
              ) : composioError ? (
                <div className="rounded-lg bg-container p-4 text-center">
                  <p className="text-xs text-red-400">{composioError}</p>
                  <button
                    onClick={() => {
                      setComposioApps([]);
                      setComposioError(null);
                      // Force re-fetch by toggling key
                      const k = composioKey;
                      setComposioKey("");
                      setTimeout(() => setComposioKey(k), 100);
                    }}
                    className="mt-2 text-xs text-text-muted hover:text-text transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Search */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      type="text"
                      value={composioSearch}
                      onChange={(e) => setComposioSearch(e.target.value)}
                      placeholder="Search 982 apps..."
                      className="w-full rounded-xl bg-container pl-8 pr-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none"
                    />
                  </div>

                  <div className="text-xs text-text-muted">
                    {filteredComposioApps.length} apps
                  </div>

                  {/* App Grid */}
                  <div className="grid grid-cols-2 gap-2 max-h-[500px] overflow-y-auto pr-1">
                    {filteredComposioApps.map((app) => (
                      <div
                        key={app.slug}
                        className={cn(
                          "flex items-center gap-3 rounded-xl bg-container px-3 py-3 transition-colors",
                          app.connected && "ring-1 ring-emerald-500/30"
                        )}
                      >
                        {app.logo ? (
                          <img src={app.logo} alt="" className="h-7 w-7 shrink-0 rounded-lg" />
                        ) : (
                          <div className="h-7 w-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-xs text-text-muted">
                            {app.name[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{app.name}</div>
                        </div>
                        {app.connected ? (
                          <span className="shrink-0 text-[10px] text-emerald-400 font-medium">Connected</span>
                        ) : (
                          <button
                            onClick={() => handleComposioConnect(app.slug)}
                            className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] text-text-muted hover:text-text hover:bg-white/15 transition-colors"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {filteredComposioApps.length === 0 && (
                    <div className="text-center py-8 text-xs text-text-muted">No apps found</div>
                  )}
                </>
              )}
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
                    <span className="text-text-muted">xCloud</span>
                    <span className="text-text">v0.1.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Engine</span>
                    <span className="text-text">OpenClaw (MIT)</span>
                  </div>
                </div>
              </div>

              {onPreviewOnboarding && (
                <div className="rounded-lg bg-container p-4">
                  <h4 className="text-[13px] font-medium mb-3">Developer</h4>
                  <button
                    onClick={onPreviewOnboarding}
                    className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-xs text-text hover:bg-white/15 transition-colors"
                  >
                    Preview Onboarding
                  </button>
                </div>
              )}
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
