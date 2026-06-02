import { Component, type ErrorInfo, type ReactNode, useState, useEffect, useRef } from "react";
import { BrowserEngine } from "@/lib/engine";
import { AppLayout } from "@/components/AppLayout";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";
import { OnboardingScreen } from "@/components/OnboardingScreen";
import { cn } from "@/lib/cn";

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

interface SshTunnelStatus {
  running: boolean;
  localPort: number;
  pid: number | null;
  url: string;
}

interface SshKeyInfo {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appleScriptQuote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function inferSshHostFromGatewayUrl(url: string) {
  try {
    const parsed = new URL(url.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://"));
    if (!parsed.hostname || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return "";
    return parsed.hostname;
  } catch {
    return "";
  }
}

function buildSshTunnelCommand(config: ReturnType<typeof getRemoteEngineConfig>) {
  return [
    "ssh",
    "-N",
    "-L",
    `${config.tunnelPort}:127.0.0.1:18789`,
    "-p",
    String(config.sshPort),
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${config.sshUser}@${config.sshHost}`,
  ].map((part) => shellQuote(part)).join(" ");
}

function buildSshKeyInstallCommand(config: ReturnType<typeof getRemoteEngineConfig>, key: SshKeyInfo) {
  const remoteCommand = [
    "mkdir -p ~/.ssh",
    "chmod 700 ~/.ssh",
    "touch ~/.ssh/authorized_keys",
    "chmod 600 ~/.ssh/authorized_keys",
    `grep -qxF ${shellQuote(key.publicKey)} ~/.ssh/authorized_keys || printf '%s\\n' ${shellQuote(key.publicKey)} >> ~/.ssh/authorized_keys`,
  ].join(" && ");
  const sshCommand = [
    "ssh",
    "-p",
    String(config.sshPort),
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${config.sshUser}@${config.sshHost}`,
    remoteCommand,
  ].map((part) => shellQuote(part)).join(" ");

  return [
    `echo ${shellQuote("xCloud will install an SSH key for automatic background tunnels.")}`,
    `echo ${shellQuote(`Local key: ${key.privateKeyPath}`)}`,
    sshCommand,
    `echo ${shellQuote("Done. Return to xCloud and press Retry.")}`,
  ].join(" && ");
}

function getRemoteEngineStoragePrefix(mode: RemoteEngineMode) {
  return mode === "mac-mini" ? "engineMacMini" : "engineVps";
}

function getRemoteEngineConfig(mode: RemoteEngineMode) {
  const prefix = getRemoteEngineStoragePrefix(mode);
  const url = normalizeGatewayUrl(localStorage.getItem(`${prefix}Url`) ?? "");
  const storedSshHost = (localStorage.getItem(`${prefix}SshHost`) ?? "").trim();
  const sshPort = Number(localStorage.getItem(`${prefix}SshPort`) ?? 22);
  const tunnelPort = Number(localStorage.getItem(`${prefix}TunnelPort`) ?? 18790);
  return {
    url,
    token: normalizeGatewayToken(localStorage.getItem(`${prefix}Token`) ?? ""),
    sshHost: mode === "vps" ? storedSshHost || inferSshHostFromGatewayUrl(url) : storedSshHost,
    sshUser: (localStorage.getItem(`${prefix}SshUser`) ?? "root").trim() || "root",
    sshPort: Number.isFinite(sshPort) && sshPort > 0 ? Math.round(sshPort) : 22,
    tunnelPort: Number.isFinite(tunnelPort) && tunnelPort > 0 ? Math.round(tunnelPort) : 18790,
  };
}

function saveRemoteEngineConfig(
  mode: RemoteEngineMode,
  url: string,
  token: string,
  ssh?: { host?: string; user?: string; sshPort?: number; tunnelPort?: number },
) {
  const prefix = getRemoteEngineStoragePrefix(mode);
  localStorage.setItem(`${prefix}Url`, normalizeGatewayUrl(url));
  localStorage.setItem(`${prefix}Token`, normalizeGatewayToken(token));
  if (mode === "vps" && ssh) {
    localStorage.setItem(`${prefix}SshHost`, (ssh.host ?? "").trim());
    localStorage.setItem(`${prefix}SshUser`, (ssh.user ?? "root").trim() || "root");
    localStorage.setItem(`${prefix}SshPort`, String(ssh.sshPort || 22));
    localStorage.setItem(`${prefix}TunnelPort`, String(ssh.tunnelPort || 18790));
  }
}

async function writeLocalGatewayModeToOpenClawConfig() {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home }).catch(() => "{}");
  const config = JSON.parse(raw || "{}") as Record<string, unknown>;
  const gateway = ((config.gateway && typeof config.gateway === "object") ? config.gateway : {}) as Record<string, unknown>;
  const nextGateway: Record<string, unknown> = { ...gateway, mode: "local" };
  delete nextGateway.remote;
  config.gateway = nextGateway;
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
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
  const target = remoteEngineLabel(mode);
  const requestId = getPairingRequestId(rawMessage);
  const approveCommand = requestId
    ? `openclaw devices approve ${requestId}`
    : "openclaw devices list, then openclaw devices approve <requestId>";
  return [
    `${target} connected, but this computer is not approved yet.`,
    `Run this on the ${target}: ${approveCommand}`,
    "Then press Retry.",
  ].join(" ");
}

function getPairingRequestId(message: string) {
  return message.match(/(?:requestId:|devices approve)\s*([a-f0-9-]+)/i)?.[1] ?? "";
}

function isSshAuthError(message: string) {
  return /Permission denied/i.test(message) && /(publickey|password)/i.test(message);
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
  | { kind: "error"; message: string; remoteMode?: RemoteEngineMode | null };

function remoteEngineLabel(mode?: RemoteEngineMode | null) {
  if (mode === "mac-mini") return "Mac mini";
  if (mode === "vps") return "OpenClaw host";
  return "Remote engine";
}

function formatStartupError(error: unknown, mode?: RemoteEngineMode | null) {
  const message = getErrorMessage(error) || "Failed to connect";
  if (!mode) return message;
  if (message.includes("SSH tunnel") || message.includes("SSH key") || message.includes("ssh -p")) {
    return message;
  }
  if (
    message.includes("timed out")
    || message.includes("WebSocket failed")
    || message.includes("Connection closed")
    || message.includes("Failed to connect")
  ) {
    return `${remoteEngineLabel(mode)} is not reachable right now. Make sure it is turned on, OpenClaw gateway is running, and the saved URL is still correct.`;
  }
  return message;
}

interface AppErrorBoundaryState {
  error: string | null;
  stack: string | null;
  componentStack: string | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    stack: null,
    componentStack: null,
  };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return {
      error: getErrorMessage(error) || "The app hit an unexpected render error.",
      stack: error instanceof Error ? error.stack ?? null : null,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const payload = {
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      componentStack: info.componentStack ?? null,
      createdAt: new Date().toISOString(),
    };
    this.setState({ componentStack: info.componentStack ?? null });
    try {
      localStorage.setItem("xcloud:last-render-error", JSON.stringify(payload));
    } catch {
      // Ignore storage failures; the visible error screen is the important part.
    }
    console.error("[xCloud] render error", payload);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-bg px-6 text-text">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
          <div className="text-sm font-semibold">xCloud hit a production render error</div>
          <div className="mt-2 rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
            {this.state.error}
          </div>
          {(this.state.stack || this.state.componentStack) && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-black/30 p-3 text-left font-mono text-[10px] leading-relaxed text-text-muted">
              {[this.state.stack, this.state.componentStack].filter(Boolean).join("\n\n")}
            </pre>
          )}
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-text transition-colors hover:bg-white/15"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              className="rounded-xl bg-white/5 px-4 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
              onClick={() => this.setState({ error: null, stack: null, componentStack: null })}
            >
              Try without reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function AppContent() {
  const [appState, setAppState] = useState<AppState>({ kind: "checking" });
  const engineRef = useRef<BrowserEngine | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [engineEditOpen, setEngineEditOpen] = useState(false);
  const [engineEditUrl, setEngineEditUrl] = useState("");
  const [engineEditToken, setEngineEditToken] = useState("");
  const [engineEditSshHost, setEngineEditSshHost] = useState("");
  const [engineEditSshUser, setEngineEditSshUser] = useState("root");
  const [engineEditSshPort, setEngineEditSshPort] = useState("22");
  const [engineEditTunnelPort, setEngineEditTunnelPort] = useState("18790");
  const [approvingPairing, setApprovingPairing] = useState(false);
  const [settingUpSshKey, setSettingUpSshKey] = useState(false);

  useEffect(() => {
    const saveRuntimeError = (payload: Record<string, unknown>) => {
      try {
        localStorage.setItem("xcloud:last-runtime-error", JSON.stringify({
          ...payload,
          createdAt: new Date().toISOString(),
        }));
      } catch {
        // Ignore storage failures; console output still helps during release-mode testing.
      }
    };
    const onError = (event: ErrorEvent) => {
      saveRuntimeError({
        type: "error",
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : null,
      });
      console.error("[xCloud] runtime error", event.error ?? event.message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      saveRuntimeError({
        type: "unhandledrejection",
        message: getErrorMessage(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : null,
      });
      console.error("[xCloud] unhandled rejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

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
      let activeRemoteMode: RemoteEngineMode | null = null;
      try {
        const mode = localStorage.getItem("engineMode") ?? "local";
        const configuredRemoteMode: RemoteEngineMode | null = mode === "mac-mini" || mode === "vps" ? mode : null;
        const configuredRemote = configuredRemoteMode ? getRemoteEngineConfig(configuredRemoteMode) : null;
        const remoteConfigured = configuredRemoteMode === "vps"
          ? Boolean(configuredRemote?.sshHost || configuredRemote?.url)
          : Boolean(configuredRemote?.url);
        const remoteMode = configuredRemoteMode && remoteConfigured ? configuredRemoteMode : null;
        activeRemoteMode = remoteMode;
        let wsUrl: string;
        let identity: ReturnType<typeof parseIdentity> | null = null;
        let remoteToken = "";

        if (configuredRemoteMode && !remoteConfigured) {
          localStorage.setItem("engineMode", "local");
          await writeLocalGatewayModeToOpenClawConfig().catch(() => {});
        }

        if (remoteMode) {
          const remote = getRemoteEngineConfig(remoteMode);
          if (!remote.token) {
            throw new Error(`No ${remoteEngineLabel(remoteMode)} token configured. Go to Settings → Engine.`);
          }
          if (remoteMode === "vps" && remote.sshHost) {
            const tunnel = await invoke<SshTunnelStatus>("engine_ssh_tunnel_start", {
              params: {
                host: remote.sshHost,
                user: remote.sshUser,
                sshPort: remote.sshPort,
                localPort: remote.tunnelPort,
                remotePort: 18789,
              },
            });
            wsUrl = tunnel.url;
          } else if (remote.url) {
            wsUrl = remote.url;
          } else {
            throw new Error(`No ${remoteEngineLabel(remoteMode)} URL configured. Go to Settings → Engine.`);
          }
          remoteToken = remote.token;

          // The remote gateway still requires this device identity for signed pairing.
          const statusForId = await invoke<EngineStatusResult>("engine_status");
          if (statusForId.identity) {
            identity = { ...parseIdentity(statusForId.identity), token: remoteToken };
          }
        } else {
          await invoke("engine_ssh_tunnel_stop").catch(() => {});
          await invoke("engine_oauth_callback_tunnel_stop").catch(() => {});
          await invoke("engine_oauth_redirect_capture_stop").catch(() => {});
          await writeLocalGatewayModeToOpenClawConfig().catch(() => {});
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

        const client = new BrowserEngine({
          url: wsUrl,
          ...identity,
          mode: remoteMode ?? "local",
          scopeKey: remoteMode ?? "local",
        });
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
          message: formatStartupError(err, activeRemoteMode),
          remoteMode: activeRemoteMode,
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

  const errorRemoteMode = appState.kind === "error" ? appState.remoteMode ?? null : null;
  useEffect(() => {
    if (!errorRemoteMode) {
      setEngineEditOpen(false);
      return;
    }
    const current = getRemoteEngineConfig(errorRemoteMode);
    setEngineEditUrl(current.url);
    setEngineEditToken(current.token);
    setEngineEditSshHost(current.sshHost);
    setEngineEditSshUser(current.sshUser);
    setEngineEditSshPort(String(current.sshPort));
    setEngineEditTunnelPort(String(current.tunnelPort));
  }, [errorRemoteMode]);

  // Handlers
  function handleOnboardingComplete() {
    setAppState({ kind: "starting" });
    setConnectAttempt((c) => c + 1);
  }

  function handleRetry() {
    setAppState({ kind: "starting" });
    setConnectAttempt((c) => c + 1);
  }

  async function handleUseLocalEngine() {
    engineRef.current?.disconnect();
    await invoke("engine_ssh_tunnel_stop").catch(() => {});
    await invoke("engine_oauth_callback_tunnel_stop").catch(() => {});
    await invoke("engine_oauth_redirect_capture_stop").catch(() => {});
    localStorage.setItem("engineMode", "local");
    await writeLocalGatewayModeToOpenClawConfig().catch(() => {});
    setAppState({ kind: "starting" });
    setConnectAttempt((c) => c + 1);
  }

  function handleSaveRemoteEngine() {
    if (!errorRemoteMode) return;
    if (errorRemoteMode === "vps") {
      const tunnelPort = Number(engineEditTunnelPort) || 18790;
      saveRemoteEngineConfig(
        errorRemoteMode,
        `ws://127.0.0.1:${tunnelPort}`,
        engineEditToken,
        {
          host: engineEditSshHost,
          user: engineEditSshUser,
          sshPort: Number(engineEditSshPort) || 22,
          tunnelPort,
        },
      );
    } else {
      saveRemoteEngineConfig(errorRemoteMode, engineEditUrl, engineEditToken);
    }
    setEngineEditOpen(false);
    handleRetry();
  }

  async function handleOpenSshTunnelTerminal() {
    const current = getRemoteEngineConfig("vps");
    const tunnelConfig = {
      ...current,
      sshHost: engineEditSshHost || current.sshHost,
      sshUser: engineEditSshUser || current.sshUser,
      sshPort: Number(engineEditSshPort) || current.sshPort,
      tunnelPort: Number(engineEditTunnelPort) || current.tunnelPort,
    };
    if (!tunnelConfig.sshHost) return;

    const command = buildSshTunnelCommand(tunnelConfig);
    const script = `tell application "Terminal" to do script ${appleScriptQuote(command)}`;
    await invoke<number>("spawn_shell", {
      cmd: `osascript -e ${shellQuote(script)}`,
    }).catch(() => {});
  }

  async function handleSetupSshKeyTerminal() {
    const current = getRemoteEngineConfig("vps");
    const tunnelConfig = {
      ...current,
      sshHost: engineEditSshHost || current.sshHost,
      sshUser: engineEditSshUser || current.sshUser,
      sshPort: Number(engineEditSshPort) || current.sshPort,
      tunnelPort: Number(engineEditTunnelPort) || current.tunnelPort,
    };
    if (!tunnelConfig.sshHost) return;

    setSettingUpSshKey(true);
    try {
      const key = await invoke<SshKeyInfo>("engine_ssh_key_prepare");
      const command = buildSshKeyInstallCommand(tunnelConfig, key);
      const script = `tell application "Terminal" to do script ${appleScriptQuote(command)}`;
      await invoke<number>("spawn_shell", {
        cmd: `osascript -e ${shellQuote(script)}`,
      });
    } catch (error) {
      setAppState({
        kind: "error",
        message: `SSH key setup failed: ${getErrorMessage(error)}`,
        remoteMode: "vps",
      });
    } finally {
      setSettingUpSshKey(false);
    }
  }

  async function handleApproveRemoteDevice() {
    if (appState.kind !== "error") return;
    const requestId = getPairingRequestId(appState.message);
    if (!requestId) return;
    const engine = engineRef.current;
    if (!engine) {
      setAppState({ kind: "error", message: "Approval failed: engine connection is not initialized.", remoteMode: appState.remoteMode });
      return;
    }

    setApprovingPairing(true);
    try {
      await engine.approvePendingDevice(requestId);
      handleRetry();
    } catch (error) {
      setAppState({
        kind: "error",
        message: `Approval failed: ${getErrorMessage(error)}`,
        remoteMode: appState.remoteMode,
      });
    } finally {
      setApprovingPairing(false);
    }
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
      return <AppLayout key={appState.engine.storageScope} engine={appState.engine} />;

    case "reconnecting":
      return <AppLayout key={appState.engine.storageScope} engine={appState.engine} reconnecting />;

    case "error":
      const remoteMode = appState.remoteMode ?? null;
      const title = remoteMode ? `${remoteEngineLabel(remoteMode)} unavailable` : "Connection Failed";
      const pairingRequestId = remoteMode ? getPairingRequestId(appState.message) : "";
      const sshAuthError = remoteMode === "vps" && isSshAuthError(appState.message);
      const message = sshAuthError
        ? "SSH access is not ready for automatic background tunnels. Install the xCloud SSH key on this host, then press Retry."
        : appState.message;
      const localPortWarning = sshAuthError && engineEditTunnelPort.trim() === "18789";
      return (
        <div className="flex h-full items-center justify-center bg-bg" onMouseDown={async (e) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button,input,textarea")) { try { await getCurrentWindow().startDragging(); } catch {} } }}>
          <div className="text-center max-w-sm px-4">
            <div className="text-lg font-medium text-text">{title}</div>
            <div className="mt-2 text-xs text-text-muted leading-relaxed">{message}</div>
            {sshAuthError && (
              <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left text-[11px] leading-relaxed text-text-muted">
                The hidden tunnel cannot ask for a password. Use <span className="text-text">Setup SSH Key</span> once, enter the VPS password in Terminal, then return here.
                {localPortWarning && (
                  <div className="mt-1 text-text-muted/80">Tip: use local port 18790 for VPS tunnels so it does not conflict with the local engine.</div>
                )}
              </div>
            )}
            {remoteMode && engineEditOpen && (
              <div className="mt-4 space-y-2 rounded-xl border border-white/8 bg-white/[0.03] p-3 text-left">
                {remoteMode === "vps" ? (
                  <>
                    <label className="block text-[11px] font-medium text-text-muted">
                      SSH Host
                      <input
                        value={engineEditSshHost}
                        onChange={(event) => setEngineEditSshHost(event.target.value)}
                        placeholder="2.24.111.200"
                        className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-[11px] font-medium text-text-muted">
                        User
                        <input
                          value={engineEditSshUser}
                          onChange={(event) => setEngineEditSshUser(event.target.value)}
                          placeholder="root"
                          className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                        />
                      </label>
                      <label className="block text-[11px] font-medium text-text-muted">
                        SSH Port
                        <input
                          value={engineEditSshPort}
                          onChange={(event) => setEngineEditSshPort(event.target.value)}
                          placeholder="22"
                          className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                        />
                      </label>
                      <label className="block text-[11px] font-medium text-text-muted">
                        Local Port
                        <input
                          value={engineEditTunnelPort}
                          onChange={(event) => setEngineEditTunnelPort(event.target.value)}
                          placeholder="18790"
                          className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <label className="block text-[11px] font-medium text-text-muted">
                    Gateway URL
                    <input
                      value={engineEditUrl}
                      onChange={(event) => setEngineEditUrl(event.target.value)}
                      placeholder="ws://192.168.1.6:18789"
                      className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                    />
                  </label>
                )}
                <label className="block text-[11px] font-medium text-text-muted">
                  Token
                  <input
                    value={engineEditToken}
                    onChange={(event) => setEngineEditToken(event.target.value)}
                    placeholder="Remote gateway token"
                    className="mt-1 h-9 w-full rounded-lg border border-white/8 bg-[#111111] px-3 text-xs text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-white/18"
                  />
                </label>
                <button
                  onClick={handleSaveRemoteEngine}
                  className="h-9 w-full rounded-lg bg-white/10 text-xs font-medium text-text transition-colors hover:bg-white/15"
                >
                  Save and Retry
                </button>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {remoteMode && pairingRequestId && (
                <button
                  onClick={handleApproveRemoteDevice}
                  disabled={approvingPairing}
                  className="rounded-xl bg-white/10 px-4 py-2 text-xs text-text transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {approvingPairing ? "Approving..." : "Approve Device"}
                </button>
              )}
              <button
                onClick={handleRetry}
                className="rounded-xl bg-white/10 px-4 py-2 text-xs text-text hover:bg-white/15 transition-colors"
              >
                Retry
              </button>
              {remoteMode && (
                <>
                  {remoteMode === "vps" && (
                    <>
                      <button
                        onClick={handleSetupSshKeyTerminal}
                        disabled={settingUpSshKey}
                        className={cn(
                          "rounded-xl px-4 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          sshAuthError
                            ? "bg-text text-bg hover:opacity-90"
                            : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text",
                        )}
                      >
                        {settingUpSshKey ? "Preparing..." : sshAuthError ? "Install SSH Key" : "Setup SSH Key"}
                      </button>
                      <button
                        onClick={handleOpenSshTunnelTerminal}
                        className="rounded-xl bg-white/5 px-4 py-2 text-xs text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                      >
                        Temporary Tunnel
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setEngineEditOpen((open) => !open)}
                    className="rounded-xl bg-white/5 px-4 py-2 text-xs text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                  >
                    Edit Engine
                  </button>
                  <button
                    onClick={handleUseLocalEngine}
                    className="rounded-xl bg-white/5 px-4 py-2 text-xs text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                  >
                    Use Local
                  </button>
                </>
              )}
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

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
