import { useState, useEffect, useRef } from "react";
import { BrowserEngine } from "@/lib/engine";
import { AppLayout } from "@/components/AppLayout";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

  // Gateway lifecycle: start → connect → pair → ready
  useEffect(() => {
    if (appState.kind !== "starting" || connectAttempt === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const mode = localStorage.getItem("engineMode") ?? "local";
        let wsUrl: string;
        let identity: ReturnType<typeof parseIdentity> | null = null;

        if (mode === "mac-mini") {
          const remoteUrl = localStorage.getItem("engineMacMiniUrl");
          if (!remoteUrl) throw new Error("No Mac Mini URL configured. Go to Settings → Engine.");
          wsUrl = remoteUrl;
          // Still need local identity for signing
          const statusForId = await invoke<EngineStatusResult>("engine_status");
          if (statusForId.identity) identity = parseIdentity(statusForId.identity);
        } else if (mode === "vps") {
          const remoteUrl = localStorage.getItem("engineVpsUrl");
          if (!remoteUrl) throw new Error("No VPS URL configured. Go to Settings → Engine.");
          wsUrl = remoteUrl;
          const statusForId = await invoke<EngineStatusResult>("engine_status");
          if (statusForId.identity) identity = parseIdentity(statusForId.identity);
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
                identity = parseIdentity(check.identity);
                break;
              }
            } catch { /* keep trying */ }
          }
        }
        if (!identity) throw new Error("No identity found. Please reconfigure.");
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
            const msg = connectErr instanceof Error ? connectErr.message : String(connectErr);

            // Pairing required → write a script, spawn it, wait, retry
            if (msg.includes("pairing")) {
              setAppState({ kind: "pairing" });
              // Write approve script to tmp and run it (avoids quoting hell)
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
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            // Token/auth error → re-read token and retry
            if (msg.includes("token") || msg.includes("auth") || msg.includes("unauthorized")) {
              try {
                const newToken = await invoke<string>("engine_read_token");
                client.updateConfig({ token: newToken });
              } catch { /* ignore */ }
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
          message: err instanceof Error ? err.message : "Failed to connect",
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  const shimmer = (
    <div className="flex h-full items-center justify-center bg-bg">
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
    </div>
  );

  switch (appState.kind) {
    case "checking":
    case "starting":
    case "connecting":
    case "pairing":
      return shimmer;

    case "onboarding":
      return <OnboardingScreen onComplete={handleOnboardingComplete} />;

    case "connected":
      return <AppLayout engine={appState.engine} />;

    case "reconnecting":
      return <AppLayout engine={appState.engine} reconnecting />;

    case "error":
      return (
        <div className="flex h-full items-center justify-center bg-bg">
          <div className="text-center max-w-sm px-4">
            <div className="text-lg font-medium text-text">Connection Failed</div>
            <div className="mt-2 text-xs text-red-400">{appState.message}</div>
            <button
              onClick={handleRetry}
              className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-xs text-text hover:bg-white/15 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
  }
}
