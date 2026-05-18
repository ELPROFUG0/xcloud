import { useState, useCallback, useEffect } from "react";
import { CheckCircle } from "lucide-react";
import type { BrowserEngine } from "@/lib/engine";
import { PROVIDERS, type ProviderConfig } from "@/types/provider";
import { useModels } from "@/hooks/use-models";
import { fmtProvider, ProviderIcon } from "@/components/chat/ModelSelector";
import { invoke } from "@tauri-apps/api/core";
import type { KeyState } from "./types";

import openaiLogo from "@/assets/providers/openai.svg";
import githubLogo from "@/assets/providers/github.svg";

const PROVIDER_CONFIG_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

interface ProviderKeyConfig extends ProviderConfig {
  envKeys: string[];
}

const ENV_KEY_ALIASES: Record<string, string[]> = {
  byteplus: ["ARK_API_KEY"],
  "byteplus-plan": ["ARK_API_KEY"],
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
  gemini: ["GEMINI_API_KEY"],
  github: ["GITHUB_TOKEN"],
  "github-copilot": ["GITHUB_TOKEN"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  "google-vertex": ["GOOGLE_APPLICATION_CREDENTIALS"],
  huggingface: ["HF_TOKEN"],
  "lm-studio": ["LM_STUDIO_API_KEY"],
  lmstudio: ["LM_STUDIO_API_KEY"],
  "openai-codex": ["OPENAI_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  volcengine: ["ARK_API_KEY"],
  "volcengine-plan": ["ARK_API_KEY"],
};

function providerEnvKey(providerId: string): string {
  return `${providerId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

function buildProviderConfig(providerId: string): ProviderKeyConfig {
  const configured = PROVIDER_CONFIG_BY_ID.get(providerId);
  const genericEnvKey = providerEnvKey(providerId);
  const envKeys = uniqueKeys([
    ...(configured ? [configured.envKey] : []),
    ...(ENV_KEY_ALIASES[providerId] ?? []),
    genericEnvKey,
  ]);
  if (configured) return { ...configured, envKeys };
  const envKey = envKeys[0] ?? genericEnvKey;
  return {
    id: providerId,
    name: fmtProvider(providerId),
    envKey,
    envKeys,
    placeholder: envKey.endsWith("_PATH") || envKey.includes("CREDENTIALS") ? "/path/to/credentials.json" : "...",
  };
}

interface KeysSectionProps {
  engine: BrowserEngine;
  onOpenTerminal?: (command?: string) => void;
}

interface AuthProfilesStatus {
  openaiCodex: boolean;
  githubCopilot: boolean;
}

const STATUS_BY_PROVIDER: Record<string, keyof AuthProfilesStatus> = {
  "github-copilot": "githubCopilot",
  "openai-codex": "openaiCodex",
};

export function KeysSection({ engine, onOpenTerminal }: KeysSectionProps) {
  const { providers: modelProviders, loading: loadingProviders } = useModels(engine);
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [authLoading, setAuthLoading] = useState<Record<string, boolean>>({});
  const [authStatus, setAuthStatus] = useState<Record<string, string>>({});
  const providerConfigs = modelProviders.map((group) => buildProviderConfig(group.provider));
  const remoteEngine = engine.isRemote;

  const openAuthTerminal = useCallback(async (args: string[]) => {
    const command = await invoke<string>("xcloud_shell_command", { args });
    const loading = "printf 'Preparing login...\\n\\n'";
    const prompt = "printf '\\nLogin finished. Return to API Keys and click Verify.\\n'";
    const marker = `# xcloud-auth-${Date.now()}`;
    const authCommand = `printf '\\033[2J\\033[H'; ${loading}; OPENCLAW_DISABLE_CLI_STARTUP_HELP_FAST_PATH=1 OPENCLAW_HIDE_BANNER=1 ${command}; ${prompt}; ${marker}`;
    if (onOpenTerminal) {
      onOpenTerminal(authCommand);
      return;
    }
    window.dispatchEvent(new CustomEvent("xcloud-open-terminal", {
      detail: { command: authCommand },
    }));
  }, [onOpenTerminal]);

  useEffect(() => {
    let cancelled = false;
    if (remoteEngine) {
      setAuthStatus({
        "codex-login": "",
        "github-copilot-login": "",
      });
      return () => { cancelled = true; };
    }
    invoke<AuthProfilesStatus>("xcloud_auth_profiles_status")
      .then((status) => {
        if (cancelled) return;
        setAuthStatus((prev) => {
          const next = { ...prev };
          next["codex-login"] = status.openaiCodex ? "connected" : "";
          next["github-copilot-login"] = status.githubCopilot ? "connected" : "";
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [remoteEngine]);

  // Load saved API keys from gateway config
  useEffect(() => {
    setKeys({});
    engine.rpc("config.get", {}).then((res) => {
      const config = (res as { config?: Record<string, unknown> }).config;
      const env = (config?.env ?? {}) as Record<string, string>;
      const loaded: Record<string, KeyState> = {};
      for (const [k, v] of Object.entries(env)) {
        if (v && typeof v === "string") {
          loaded[k] = { value: v, saving: false, saved: false, error: null };
        }
      }
      setKeys(loaded);
    }).catch(() => {});
  }, [engine]);

  const getKeyState = (provider: ProviderKeyConfig): KeyState => {
    for (const envKey of provider.envKeys) {
      const state = keys[envKey];
      if (state?.value) return state;
    }
    return keys[provider.envKey] ?? { value: "", saving: false, saved: false, error: null };
  };

  const updateKey = useCallback((provider: ProviderKeyConfig, value: string) => {
    setKeys((prev) => {
      const next = { ...prev };
      for (const envKey of provider.envKeys) {
        next[envKey] = { value, saving: false, saved: false, error: null };
      }
      return next;
    });
  }, []);

  const saveKey = useCallback(async (provider: ProviderKeyConfig) => {
    const state = getKeyState(provider);
    if (!state?.value.trim()) return;
    setKeys((prev) => {
      const next = { ...prev };
      for (const envKey of provider.envKeys) {
        next[envKey] = { value: state.value, saving: true, saved: false, error: null };
      }
      return next;
    });
    try {
      const cfgRes = await engine.rpc("config.get", {});
      const hash = (cfgRes as { hash?: string }).hash ?? "";
      await engine.patchConfig(JSON.stringify({
        env: Object.fromEntries(provider.envKeys.map((envKey) => [envKey, state.value.trim()])),
      }), hash);
    } catch {
      // Gateway restarts after config patch — "Connection closed" is expected
    }
    // Always mark as saved (the key was written before the gateway restarted)
    setKeys((prev) => {
      const next = { ...prev };
      for (const envKey of provider.envKeys) {
        next[envKey] = { value: state.value, saving: false, saved: true, error: null };
      }
      return next;
    });
    setTimeout(() => {
      setKeys((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const envKey of provider.envKeys) {
          const c = next[envKey];
          if (c?.saved) {
            next[envKey] = { ...c, saved: false };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 3000);
  }, [keys, engine]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <h3 className="text-base font-semibold">API Keys</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div>
          {/* Subscription logins */}
          <div className="mb-6">
            <p className="text-xs text-text-muted mb-3 uppercase tracking-wider font-semibold">Subscriptions</p>
            {[
              { id: "github-copilot-login", name: "GitHub Copilot", provider: "github-copilot", logo: githubLogo, cmdArgs: ["models", "auth", "login-github-copilot"], description: remoteEngine ? "Configure this on the active host" : "Use your Copilot subscription" },
              { id: "codex-login", name: "OpenAI Codex", provider: "openai-codex", logo: openaiLogo, cmdArgs: ["models", "auth", "login", "--provider", "openai-codex"], description: remoteEngine ? "Configure this on the active host" : "Use your Codex subscription" },
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
                          const status = await invoke<AuthProfilesStatus>("xcloud_disconnect_auth_provider", { provider: item.provider });
                          const statusKey = STATUS_BY_PROVIDER[item.provider];
                          setAuthStatus(p => ({ ...p, [item.id]: status[statusKey] ? "connected" : "" }));
                        } catch {
                          setAuthStatus(p => ({ ...p, [item.id]: "connected" }));
                        }
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
                          const status = await invoke<AuthProfilesStatus>("xcloud_auth_profiles_status");
                          const statusKey = STATUS_BY_PROVIDER[item.provider];
                          setAuthStatus(p => ({ ...p, [item.id]: status[statusKey] ? "connected" : "failed" }));
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
                        if (remoteEngine) return;
                        setAuthLoading(p => ({ ...p, [item.id]: true }));
                        try {
                          await openAuthTerminal(item.cmdArgs);
                          setAuthStatus(p => ({ ...p, [item.id]: "check-terminal" }));
                        } catch {
                          setAuthStatus(p => ({ ...p, [item.id]: "failed" }));
                        }
                        setAuthLoading(p => ({ ...p, [item.id]: false }));
                      }}
                      disabled={authLoading[item.id] || remoteEngine}
                      className="rounded-xl bg-[#262626] px-4 py-1.5 text-sm text-text hover:text-white transition-colors disabled:opacity-50"
                    >
                      {remoteEngine ? "Host only" :
                       authLoading[item.id] ? "..." :
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
          {loadingProviders && providerConfigs.length === 0 && (
            <div className="py-4 text-xs text-text-muted">Loading providers...</div>
          )}
          {providerConfigs.map((provider) => {
            const state = getKeyState(provider);
            return (
              <div key={provider.id} className="flex items-center justify-between border-b border-border/50 py-3.5 last:border-0">
                <div className="flex items-center gap-3 min-w-0 mr-4">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <ProviderIcon provider={provider.id} size={18} color />
                  </div>
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">{provider.name}</span>
                    <span className="block truncate text-[10px] font-mono text-text-muted">{provider.envKeys.join(" / ")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="password"
                    value={state.value}
                    onChange={(e) => updateKey(provider, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveKey(provider)}
                    placeholder={provider.placeholder}
                    className="w-48 rounded-xl bg-[#262626] px-3 py-1.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
                  />
                  <button
                    onClick={() => saveKey(provider)}
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
      </div>
    </div>
  );
}
