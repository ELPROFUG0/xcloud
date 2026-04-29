import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import { PROVIDERS } from "@/types/provider";
import { Key, Save, Loader2, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";

interface SettingsPanelProps {
  engine: BrowserEngine;
  onBack: () => void;
}

interface KeyState {
  value: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

export function SettingsPanel({ engine, onBack }: SettingsPanelProps) {
  const [keys, setKeys] = useState<Record<string, KeyState>>({});

  const getKeyState = (envKey: string): KeyState =>
    keys[envKey] ?? { value: "", saving: false, saved: false, error: null };

  const updateKey = useCallback((envKey: string, value: string) => {
    setKeys((prev) => ({
      ...prev,
      [envKey]: { value, saving: false, saved: false, error: null },
    }));
  }, []);

  const saveKey = useCallback(async (envKey: string) => {
    const state = keys[envKey];
    if (!state?.value.trim()) return;

    setKeys((prev) => ({
      ...prev,
      [envKey]: { ...prev[envKey]!, saving: true, saved: false, error: null },
    }));

    try {
      // Get current config hash
      const configResult = await engine.rpc("config.get", {});
      const hash = (configResult as { hash?: string }).hash ?? "";

      // Patch env.vars with the API key
      const patch = JSON.stringify({
        env: { [envKey]: state.value.trim() },
      });

      await engine.patchConfig(patch, hash);

      setKeys((prev) => ({
        ...prev,
        [envKey]: { ...prev[envKey]!, saving: false, saved: true, error: null },
      }));

      // Clear saved indicator after 3s
      setTimeout(() => {
        setKeys((prev) => {
          const current = prev[envKey];
          if (current?.saved) {
            return { ...prev, [envKey]: { ...current, saved: false } };
          }
          return prev;
        });
      }, 3000);
    } catch (err) {
      setKeys((prev) => ({
        ...prev,
        [envKey]: {
          ...prev[envKey]!,
          saving: false,
          error: err instanceof Error ? err.message : "Failed to save",
        },
      }));
    }
  }, [keys, engine]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold">API Keys</h1>
        <span className="text-xs text-text-muted">Configure provider credentials</span>
      </header>

      {/* Keys list */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-1 py-4">
          <p className="px-4 pb-3 text-xs text-text-muted">
            Enter API keys for the providers you want to use. Keys are stored in the gateway config
            and never leave your machine.
          </p>

          {PROVIDERS.map((provider) => {
            const state = getKeyState(provider.envKey);

            return (
              <div
                key={provider.id}
                className="rounded-lg border border-border bg-surface px-4 py-3 mx-4 mb-2"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-text-muted" />
                    <span className="text-xs font-medium">{provider.name}</span>
                  </div>
                  <span className="text-[10px] text-text-muted font-mono">{provider.envKey}</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={state.value}
                    onChange={(e) => updateKey(provider.envKey, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveKey(provider.envKey)}
                    placeholder={provider.placeholder}
                    className={cn(
                      "flex-1 rounded-lg border border-border bg-bg px-3 py-2",
                      "text-xs text-text placeholder:text-text-muted font-mono",
                      "focus:border-accent focus:outline-none",
                    )}
                  />

                  <button
                    onClick={() => saveKey(provider.envKey)}
                    disabled={!state.value.trim() || state.saving}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      "border border-border transition-colors",
                      "hover:border-accent hover:text-accent",
                      "disabled:opacity-30 disabled:cursor-not-allowed",
                    )}
                  >
                    {state.saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : state.saved ? (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {state.error && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400">
                    <AlertCircle className="h-3 w-3" />
                    {state.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
