import { useState, useCallback } from "react";
import { ChevronLeft, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import type { ChannelField, ChannelConfig } from "./types";

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

interface ChannelsSectionProps {
  engine: BrowserEngine;
}

export function ChannelsSection({ engine }: ChannelsSectionProps) {
  const [channelValues, setChannelValues] = useState<Record<string, Record<string, string>>>({});
  const [channelSaving, setChannelSaving] = useState<Record<string, boolean>>({});
  const [channelSaved, setChannelSaved] = useState<Record<string, boolean>>({});
  const [channelError, setChannelError] = useState<Record<string, string | null>>({});
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [channelEnabled, setChannelEnabled] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      </div>
    </div>
  );
}
