import { useState, useCallback, useEffect } from "react";
import { ChevronLeft, AlertCircle, CheckCircle, Eye, EyeOff, PlayCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import type { AgentInfo } from "@/hooks/use-agents";
import { ShowQr } from "@/components/ui/show-qr";
import type { ChannelField, ChannelConfig } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";

import telegramLogo from "@/assets/channels/telegram.svg";
import whatsappLogo from "@/assets/channels/whatsapp.svg";
import discordLogo from "@/assets/channels/discord.svg";
import slackLogo from "@/assets/channels/slack.svg";
import signalLogo from "@/assets/channels/signal.svg";
import imessageLogo from "@/assets/channels/imessage.svg";
import matrixLogo from "@/assets/channels/matrix.svg";
import teamsLogo from "@/assets/channels/teams.svg";
import googleChatLogo from "@/assets/channels/google-chat.svg";

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

const TELEGRAM_DM_POLICIES = [
  {
    id: "pairing",
    label: "Pairing",
    description: "Recommended. New users must pair before they can talk to the agent.",
  },
  {
    id: "allowlist",
    label: "Allowlist",
    description: "Only specific Telegram user IDs or handles can DM the agent.",
  },
  {
    id: "open",
    label: "Open",
    description: "Anyone can DM the bot. The UI will add the required wildcard allowlist.",
  },
  {
    id: "disabled",
    label: "Disabled",
    description: "Telegram DMs are ignored.",
  },
] as const;

const BOTFATHER_URL = "https://t.me/BotFather";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function isWhatsAppLoginProviderUnavailable(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("web login provider is not available");
}

function isQrDataImage(value: string) {
  return value.startsWith("data:image/");
}

function stringFromConfigValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseAllowFrom(value: string | undefined, dmPolicy: string) {
  const entries = (value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (dmPolicy === "open" && !entries.includes("*")) entries.unshift("*");
  return Array.from(new Set(entries));
}

function buildChannelPatch(values: Record<string, string>, enabled: boolean) {
  const channelConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!value.trim()) continue;
    if (key === "allowFrom") {
      const allowFrom = parseAllowFrom(value, values.dmPolicy);
      if (allowFrom.length > 0) channelConfig.allowFrom = allowFrom;
      continue;
    }
    if (value === "true" || value === "false") {
      channelConfig[key] = value === "true";
      continue;
    }
    channelConfig[key] = value.trim();
  }
  channelConfig.enabled = enabled;
  if (values.dmPolicy === "open") {
    channelConfig.allowFrom = parseAllowFrom(values.allowFrom, "open");
  }
  return channelConfig;
}

function getMainAgentId(agents: AgentInfo[]) {
  return agents.find((agent) => agent.isDefault)?.id ?? agents[0]?.id ?? "main";
}

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
            className="h-9 min-w-48 appearance-none rounded-xl bg-[#262626] py-1.5 pl-3 pr-9 text-sm text-text transition-colors hover:bg-[#2d2d2d] focus:outline-none cursor-pointer"
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

interface ChannelsSectionProps {
  engine: BrowserEngine;
  agents?: AgentInfo[];
}

