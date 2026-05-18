import { useState, useEffect, useRef } from "react";
import { BrowserEngine } from "@/lib/engine";
import { AppLayout } from "@/components/AppLayout";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";
import { OnboardingScreen } from "@/components/OnboardingScreen";

interface RustIdentity {
  device_id: string;
  public_key_pem: string;
  private_key_pem: string;
  token: string;
}

interface EngineStatusResult {
  running: boolean;
  port: number;
  pid: number | null;
  managed: boolean;
  identity: RustIdentity | null;
}

type RemoteEngineMode = "mac-mini" | "vps";

/** Convert Rust identity to BrowserEngine config format */
function parseIdentity(raw: RustIdentity) {
  const pubB64 = raw.public_key_pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const spkiBytes = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0));
  const rawPub = spkiBytes.slice(-32);
  const publicKeyBase64Url = btoa(String.fromCharCode(...rawPub))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  const privateKeyPkcs8Base64 = raw.private_key_pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return { deviceId: raw.device_id, publicKeyBase64Url, privateKeyPkcs8Base64, token: raw.token };
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

function getRemoteEngineConfig(mode: RemoteEngineMode) {
  const prefix = mode === "mac-mini" ? "engineMacMini" : "engineVps";
  return {
    url: normalizeGatewayUrl(localStorage.getItem(`${prefix}Url`) ?? ""),
    token: normalizeGatewayToken(localStorage.getItem(`${prefix}Token`) ?? ""),
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatRemotePairingMessage(mode: RemoteEngineMode, rawMessage: string) {
  const target = mode === "mac-mini" ? "Mac Mini" : "VPS";
  const requestId = rawMessage.match(/requestId:\s*([a-f0-9-]+)/i)?.[1];
  const approveCommand = requestId
    ? `openclaw devices approve ${requestId}`
    : "openclaw devices list, then openclaw devices approve <requestId>";
  return [
    `${target} connected, but this computer is not approved yet.`,
    `Run this on the ${target}: ${approveCommand}`,
    "Then press Retry.",
  ].join(" ");
}

// ─── App State Machine ────────────────────────────────────────────────────────

type AppState =
  | { kind: "checking" }
  | { kind: "onboarding" }
  | { kind: "starting" }
  | { kind: "connecting" }
  | { kind: "pairing" }
  | { kind: "connected"; engine: BrowserEngine }
  | { kind: "reconnecting"; engine: BrowserEngine }
  | { kind: "error"; message: string };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ kind: "checking" });
  const engineRef = useRef<BrowserEngine | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  // Initial check: does config exist?
  useEffect(() => {
    invoke<boolean>("engine_init_check")
      .then((isSetup) => {
        if (isSetup) {
          setAppState({ kind: "starting" });
          setConnectAttempt(1);
        } else {
          setAppState({ kind: "onboarding" });
        }
      })
      .catch(() => setAppState({ kind: "onboarding" }));
  }, []);

  useEffect(() => {
    const handleEngineConfigChanged = () => {
      engineRef.current?.disconnect();
      setAppState({ kind: "starting" });
      setConnectAttempt((c) => c + 1);
    };
    window.addEventListener("xcloud-engine-config-changed", handleEngineConfigChanged);
    return () => window.removeEventListener("xcloud-engine-config-changed", handleEngineConfigChanged);
  }, []);

  // Gateway lifecycle: start → connect → pair → ready
  useEffect(() => {
    if (appState.kind !== "starting" || connectAttempt === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const mode = localStorage.getItem("engineMode") ?? "local";
        const configuredRemoteMode: RemoteEngineMode | null = mode === "mac-mini" || mode === "vps" ? mode : null;
        const configuredRemote = configuredRemoteMode ? getRemoteEngineConfig(configuredRemoteMode) : null;
        const remoteMode = configuredRemoteMode && configuredRemote?.url ? configuredRemoteMode : null;
        let wsUrl: string;
        let identity: ReturnType<typeof parseIdentity> | null = null;
        let remoteToken = "";

        if (configuredRemoteMode && !configuredRemote?.url) {
          localStorage.setItem("engineMode", "local");
        }

        if (remoteMode) {
          const remote = getRemoteEngineConfig(remoteMode);
          if (!remote.url) {
            throw new Error(`No ${remoteMode === "mac-mini" ? "Mac Mini" : "VPS"} URL configured. Go to Settings → Engine.`);
          }
          wsUrl = remote.url;
          remoteToken = remote.token;

          // The remote gateway still requires this device identity for signed pairing.
          const statusForId = await invoke<EngineStatusResult>("engine_status");
          if (statusForId.identity) {
            identity = { ...parseIdentity(statusForId.identity), token: remoteToken };
          }
        } else {
          const status = await invoke<EngineStatusResult>("engine_ensure_running");
          wsUrl = `ws://127.0.0.1:${status.port}`;
          // Identity comes from the same call — no separate invoke needed
          if (status.identity) {
            identity = parseIdentity(status.identity);
          }
        }

        if (cancelled) return;

        // Identity may not be ready yet if onboard just finished — retry a few times
        if (!identity) {
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            if (cancelled) return;
            try {
              const check = await invoke<EngineStatusResult>("engine_status");
              if (check.identity) {
                identity = remoteMode
                  ? { ...parseIdentity(check.identity), token: remoteToken }
                  : parseIdentity(check.identity);
                break;
              }
            } catch { /* keep trying */ }
          }
        }
        if (!identity) throw new Error("Waiting for identity — the gateway may still be starting. Try again in a few seconds.");
        setAppState({ kind: "connecting" });

        const client = new BrowserEngine({ url: wsUrl, ...identity });
        engineRef.current = client;

        // Wire auto-reconnect state changes
        client.onStateChange((state) => {
          if (state === "reconnecting") {
            setAppState((prev) =>
              prev.kind === "connected" ? { kind: "reconnecting", engine: client } : prev
            );
          } else if (state === "connected") {
            setAppState({ kind: "connected", engine: client });
          }
        });

        client.onFatal((msg) => {
          setAppState({ kind: "error", message: msg });
        });

        // Try connecting with auto-recovery (up to 5 attempts)
        for (let attempt = 0; attempt < 5; attempt++) {
          if (cancelled) return;
          try {
            await client.connect();
            if (cancelled) return;
            setAppState({ kind: "connected", engine: client });
            return; // Success
          } catch (connectErr) {
            if (cancelled) return;
            const msg = getErrorMessage(connectErr);

            // Pairing required → write a script, spawn it, wait, retry
            if (msg.includes("pairing")) {
              setAppState({ kind: "pairing" });
              if (remoteMode) {
                throw new Error(formatRemotePairingMessage(remoteMode, msg));
              } else {
                // Try Rust auto-pair first, then fallback to python script
                try {
                  await invoke("engine_auto_pair");
                } catch {
                  // Fallback: python script
                  await invoke<number>("spawn_shell", {
                    cmd: [
                      "cat > /tmp/xcloud-pair.py << 'XEOF'",
                      "import json, subprocess, os",
                      "home = os.path.expanduser('~')",
                      "try:",
                      "  cfg = json.load(open(f'{home}/.openclaw/openclaw.json'))",
                      "  token = cfg['gateway']['auth']['token']",
                      "  pending = json.load(open(f'{home}/.openclaw/devices/pending.json'))",
                      "  for v in pending.values():",
                      "    rid = v.get('requestId', '')",
                      "    if rid:",
                      "      subprocess.run(['sh', '-lc', f'openclaw devices approve {rid} --token {token}'], capture_output=True)",
                      "except: pass",
                      "XEOF",
                      "sleep 1 && python3 /tmp/xcloud-pair.py",
                    ].join("\n"),
                  }).catch(() => {});
                }
              }
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            // Token/auth error → re-read token and retry
            if (msg.includes("token") || msg.includes("auth") || msg.includes("unauthorized")) {
              if (remoteMode) {
                client.updateConfig({ token: remoteToken });
              } else {
                try {
                  const newToken = await invoke<string>("engine_read_token");
                  client.updateConfig({ token: newToken });
                } catch { /* ignore */ }
              }
              await new Promise((r) => setTimeout(r, 2000));
              continue; // Retry connect
            }

            // Rate limited → wait longer and retry
            if (msg.includes("rate") || msg.includes("too many")) {
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            // Unknown error on last attempt → throw
            if (attempt === 4) throw connectErr;

            // Otherwise wait and retry
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      } catch (err) {
        if (cancelled) return;
        setAppState({
          kind: "error",
          message: getErrorMessage(err) || "Failed to connect",
        });
      }
    })();

    return () => { cancelled = true; };
  }, [connectAttempt]);

  // Listen for gateway crash events
  useEffect(() => {
    const unCrash = listen<string>("engine-gateway-crashed", async () => {
      const exists = await invoke<boolean>("engine_config_exists").catch(() => false);
      if (!exists) {
        engineRef.current?.disconnect();
        setAppState({ kind: "onboarding" });
        return;
      }
      engineRef.current?.disconnect();
      setAppState({ kind: "starting" });
      setConnectAttempt((c) => c + 1);
    });

    const unUnresponsive = listen("engine-gateway-unresponsive", () => {
      // Gateway process alive but port unresponsive — WebSocket auto-reconnect handles this
    });

    return () => {
      unCrash.then((fn) => fn());
      unUnresponsive.then((fn) => fn());
    };
  }, []);

  // Handlers
  function handleOnboardingComplete() {
    setAppState({ kind: "starting" });
    setConnectAttempt((c) => c + 1);
  }

  function handleRetry() {
    setAppState({ kind: "starting" });
    setConnectAttempt((c) => c + 1);
  }

  // ─── Loading status texts ───────────────────────────────────────────────────
  const STATUS_TEXTS: Record<string, string[]> = {
    checking: ["Checking setup...", "Looking for gateway..."],
    starting: ["Starting engine...", "Preparing services...", "Almost there..."],
    connecting: ["Connecting...", "Establishing connection...", "Handshaking..."],
    pairing: ["Pairing device...", "Verifying identity...", "Finalizing..."],
  };

  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    const kind = appState.kind;
    if (!["checking", "starting", "connecting", "pairing"].includes(kind)) return;
    setStatusIdx(0);
    const texts = STATUS_TEXTS[kind] ?? ["Loading..."];
    const interval = setInterval(() => {
      setStatusIdx(prev => (prev + 1) % texts.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [appState.kind]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  switch (appState.kind) {
    case "checking":
    case "starting":
    case "connecting":
    case "pairing": {
      const texts = STATUS_TEXTS[appState.kind] ?? ["Loading..."];
      const currentText = texts[statusIdx % texts.length]!;
      return (
        <div className="flex h-full flex-col items-center justify-center bg-bg" onMouseDown={async (e) => { if (e.button === 0) { try { await getCurrentWindow().startDragging(); } catch {} } }}>
          <div
            className="h-20 w-20"
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
          <div className="mt-5 h-6 overflow-hidden">
            <p
              key={currentText}
              className="font-medium text-text-muted text-center"
              style={{
                fontSize: 15,
                backgroundImage: "linear-gradient(90deg, #555 0%, #555 35%, #999 50%, #555 65%, #555 100%)",
                backgroundSize: "250% 100%",
                animation: "shimmerBg 2.7s linear infinite, fadeBlurIn 400ms ease-out",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {currentText}
            </p>
          </div>
        </div>
      );
    }

    case "onboarding":
      return <OnboardingScreen onComplete={handleOnboardingComplete} />;

    case "connected":
      return <AppLayout engine={appState.engine} />;

    case "reconnecting":
      return <AppLayout engine={appState.engine} reconnecting />;

    case "error":
      return (
        <div className="flex h-full items-center justify-center bg-bg" onMouseDown={async (e) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button")) { try { await getCurrentWindow().startDragging(); } catch {} } }}>
          <div className="text-center max-w-sm px-4">
            <div className="text-lg font-medium text-text">Connection Failed</div>
            <div className="mt-2 text-xs text-text-muted leading-relaxed">{appState.message}</div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={handleRetry}
                className="rounded-xl bg-white/10 px-4 py-2 text-xs text-text hover:bg-white/15 transition-colors"
              >
                Retry
              </button>
              {appState.message.includes("identity") && (
                <button
                  onClick={() => setAppState({ kind: "onboarding" })}
                  className="rounded-xl bg-white/5 px-4 py-2 text-xs text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                >
                  Reconfigure
                </button>
              )}
            </div>
          </div>
        </div>
      );
  }
}
