import { Component, useRef, useEffect, useState, useCallback } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X, Search, AlertTriangle, ArrowDown, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import "@xterm/xterm/css/xterm.css";

// CLI agent icons (from existing assets/editors/)
import claudeIcon from "@/assets/editors/claude-code.svg";
import codexIcon from "@/assets/editors/codex.svg";
import cursorIcon from "@/assets/editors/cursor.svg";
import opencodeIcon from "@/assets/editors/opencode.svg";
// Providers for agents without editor icons
import geminiIcon from "@/assets/providers/google.svg";
import copilotIcon from "@/assets/providers/github.svg";

// ── CLI Agent definitions ───────────────────────────────────────────────────
interface CLIAgent {
  id: string;
  label: string;
  icon: string;
  command: string | null; // null = plain shell
  binary: string | null; // binary to check in PATH
}

const CLI_AGENTS: CLIAgent[] = [
  { id: "shell",    label: "Terminal",     icon: "",            command: null,      binary: null },
  { id: "claude",   label: "Claude Code",  icon: claudeIcon,    command: "claude",  binary: "claude" },
  { id: "codex",    label: "Codex",        icon: codexIcon,     command: "codex",   binary: "codex" },
  { id: "cursor",   label: "Cursor Agent", icon: cursorIcon,    command: "cursor-agent", binary: "cursor-agent" },
  { id: "opencode", label: "OpenCode",     icon: opencodeIcon,  command: "opencode", binary: "opencode" },
  { id: "gemini",   label: "Gemini CLI",   icon: geminiIcon,    command: "gemini",  binary: "gemini" },
  { id: "copilot",  label: "Copilot",      icon: copilotIcon,   command: "github-copilot", binary: "github-copilot" },
];

// ── Theme ───────────────────────────────────────────────────────────────────
const TERMINAL_THEME = {
  background: "#141414",
  foreground: "#e8e8e8",
  cursor: "#6366f1",
  cursorAccent: "#141414",
  selectionBackground: "rgba(99, 102, 241, 0.25)",
  selectionForeground: undefined,
  black: "#141414",
  red: "#dc6b6b",
  green: "#7ec699",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#e8e8e8",
  brightBlack: "#5c5856",
  brightRed: "#e88888",
  brightGreen: "#98d1a8",
  brightYellow: "#ecd08f",
  brightBlue: "#7ec0f5",
  brightMagenta: "#d494e6",
  brightCyan: "#73c7d3",
  brightWhite: "#ffffff",
};

const BG = TERMINAL_THEME.background;

const SEARCH_DECORATIONS = {
  matchBackground: "#515c6a",
  matchBorder: "#74879f",
  matchOverviewRuler: "#d186167e",
  activeMatchBackground: "#515c6a",
  activeMatchBorder: "#ffd33d",
  activeMatchColorOverviewRuler: "#ffd33d",
};

const ANSI_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/g;
const TRUSTED_AUTH_HOSTS = new Set([
  "auth.openai.com",
  "github.com",
]);

function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, "");
}

