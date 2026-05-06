import { useState, useEffect, useCallback } from "react";
import { CheckCircle, FolderOpen, ExternalLink, Trash2, ChevronLeft, Cloud, Brain } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { invoke } from "@tauri-apps/api/core";

interface MemorySectionProps {
  engine: BrowserEngine;
}

export function MemorySection({ engine: _engine }: MemorySectionProps) {
  const [showSupermemory, setShowSupermemory] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [localMemoryCount, setLocalMemoryCount] = useState<number | null>(null);

  useEffect(() => {
    setApiKey(localStorage.getItem("supermemory_api_key") ?? "");
    setEnabled(localStorage.getItem("supermemory_enabled") === "true");
    invoke("run_shell", { cmd: "ls ~/.openclaw/workspace/memory/*.md 2>/dev/null | wc -l" })
      .then((r) => setLocalMemoryCount(parseInt(String(r).trim()) || 0))
      .catch(() => setLocalMemoryCount(0));
  }, []);

  const saveKey = useCallback(async (key: string) => {
    setSaving(true);
    setSaved(false);
    setTestResult(null);
    localStorage.setItem("supermemory_api_key", key);

    if (key.trim()) {
      try {
        const configStr: string = await invoke("run_shell", { cmd: "cat ~/.openclaw/openclaw.json 2>/dev/null || echo '{}'" });
        const config = JSON.parse(configStr);
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.supermemory = {
          url: "https://mcp.supermemory.ai/mcp",
          headers: { Authorization: `Bearer ${key.trim()}` },
        };
        const jsonStr = JSON.stringify(config, null, 2);
        await invoke("run_shell", { cmd: `echo '${jsonStr.replace(/'/g, "'\\''")}' > ~/.openclaw/openclaw.json` });
        localStorage.setItem("supermemory_enabled", "true");
        setEnabled(true);
        setSaved(true);
      } catch {
        setTestResult("fail");
      }
    } else {
      try {
        const configStr: string = await invoke("run_shell", { cmd: "cat ~/.openclaw/openclaw.json 2>/dev/null || echo '{}'" });
        const config = JSON.parse(configStr);
        if (config.mcpServers?.supermemory) {
          delete config.mcpServers.supermemory;
          const jsonStr = JSON.stringify(config, null, 2);
          await invoke("run_shell", { cmd: `echo '${jsonStr.replace(/'/g, "'\\''")}' > ~/.openclaw/openclaw.json` });
        }
      } catch {}
      localStorage.setItem("supermemory_enabled", "false");
      setEnabled(false);
      setSaved(true);
    }

    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
  }, []);

  const testConnection = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result: string = await invoke("run_shell", {
        cmd: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${apiKey.trim()}" https://api.supermemory.ai/v3/documents/list -X POST -d '{}' -H "Content-Type: application/json"`,
      });
      setTestResult(parseInt(result.trim()) === 200 ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    }
    setTesting(false);
  }, [apiKey]);

  const openMemoryFolder = useCallback(async () => {
    await invoke("run_shell", { cmd: "mkdir -p ~/.openclaw/workspace/memory && open ~/.openclaw/workspace/memory" }).catch(() => {});
  }, []);

  const openWorkspaceFolder = useCallback(async () => {
    await invoke("run_shell", { cmd: "open ~/.openclaw/workspace" }).catch(() => {});
  }, []);

  const openUrl = useCallback((url: string) => {
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {showSupermemory && (
          <button onClick={() => setShowSupermemory(false)} className="text-text-muted hover:text-text">
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <h3 className="text-base font-semibold">
          {showSupermemory ? "Supermemory" : "Memory"}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {!showSupermemory ? (
          <>
            {/* ── Local Memory ─────────────────────────────────────── */}
            <div className="mb-6">
              <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">Local Memory</p>
              <p className="text-xs text-text-muted mb-4">
                Your agent stores daily notes and long-term memory as markdown files on your machine.
              </p>

              <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                <div className="flex items-center gap-3 min-w-0 mr-4">
                  <span className="text-sm font-medium text-text">MEMORY.md</span>
                  <span className="text-xs text-text-muted">Long-term curated memory</span>
                </div>
                <button
                  onClick={openMemoryFolder}
                  className="flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open folder
                </button>
              </div>

              <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                <div className="flex items-center gap-3 min-w-0 mr-4">
                  <span className="text-sm font-medium text-text">Daily notes</span>
                  <span className="text-xs text-text-muted">
                    {localMemoryCount !== null ? `${localMemoryCount} files` : "..."}
                  </span>
                </div>
                <button
                  onClick={openMemoryFolder}
                  className="flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open folder
                </button>
              </div>

              <div className="flex items-center justify-between border-b border-border/50 py-3.5">
                <div className="flex items-center gap-3 min-w-0 mr-4">
                  <span className="text-sm font-medium text-text">Storage path</span>
                  <span className="text-xs text-text-muted font-mono">~/.openclaw/workspace/memory</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-3.5">
                <div className="flex items-center gap-3 min-w-0 mr-4">
                  <span className="text-sm font-medium text-text">Workspace</span>
                  <span className="text-xs text-text-muted">Agent workspace root</span>
                </div>
                <button
                  onClick={openWorkspaceFolder}
                  className="flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open folder
                </button>
              </div>
            </div>

            {/* ── Supermemory card (Engine-style) ──────────────────── */}
            <div className="mb-6">
              <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">Cloud Memory</p>
              <button
                onClick={() => setShowSupermemory(true)}
                className="flex w-full items-center justify-between rounded-lg bg-container px-4 py-3.5 text-left transition-colors hover:bg-surface-hover"
              >
                <div className="flex items-center gap-3">
                  <Cloud className="h-5 w-5 shrink-0 text-text-muted" />
                  <div>
                    <span className="text-sm font-medium text-text">Supermemory</span>
                    <span className="text-xs text-text-muted ml-2">AI memory engine with user profiles</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {enabled && <span className="text-xs text-text-muted">Active</span>}
                  <div className={cn("h-2 w-2 rounded-full shrink-0", enabled ? "bg-emerald-400" : "bg-text-muted/30")} />
                </div>
              </button>
            </div>
          </>
        ) : (
          /* ── Supermemory detail (Engine-style) ─────────────────── */
          <div>
            <div className="flex justify-center py-4">
              <Brain className="h-16 w-16 text-purple-400/30" />
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Active</span>
              <button
                onClick={() => {
                  if (enabled) { setApiKey(""); saveKey(""); }
                  else if (apiKey.trim()) { saveKey(apiKey); }
                }}
                disabled={!apiKey.trim() && !enabled}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  enabled ? "bg-purple-500" : "bg-text-muted/20",
                  !apiKey.trim() && !enabled ? "opacity-30" : "",
                )}
              >
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  enabled ? "translate-x-4" : "translate-x-0.5",
                )} />
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">API Key</span>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveKey(apiKey)}
                  placeholder="sm_..."
                  className="w-48 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
                />
                <button
                  onClick={() => saveKey(apiKey)}
                  disabled={saving}
                  className="rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors disabled:opacity-30"
                >
                  {saving ? "..." : saved ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : "Save"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Status</span>
              <div className="flex items-center gap-2">
                <span className={cn("text-sm", enabled ? "text-emerald-400" : "text-text-muted")}>
                  {enabled ? "Connected" : "Disconnected"}
                </span>
                <button
                  onClick={testConnection}
                  disabled={testing || !apiKey.trim()}
                  className="rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors disabled:opacity-30"
                >
                  {testing ? "..." : "Test"}
                </button>
                {testResult === "ok" && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                {testResult === "fail" && <span className="text-xs text-red-400">Failed</span>}
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">MCP Server</span>
              <span className="text-sm font-mono text-text-muted">mcp.supermemory.ai</span>
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Dashboard</span>
              <button
                onClick={() => openUrl("https://console.supermemory.ai")}
                className="flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-border/50 py-3">
              <span className="text-sm text-text">Get API Key</span>
              <button
                onClick={() => openUrl("https://console.supermemory.ai")}
                className="flex items-center gap-1.5 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                console.supermemory.ai
              </button>
            </div>

            {enabled && (
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-text">Disconnect</span>
                <button
                  onClick={() => { setApiKey(""); saveKey(""); }}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-red-400/70 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            )}

            {/* Agent tools */}
            <div className="mt-4 rounded-lg bg-container px-4 py-3">
              <p className="text-xs text-text-muted leading-relaxed mb-2">
                When connected, your agents get these MCP tools:
              </p>
              <div className="space-y-1">
                {[
                  { name: "add_memory", desc: "Store information" },
                  { name: "search_memory", desc: "Semantic search" },
                  { name: "list_memories", desc: "Browse with filters" },
                  { name: "delete_memory", desc: "Remove entries" },
                ].map((t) => (
                  <div key={t.name} className="flex items-center justify-between py-1">
                    <span className="text-xs font-mono text-accent">{t.name}</span>
                    <span className="text-[11px] text-text-muted">{t.desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-text-muted/60 mt-3">
                Free: 1M tokens/month, 10K searches. No credit card required.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