type ConfigBinding = {
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function ChannelsSection({ engine, agents = [] }: ChannelsSectionProps) {
  const [channelValues, setChannelValues] = useState<Record<string, Record<string, string>>>({});
  const [telegramAgentBots, setTelegramAgentBots] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState<Record<string, boolean>>({});
  const [channelSaved, setChannelSaved] = useState<Record<string, boolean>>({});
  const [channelError, setChannelError] = useState<Record<string, string | null>>({});
  const [telegramPairingCode, setTelegramPairingCode] = useState("");
  const [telegramPairingOutput, setTelegramPairingOutput] = useState("");
  const [telegramPairingRunning, setTelegramPairingRunning] = useState(false);
  const [telegramTokenVisible, setTelegramTokenVisible] = useState(false);
  const [showTelegramSecurity, setShowTelegramSecurity] = useState(false);
  const [showWhatsAppSecurity, setShowWhatsAppSecurity] = useState(false);
  const [whatsAppLoginRunning, setWhatsAppLoginRunning] = useState(false);
  const [whatsAppLoginOutput, setWhatsAppLoginOutput] = useState("");
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState("");
  const [whatsAppLoginConnected, setWhatsAppLoginConnected] = useState<boolean | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedTelegramAgentId, setSelectedTelegramAgentId] = useState<string>("");
  const [channelEnabled, setChannelEnabled] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    engine.rpc("config.get", {}).then((res) => {
      if (cancelled) return;
      const config = (res as { config?: Record<string, unknown> }).config;
      const channels = (config?.channels ?? {}) as Record<string, Record<string, unknown>>;
      const telegramAccounts = (channels.telegram?.accounts ?? {}) as Record<string, Record<string, unknown>>;
      const mainAgentId = getMainAgentId(agents);
      const nextValues: Record<string, Record<string, string>> = {};
      const nextEnabled: Record<string, boolean> = {};
      const nextTelegramAgentBots: Record<string, string> = {};
      for (const channel of CHANNELS) {
        const channelConfig = channels[channel.id];
        if (!channelConfig || typeof channelConfig !== "object") continue;
        nextEnabled[channel.id] = channelConfig.enabled !== false;
        nextValues[channel.id] = Object.fromEntries(
          Object.entries(channelConfig)
            .filter(([key]) => key !== "enabled" && key !== "accounts")
            .map(([key, value]) => [key, stringFromConfigValue(value)]),
        );
      }
      for (const [agentId, accountConfig] of Object.entries(telegramAccounts)) {
        const token = accountConfig?.botToken;
        const normalizedAgentId = agentId === "default" ? mainAgentId : agentId;
        if (typeof token === "string" && token.trim()) nextTelegramAgentBots[normalizedAgentId] = token;
      }
      const legacyMainToken = channels.telegram?.botToken;
      if (typeof legacyMainToken === "string" && legacyMainToken.trim() && !nextTelegramAgentBots[mainAgentId]) {
        nextTelegramAgentBots[mainAgentId] = legacyMainToken;
      }
      setChannelValues((prev) => ({ ...prev, ...nextValues }));
      setChannelEnabled((prev) => ({ ...prev, ...nextEnabled }));
      setTelegramAgentBots((prev) => ({ ...prev, ...nextTelegramAgentBots }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [engine, agents]);

  useEffect(() => {
    if (selectedTelegramAgentId && agents.some((agent) => agent.id === selectedTelegramAgentId)) return;
    const defaultAgent = agents.find((agent) => agent.isDefault) ?? agents[0];
    if (defaultAgent) setSelectedTelegramAgentId(defaultAgent.id);
  }, [agents, selectedTelegramAgentId]);

  const updateChannelField = useCallback((channelId: string, field: string, value: string) => {
    setChannelValues((prev) => ({
      ...prev,
      [channelId]: { ...(prev[channelId] ?? {}), [field]: value },
    }));
  }, []);

  const updateTelegramAgentBot = useCallback((agentId: string, value: string) => {
    setTelegramAgentBots((prev) => ({ ...prev, [agentId]: value }));
  }, []);

  const buildTelegramAccountsPatch = useCallback((values: Record<string, string>, existingAccounts: unknown) => {
    const dmPolicy = values.dmPolicy || "pairing";
    const allowFrom = parseAllowFrom(values.allowFrom, dmPolicy);
    const mainAgentId = getMainAgentId(agents);
    const accounts: Record<string, unknown> = existingAccounts && typeof existingAccounts === "object" && !Array.isArray(existingAccounts)
      ? { ...(existingAccounts as Record<string, unknown>) }
      : {};

    for (const agent of agents) {
      const botToken = (telegramAgentBots[agent.id] ?? "").trim();
      if (botToken) {
        const accountConfig = {
          enabled: true,
          name: agent.name ?? agent.id,
          botToken,
          dmPolicy,
          ...(allowFrom.length > 0 ? { allowFrom } : {}),
        };
        accounts[agent.id] = accountConfig;
        if (agent.id === mainAgentId) {
          accounts.default = {
            ...accountConfig,
            name: "Default Telegram bot",
          };
        }
      } else if (agent.id in telegramAgentBots) {
        accounts[agent.id] = null;
        if (agent.id === mainAgentId && "default" in accounts) {
          accounts.default = null;
        }
      }
    }
    return accounts;
  }, [agents, telegramAgentBots]);

  const buildTelegramBindingsPatch = useCallback((existingBindings: unknown) => {
    const managedAgentIds = new Set(agents.map((agent) => agent.id));
    const configuredAgentIds = new Set(
      Object.entries(telegramAgentBots)
        .filter(([, botToken]) => botToken.trim())
        .map(([agentId]) => agentId),
    );
    const current = Array.isArray(existingBindings) ? existingBindings.filter((binding): binding is ConfigBinding => Boolean(binding) && typeof binding === "object") : [];
    const preserved = current.filter((binding) => {
      const match = binding.match;
      if (match?.channel !== "telegram") return true;
      if (!match.accountId) return true;
      return !managedAgentIds.has(match.accountId);
    });
    const next = [...preserved];
    for (const agentId of configuredAgentIds) {
      next.push({ agentId, match: { channel: "telegram", accountId: agentId } });
    }
    return next;
  }, [agents, telegramAgentBots]);

  const saveChannel = useCallback(async (channelId: string, forceEnabled?: boolean) => {
    const rawValues = channelValues[channelId] ?? {};
    const values = channelId === "telegram" ? { dmPolicy: "pairing", ...rawValues } : rawValues;
    const enabled = forceEnabled ?? channelEnabled[channelId] ?? false;
    if (!enabled && Object.values(values).every(v => !v.trim())) return;

    setChannelSaving((prev) => ({ ...prev, [channelId]: true }));
    setChannelError((prev) => ({ ...prev, [channelId]: null }));
    try {
      const cfgRes = await engine.rpc("config.get", {});
      const hash = (cfgRes as { hash?: string }).hash ?? "";
      const existingConfig = (cfgRes as { config?: Record<string, unknown> }).config ?? {};
      const channelConfig = buildChannelPatch(values, enabled);
      if (channelId === "telegram") {
        channelConfig.botToken = null;
      }
      const patch: Record<string, unknown> = { channels: { [channelId]: channelConfig } };
      if (channelId === "telegram") {
        const existingChannels = (existingConfig.channels ?? {}) as Record<string, Record<string, unknown>>;
        const existingTelegram = existingChannels.telegram ?? {};
        const accounts = buildTelegramAccountsPatch(values, existingTelegram.accounts);
        if (Object.keys(accounts).length > 0) {
          channelConfig.accounts = accounts;
        }
        patch.bindings = buildTelegramBindingsPatch(existingConfig.bindings);
      }
      if (channelId === "whatsapp") {
        const existingChannels = (existingConfig.channels ?? {}) as Record<string, Record<string, unknown>>;
        const existingWhatsApp = existingChannels.whatsapp ?? {};
        const existingAccounts = existingWhatsApp.accounts && typeof existingWhatsApp.accounts === "object" && !Array.isArray(existingWhatsApp.accounts)
          ? existingWhatsApp.accounts as Record<string, unknown>
          : {};
        channelConfig.accounts = {
          ...existingAccounts,
          default: {
            ...((existingAccounts.default && typeof existingAccounts.default === "object" && !Array.isArray(existingAccounts.default)) ? existingAccounts.default as Record<string, unknown> : {}),
            name: "WhatsApp",
            enabled: true,
          },
        };
        patch.plugins = { entries: { whatsapp: { enabled: true } } };
      }
      await engine.patchConfig(
        JSON.stringify(patch),
        hash,
      );
    } catch {
      // Gateway restarts after config patch — expected
    }
    setChannelSaving((prev) => ({ ...prev, [channelId]: false }));
    setChannelSaved((prev) => ({ ...prev, [channelId]: true }));
    setTimeout(() => setChannelSaved((prev) => ({ ...prev, [channelId]: false })), 3000);
  }, [buildTelegramAccountsPatch, buildTelegramBindingsPatch, channelValues, channelEnabled, engine]);

  const listPairings = useCallback(async (channelId: "telegram" | "whatsapp") => {
    setTelegramPairingRunning(true);
    setTelegramPairingOutput("");
    try {
      const output = await invoke<string>("xcloud_run", { args: ["pairing", "list", channelId, "--json"] });
      setTelegramPairingOutput(output.trim() || `No pending ${channelId} pairing requests.`);
    } catch (error) {
      setTelegramPairingOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setTelegramPairingRunning(false);
    }
  }, []);

  const approvePairing = useCallback(async (channelId: "telegram" | "whatsapp") => {
    const code = telegramPairingCode.trim();
    if (!code) {
      setTelegramPairingOutput("Paste the pairing code first.");
      return;
    }
    setTelegramPairingRunning(true);
    setTelegramPairingOutput("");
    try {
      const output = await invoke<string>("xcloud_run", { args: ["pairing", "approve", channelId, code, "--notify"] });
      setTelegramPairingOutput(output.trim() || `${channelId} user approved.`);
      setTelegramPairingCode("");
    } catch (error) {
      setTelegramPairingOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setTelegramPairingRunning(false);
    }
  }, [telegramPairingCode]);

  const startWhatsAppQrLogin = useCallback(async (force = false) => {
    setWhatsAppLoginRunning(true);
    setWhatsAppLoginOutput("");
    setWhatsAppLoginConnected(null);
    try {
      const startLogin = () => engine.rpc("web.login.start", {
        force,
        accountId: "default",
        timeoutMs: 25_000,
      });
      let result: Record<string, unknown> | null = null;
      try {
        result = await startLogin();
      } catch (error) {
        if (!isWhatsAppLoginProviderUnavailable(error)) throw error;
        setWhatsAppLoginOutput("Preparing WhatsApp...");
        await invoke<string>("xcloud_run", {
          args: ["channels", "add", "--channel", "whatsapp", "--account", "default", "--name", "WhatsApp"],
        });
        setChannelEnabled((prev) => ({ ...prev, whatsapp: true }));
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await sleep(1_000);
          try {
            result = await startLogin();
            break;
          } catch (retryError) {
            if (!isWhatsAppLoginProviderUnavailable(retryError) || attempt === 5) throw retryError;
          }
        }
      }
      if (!result) throw new Error("WhatsApp login did not start.");
      const qrDataUrl = typeof result.qrDataUrl === "string" ? result.qrDataUrl : "";
      const message = typeof result.message === "string" ? result.message : "Scan this QR in WhatsApp > Linked Devices.";
      setWhatsAppQrDataUrl(qrDataUrl);
      setWhatsAppLoginConnected(typeof result.connected === "boolean" ? result.connected : null);
      setWhatsAppLoginOutput(message);
    } catch (error) {
      setWhatsAppQrDataUrl("");
      setWhatsAppLoginOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setWhatsAppLoginRunning(false);
    }
  }, [engine]);

  const waitForWhatsAppQrScan = useCallback(async () => {
    setWhatsAppLoginRunning(true);
    setWhatsAppLoginOutput("Waiting for WhatsApp to confirm the scan...");
    try {
      const result = await engine.rpc("web.login.wait", {
        accountId: "default",
        timeoutMs: 25_000,
        ...(whatsAppQrDataUrl ? { currentQrDataUrl: whatsAppQrDataUrl } : {}),
      });
      if (typeof result.qrDataUrl === "string" && result.qrDataUrl) {
        setWhatsAppQrDataUrl(result.qrDataUrl);
      } else if (result.connected) {
        setWhatsAppQrDataUrl("");
      }
      setWhatsAppLoginConnected(typeof result.connected === "boolean" ? result.connected : null);
      setWhatsAppLoginOutput(typeof result.message === "string" ? result.message : "WhatsApp login updated.");
    } catch (error) {
      setWhatsAppLoginOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setWhatsAppLoginRunning(false);
    }
  }, [engine, whatsAppQrDataUrl]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {selectedChannel && (
          <button
            onClick={() => setSelectedChannel(null)}
            className="text-text-muted hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h3 className="text-base font-semibold">
          {selectedChannel
            ? CHANNELS.find(c => c.id === selectedChannel)?.name ?? "Channel"
            : "Channels"}
        </h3>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Channel list */}
        {!selectedChannel && (
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
        {selectedChannel && (() => {
          const ch = CHANNELS.find(c => c.id === selectedChannel)!;
          const values = channelValues[ch.id] ?? {};
          const saving = channelSaving[ch.id] ?? false;
          const saved = channelSaved[ch.id] ?? false;
          const error = channelError[ch.id] ?? null;
          const enabled = channelEnabled[ch.id] ?? false;
          const isTelegram = ch.id === "telegram";
          const isWhatsApp = ch.id === "whatsapp";
          const hasTelegramCredential = Object.values(telegramAgentBots).some((botToken) => botToken.trim());
          const selectedTelegramAgent = agents.find((agent) => agent.id === selectedTelegramAgentId) ?? agents[0];
          const mainTelegramAgent = agents.find((agent) => agent.isDefault) ?? agents[0];
          const selectedTelegramAgentIsMain = Boolean(selectedTelegramAgent && mainTelegramAgent && selectedTelegramAgent.id === mainTelegramAgent.id);
          const selectedTelegramBotToken = selectedTelegramAgent
            ? telegramAgentBots[selectedTelegramAgent.id] ?? ""
            : "";
          const selectedTelegramConnected = Boolean(selectedTelegramBotToken.trim());
          const configuredTelegramAgentCount = Object.entries(telegramAgentBots)
            .filter(([agentId, botToken]) => agents.some((agent) => agent.id === agentId) && botToken.trim())
            .length;
          const nextUnconnectedTelegramAgent = agents.find((agent) => {
            return !(telegramAgentBots[agent.id] ?? "").trim();
          });

          const updateSelectedTelegramBotToken = (value: string) => {
            if (!selectedTelegramAgent) return;
            updateTelegramAgentBot(selectedTelegramAgent.id, value);
          };

          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <img src={ch.logo} alt={ch.name} className="h-7 w-7" />
                <div>
                  <h4 className="text-sm font-medium">{ch.name}</h4>
                  <p className="text-[11px] text-text-muted">{ch.description}</p>
                </div>
              </div>

              {isTelegram ? (
                <>
                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">1</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Create a bot in Telegram</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          Open BotFather, send <span className="font-mono text-text">/newbot</span>, choose a name, then copy the token it gives you.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ShowQr value={BOTFATHER_URL} buttonLabel="Open BotFather" compact />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">2</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Connect a bot to an agent</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          Select the agent this bot belongs to, then paste the BotFather token for that agent.
                        </p>
                        {agents.length === 0 ? (
                          <div className="mt-3 flex h-9 items-center rounded-xl bg-[#262626] px-3 text-sm text-text-muted">
                            No agents loaded yet.
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                              <div className="min-w-0 mr-4">
                                <span className="block text-sm font-medium text-text">Agent</span>
                                <span className="block truncate text-[10px] text-text-muted">
                                  {selectedTelegramConnected ? "Telegram bot connected" : "No Telegram bot connected"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {selectedTelegramConnected && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                                <select
                                  value={selectedTelegramAgent?.id ?? ""}
                                  onChange={(e) => setSelectedTelegramAgentId(e.target.value)}
                                  className="h-9 w-56 appearance-none rounded-xl bg-[#262626] py-1.5 pl-3 pr-9 text-sm text-text transition-colors hover:bg-[#2d2d2d] focus:outline-none cursor-pointer"
                                >
                                  {agents.map((agent) => {
                                    const connected = Boolean((telegramAgentBots[agent.id] ?? "").trim());
                                    return (
                                      <option key={agent.id} value={agent.id}>
                                        {agent.name ?? agent.id}{connected ? " - connected" : ""}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                              <div className="min-w-0 mr-4">
                                <span className="block text-sm font-medium text-text">Bot token</span>
                                <span className="block truncate text-[10px] text-text-muted">
                                  {selectedTelegramAgentIsMain ? "Telegram bot for the main agent" : `Telegram bot for ${selectedTelegramAgent?.name ?? selectedTelegramAgent?.id}`}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="relative">
                                  <input
                                    type={telegramTokenVisible ? "text" : "password"}
                                    value={selectedTelegramBotToken}
                                    onChange={(e) => updateSelectedTelegramBotToken(e.target.value)}
                                    placeholder="123456:ABC-DEF..."
                                    className="h-9 w-56 rounded-xl bg-[#262626] py-1.5 pl-3 pr-9 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setTelegramTokenVisible((visible) => !visible)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted transition-colors hover:text-text"
                                  >
                                    {telegramTokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between py-2">
                              <span className="text-[10px] text-text-muted">
                                {configuredTelegramAgentCount} agent{configuredTelegramAgentCount === 1 ? "" : "s"} connected
                              </span>
                              <button
                                onClick={() => {
                                  const target = nextUnconnectedTelegramAgent ?? agents[0];
                                  if (target) setSelectedTelegramAgentId(target.id);
                                }}
                                className="h-9 rounded-xl bg-[#262626] px-3 text-sm text-text-muted transition-colors hover:text-text"
                              >
                                Connect another agent
                              </button>
                            </div>

                            <div className="border-t border-border/50 pt-3">
                              <button
                                onClick={() => setShowTelegramSecurity((value) => !value)}
                                className="flex h-9 w-full items-center justify-between rounded-xl bg-[#262626] px-3 text-sm text-text-muted transition-colors hover:text-text"
                              >
                                <span>Advanced security</span>
                                <span className="text-[10px] uppercase tracking-wide">{values.dmPolicy || "pairing"}</span>
                              </button>
                              {showTelegramSecurity && (
                                <div className="mt-3 space-y-3">
                                  <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                                    <div className="min-w-0 mr-4">
                                      <span className="block text-sm font-medium text-text">Who can DM</span>
                                      <span className="block truncate text-[10px] text-text-muted">Pairing is recommended for most setups</span>
                                    </div>
                                    <select
                                      value={values.dmPolicy || "pairing"}
                                      onChange={(e) => updateChannelField(ch.id, "dmPolicy", e.target.value)}
                                      className="h-9 w-48 appearance-none rounded-xl bg-[#262626] py-1.5 pl-3 pr-9 text-sm text-text transition-colors hover:bg-[#2d2d2d] focus:outline-none cursor-pointer"
                                    >
                                      {TELEGRAM_DM_POLICIES.map((policy) => (
                                        <option key={policy.id} value={policy.id}>{policy.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {["allowlist", "open"].includes(values.dmPolicy || "pairing") && (
                                    <div className="border-b border-border/50 py-3.5">
                                      <div className="mb-2">
                                        <span className="block text-sm font-medium text-text">Allowlist</span>
                                        <span className="block text-[10px] text-text-muted">Use comma-separated entries or one per line</span>
                                      </div>
                                      <textarea
                                        value={values.allowFrom ?? ((values.dmPolicy || "pairing") === "open" ? "*" : "")}
                                        onChange={(e) => updateChannelField(ch.id, "allowFrom", e.target.value)}
                                        placeholder={"tg:123456789\n@username"}
                                        className="min-h-20 w-full resize-none rounded-xl bg-[#262626] px-3 py-2 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">3</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Approve Telegram users</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          Ask the user to message this agent on Telegram. The agent will reply with a pairing code to paste here.
                        </p>
                        <div className="mt-3">
                          <input
                            value={telegramPairingCode}
                            onChange={(e) => setTelegramPairingCode(e.target.value.toUpperCase())}
                            placeholder="Pairing code, e.g. FXH8P3C7"
                            className="h-9 w-full rounded-xl bg-[#262626] px-3 text-sm font-mono uppercase text-text placeholder:text-text-muted focus:outline-none"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => void approvePairing("telegram")}
                              disabled={telegramPairingRunning || !telegramPairingCode.trim()}
                              className="flex h-9 items-center gap-1.5 rounded-xl bg-text px-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              {telegramPairingRunning ? "Approving..." : "Approve user"}
                            </button>
                            <button
                              onClick={() => void listPairings("telegram")}
                              disabled={telegramPairingRunning}
                              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#262626] px-3 text-sm font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text disabled:opacity-50"
                            >
                              <PlayCircle className="h-3.5 w-3.5" />
                              List pending
                            </button>
                          </div>
                        </div>
                        {telegramPairingOutput && (
                          <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-black/30 p-3 text-[10px] leading-relaxed text-[#D4D4D4]">
                            {telegramPairingOutput}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center mt-4">
                    <button
                      onClick={() => {
                        setChannelEnabled((prev) => ({ ...prev, [ch.id]: true }));
                        void saveChannel(ch.id, true);
                      }}
                      disabled={saving || !hasTelegramCredential}
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
                </>
              ) : isWhatsApp ? (
                <>
                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">1</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Choose access</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          WhatsApp links through WhatsApp Web. Pairing is recommended so unknown senders must request access first.
                        </p>
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                            <div className="min-w-0 mr-4">
                              <span className="block text-sm font-medium text-text">Personal number</span>
                              <span className="block truncate text-[10px] text-text-muted">Use the linked WhatsApp number as the bot</span>
                            </div>
                            <button
                              onClick={() => updateChannelField(ch.id, "selfPhoneMode", values.selfPhoneMode === "true" ? "false" : "true")}
                              className={cn(
                                "relative h-5 w-9 rounded-full transition-colors",
                                values.selfPhoneMode === "true" ? "bg-emerald-500" : "bg-text-muted/20",
                              )}
                            >
                              <div className={cn(
                                "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                                values.selfPhoneMode === "true" ? "translate-x-4" : "translate-x-0.5",
                              )} />
                            </button>
                          </div>

                          <div className="border-t border-border/50 pt-3">
                            <button
                              onClick={() => setShowWhatsAppSecurity((value) => !value)}
                              className="flex h-9 w-full items-center justify-between rounded-xl bg-[#262626] px-3 text-sm text-text-muted transition-colors hover:text-text"
                            >
                              <span>Advanced security</span>
                              <span className="text-[10px] uppercase tracking-wide">{values.dmPolicy || "pairing"}</span>
                            </button>
                            {showWhatsAppSecurity && (
                              <div className="mt-3 space-y-3">
                                <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                                  <div className="min-w-0 mr-4">
                                    <span className="block text-sm font-medium text-text">Who can DM</span>
                                    <span className="block truncate text-[10px] text-text-muted">Pairing is recommended for WhatsApp</span>
                                  </div>
                                  <select
                                    value={values.dmPolicy || "pairing"}
                                    onChange={(e) => updateChannelField(ch.id, "dmPolicy", e.target.value)}
                                    className="h-9 w-48 appearance-none rounded-xl bg-[#262626] py-1.5 pl-3 pr-9 text-sm text-text transition-colors hover:bg-[#2d2d2d] focus:outline-none cursor-pointer"
                                  >
                                    {TELEGRAM_DM_POLICIES.map((policy) => (
                                      <option key={policy.id} value={policy.id}>{policy.label}</option>
                                    ))}
                                  </select>
                                </div>
                                {["allowlist", "open"].includes(values.dmPolicy || "pairing") && (
                                  <div className="border-b border-border/50 py-3.5">
                                    <div className="mb-2">
                                      <span className="block text-sm font-medium text-text">Allowlist</span>
                                      <span className="block text-[10px] text-text-muted">Use phone numbers like +15551234567, separated by commas or new lines</span>
                                    </div>
                                    <textarea
                                      value={values.allowFrom ?? ((values.dmPolicy || "pairing") === "open" ? "*" : "")}
                                      onChange={(e) => updateChannelField(ch.id, "allowFrom", e.target.value)}
                                      placeholder={"+15551234567\n+525512345678"}
                                      className="min-h-20 w-full resize-none rounded-xl bg-[#262626] px-3 py-2 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">2</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Link WhatsApp with QR</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          Generate the QR here, then scan it from WhatsApp on your phone under Settings → Linked Devices → Link a device. Do not use the camera app.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => void startWhatsAppQrLogin(false)}
                            disabled={whatsAppLoginRunning}
                            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#262626] px-3 text-sm font-medium text-text transition-colors hover:bg-[#2d2d2d] disabled:opacity-50"
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                            {whatsAppLoginRunning ? "Loading..." : "Show QR"}
                          </button>
                          <button
                            onClick={() => void startWhatsAppQrLogin(true)}
                            disabled={whatsAppLoginRunning}
                            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#262626] px-3 text-sm font-medium text-text-muted transition-colors hover:bg-[#2d2d2d] hover:text-text disabled:opacity-50"
                          >
                            Relink
                          </button>
                          {whatsAppQrDataUrl && (
                            <button
                              onClick={() => void waitForWhatsAppQrScan()}
                              disabled={whatsAppLoginRunning}
                              className="flex h-9 items-center gap-1.5 rounded-xl bg-text px-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              I scanned it
                            </button>
                          )}
                        </div>
                        {whatsAppQrDataUrl && (
                          <div className="mt-3 inline-flex rounded-[28px] bg-white p-4 shadow-lg shadow-black/20">
                            {isQrDataImage(whatsAppQrDataUrl) ? (
                              <img src={whatsAppQrDataUrl} alt="WhatsApp login QR" className="h-56 w-56" />
                            ) : (
                              <QRCodeSVG value={whatsAppQrDataUrl} size={224} level="H" className="h-56 w-56 text-black" />
                            )}
                          </div>
                        )}
                        {whatsAppLoginOutput && (
                          <div className={cn(
                            "mt-3 rounded-xl bg-black/30 p-3 text-xs leading-relaxed",
                            whatsAppLoginConnected ? "text-emerald-300" : "text-[#D4D4D4]",
                          )}>
                            {whatsAppLoginOutput}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-border/50 py-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#262626] text-[11px] font-medium text-text-muted">3</div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-text">Approve WhatsApp users</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                          Ask the user to message the linked WhatsApp number. The agent will reply with a pairing code to paste here.
                        </p>
                        <div className="mt-3">
                          <input
                            value={telegramPairingCode}
                            onChange={(e) => setTelegramPairingCode(e.target.value.toUpperCase())}
                            placeholder="Pairing code, e.g. FXH8P3C7"
                            className="h-9 w-full rounded-xl bg-[#262626] px-3 text-sm font-mono uppercase text-text placeholder:text-text-muted focus:outline-none"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => void approvePairing("whatsapp")}
                              disabled={telegramPairingRunning || !telegramPairingCode.trim()}
                              className="flex h-9 items-center gap-1.5 rounded-xl bg-text px-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              {telegramPairingRunning ? "Approving..." : "Approve user"}
                            </button>
                            <button
                              onClick={() => void listPairings("whatsapp")}
                              disabled={telegramPairingRunning}
                              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#262626] px-3 text-sm font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text disabled:opacity-50"
                            >
                              <PlayCircle className="h-3.5 w-3.5" />
                              List pending
                            </button>
                          </div>
                        </div>
                        {telegramPairingOutput && (
                          <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-black/30 p-3 text-[10px] leading-relaxed text-[#D4D4D4]">
                            {telegramPairingOutput}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center mt-4">
                    <button
                      onClick={() => {
                        setChannelEnabled((prev) => ({ ...prev, [ch.id]: true }));
                        void saveChannel(ch.id, true);
                      }}
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
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
