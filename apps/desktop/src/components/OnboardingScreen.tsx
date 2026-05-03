import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import { cn } from "@/lib/cn";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";
import { ChevronRight, ArrowRight, Loader2 } from "lucide-react";
import openclawLogo from "@/assets/openclaw-logo.svg";

// Provider logos
import anthropicLogo from "@/assets/providers/anthropic.svg";
import openaiLogo from "@/assets/providers/openai.svg";
import googleLogo from "@/assets/providers/google.svg";
import deepseekLogo from "@/assets/providers/deepseek.svg";
import groqLogo from "@/assets/providers/groq.svg";
import mistralLogo from "@/assets/providers/mistral.svg";
import fireworksLogo from "@/assets/providers/fireworks.svg";
import openrouterLogo from "@/assets/providers/openrouter.svg";
import xaiLogo from "@/assets/providers/xai.svg";
import cerebrasLogo from "@/assets/providers/cerebras.svg";
import ollamaLogo from "@/assets/providers/ollama.svg";
import githubLogo from "@/assets/providers/github.svg";

interface OnboardingScreenProps {
  onComplete: () => void;
  /** Preview mode — skips all real commands, just shows the UI */
  preview?: boolean;
}

type Step = "welcome" | "provider" | "apikey" | "identity" | "user" | "running" | "done";

interface ProviderOption {
  id: string;
  name: string;
  logo: string;
  authChoice: string;
  keyFlag: string;
  placeholder: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: "anthropic", name: "Anthropic", logo: anthropicLogo, authChoice: "anthropic-api-key", keyFlag: "--anthropic-api-key", placeholder: "sk-ant-..." },
  { id: "openai", name: "OpenAI", logo: openaiLogo, authChoice: "openai-api-key", keyFlag: "--openai-api-key", placeholder: "sk-..." },
  { id: "gemini", name: "Google Gemini", logo: googleLogo, authChoice: "gemini-api-key", keyFlag: "--gemini-api-key", placeholder: "AIza..." },
  { id: "deepseek", name: "DeepSeek", logo: deepseekLogo, authChoice: "deepseek-api-key", keyFlag: "--deepseek-api-key", placeholder: "sk-..." },
  { id: "openrouter", name: "OpenRouter", logo: openrouterLogo, authChoice: "openrouter-api-key", keyFlag: "--openrouter-api-key", placeholder: "sk-or-..." },
  { id: "groq", name: "Groq", logo: groqLogo, authChoice: "groq-api-key", keyFlag: "--groq-api-key", placeholder: "gsk_..." },
  { id: "mistral", name: "Mistral", logo: mistralLogo, authChoice: "mistral-api-key", keyFlag: "--mistral-api-key", placeholder: "..." },
  { id: "xai", name: "xAI", logo: xaiLogo, authChoice: "xai-api-key", keyFlag: "--xai-api-key", placeholder: "xai-..." },
  { id: "fireworks", name: "Fireworks", logo: fireworksLogo, authChoice: "fireworks-api-key", keyFlag: "--fireworks-api-key", placeholder: "fw_..." },
  { id: "cerebras", name: "Cerebras", logo: cerebrasLogo, authChoice: "cerebras-api-key", keyFlag: "--cerebras-api-key", placeholder: "..." },
  { id: "github-copilot", name: "GitHub Copilot", logo: githubLogo, authChoice: "github-copilot", keyFlag: "", placeholder: "" },
  { id: "ollama", name: "Ollama (Local)", logo: ollamaLogo, authChoice: "ollama", keyFlag: "", placeholder: "" },
];

const TIMEZONES = [
  "America/Mexico_City", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Bogota", "America/Lima", "America/Sao_Paulo",
  "America/Buenos_Aires", "America/Santiago", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Kolkata", "Asia/Dubai", "Australia/Sydney", "Pacific/Auckland",
];

