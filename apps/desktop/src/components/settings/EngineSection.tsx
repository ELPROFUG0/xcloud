import { useState, useEffect } from "react";
import { ChevronLeft, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { BrowserEngine } from "@/lib/engine";
import type { EngineMode } from "./types";

import cloudServerLogo from "@/assets/engine/cloud-server.png";
import macMiniLogo from "@/assets/engine/mac-mini.svg";
import localDesktopLogo from "@/assets/engine/local-desktop.svg";

interface EngineSectionProps {
  engine: BrowserEngine;
}

function normalizeGatewayUrl(value: string) {
  const trimmed = value.trim().replace(/^URL:\s*/i, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  return `ws://${trimmed}`;
}

function normalizeGatewayToken(value: string) {
  return value.trim().replace(/^Token:\s*/i, "");
}

function getStoredRemoteEngineConfig(mode: Exclude<EngineMode, "local">) {
  const prefix = mode === "mac-mini" ? "engineMacMini" : "engineVps";
  return {
    url: localStorage.getItem(`${prefix}Url`) ?? "",
    token: localStorage.getItem(`${prefix}Token`) ?? "",
  };
}

async function writeGatewayModeToOpenClawConfig(mode: EngineMode, url?: string, token?: string) {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home }).catch(() => "{}");
  const config = JSON.parse(raw || "{}") as Record<string, unknown>;
  const gateway = ((config.gateway && typeof config.gateway === "object") ? config.gateway : {}) as Record<string, unknown>;
  const remote = ((gateway.remote && typeof gateway.remote === "object") ? gateway.remote : {}) as Record<string, unknown>;
  const normalizedUrl = normalizeGatewayUrl(url ?? "");
  const existingRemoteUrl = typeof remote.url === "string" && remote.url.trim() ? normalizeGatewayUrl(remote.url) : "";
  const nextRemote = normalizedUrl
    ? {
        ...remote,
        url: normalizedUrl,
        ...(token?.trim() ? { token: token.trim() } : {}),
      }
    : existingRemoteUrl
      ? { ...remote, url: existingRemoteUrl }
      : null;

  if (mode === "local") {
    config.gateway = { ...gateway, mode: "local", ...(nextRemote ? { remote: nextRemote } : {}) };
  } else {
    if (!nextRemote) {
      config.gateway = { ...gateway, mode: "local" };
      await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
      return;
    }
    config.gateway = {
      ...gateway,
      mode: "remote",
      remote: nextRemote,
    };
  }

  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
}

