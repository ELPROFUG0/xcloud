import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/cn";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";
import { ArrowRight } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

export function OnboardingScreen({ onComplete, preview }: OnboardingScreenProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState<ProviderOption | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [agentName, setAgentName] = useState("");
  const [userName, setUserName] = useState("");
  const [timezone, setTimezone] = useState("America/Mexico_City");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [runningMode, setRunningMode] = useState<"idle" | "preview" | "real">("idle");
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Animated progress bar
  useEffect(() => {
    if (runningMode === "idle") return;

    let cancelled = false;
    const steps = runningMode === "preview"
      ? [
          { msg: "Initializing...", pct: 10, delay: 600 },
          { msg: "Configuring gateway...", pct: 25, delay: 800 },
          { msg: "Setting up authentication...", pct: 40, delay: 700 },
          { msg: "Installing services...", pct: 55, delay: 900 },
          { msg: "Creating workspace...", pct: 70, delay: 700 },
          { msg: "Almost done...", pct: 85, delay: 600 },
          { msg: "Done!", pct: 100, delay: 400 },
        ]
      : [
          { msg: "Initializing...", pct: 15, delay: 500 },
          { msg: "Configuring gateway...", pct: 30, delay: 700 },
          { msg: "Setting up authentication...", pct: 45, delay: 700 },
          { msg: "Installing services...", pct: 55, delay: 800 },
          { msg: "Creating workspace...", pct: 65, delay: 800 },
          { msg: "Configuring agent...", pct: 75, delay: 700 },
          { msg: "Almost done...", pct: 80, delay: 600 },
        ];

    (async () => {
      for (const s of steps) {
        await new Promise((r) => setTimeout(r, s.delay));
        if (cancelled) return;
        setProgress(s.msg);
        setProgressPct(s.pct);
      }
      if (runningMode === "preview" && !cancelled) {
        setStep("done");
        setRunningMode("idle");
        return;
      }
      // Real mode: creep slowly from 80→95% while waiting
      let creep = 80;
      while (!cancelled && creep < 95) {
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        creep += 1;
        setProgressPct(creep);
      }
    })();

    return () => { cancelled = true; };
  }, [runningMode]);

  // Run the full onboarding via Tauri commands (no shell scripts)
  function handleFinish() {
    setStep("running");
    setError(null);
    setProgress("Setting up...");
    setProgressPct(0);

    if (preview) {
      setRunningMode("preview");
      return;
    }

    setRunningMode("real");

    // Register event listener and launch setup
    const setupAndListen = async () => {
      // Register listener FIRST
      const unlisten = await listen<boolean>("engine-setup-complete", () => {
        (window as Window & { __onboardDone?: boolean }).__onboardDone = true;
      });

      // Launch setup (fire and forget)
      invoke("engine_setup", {
        params: {
          auth_choice: provider?.authChoice ?? "skip",
          key_flag: provider?.keyFlag ?? "",
          api_key: apiKey.trim(),
        },
      }).catch(() => {});

      // Poll the flag with simple setInterval (no invoke, no Tauri calls)
      const timer = setInterval(() => {
        if ((window as any).__onboardDone) {
          clearInterval(timer);
          unlisten();
          delete (window as any).__onboardDone;
          setStep("done");
        }
      }, 500);
    };
    setupAndListen();
  }

  // Skip to next step
  const STEP_ORDER: Step[] = ["welcome", "provider", "apikey", "identity", "user"];
  function skipStep() {
    setError(null);
    const idx = STEP_ORDER.indexOf(step);
    if (idx >= STEP_ORDER.length - 1) {
      handleFinish();
      return;
    }
    const next = STEP_ORDER[idx + 1]!;
    if (next === "apikey" && (!provider || !provider.keyFlag)) {
      setStep("identity");
    } else {
      setStep(next);
    }
  }

  // Drag handler for Tauri window
  const handleDrag = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, select, a, [data-interactive]")) return;
    try { await getCurrentWindow().startDragging(); } catch {}
  };

  // --- RENDER HELPERS ---

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
    return (
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md text-center">
          {logoEl}
          <h1 className="text-2xl font-semibold text-text">Welcome to xCloud</h1>

          <div className="mt-8">
            <button
              onClick={() => setStep("provider")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-black px-6 py-2.5 text-sm font-medium hover:bg-white/90 transition-colors"
            >
              Get Started <ArrowRight size={14} />
            </button>
          </div>

          {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // Step: Provider selection
  if (step === "provider") {
    return (
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
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
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
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
              Your key is stored locally and never leaves your device.
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
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md">
          {logoEl}
          <h2 className="text-lg font-semibold text-text text-center">Name your agent</h2>
          <p className="mt-1 text-xs text-text-muted text-center">
            Give your main agent a name. You can change this later.
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
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
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
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
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
          <p className="mt-3 text-sm text-text-muted">{progress}</p>
          <div className="mt-5 w-full max-w-xs mx-auto">
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-all duration-700 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-text-muted text-center">{progressPct}%</p>
          </div>
        </div>
      </div>
    );
  }

  // Step: Done
  if (step === "done") {
    return (
      <div onMouseDown={handleDrag} className="flex h-full flex-col items-center justify-center bg-bg px-4">
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
