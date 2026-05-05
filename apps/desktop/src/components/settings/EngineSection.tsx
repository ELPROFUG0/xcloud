import { useState, useEffect } from "react";
import { ChevronLeft, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserEngine } from "@/lib/engine";
import type { EngineMode } from "./types";

import cloudServerLogo from "@/assets/engine/cloud-server.png";
import macMiniLogo from "@/assets/engine/mac-mini.svg";
import localDesktopLogo from "@/assets/engine/local-desktop.svg";

interface EngineSectionProps {
  engine: BrowserEngine;
}

export function EngineSection({ engine: _engine }: EngineSectionProps) {
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
      </div>
    </div>
  );
}