export function EngineSection({ engine: _engine }: EngineSectionProps) {
  const [engineMode, setEngineModeState] = useState<EngineMode>(() =>
    (localStorage.getItem("engineMode") as EngineMode) ?? "local",
  );
  const saveRemoteEngineConfig = (mode: Exclude<EngineMode, "local">, url: string, token: string) => {
    const normalizedUrl = normalizeGatewayUrl(url);
    const normalizedToken = normalizeGatewayToken(token);
    const prefix = mode === "mac-mini" ? "engineMacMini" : "engineVps";
    localStorage.setItem(`${prefix}Url`, normalizedUrl);
    localStorage.setItem(`${prefix}Token`, normalizedToken);
    if (mode === "mac-mini") {
      setMacMiniUrl(normalizedUrl);
      setMacMiniToken(normalizedToken);
    } else {
      setVpsUrl(normalizedUrl);
      setVpsToken(normalizedToken);
    }
    return { url: normalizedUrl, token: normalizedToken };
  };
  const setEngineMode = async (m: EngineMode, remoteOverride?: { url: string; token: string }) => {
    setEngineModeState(m);
    localStorage.setItem("engineMode", m);
    const prefix = m === "mac-mini" ? "engineMacMini" : m === "vps" ? "engineVps" : "";
    const url = remoteOverride?.url ?? (prefix ? localStorage.getItem(`${prefix}Url`) ?? "" : "");
    const token = remoteOverride?.token ?? (prefix ? localStorage.getItem(`${prefix}Token`) ?? "" : "");
    await writeGatewayModeToOpenClawConfig(m, url, token).catch(() => {});
    window.dispatchEvent(new CustomEvent("xcloud-engine-config-changed"));
  };
  const [macMiniUrl, setMacMiniUrl] = useState(() => localStorage.getItem("engineMacMiniUrl") ?? "");
  const [macMiniToken, setMacMiniToken] = useState(() => localStorage.getItem("engineMacMiniToken") ?? "");
  const [vpsUrl, setVpsUrl] = useState(() => localStorage.getItem("engineVpsUrl") ?? "");
  const [vpsToken, setVpsToken] = useState(() => localStorage.getItem("engineVpsToken") ?? "");
  const [engineSaved, setEngineSaved] = useState(false);
  const [engineStatus, setEngineStatus] = useState<{ running: boolean; port: number; pid: number | null; managed: boolean } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [selectedEngineView, setSelectedEngineView] = useState<EngineMode | null>(null);

  useEffect(() => {
    invoke<{ running: boolean; port: number; pid: number | null; managed: boolean }>("engine_status")
      .then(setEngineStatus).catch(() => {});
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {selectedEngineView && (
          <button
            onClick={() => setSelectedEngineView(null)}
            className="text-text-muted hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h3 className="text-base font-semibold">
          {selectedEngineView
            ? ({ local: "Local", "mac-mini": "Mac Mini", vps: "Cloud VPS" }[selectedEngineView])
            : "Engine"}
        </h3>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Engine: list view */}
        {!selectedEngineView && (
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
        {selectedEngineView === "local" && (
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
        {(selectedEngineView === "mac-mini" || selectedEngineView === "vps") && (() => {
          const isMini = selectedEngineView === "mac-mini";
          const url = isMini ? macMiniUrl : vpsUrl;
          const token = isMini ? macMiniToken : vpsToken;
          const setUrl = isMini ? setMacMiniUrl : setVpsUrl;
          const setToken = isMini ? setMacMiniToken : setVpsToken;
          const installCmd = "npm install -g openclaw@latest && TOKEN=$(openssl rand -hex 24) && openclaw onboard --non-interactive --accept-risk --mode local --gateway-bind lan --gateway-auth token --gateway-token \"$TOKEN\" --install-daemon --skip-channels --skip-skills --skip-search --skip-ui && openclaw config set gateway.controlUi.allowedOrigins '[\"http://localhost:1420\",\"http://127.0.0.1:1420\",\"tauri://localhost\",\"http://tauri.localhost\"]' --strict-json && openclaw gateway restart && IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0) && echo \"URL: ws://$IP:18789\" && echo \"Token: $TOKEN\"";

          return (
            <div>
              <div className="flex justify-center py-4">
                <img src={isMini ? macMiniLogo : cloudServerLogo} alt="" className="h-16 w-16 object-contain" />
              </div>

              <div className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-text">Active</span>
                <button
                  onClick={() => {
                    const remote = saveRemoteEngineConfig(selectedEngineView, url, token);
                    if (!remote.url) return;
                    void setEngineMode(selectedEngineView, remote);
                  }}
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
                    const activeMode = selectedEngineView;
                    const savedRemote = saveRemoteEngineConfig(activeMode, url, token);
                    if (engineMode === selectedEngineView) localStorage.setItem("engineMode", selectedEngineView);
                    const activeConfig = engineMode !== selectedEngineView && engineMode !== "local"
                      ? getStoredRemoteEngineConfig(engineMode)
                      : savedRemote;
                    writeGatewayModeToOpenClawConfig(engineMode === selectedEngineView ? activeMode : engineMode, activeConfig.url, activeConfig.token)
                      .then(() => {
                        setEngineSaved(true);
                        if (engineMode === selectedEngineView) {
                          window.dispatchEvent(new CustomEvent("xcloud-engine-config-changed"));
                        }
                        setTimeout(() => setEngineSaved(false), 3000);
                      })
                      .catch(() => {
                        setEngineSaved(true);
                        setTimeout(() => setEngineSaved(false), 3000);
                      });
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
      </div>
    </div>
  );
}
