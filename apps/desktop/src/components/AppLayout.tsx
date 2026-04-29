import { useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import { HomeScreen } from "./home/HomeScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { AgentCanvas } from "./canvas/AgentCanvas";
import { SettingsPanel } from "./SettingsPanel";

interface AppLayoutProps {
  engine: BrowserEngine;
}

type View = { type: "home" } | { type: "chat"; agentId: string } | { type: "settings" };

export function AppLayout({ engine }: AppLayoutProps) {
  const { agents } = useAgents(engine);
  const [view, setView] = useState<View>({ type: "home" });

  // Settings overlay
  if (view.type === "settings") {
    return <SettingsPanel engine={engine} onBack={() => setView({ type: "home" })} />;
  }

  // Chat view (fullscreen left + canvas right)
  if (view.type === "chat") {
    const agent = agents.find((a) => a.id === view.agentId);
    return (
      <div className="flex h-full">
        {/* Chat (fixed width, like a messaging app) */}
        <div className="h-full w-[360px] shrink-0">
          <ChatPanel
            engine={engine}
            agentId={view.agentId}
            agentName={agent?.name ?? view.agentId}
            onBack={() => setView({ type: "home" })}
          />
        </div>

        {/* Canvas (takes remaining space) */}
        <div className="h-full flex-1 min-w-0 border-l border-border">
          <AgentCanvas engine={engine} agentId={view.agentId} />
        </div>
      </div>
    );
  }

  // Home view
  return (
    <div className="flex h-full">
      {/* Home (same width as chat) */}
      <div className="h-full w-[360px] shrink-0">
        <HomeScreen
          engine={engine}
          agents={agents}
          onSelectAgent={(id) => setView({ type: "chat", agentId: id })}
          onOpenSettings={() => setView({ type: "settings" })}
        />
      </div>

      {/* Canvas preview (takes remaining space) */}
      <div className="h-full flex-1 min-w-0 border-l border-border">
        <AgentCanvas
          engine={engine}
          agentId={agents.find((a) => a.isDefault)?.id ?? "main"}
        />
      </div>
    </div>
  );
}
