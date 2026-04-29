import { useState } from "react";
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

export function AppLayout({ engine }: AppLayoutProps) {
  const { agents } = useAgents(engine);
  const [view, setView] = useState<View>({ type: "home" });
  const [showSettings, setShowSettings] = useState(false);

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
        <div className="h-full w-[360px] shrink-0">
          {leftPanel}
        </div>
        <div className="h-full flex-1 min-w-0 border-l border-border">
          {rightPanel}
        </div>
      </div>
    </div>
  );
}
