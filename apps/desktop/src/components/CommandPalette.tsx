import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Search, MessageSquare, Settings, Layers, KeyRound, Globe, Sparkles,
  Plug, Brain, Server, Palette, SlidersHorizontal, Terminal, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { AgentInfo } from "@/hooks/use-agents";
import type { SessionInfo } from "@/hooks/use-sessions";
import { AgentAvatar } from "./ui/AgentAvatar";

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  category: "conversations" | "agents" | "settings" | "actions";
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  agents: AgentInfo[];
  getAgentSessions?: (agentId: string) => SessionInfo[];
  onSelectAgent: (id: string) => void;
  onSelectSession?: (agentId: string, sessionKey: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenTerminal: () => void;
}

export function CommandPalette({
  open,
  onClose,
  agents,
  getAgentSessions,
  onSelectAgent,
  onSelectSession,
  onOpenSettings,
  onOpenTerminal,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape or click outside
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (overlayRef.current === e.target) onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onClose]);

  // Build items
  const items = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    // Conversations
    for (const agent of agents) {
      const sessions = getAgentSessions?.(agent.id) ?? [];
      for (const s of sessions) {
        if (s.preview) {
          result.push({
            id: `session-${s.key}`,
            label: s.preview.slice(0, 60),
            icon: <MessageSquare className="h-3.5 w-3.5" />,
            category: "conversations",
            action: () => { onSelectSession?.(agent.id, s.key); onClose(); },
          });
        }
      }
    }

    // Agents
    for (const agent of agents) {
      result.push({
        id: `agent-${agent.id}`,
        label: agent.name ?? agent.id,
        icon: <AgentAvatar emoji={agent.emoji} avatar={agent.avatar} isMain={agent.isDefault} size="sm" />,
        category: "agents",
        action: () => { onSelectAgent(agent.id); onClose(); },
      });
    }

    // Settings sections
    const settingsSections = [
      { id: "models", label: "Models", icon: <Layers className="h-3.5 w-3.5" /> },
      { id: "keys", label: "API Keys", icon: <KeyRound className="h-3.5 w-3.5" /> },
      { id: "channels", label: "Channels", icon: <Globe className="h-3.5 w-3.5" /> },
      { id: "skills", label: "Skills", icon: <Sparkles className="h-3.5 w-3.5" /> },
      { id: "integrations", label: "Integrations", icon: <Plug className="h-3.5 w-3.5" /> },
      { id: "memory", label: "Memory", icon: <Brain className="h-3.5 w-3.5" /> },
      { id: "engine", label: "Engine", icon: <Server className="h-3.5 w-3.5" /> },
      { id: "appearance", label: "Appearance", icon: <Palette className="h-3.5 w-3.5" /> },
      { id: "general", label: "General", icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
    ];
    for (const s of settingsSections) {
      result.push({
        id: `settings-${s.id}`,
        label: s.label,
        icon: s.icon,
        category: "settings",
        action: () => { onOpenSettings(s.id); onClose(); },
      });
    }

    // Actions
    result.push({
      id: "action-terminal",
      label: "Open Terminal",
      icon: <Terminal className="h-3.5 w-3.5" />,
      category: "actions",
      action: () => { onOpenTerminal(); onClose(); },
    });

    return result;
  }, [agents, getAgentSessions, onSelectAgent, onSelectSession, onOpenSettings, onOpenTerminal, onClose]);

  // Filter — without query only show conversations + agents
  const filtered = useMemo(() => {
    if (!query.trim()) {
      return items.filter(item => item.category === "conversations" || item.category === "agents");
    }
    const q = query.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.category.includes(q)
    );
  }, [items, query]);

  // Clamp index
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    }
  }, [filtered, selectedIndex]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Group filtered items by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [filtered]);

  const categoryLabels: Record<string, string> = {
    conversations: "Conversations",
    agents: "Agents",
    settings: "Settings",
    actions: "Actions",
  };

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
    >
      <div className="w-[480px] rounded-2xl border border-border shadow-2xl overflow-hidden" style={{ background: "#181818" }}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted/50 focus:outline-none"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[35vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="py-4 text-center text-sm text-text-muted">No matches</div>
          )}

          {Array.from(grouped.entries()).map(([category, categoryItems]) => (
            <div key={category}>
              <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-text-muted/50">
                {categoryLabels[category] ?? category}
              </div>
              {categoryItems.map((item) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={item.id}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      idx === selectedIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="shrink-0 text-text">
                      {item.icon}
                    </div>
                    <span className="truncate text-[13px] text-text">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