function normalizeAuthUrl(raw: string) {
  const trimmed = raw.replace(/[.,;:!?]+$/g, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    if (!TRUSTED_AUTH_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function maybeOpenAuthUrlLocally(output: string, opened: Set<string>) {
  const text = stripAnsi(output);
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = normalizeAuthUrl(match[0]);
    if (!url || opened.has(url)) continue;
    opened.add(url);
    import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(url))
      .catch(() => {});
    return;
  }
}

function extractOpenAIOAuthState(output: string) {
  const text = stripAnsi(output);
  for (const match of text.matchAll(URL_PATTERN)) {
    const authUrl = normalizeAuthUrl(match[0]);
    if (!authUrl) continue;
    try {
      const url = new URL(authUrl);
      if (url.hostname !== "auth.openai.com" || url.pathname !== "/oauth/authorize") continue;
      const state = url.searchParams.get("state")?.trim();
      if (state) return state;
    } catch {}
  }
  return null;
}

// ── Error boundary ──────────────────────────────────────────────────────────
class TerminalErrorBoundary extends Component<
  { children: ReactNode; onClose?: () => void },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Terminal crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg text-text-muted">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <p className="text-xs">Terminal crashed: {this.state.error}</p>
          <button onClick={() => this.props.onClose?.()} className="mt-1 rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/15">Close</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────
interface TerminalTab {
  id: number;
  transport: "local" | "remote";
  ptyId?: number;
  remotePtyId?: string;
  title: string;
  icon: string;
  agentId: string;
}

interface OAuthRedirectCapturedEvent {
  url?: string;
}

interface TerminalPanelProps {
  className?: string;
  onClose?: () => void;
  initialCommand?: string;
  remoteEngine?: BrowserEngine;
  remoteLabel?: string;
}

export function TerminalPanel(props: TerminalPanelProps) {
  return (
    <TerminalErrorBoundary onClose={props.onClose}>
      <TerminalPanelInner {...props} />
    </TerminalErrorBoundary>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
function TerminalPanelInner({ className, onClose, initialCommand, remoteEngine, remoteLabel }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["shell"]));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const initRef = useRef(false);
  const lastInitialCommandRef = useRef<string | undefined>(undefined);
  const tabSeqRef = useRef(1);
  const tabsRef = useRef<TerminalTab[]>([]);

  const parkedRef = useRef<Map<number, { xterm: XTerm; wrapper: HTMLDivElement; fitAddon: FitAddon; searchAddon: SearchAddon }>>(new Map());
  const unlistenersRef = useRef<Map<number, () => void>>(new Map());
  const isRemoteTerminal = Boolean(remoteEngine?.isRemote);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // ── Detect installed CLIs ─────────────────────────────────────────────────
  useEffect(() => {
    if (isRemoteTerminal) {
      setInstalledAgents(new Set(["shell"]));
      return;
    }
    async function detect() {
      const installed = new Set<string>(["shell"]);
      for (const agent of CLI_AGENTS) {
        if (!agent.binary) continue;
        try {
          const result: string = await invoke("run_shell", { cmd: `which ${agent.binary} 2>/dev/null` });
          if (result.trim()) installed.add(agent.id);
        } catch {}
      }
      setInstalledAgents(installed);
    }
    detect();
  }, [isRemoteTerminal]);


  // ── Create tab ────────────────────────────────────────────────────────────
  const createTab = useCallback(async (agentId: string = "shell", command?: string) => {
    try {
      const agent = CLI_AGENTS.find(a => a.id === agentId) ?? CLI_AGENTS[0]!;
      const launchCmd = command ?? (agent.command ? agent.command : null);
      const isAuthLaunch = command?.includes("# xcloud-auth-") ?? false;
      const isOAuthTunnelLaunch = isAuthLaunch && (launchCmd?.includes("# xcloud-oauth-tunnel") ?? false);
      const shouldCaptureOAuthUrl = isAuthLaunch && (launchCmd?.includes("# xcloud-oauth-capture-url") ?? false);
      const tabId = tabSeqRef.current++;
      let ptyId: number | undefined;
      let remotePtyId: string | undefined;

      if (remoteEngine?.isRemote) {
        if (!remoteEngine.connected) throw new Error("Remote engine is not connected.");
        const spawned = await remoteEngine.rpc("xcloud.pty.spawn", {
          cols: 80,
          rows: 24,
          cwd: null,
          command: launchCmd,
        });
        remotePtyId = typeof spawned.id === "string" ? spawned.id : undefined;
        if (!remotePtyId) throw new Error("Remote engine did not return a terminal id.");
      } else {
        ptyId = await invoke("pty_spawn", {
          cols: 80,
          rows: 24,
          cwd: null,
          command: isAuthLaunch ? launchCmd : null,
        });
      }

      const tab: TerminalTab = {
        id: tabId,
        transport: remotePtyId ? "remote" : "local",
        ptyId,
        remotePtyId,
        title: remotePtyId && remoteLabel ? `${remoteLabel}` : agent.label,
        icon: agent.icon,
        agentId: agent.id,
      };

      const xterm = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGM Nerd Font", "MesloLGM NF", "MesloLGS NF", "MesloLGS Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "CaskaydiaCove Nerd Font", "Menlo", "Monaco", "Courier New", monospace',
        fontSize: 12,
        theme: TERMINAL_THEME,
        allowProposedApi: true,
        scrollback: 5000,
        macOptionIsMeta: false,
        cursorStyle: "block",
        cursorInactiveStyle: "outline",
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(searchAddon);
      const unicode11 = new Unicode11Addon();
      xterm.loadAddon(unicode11);
      xterm.unicode.activeVersion = "11";
      xterm.loadAddon(new WebLinksAddon());
      try { xterm.loadAddon(new LigaturesAddon()); } catch {}

      const wrapper = document.createElement("div");
      wrapper.style.width = "100%";
      wrapper.style.height = "100%";
      xterm.open(wrapper);

      xterm.onScroll(() => { const buf = xterm.buffer.active; setIsAtBottom(buf.viewportY >= buf.baseY); });
      xterm.onWriteParsed(() => { const buf = xterm.buffer.active; setIsAtBottom(buf.viewportY >= buf.baseY); });

      if (remotePtyId && remoteEngine) {
        xterm.onData((data) => {
          remoteEngine.rpc("xcloud.pty.write", { id: remotePtyId, data }).catch(() => {});
        });
        let oauthCaptureUnlisten: (() => void) | undefined;
        let oauthCaptureActive = false;
        let oauthCaptureSent = false;
        let oauthCapturePoll: number | undefined;
        let expectedOAuthState: string | null = null;
        if (isAuthLaunch && !isOAuthTunnelLaunch) {
          const sendCapturedOAuthUrl = (url?: string) => {
            if (!url || oauthCaptureSent) return;
            if (shouldCaptureOAuthUrl) {
              try {
                const captured = new URL(url);
                const capturedState = captured.searchParams.get("state")?.trim() ?? "";
                if (!expectedOAuthState) {
                  xterm.write("\r\n\x1b[38;5;214m[OAuth callback captured before the current login URL was ready; ignoring it]\x1b[0m\r\n");
                  return;
                }
                if (!capturedState || capturedState !== expectedOAuthState) {
                  xterm.write("\r\n\x1b[38;5;214m[OAuth callback ignored because it belongs to an older login attempt]\x1b[0m\r\n");
                  return;
                }
              } catch {
                xterm.write("\r\n\x1b[38;5;214m[OAuth callback looked invalid; ignoring it]\x1b[0m\r\n");
                return;
              }
            }
            oauthCaptureSent = true;
            xterm.write("\r\n\x1b[38;5;75m[OAuth callback captured, sending it to OpenClaw]\x1b[0m\r\n");
            remoteEngine.rpc("xcloud.pty.write", { id: remotePtyId, data: `${url}\r` }).catch(() => {});
            invoke("engine_oauth_redirect_capture_stop").catch(() => {});
            if (oauthCapturePoll !== undefined) {
              window.clearInterval(oauthCapturePoll);
              oauthCapturePoll = undefined;
            }
          };
          oauthCaptureUnlisten = await listen<OAuthRedirectCapturedEvent>("engine-oauth-redirect-captured", (event) => {
            sendCapturedOAuthUrl(event.payload?.url);
          });
          try {
            await invoke("engine_oauth_redirect_capture_start", { port: 1455 });
            oauthCaptureActive = true;
            oauthCapturePoll = window.setInterval(() => {
              invoke<string | null>("engine_oauth_redirect_capture_take")
                .then((url) => sendCapturedOAuthUrl(url ?? undefined))
                .catch(() => {});
            }, 250);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            xterm.write(`\r\n\x1b[38;5;214m[OAuth callback helper unavailable: ${message}]\x1b[0m\r\n`);
            xterm.write("\x1b[38;5;241mIf the browser cannot finish automatically, copy the full localhost callback URL and paste it here.\x1b[0m\r\n");
          }
        }
        const openedAuthUrls = new Set<string>();
        let lastSeq = 0;
        let stopped = false;
        let polling = false;
        let exitWritten = false;
        const poll = async () => {
          if (stopped || polling) return;
          polling = true;
          try {
            const result = await remoteEngine.rpc("xcloud.pty.read", { id: remotePtyId, after: lastSeq });
            const chunks = Array.isArray(result.chunks) ? result.chunks : [];
            for (const chunk of chunks) {
              if (!chunk || typeof chunk !== "object") continue;
              const seq = Number((chunk as { seq?: unknown }).seq);
              const data = (chunk as { data?: unknown }).data;
              if (Number.isFinite(seq)) lastSeq = Math.max(lastSeq, seq);
              if (typeof data === "string") {
                const output = isAuthLaunch ? data.replace(/\r?\n?🦞 OpenClaw[^\r\n]*(?:\r?\n\s+[^\r\n]+)?\r?\n?/g, "\r\n") : data;
                if (isAuthLaunch) {
                  expectedOAuthState = extractOpenAIOAuthState(output) ?? expectedOAuthState;
                  maybeOpenAuthUrlLocally(output, openedAuthUrls);
                }
                xterm.write(output);
              }
            }
            if (result.exited === true && !exitWritten) {
              exitWritten = true;
              xterm.write("\r\n\x1b[38;5;241m[Process exited]\x1b[0m\r\n");
              if (oauthCaptureActive) invoke("engine_oauth_redirect_capture_stop").catch(() => {});
              if (isOAuthTunnelLaunch) invoke("engine_oauth_callback_tunnel_stop").catch(() => {});
              if (oauthCapturePoll !== undefined) window.clearInterval(oauthCapturePoll);
              stopped = true;
              window.clearInterval(interval);
            }
          } catch (err) {
            if (!stopped) {
              stopped = true;
              window.clearInterval(interval);
              const message = err instanceof Error ? err.message : String(err);
              xterm.write(`\r\n\x1b[38;5;203m[Remote terminal unavailable: ${message}]\x1b[0m\r\n`);
            }
          } finally {
            polling = false;
          }
        };
        const interval = window.setInterval(poll, 80);
        void poll();
        unlistenersRef.current.set(tabId, () => {
          stopped = true;
          window.clearInterval(interval);
          oauthCaptureUnlisten?.();
          if (oauthCaptureActive) invoke("engine_oauth_redirect_capture_stop").catch(() => {});
          if (isOAuthTunnelLaunch) invoke("engine_oauth_callback_tunnel_stop").catch(() => {});
          if (oauthCapturePoll !== undefined) window.clearInterval(oauthCapturePoll);
        });
      } else if (ptyId !== undefined) {
        xterm.onData((data) => { invoke("pty_write", { id: ptyId, data }).catch(() => {}); });

        const unlisten = await listen<{ id: number; data: string }>("pty-output", (event) => {
          if (event.payload.id !== ptyId) return;
          let data = event.payload.data;
          if (isAuthLaunch) {
            data = data.replace(/\r?\n?🦞 OpenClaw[^\r\n]*(?:\r?\n\s+[^\r\n]+)?\r?\n?/g, "\r\n");
          }
          xterm.write(data);
        });
        const unlistenExit = await listen<{ id: number; code: number | null }>("pty-exit", (event) => {
          if (event.payload.id === ptyId) xterm.write("\r\n\x1b[38;5;241m[Process exited]\x1b[0m\r\n");
        });

        unlistenersRef.current.set(tabId, () => { unlisten(); unlistenExit(); });
      }

      parkedRef.current.set(tabId, { xterm, wrapper, fitAddon, searchAddon });

      setTabs((prev) => [...prev, tab]);
      setActiveTab(tabId);

      if (launchCmd && !isAuthLaunch && ptyId !== undefined) {
        setTimeout(() => {
          invoke("pty_write", { id: ptyId, data: `${launchCmd}\n` }).catch(() => {});
        }, 450);
      }

      return ptyId;
    } catch (err) {
      console.error("Failed to create terminal:", err);
      const tabId = tabSeqRef.current++;
      const message = err instanceof Error ? err.message : String(err);
      const xterm = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGM Nerd Font", "MesloLGM NF", "MesloLGS NF", "MesloLGS Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "CaskaydiaCove Nerd Font", "Menlo", "Monaco", "Courier New", monospace',
        fontSize: 12,
        theme: TERMINAL_THEME,
        allowProposedApi: true,
        scrollback: 5000,
        macOptionIsMeta: false,
        cursorStyle: "block",
        cursorInactiveStyle: "outline",
      });
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(searchAddon);
      const wrapper = document.createElement("div");
      wrapper.style.width = "100%";
      wrapper.style.height = "100%";
      xterm.open(wrapper);
      xterm.write("\x1b[38;5;203mTerminal failed to start\x1b[0m\r\n\r\n");
      xterm.write(`${message}\r\n\r\n`);
      if (remoteEngine?.isRemote) {
        xterm.write("The remote engine may need Settings > Engine > Repair / update remote helper.\r\n");
        xterm.write("After updating the helper, wait for the gateway to reconnect and try Login again.\r\n");
      }
      const tab: TerminalTab = {
        id: tabId,
        transport: "local",
        title: remoteEngine?.isRemote ? (remoteLabel ?? "Remote") : "Terminal",
        icon: "",
        agentId: "shell",
      };
      parkedRef.current.set(tabId, { xterm, wrapper, fitAddon, searchAddon });
      setTabs((prev) => [...prev, tab]);
      setActiveTab(tabId);
      return null;
    }
  }, [remoteEngine, remoteLabel]);

  // ── Mount active terminal ─────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeTab === null) return;
    const parked = parkedRef.current.get(activeTab);
    if (!parked) return;

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(parked.wrapper);

    // Wait for layout to settle before fitting
    const timerId = setTimeout(() => {
      try {
        parked.fitAddon.fit();
        const dims = parked.fitAddon.proposeDimensions();
        if (dims) {
          const tab = tabsRef.current.find((item) => item.id === activeTab);
          if (tab?.transport === "remote" && tab.remotePtyId && remoteEngine) {
            remoteEngine.rpc("xcloud.pty.resize", { id: tab.remotePtyId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          } else if (tab?.ptyId !== undefined) {
            invoke("pty_resize", { id: tab.ptyId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        }
      } catch {}
      parked.xterm.focus();
    }, 50);

    xtermRef.current = parked.xterm;
    fitAddonRef.current = parked.fitAddon;
    searchAddonRef.current = parked.searchAddon;

    return () => {
      clearTimeout(timerId);
      if (container.contains(parked.wrapper)) container.removeChild(parked.wrapper);
    };
  }, [activeTab, remoteEngine]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timeout: ReturnType<typeof setTimeout>;
    let lastCols = 0;
    let lastRows = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    let mouseDown = false;
    let pendingResize = false;

    const doResize = () => {
      if (!fitAddonRef.current || activeTab === null) return;
      try {
        const xterm = xtermRef.current;
        const wasAtBottom = xterm ? xterm.buffer.active.viewportY >= xterm.buffer.active.baseY : true;

        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          lastCols = dims.cols;
          lastRows = dims.rows;
          const tab = tabsRef.current.find((item) => item.id === activeTab);
          if (tab?.transport === "remote" && tab.remotePtyId && remoteEngine) {
            remoteEngine.rpc("xcloud.pty.resize", { id: tab.remotePtyId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          } else if (tab?.ptyId !== undefined) {
            invoke("pty_resize", { id: tab.ptyId, cols: dims.cols, rows: dims.rows }).catch(() => {});
          }
        }

        if (wasAtBottom && xterm) xterm.scrollToBottom();
      } catch {}
      pendingResize = false;
    };

    // Track mouse state — only resize on mouseup to avoid mid-drag duplication
    const onMouseDown = () => { mouseDown = true; };
    const onMouseUp = () => {
      mouseDown = false;
      if (pendingResize) {
        clearTimeout(timeout);
        timeout = setTimeout(doResize, 50);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 10 || height < 10) return;
      // Skip if size barely changed (sub-pixel jitter)
      if (Math.abs(width - lastWidth) < 2 && Math.abs(height - lastHeight) < 2) return;
      lastWidth = width;
      lastHeight = height;

      if (mouseDown) {
        // Mouse is held — defer resize until release
        pendingResize = true;
      } else {
        // No drag — debounce normally (window resize, etc.)
        clearTimeout(timeout);
        pendingResize = false;
        timeout = setTimeout(doResize, 40);
      }
    });
    observer.observe(container);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeTab, remoteEngine]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    lastInitialCommandRef.current = initialCommand;
    createTab("shell", initialCommand ?? undefined).catch((err) => {
      console.error("Terminal init failed:", err);
      if (onClose) onClose();
    });
  }, []);

  // When another part of the app asks the already-open terminal to run a
  // command, create a fresh shell tab instead of ignoring the new command.
  useEffect(() => {
    if (!initRef.current || !initialCommand || lastInitialCommandRef.current === initialCommand) return;
    lastInitialCommandRef.current = initialCommand;
    createTab("shell", initialCommand).catch((err) => {
      console.error("Terminal command launch failed:", err);
    });
  }, [initialCommand, createTab]);

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback(async (tabId: number) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab?.transport === "remote" && tab.remotePtyId && remoteEngine) {
      await remoteEngine.rpc("xcloud.pty.kill", { id: tab.remotePtyId }).catch(() => {});
    } else if (tab?.ptyId !== undefined) {
      await invoke("pty_kill", { id: tab.ptyId }).catch(() => {});
    }
    const parked = parkedRef.current.get(tabId);
    if (parked) { parked.xterm.dispose(); parkedRef.current.delete(tabId); }
    const unlisten = unlistenersRef.current.get(tabId);
    if (unlisten) { unlisten(); unlistenersRef.current.delete(tabId); }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTab === tabId) setActiveTab(next.length > 0 ? next[next.length - 1].id : null);
      if (next.length === 0 && onClose) onClose();
      return next;
    });
  }, [activeTab, onClose, remoteEngine]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const [id, parked] of parkedRef.current) {
        parked.xterm.dispose();
        const tab = tabsRef.current.find((item) => item.id === id);
        if (tab?.transport === "remote" && tab.remotePtyId && remoteEngine) {
          remoteEngine.rpc("xcloud.pty.kill", { id: tab.remotePtyId }).catch(() => {});
        } else if (tab?.ptyId !== undefined) {
          invoke("pty_kill", { id: tab.ptyId }).catch(() => {});
        }
      }
      for (const fn of unlistenersRef.current.values()) fn();
      parkedRef.current.clear();
      unlistenersRef.current.clear();
    };
  }, [remoteEngine]);

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => { if (showSearch) searchInputRef.current?.focus(); }, [showSearch]);
  const handleSearch = useCallback((direction: "next" | "prev") => {
    if (!searchAddonRef.current || !searchQuery) return;
    const opts = { decorations: SEARCH_DECORATIONS };
    if (direction === "next") searchAddonRef.current.findNext(searchQuery, opts);
    else searchAddonRef.current.findPrevious(searchQuery, opts);
  }, [searchQuery]);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey && e.key === "f") { e.preventDefault(); setShowSearch((v) => !v); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const scrollToBottom = useCallback(() => { xtermRef.current?.scrollToBottom(); }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn("flex h-full flex-col bg-bg", className)}>
      {/* Tab bar — same height as chat header */}
      <div className="flex h-9 shrink-0 items-center" style={{ background: BG }}>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto hide-scrollbar px-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group flex h-7 shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-xs transition-colors",
                activeTab === tab.id
                  ? "bg-white/[0.06] text-text"
                  : "text-text-muted hover:bg-white/[0.03] hover:text-text/80"
              )}
              style={{ minWidth: 110, maxWidth: 170 }}
            >
              {tab.icon && <img src={tab.icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />}
              <span className="truncate flex-1 text-left">{tab.title}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text hover:bg-white/10 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 px-2">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/[0.06] hover:text-text transition-colors"
            title="Search (⌘F)"
          >
            <Search className="h-3 w-3" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/[0.06] hover:text-text transition-colors"
              title="Close terminal"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Agent quick-launch bar — same height as chat header, always visible */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 px-2.5 overflow-x-auto hide-scrollbar" style={{ background: BG }}>
        {CLI_AGENTS.map((agent) => {
          const isInstalled = installedAgents.has(agent.id);
          return (
            <button
              key={agent.id}
              onClick={() => { if (isInstalled) createTab(agent.id); }}
              className={cn(
                "flex items-center gap-1.5 shrink-0 rounded-md px-2 py-1 transition-colors",
                isInstalled
                  ? "hover:bg-white/[0.06] text-text-muted hover:text-text"
                  : "opacity-30 cursor-not-allowed text-text-muted"
              )}
              title={isInstalled ? agent.label : `${agent.label} (not installed)`}
            >
              {agent.icon && <img src={agent.icon} alt={agent.label} className="h-4 w-4 object-contain" />}
              <span className="text-[11px]">{agent.label}</span>
            </button>
          );
        })}
      </div>

      {/* Terminal content */}
      <div className="relative flex-1 min-h-0 overflow-hidden p-1" style={{ background: BG }}>
        {/* Search overlay */}
        {showSearch && (
          <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 shadow-lg backdrop-blur px-2">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (searchAddonRef.current && e.target.value) searchAddonRef.current.findNext(e.target.value, { decorations: SEARCH_DECORATIONS });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch(e.shiftKey ? "prev" : "next");
                if (e.key === "Escape") { setShowSearch(false); xtermRef.current?.focus(); }
              }}
              placeholder="Search..."
              className="h-7 w-28 bg-transparent text-xs text-text placeholder-text-muted outline-none"
            />
            <button onClick={() => handleSearch("prev")} className="rounded p-1 text-text-muted hover:text-text hover:bg-white/[0.06]"><ChevronUp className="h-3 w-3" /></button>
            <button onClick={() => handleSearch("next")} className="rounded p-1 text-text-muted hover:text-text hover:bg-white/[0.06]"><ChevronDown className="h-3 w-3" /></button>
            <button onClick={() => { setShowSearch(false); searchAddonRef.current?.clearDecorations(); xtermRef.current?.focus(); }} className="rounded p-1 text-text-muted hover:text-text hover:bg-white/[0.06]"><X className="h-3 w-3" /></button>
          </div>
        )}

        {/* xterm container */}
        <div ref={containerRef} className="h-full w-full" style={{ background: BG }} />

        {/* Scroll to bottom */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute left-1/2 -translate-x-1/2 bottom-4 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg text-text-muted hover:bg-surface hover:text-text transition-all"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