/** Check if OpenClaw is already set up */
export async function checkOpenClawSetup(): Promise<boolean> {
  try {
    const hasIdentity = await exists(".openclaw/identity/device.json", { baseDir: BaseDirectory.Home });
    if (!hasIdentity) return false;
    const hasConfig = await exists(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
    return hasIdentity && hasConfig;
  } catch {
    return false;
  }
}

/** Check if OpenClaw CLI is installed */
async function checkOpenClawInstalled(): Promise<boolean> {
  try {
    await invoke<string>("run_shell", { cmd: "sh -lc 'which openclaw'" });
    return true;
  } catch {
    return false;
  }
}

export function OnboardingScreen({ onComplete, preview }: OnboardingScreenProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState<ProviderOption | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentEmoji, setAgentEmoji] = useState("");
  const [userName, setUserName] = useState("");
  const [timezone, setTimezone] = useState("America/Mexico_City");
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [progress, setProgress] = useState("");
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Check CLI on welcome step
  const checkCli = useCallback(async () => {
    if (preview) { setCliInstalled(true); return; }
    const installed = await checkOpenClawInstalled();
    setCliInstalled(installed);
  }, [preview]);

  // Import existing OpenClaw setup
  const handleImport = useCallback(async () => {
    if (preview) { onComplete(); return; }
    const isSetup = await checkOpenClawSetup();
    if (isSetup) {
      onComplete();
    } else {
      setError("No existing OpenClaw setup found. Complete the setup first.");
    }
  }, [onComplete, preview]);

  // Install OpenClaw CLI
  const handleInstallCli = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke<string>("run_shell", { cmd: "sh -lc 'npm install -g openclaw@latest'" });
      setCliInstalled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install OpenClaw CLI");
    } finally {
      setInstalling(false);
    }
  }, []);

  // Run the full onboarding
  const handleFinish = useCallback(async () => {
    setStep("running");
    setError(null);
    setProgress("Setting up OpenClaw...");

    // Preview/test mode skips actual onboard commands
    const isTestMode = preview || localStorage.getItem("forceOnboarding") === "true";
    if (isTestMode) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!mountedRef.current) return;
      localStorage.removeItem("forceOnboarding");
      setStep("done");
      return;
    }

    try {
      // Build the onboard command
      const parts = ["sh -lc 'openclaw onboard --non-interactive --accept-risk --install-daemon --mode local --gateway-auth token --flow quickstart"];

      if (provider) {
        parts.push(`--auth-choice ${provider.authChoice}`);
        if (provider.keyFlag && apiKey.trim()) {
          parts.push(`${provider.keyFlag} "${apiKey.trim()}"`);
        }
      }

      parts.push("--skip-channels --skip-skills --skip-search");
      const cmd = parts.join(" ") + "'";

      setProgress("Running openclaw onboard...");
      await invoke<string>("run_shell", { cmd });

      // Update IDENTITY.md if user provided agent name/emoji
      if (agentName.trim() || agentEmoji.trim()) {
        setProgress("Setting up agent identity...");
        const identityLines = ["# IDENTITY.md - Who Am I?\n"];
        identityLines.push(`- **Name:** ${agentName.trim() || "Assistant"}`);
        identityLines.push(`- **Creature:** AI assistant`);
        identityLines.push(`- **Vibe:** Helpful, direct, and friendly.`);
        identityLines.push(`- **Emoji:** ${agentEmoji.trim() || "\u{1F916}"}`);
        identityLines.push(`- **Avatar:** \n`);
        const identityContent = identityLines.join("\n");

        // Write via shell (writeTextFile may need the directory to exist)
        const escaped = identityContent.replace(/'/g, "'\\''");
        await invoke<string>("run_shell", {
          cmd: `sh -lc 'echo "${escaped}" > ~/.openclaw/workspace/IDENTITY.md'`
        }).catch(() => {});
      }

      // Update USER.md if user provided their name
      if (userName.trim()) {
        setProgress("Setting up user profile...");
        const userLines = ["# USER.md - About Your Human\n"];
        userLines.push(`- **Name:** ${userName.trim()}`);
        userLines.push(`- **What to call them:** ${userName.trim()}`);
        userLines.push(`- **Timezone:** ${timezone}`);
        userLines.push(`- **Location:** \n`);
        const userContent = userLines.join("\n");

        const escaped = userContent.replace(/'/g, "'\\''");
        await invoke<string>("run_shell", {
          cmd: `sh -lc 'echo "${escaped}" > ~/.openclaw/workspace/USER.md'`
        }).catch(() => {});
      }

      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep("user"); // Go back
    }
  }, [provider, apiKey, agentName, agentEmoji, userName, timezone, preview]);

  // Step order for skip navigation
  const STEP_ORDER: Step[] = ["welcome", "provider", "apikey", "identity", "user"];
  const skipStep = useCallback(() => {
    setError(null);
    const idx = STEP_ORDER.indexOf(step);
    if (idx >= STEP_ORDER.length - 1) {
      // Last step → finish
      handleFinish();
      return;
    }
    const next = STEP_ORDER[idx + 1]!;
    // Provider without key flag → skip apikey
    if (next === "apikey" && (!provider || !provider.keyFlag)) {
      setStep("identity");
    } else {
      setStep(next);
    }
  }, [step, provider, handleFinish]);

  // --- RENDER ---

  // Shimmer logo used across steps
  const logoEl = (
    <div
      className="h-16 w-16 mx-auto mb-6"
      style={{
        WebkitMaskImage: `url("${xcloudLogo}")`,
        maskImage: `url("${xcloudLogo}")`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
        backgroundSize: "250% 100%",
        animation: "shimmerBg 2.7s linear infinite",
      }}
    />
  );

  const btnBase = "flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm transition-colors";
  const btnBack = (onClick: () => void) => (
    <button onClick={() => { onClick(); setError(null); }} className={cn(btnBase, "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text")}>
      Back
    </button>
  );
  const btnSkip = (
    <button onClick={skipStep} className={cn(btnBase, "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text")}>
      Skip
    </button>
  );
  const btnContinue = (onClick: () => void, label = "Continue") => (
    <button onClick={onClick} className={cn(btnBase, "bg-white text-black font-medium hover:bg-white/90")}>
      {label} <ArrowRight size={14} />
    </button>
  );

  // Step: Welcome
  if (step === "welcome") {
    if (cliInstalled === null) checkCli();

    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md text-center">
          {logoEl}
          <h1 className="text-2xl font-semibold text-text">Welcome to xCloud</h1>
          <p className="mt-2 text-sm text-text-muted">
            Your AI agents, everywhere. Let's get you set up.
          </p>

          <div className="mt-8 space-y-3">
            {/* Import existing */}
            <button
              onClick={handleImport}
              className="w-full flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 text-left hover:bg-white/15 transition-colors"
            >
              <img src={openclawLogo} alt="" className="h-8 w-8 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text">Import from OpenClaw</div>
                <div className="text-xs text-text-muted mt-0.5">Use your existing setup</div>
              </div>
              <ChevronRight size={18} className="text-text-muted shrink-0" />
            </button>

            {/* Fresh setup */}
            <button
              onClick={() => {
                setError(null);
                if (cliInstalled === false) {
                  setStep("welcome"); // Stay, show install
                } else {
                  setStep("provider");
                }
              }}
              className="w-full flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 text-left hover:bg-white/15 transition-colors"
            >
              <div className="h-8 w-8 shrink-0 flex items-center justify-center text-lg">+</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text">New Setup</div>
                <div className="text-xs text-text-muted mt-0.5">Configure your first agent</div>
              </div>
              <ChevronRight size={18} className="text-text-muted shrink-0" />
            </button>
          </div>

          {/* CLI Install needed */}
          {cliInstalled === false && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-left">
              <div className="text-sm text-text">OpenClaw CLI not found</div>
              <div className="text-xs text-text-muted mt-1">
                Install it to continue with the setup.
              </div>
              <button
                onClick={handleInstallCli}
                disabled={installing}
                className={cn(
                  "mt-3 w-full rounded-xl py-2.5 text-sm font-medium transition-colors",
                  installing
                    ? "bg-white/5 text-text-muted cursor-wait"
                    : "bg-white/10 text-text hover:bg-white/15"
                )}
              >
                {installing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Installing...
                  </span>
                ) : (
                  "Install OpenClaw CLI"
                )}
              </button>
              <div className="mt-2 text-[10px] text-text-muted font-mono text-center">
                npm install -g openclaw@latest
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-xs text-red-400">{error}</p>
          )}

          <div className="mt-6 flex justify-center">
            {btnSkip}
          </div>
        </div>
      </div>
    );
  }

  // Step: Provider selection
  if (step === "provider") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md">
          {logoEl}
          <h2 className="text-lg font-semibold text-text text-center">Choose your AI provider</h2>
          <p className="mt-1 text-xs text-text-muted text-center">
            Select the provider you want to use for your agents.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setProvider(p);
                  setError(null);
                  // Providers without API key (Ollama, GitHub Copilot) skip apikey step
                  if (!p.keyFlag) {
                    setStep("identity");
                  } else {
                    setStep("apikey");
                  }
                }}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3",
                  "hover:bg-surface-hover transition-colors text-left"
                )}
              >
                <img src={p.logo} alt="" className="h-6 w-6 shrink-0" />
                <span className="text-sm text-text truncate">{p.name}</span>
              </button>
            ))}
          </div>

          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}

          <div className="mt-5 flex items-center justify-between">
            {btnBack(() => setStep("welcome"))}
            {btnSkip}
          </div>
        </div>
      </div>
    );
  }

  // Step: API Key
  if (step === "apikey") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md">
          {logoEl}
          <div className="flex items-center justify-center gap-3 mb-2">
            {provider && <img src={provider.logo} alt="" className="h-7 w-7" />}
            <h2 className="text-lg font-semibold text-text">{provider?.name} API Key</h2>
          </div>
          <p className="text-xs text-text-muted text-center">
            Enter your API key to connect to {provider?.name}.
          </p>

          <div className="mt-6">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && apiKey.trim()) {
                  setStep("identity");
                  setError(null);
                }
              }}
              placeholder={provider?.placeholder || "Paste your API key"}
              className={cn(
                "w-full rounded-2xl bg-surface px-4 py-3.5",
                "text-sm text-text font-mono placeholder:text-text-muted/50",
                "focus:outline-none transition-colors"
              )}
              autoFocus
            />
            <p className="mt-2 text-[10px] text-text-muted text-center">
              Your key is stored locally in ~/.openclaw/openclaw.json
            </p>
          </div>

          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}

          <div className="mt-6 flex items-center justify-between">
            {btnBack(() => setStep("provider"))}
            <div className="flex items-center gap-2">
              {btnSkip}
              {btnContinue(() => {
                if (!apiKey.trim()) { setError("API key is required"); return; }
                setStep("identity"); setError(null);
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step: Agent Identity
  if (step === "identity") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md">
          {logoEl}
          <h2 className="text-lg font-semibold text-text text-center">Name your agent</h2>
          <p className="mt-1 text-xs text-text-muted text-center">
            Give your main agent a name and emoji. You can change this later.
          </p>

          <div className="mt-6">
            <label className="mb-1.5 block text-xs text-text-muted">Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Jarvis, Nova, Atlas..."
              className={cn(
                "w-full rounded-2xl bg-surface px-4 py-3",
                "text-sm text-text placeholder:text-text-muted/50",
                "focus:outline-none transition-colors"
              )}
              autoFocus
            />
          </div>

          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}

          <div className="mt-6 flex items-center justify-between">
            {btnBack(() => setStep(provider?.keyFlag ? "apikey" : "provider"))}
            <div className="flex items-center gap-2">
              {btnSkip}
              {btnContinue(() => { setStep("user"); setError(null); })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step: User info
  if (step === "user") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md">
          {logoEl}
          <h2 className="text-lg font-semibold text-text text-center">About you</h2>
          <p className="mt-1 text-xs text-text-muted text-center">
            So your agent knows who you are. Optional.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs text-text-muted">Your name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Your name"
                className={cn(
                  "w-full rounded-2xl bg-surface px-4 py-3",
                  "text-sm text-text placeholder:text-text-muted/50",
                  "focus:outline-none transition-colors"
                )}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-muted">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={cn(
                  "w-full rounded-2xl bg-surface px-4 py-3",
                  "text-sm text-text appearance-none cursor-pointer",
                  "focus:outline-none transition-colors"
                )}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}

          <div className="mt-6 flex items-center justify-between">
            {btnBack(() => setStep("identity"))}
            <div className="flex items-center gap-2">
              {btnSkip}
              {btnContinue(handleFinish, "Finish Setup")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step: Running
  if (step === "running") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md text-center">
          <div
            className="h-16 w-16 mx-auto mb-6"
            style={{
              WebkitMaskImage: `url("${xcloudLogo}")`,
              maskImage: `url("${xcloudLogo}")`,
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
              backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
              backgroundSize: "250% 100%",
              animation: "shimmerBg 2.7s linear infinite",
            }}
          />
          <h2 className="text-lg font-semibold text-text">Setting up</h2>
          <p className="mt-2 text-sm text-text-muted">{progress}</p>
          <Loader2 size={20} className="animate-spin text-text-muted mx-auto mt-4" />
        </div>
      </div>
    );
  }

  // Step: Done
  if (step === "done") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md text-center">
          {logoEl}
          <h2 className="text-xl font-semibold text-text">You're all set</h2>
          <p className="mt-2 text-sm text-text-muted">
            {agentName ? `${agentName} is ready.` : "Your agent is ready."} Let's go.
          </p>

          <button
            onClick={onComplete}
            className="mt-8 rounded-xl bg-white text-black px-8 py-3 text-sm font-medium hover:bg-white/90 transition-colors"
          >
            Open xCloud
          </button>
        </div>
      </div>
    );
  }

  return null;
}
