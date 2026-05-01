import { useState, useCallback, useRef, useEffect } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import { PanelLeftClose, PanelLeftOpen, Settings, Eye } from "lucide-react";
import { HomeScreen } from "./home/HomeScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { AgentCanvas } from "./canvas/AgentCanvas";
import { SettingsPanel } from "./SettingsPanel";
import { DevPreview } from "./DevPreview";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppLayoutProps {
  engine: BrowserEngine;
}

type View = { type: "home" } | { type: "chat"; agentId: string };

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 360;

export function AppLayout({ engine }: AppLayoutProps) {
  const { agents } = useAgents(engine);
  const [view, setView] = useState<View>({ type: "home" });
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);

  // Cmd+Shift+P to toggle dev preview
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey && e.shiftKey && e.key === "p") {
        e.preventDefault();
        setShowPreview((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const rightPanel = showPreview ? (
    <DevPreview />
  ) : showSettings ? (
    <SettingsPanel engine={engine} />
  ) : (
    <AgentCanvas
      key={view.type === "chat" ? view.agentId : "default"}
      engine={engine}
      agentId={view.type === "chat" ? view.agentId : (agents.find((a) => a.isDefault)?.id ?? "main")}
      sidebarCollapsed={sidebarCollapsed}
    />
  );

  const leftPanel = view.type === "chat" ? (
    <ChatPanel
      key={view.agentId}
      engine={engine}
      agentId={view.agentId}
      agentName={agents.find((a) => a.id === view.agentId)?.name ?? view.agentId}
      agents={agents}
      onSwitchAgent={(id) => setView({ type: "chat", agentId: id })}
      onBack={() => setView({ type: "home" })}
    />
  ) : (
    <HomeScreen
      agents={agents}
      onSelectAgent={(id) => setView({ type: "chat", agentId: id })}
    />
  );

  return (
    <div className="flex h-full">
      {/* Toggle sidebar — fixed next to macOS traffic lights, always visible */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed z-20 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
        style={{ top: 14, left: 88 }}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
      >
        {sidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>

      {/* Left panel — sidebar with vibrancy */}
      <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarCollapsed ? 0 : panelWidth, backgroundColor: "rgba(30,30,30,0.30)", overflow: "hidden", transition: isDragging ? "none" : "width 150ms ease" }}>
        <div className="flex flex-1 min-h-0 flex-col" style={{ minWidth: panelWidth }}>
          {leftPanel}
        </div>

        {/* Sidebar footer — sticky bottom */}
        <div className="shrink-0 px-3 py-1.5" style={{ minWidth: panelWidth }}>
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setShowSettings(!showSettings); setShowPreview(false); }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1 text-text transition-colors hover:bg-white/6"
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm font-medium">Settings</span>
            </button>
            <button
              onClick={() => { setShowPreview(!showPreview); setShowSettings(false); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/6 hover:text-text"
              title="Preview"
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Resize handle — overlaps edges, no extra gap */}
      <div
        onMouseDown={onMouseDown}
        className="relative z-10 h-full w-0 shrink-0 cursor-col-resize"
      >
        <div className="absolute -left-1.5 top-0 h-full w-3 group">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent" />
        </div>
      </div>

      {/* Right panel — solid, rounded card with padding */}
      <div
        className={`flex h-full flex-1 min-w-0 flex-col py-2 pr-2 ${sidebarCollapsed ? "pl-2" : ""}`}
        style={{ backgroundColor: "rgba(30,30,30,0.30)", transition: "padding 150ms ease" }}
      >
        <div
          className="flex flex-1 min-h-0 flex-col rounded-xl bg-bg overflow-hidden"
          onMouseDown={async (e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, input, a, [data-interactive]")) return;
            await getCurrentWindow().startDragging();
          }}
        >
          <div className="flex-1 min-h-0">
            {rightPanel}
          </div>
        </div>
      </div>
    </div>
  );
}
