import { useState, useCallback, useRef } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import { Titlebar } from "./Titlebar";
import { HomeScreen } from "./home/HomeScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { AgentCanvas } from "./canvas/AgentCanvas";
import { SettingsPanel } from "./SettingsPanel";

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
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
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

  const rightPanel = showSettings ? (
    <SettingsPanel engine={engine} />
  ) : (
    <AgentCanvas
      engine={engine}
      agentId={view.type === "chat" ? view.agentId : (agents.find((a) => a.isDefault)?.id ?? "main")}
    />
  );

  const leftPanel = view.type === "chat" ? (
    <ChatPanel
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
    <div className="flex h-full flex-col">
      <Titlebar
        onToggleSettings={() => setShowSettings(!showSettings)}
        settingsOpen={showSettings}
      />
      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div className="h-full shrink-0" style={{ width: panelWidth }}>
          {leftPanel}
        </div>

        {/* Resize handle — overlaps edges, no extra gap */}
        <div
          onMouseDown={onMouseDown}
          className="relative z-10 h-full w-0 shrink-0 cursor-col-resize"
        >
          <div className="absolute -left-1.5 top-0 h-full w-3 group">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-accent" />
          </div>
        </div>

        {/* Right panel */}
        <div className="h-full flex-1 min-w-0">
          {rightPanel}
        </div>
      </div>
    </div>
  );
}
