import { useState } from "react";
import { Cpu, Key, Radio, Sparkles, Plug, Server, Settings2, Brain } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BrowserEngine } from "@/lib/engine";
import {
  ModelsSection,
  KeysSection,
  ChannelsSection,
  SkillsSection,
  IntegrationsSection,
  MemorySection,
  EngineSection,
  AppearanceSection,
  GeneralSection,
} from "./settings";
import type { Section } from "./settings";

// Re-export types for external consumers
export type { Section, SkillInfo, KeyState, ComposioApp, ChannelField, ChannelConfig } from "./settings";

interface SettingsPanelProps {
  engine: BrowserEngine;
  section?: Section;
  onBack?: () => void;
  onPreviewOnboarding?: () => void;
}

const SECTIONS: { id: Section; label: string; icon: typeof Cpu }[] = [
  { id: "models", label: "Models", icon: Cpu },
  { id: "keys", label: "API Keys", icon: Key },
  { id: "channels", label: "Channels", icon: Radio },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "engine", label: "Engine", icon: Server },
  { id: "general", label: "General", icon: Settings2 },
];

export function SettingsPanel({ engine, section: externalSection, onPreviewOnboarding }: SettingsPanelProps) {
  const [internalSection, setSection] = useState<Section>("models");
  const section = externalSection ?? internalSection;

  const renderSection = () => {
    switch (section) {
      case "models":
        return <ModelsSection engine={engine} />;
      case "keys":
        return <KeysSection engine={engine} />;
      case "channels":
        return <ChannelsSection engine={engine} />;
      case "skills":
        return <SkillsSection engine={engine} />;
      case "integrations":
        return <IntegrationsSection engine={engine} />;
      case "memory":
        return <MemorySection engine={engine} />;
      case "engine":
        return <EngineSection engine={engine} />;
      case "appearance":
        return <AppearanceSection engine={engine} />;
      case "general":
        return <GeneralSection engine={engine} onPreviewOnboarding={onPreviewOnboarding} />;
      default:
        return null;
    }
  };

  if (externalSection) {
    return renderSection();
  }

  return (
    <div className="flex h-full bg-surface">
      <div className="flex h-full w-52 shrink-0 flex-col bg-surface pt-6">
        <div className="px-5 mb-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Settings</h2>
        </div>
        <nav className="px-2 space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => { setSection(s.id); }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] transition-colors",
                  section === s.id
                    ? "bg-container text-text"
                    : "text-text-muted hover:text-text",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </nav>
      </div>
      {renderSection()}
    </div>
  );
}
