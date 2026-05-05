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
import { Terminal, X, Plus, Search, AlertTriangle, ChevronDown, ArrowDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import "@xterm/xterm/css/xterm.css";

// ── Superset Ember theme ────────────────────────────────────────────────────
const TERMINAL_THEME = {
  background: "#151110",
  foreground: "#eae8e6",
  cursor: "#e07850",
  cursorAccent: "#151110",
  selectionBackground: "rgba(224, 120, 80, 0.25)",
  selectionForeground: undefined,
  black: "#151110",
  red: "#dc6b6b",
  green: "#7ec699",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#eae8e6",
  brightBlack: "#5c5856",
  brightRed: "#e88888",
  brightGreen: "#98d1a8",
  brightYellow: "#ecd08f",
  brightBlue: "#7ec0f5",
  brightMagenta: "#d494e6",
  brightCyan: "#73c7d3",
  brightWhite: "#ffffff",
};

const SEARCH_DECORATIONS = {
  matchBackground: "#515c6a",
  matchBorder: "#74879f",
  matchOverviewRuler: "#d186167e",
  activeMatchBackground: "#515c6a",
  activeMatchBorder: "#ffd33d",
  activeMatchColorOverviewRuler: "#ffd33d",
};

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
        <div className="flex h-full flex-col items-center justify-center gap-2" style={{ background: TERMINAL_THEME.background, color: "#a8a5a3" }}>
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <p className="text-xs">Terminal crashed: {this.state.error}</p>
          <button
            onClick={() => this.props.onClose?.()}
            className="mt-1 rounded-md px-3 py-1 text-xs transition-colors"
            style={{ background: "#2a2827" }}
          >
            Close
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────
interface TerminalTab {
  id: number;
  ptyId: number;
  title: string;
}

interface TerminalPanelProps {
  className?: string;
  onClose?: () => void;
  initialCommand?: string;
}

// ── Exported component with error boundary ──────────────────────────────────
export function TerminalPanel(props: TerminalPanelProps) {
  return (
    <TerminalErrorBoundary onClose={props.onClose}>
      <TerminalPanelInner {...props} />
    </TerminalErrorBoundary>
  );
}

// ── Main terminal component ─────────────────────────────────────────────────
function TerminalPanelInner({ className, onClose, initialCommand }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Parking map: tabId -> { xterm, wrapper, fitAddon, searchAddon }
  const parkedRef = useRef<Map<number, { xterm: XTerm; wrapper: HTMLDivElement; fitAddon: FitAddon; searchAddon: SearchAddon }>>(new Map());
  const unlistenersRef = useRef<Map<number, () => void>>(new Map());

  // ── Create tab ────────────────────────────────────────────────────────────
  const createTab = useCallback(async (command?: string) => {
    try {
      const ptyId: number = await invoke("pty_spawn", {
        cols: 120,
        rows: 32,
        cwd: null,
      });

      const tab: TerminalTab = { id: ptyId, ptyId, title: `zsh` };

      // Superset-identical xterm config
      const xterm = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGM Nerd Font", "MesloLGM NF", "MesloLGS NF", "MesloLGS Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "CaskaydiaCove Nerd Font", "Menlo", "Monaco", "Courier New", monospace',
        fontSize: 14,
        // fontWeight, fontWeightBold, letterSpacing, lineHeight — NOT SET (xterm defaults)
        // drawBoldTextInBrightColors — NOT SET (default: true)
        // minimumContrastRatio — NOT SET (default: 1)
        theme: TERMINAL_THEME,
        allowProposedApi: true,
        scrollback: 5000,
        macOptionIsMeta: false,
        cursorStyle: "block",
        cursorInactiveStyle: "outline",
      });

      // Load addons in Superset order
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(searchAddon);

      // Unicode11 — must be activated BEFORE buffer restore (CJK/emoji width)
      const unicode11 = new Unicode11Addon();
      xterm.loadAddon(unicode11);
      xterm.unicode.activeVersion = "11";

      xterm.loadAddon(new WebLinksAddon());

      // Ligatures — font ligature support (try/catch for unsupported fonts)
      try { xterm.loadAddon(new LigaturesAddon()); } catch {}

      // Wrapper div (parking pattern)
      const wrapper = document.createElement("div");
      wrapper.style.width = "100%";
      wrapper.style.height = "100%";
      xterm.open(wrapper);

      // Track scroll position for "scroll to bottom" button
      xterm.onScroll(() => {
        const buf = xterm.buffer.active;
        setIsAtBottom(buf.viewportY >= buf.baseY);
      });
      xterm.onWriteParsed(() => {
        const buf = xterm.buffer.active;
        setIsAtBottom(buf.viewportY >= buf.baseY);
      });

      // User input → PTY
      xterm.onData((data) => {
        invoke("pty_write", { id: ptyId, data }).catch(() => {});
      });

      // PTY output → xterm
      const unlisten = await listen<{ id: number; data: string }>("pty-output", (event) => {
        if (event.payload.id === ptyId) {
          xterm.write(event.payload.data);
        }
      });

      // PTY exit
      const unlistenExit = await listen<{ id: number; code: number | null }>("pty-exit", (event) => {
        if (event.payload.id === ptyId) {
          xterm.write("\r\n\x1b[38;5;241m[Process exited]\x1b[0m\r\n");
        }
      });

      unlistenersRef.current.set(ptyId, () => { unlisten(); unlistenExit(); });
      parkedRef.current.set(ptyId, { xterm, wrapper, fitAddon, searchAddon });

      setTabs((prev) => [...prev, tab]);
      setActiveTab(ptyId);

      if (command) {
        setTimeout(() => {
          invoke("pty_write", { id: ptyId, data: command + "\n" }).catch(() => {});
        }, 500);
      }

      return ptyId;
    } catch (err) {
      console.error("Failed to create terminal:", err);
      return null;
    }
  }, []);

  // ── Mount active terminal ─────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeTab === null) return;
    const parked = parkedRef.current.get(activeTab);
    if (!parked) return;

    container.innerHTML = "";
    container.appendChild(parked.wrapper);

    requestAnimationFrame(() => {
      try {
        parked.fitAddon.fit();
        const dims = parked.fitAddon.proposeDimensions();
        if (dims) invoke("pty_resize", { id: activeTab, cols: dims.cols, rows: dims.rows }).catch(() => {});
      } catch {}
      parked.xterm.focus();
    });

    xtermRef.current = parked.xterm;
    fitAddonRef.current = parked.fitAddon;
    searchAddonRef.current = parked.searchAddon;

    return () => {
      if (container.contains(parked.wrapper)) container.removeChild(parked.wrapper);
    };
  }, [activeTab]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (fitAddonRef.current && activeTab !== null) {
          try {
            fitAddonRef.current.fit();
            const dims = fitAddonRef.current.proposeDimensions();
            if (dims) invoke("pty_resize", { id: activeTab, cols: dims.cols, rows: dims.rows }).catch(() => {});
          } catch {}
        }
      }, 75);
    });
    observer.observe(container);
    return () => { clearTimeout(timeout); observer.disconnect(); };
  }, [activeTab]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    createTab(initialCommand).catch((err) => {
      console.error("Terminal init failed:", err);
      if (mounted && onClose) onClose();
    });
    return () => { mounted = false; };
  }, []);

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback(async (tabId: number) => {
    await invoke("pty_kill", { id: tabId }).catch(() => {});
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
  }, [activeTab, onClose]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const [id, parked] of parkedRef.current) { parked.xterm.dispose(); invoke("pty_kill", { id }).catch(() => {}); }
      for (const fn of unlistenersRef.current.values()) fn();
      parkedRef.current.clear();
      unlistenersRef.current.clear();
    };
  }, []);

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

  const scrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn("flex h-full flex-col", className)} style={{ background: TERMINAL_THEME.background }}>

      {/* ── Tab bar (Superset style: h-10, border-b, bg-background) ── */}
      <div className="flex h-10 shrink-0 items-center" style={{ borderBottom: "1px solid #2a2827", background: TERMINAL_THEME.background }}>
        {/* Tabs */}
        <div className="flex flex-1 items-center overflow-x-auto hide-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="group relative flex items-center shrink-0"
              style={{
                width: 160,
                height: 40,
                borderRight: "1px solid #2a2827",
                padding: "0 4px 0 12px",
                background: activeTab === tab.id ? "rgba(42, 40, 39, 0.3)" : "transparent",
                color: activeTab === tab.id ? "#eae8e6" : "rgba(168, 165, 163, 0.7)",
                transition: "background 150ms, color 150ms",
              }}
              onMouseEnter={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = "rgba(26, 23, 22, 0.2)"; }}
              onMouseLeave={(e) => { if (activeTab !== tab.id) e.currentTarget.style.background = "transparent"; }}
            >
              <Terminal className="h-3.5 w-3.5 shrink-0" style={{ marginRight: 8 }} />
              <span className="truncate text-xs flex-1 text-left">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="flex h-5 w-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "rgba(168, 165, 163, 0.6)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#eae8e6"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(168, 165, 163, 0.6)"; }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </button>
          ))}
        </div>

        {/* Add tab button (Superset style: size-7, rounded-md, border) */}
        <div className="flex items-center gap-1 px-2">
          <button
            onClick={() => createTab()}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{ border: "1px solid rgba(42, 40, 39, 0.6)", background: "rgba(42, 40, 39, 0.3)", color: "#a8a5a3" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(42, 40, 39, 0.6)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(42, 40, 39, 0.3)"; }}
            title="New terminal"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Pane header (Superset style: h-7, bg-muted when active) ── */}
      <div
        className="flex h-7 shrink-0 items-center gap-2 px-3"
        style={{ background: "#2a2827" }}
      >
        {/* Terminal session dropdown trigger */}
        <button
          className="flex min-w-32 max-w-96 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors"
          style={{ color: "#a8a5a3" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#2a2827"; e.currentTarget.style.color = "#eae8e6"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#a8a5a3"; }}
        >
          <Terminal className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{tabs.find(t => t.id === activeTab)?.title ?? "Terminal"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>

        <div className="flex-1" />

        {/* Header actions */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="rounded p-0.5 transition-colors"
            style={{ color: "rgba(168, 165, 163, 0.6)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#a8a5a3"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(168, 165, 163, 0.6)"; }}
            title="Search (⌘F)"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-0.5 transition-colors"
              style={{ color: "rgba(168, 165, 163, 0.6)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#a8a5a3"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(168, 165, 163, 0.6)"; }}
              title="Close terminal"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Terminal content area ── */}
      <div className="relative flex-1 min-h-0 overflow-hidden p-2" style={{ background: TERMINAL_THEME.background }}>
        {/* Search overlay (Superset style: absolute top-right, backdrop-blur) */}
        {showSearch && (
          <div
            className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded shadow-lg backdrop-blur"
            style={{ background: "rgba(32, 30, 28, 0.95)", padding: "0 2px 0 8px", border: "1px solid rgba(42, 40, 39, 0.4)" }}
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (searchAddonRef.current && e.target.value) {
                  searchAddonRef.current.findNext(e.target.value, { decorations: SEARCH_DECORATIONS });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch(e.shiftKey ? "prev" : "next");
                if (e.key === "Escape") { setShowSearch(false); xtermRef.current?.focus(); }
              }}
              placeholder="Search..."
              className="h-6 w-28 bg-transparent text-sm outline-none"
              style={{ color: "#eae8e6" }}
            />
            <button
              onClick={() => handleSearch("prev")}
              className="rounded p-1 transition-colors"
              style={{ color: "#a8a5a3" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(168, 165, 163, 0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleSearch("next")}
              className="rounded p-1 transition-colors"
              style={{ color: "#a8a5a3" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(168, 165, 163, 0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setShowSearch(false); searchAddonRef.current?.clearDecorations(); xtermRef.current?.focus(); }}
              className="rounded p-1 transition-colors"
              style={{ color: "#a8a5a3" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(168, 165, 163, 0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* xterm.js container */}
        <div ref={containerRef} className="h-full w-full" style={{ background: TERMINAL_THEME.background }} />

        {/* Scroll-to-bottom button (Superset style: bottom center, size-8, rounded-full) */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute left-1/2 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full transition-all"
            style={{
              bottom: 16,
              border: "1px solid #2a2827",
              background: TERMINAL_THEME.background,
              color: "#a8a5a3",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#2a2827"; e.currentTarget.style.color = "#eae8e6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = TERMINAL_THEME.background; e.currentTarget.style.color = "#a8a5a3"; }}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
