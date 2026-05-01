import { useState, useCallback, useRef, useEffect } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import { Settings, Eye, PanelRight } from "lucide-react";
import { HomeScreen } from "./home/HomeScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { AgentCanvas } from "./canvas/AgentCanvas";
import { SettingsPanel } from "./SettingsPanel";
import { DevPreview } from "./DevPreview";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppLayoutProps {
  engine: BrowserEngine;
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 280;

export function AppLayout({ engine }: AppLayoutProps) {
  const { agents } = useAgents(engine);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [showCanvas, setShowCanvas] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(450);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const draggingCanvas = useRef(false);

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

  const cardRef = useRef<HTMLDivElement>(null);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingCanvas.current = true;
    setIsDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingCanvas.current || !cardRef.current) return;
      const cardRect = cardRef.current.getBoundingClientRect();
      const newWidth = Math.min(800, Math.max(250, cardRect.right - ev.clientX));
      setCanvasWidth(newWidth);
    };

    const onMouseUp = () => {
      draggingCanvas.current = false;
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

  const handleSelectAgent = useCallback((id: string) => {
    setActiveAgentId(id);
    setShowSettings(false);
    setShowPreview(false);
  }, []);

  const currentAgentId = activeAgentId ?? agents.find((a) => a.isDefault)?.id ?? "main";
  const hasChat = activeAgentId !== null;

  // What goes in the right-most panel
  const thirdPanel = showPreview ? (
    <DevPreview />
  ) : showSettings ? (
    <SettingsPanel engine={engine} />
  ) : showCanvas ? (
    <AgentCanvas
      key={currentAgentId}
      engine={engine}
      agentId={currentAgentId}
      sidebarCollapsed={sidebarCollapsed}
      onToggle={() => setShowCanvas(false)}
    />
  ) : null;

  const showThirdPanel = showPreview || showSettings || showCanvas;

  return (
    <div className="flex h-full">
      {/* Toggle sidebar — fixed next to macOS traffic lights */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed z-20 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
        style={{ top: 14, left: 88 }}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
          <path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" />
          {sidebarCollapsed
            ? <path d="M16 8L16 16" />
            : <path d="M8.00488 16.0049L8.00488 8.00488" />
          }
        </svg>
      </button>

      {/* 1. Sidebar — agent list */}
      <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarCollapsed ? 0 : panelWidth, backgroundColor: "rgba(30,30,30,0.30)", overflow: "hidden", transition: isDragging ? "none" : "width 150ms ease" }}>
        <div className="flex flex-1 min-h-0 flex-col" style={{ minWidth: panelWidth }}>
          <HomeScreen
            agents={agents}
            activeAgentId={hasChat ? currentAgentId : null}
            onSelectAgent={handleSelectAgent}
          />
        </div>

        {/* Sidebar footer */}
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

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="relative z-10 h-full w-0 shrink-0 cursor-col-resize"
      >
        <div className="absolute -left-1.5 top-0 h-full w-3 group">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent" />
        </div>
      </div>

      {/* 2 & 3. Chat + Canvas — single rounded card */}
      <div
        className={`flex h-full flex-1 min-w-0 flex-col py-2 pr-2 ${sidebarCollapsed ? "pl-2" : ""}`}
        style={{ backgroundColor: "rgba(30,30,30,0.30)", transition: "padding 150ms ease" }}
      >
        <div
          ref={cardRef}
          className="flex flex-1 min-h-0 rounded-xl bg-bg overflow-hidden"
          onMouseDown={async (e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, input, textarea, a, [data-interactive]")) return;
            await getCurrentWindow().startDragging();
          }}
        >
          {/* Chat */}
          <div className="flex flex-1 min-w-0 flex-col">
            {hasChat ? (
              <ChatPanel
                key={currentAgentId}
                engine={engine}
                agentId={currentAgentId}
                agentName={agents.find((a) => a.id === currentAgentId)?.name ?? currentAgentId}
                agents={agents}
                onSwitchAgent={(id) => setActiveAgentId(id)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-text-muted">
                <div className="text-3xl opacity-20">✦</div>
                <p className="text-sm">Select an agent to start chatting</p>
              </div>
            )}
          </div>

          {/* Canvas / Settings / Preview */}
          {showThirdPanel && (
            <>
              {/* Resize handle */}
              <div
                onMouseDown={onCanvasMouseDown}
                data-interactive
                className="relative z-10 h-full w-0 shrink-0 cursor-col-resize"
              >
                <div className="absolute -left-1.5 top-0 h-full w-3 group">
                  <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/30 transition-colors group-hover:bg-accent" />
                </div>
              </div>
              <div className="flex h-full shrink-0 flex-col" style={{ width: canvasWidth }}>
                <div className="flex-1 min-h-0">
                  {thirdPanel}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Show canvas button — when canvas is hidden */}
      {!showCanvas && !showSettings && !showPreview && (
        <button
          onClick={() => setShowCanvas(true)}
          className="fixed z-20 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/8 hover:text-text"
          style={{ top: 14, right: 14 }}
          title="Show canvas"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
