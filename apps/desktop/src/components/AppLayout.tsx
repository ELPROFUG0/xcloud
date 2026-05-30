import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import type { AgentInfo } from "@/hooks/use-agents";
import { getWorkspaceAgentId, getWorkspaceDir, useWorkspaces } from "@/hooks/use-workspaces";
import type { WorkspaceInfo } from "@/hooks/use-workspaces";
import { Settings, Eye, Layers, KeyRound, Globe, SlidersHorizontal, ArrowLeft, Palette, Server, Sparkles, Plug, Brain, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { HomeScreen } from "./home/HomeScreen";
import { useSessions } from "@/hooks/use-sessions";
import type { AppToolHandler } from "@/hooks/use-chat";
import { exportAgentPackage, importAgentPackage, type AgentImportProgress } from "@/lib/agent-package";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatInput } from "./chat/ChatInput";
import { AgentCanvas, type DetailPanel } from "./canvas/AgentCanvas";
import { WorkspaceCanvas } from "./canvas/WorkspaceCanvas";
import { SettingsPanel } from "./SettingsPanel";
import { DevPreview } from "./DevPreview";
import { OnboardingScreen } from "./OnboardingScreen";
import { getCanvasPanelOpen, setCanvasPanelOpen } from "@/lib/canvas-preferences";
import { engineScopedStorageKey } from "@/lib/engine-storage";
import { deleteOpenClawAgent } from "@/lib/openclaw-store";
import { useAppUpdater } from "@/hooks/use-app-updater";
const TerminalPanel = lazy(() => import("./terminal/TerminalPanel").then(m => ({ default: m.TerminalPanel })));
import { getCurrentWindow } from "@tauri-apps/api/window";
import { homeDir } from "@tauri-apps/api/path";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useTheme } from "@/hooks/use-theme";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CommandPalette } from "./CommandPalette";

interface AppLayoutProps {
  engine: BrowserEngine;
  reconnecting?: boolean;
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 280;

const NEW_AGENT_CREATION_GUIDE = [
  "Create a real persistent OpenClaw agent from this request.",
  "Use the native xcloud_agent_create tool once the agent name and role are clear.",
  "Ask at most one concise question only if the request is missing a name or a useful role.",
  "If the request asks for an interface, UI, app, dashboard, preview, or frontend, set createUi: true so the agent gets its own UI.",
  "Do not stop at a plan or notes; materialize the agent when you have enough context.",
].join("\n");

const newAgentAvatarModules = import.meta.glob("@/assets/avatars/avatar-*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const NEW_AGENT_SUGGESTION_AVATARS = Object.values(newAgentAvatarModules).sort();
const NEW_AGENT_SUGGESTION_TILTS = ["-rotate-[1.25deg]", "rotate-[1deg]", "-rotate-[0.75deg]"];
const NEW_AGENT_VISIBLE_SUGGESTIONS = 3;
const NEW_AGENT_SUGGESTION_ROTATE_MS = 5200;

function buildNewAgentPrompt(request?: string) {
  const trimmed = request?.trim();
  return `${NEW_AGENT_CREATION_GUIDE}\n\nUser request:\n${trimmed || "Help me define and create a useful new agent."}`;
}

const NEW_AGENT_SUGGESTIONS = [
  {
    id: "specialist-agent",
    avatarSlot: 10,
    text: "Create a specialist agent",
    actionPrompt: "Create a persistent specialist agent for one clear responsibility. Give it a concise name, define what it should handle, what it should avoid, and how it should report progress.",
  },
  {
    id: "agent-with-ui",
    avatarSlot: 16,
    text: "Give an agent its own UI",
    actionPrompt: "Create a persistent agent with its own useful UI/app. The UI should match the agent's job, open automatically in the UI tab, and include the controls or views a real user would expect.",
  },
  {
    id: "agent-team",
    avatarSlot: 29,
    text: "Design a small agent team",
    actionPrompt: "Create a small team of persistent agents for one project. Define each agent's role, when I should use it, and how the agents should work together without overlapping responsibilities.",
  },
  {
    id: "research-scout",
    avatarSlot: 4,
    text: "Build a research scout",
    actionPrompt: "Create a persistent research scout agent that can investigate topics, compare options, track sources, summarize tradeoffs, and keep useful findings organized for later.",
  },
  {
    id: "workflow-operator",
    avatarSlot: 23,
    text: "Automate a workflow",
    actionPrompt: "Create a persistent workflow operator agent for a repeated process. It should ask for the missing process details, then define steps, checks, reminders, and handoff rules.",
  },
  {
    id: "personal-coach",
    avatarSlot: 31,
    text: "Make a personal coach",
    actionPrompt: "Create a persistent personal coach agent for a personal goal. Give it a practical tone, clear boundaries, progress tracking, and a simple routine for check-ins.",
  },
];

const MAIN_AGENT_ID = "main";
const DELETED_AGENTS_KEY = "xcloudDeletedAgents";
const UNICORE_WORKSPACE_PLUGIN_ID = "unicore-workspace";
const WORKSPACE_AGENT_CREATE_TOOL = "workspace_agent_create";
const UNICORE_ALLOWED_TOOLS = [
  "xcloud_context",
  "xcloud_ui_action",
  "xcloud_agent_create",
  "xcloud_agent_ui_create",
  WORKSPACE_AGENT_CREATE_TOOL,
];

interface TerminalContextState {
  visible: boolean;
  mounted: boolean;
  command?: string;
  remote?: boolean;
}

function markAgentDeleted(agentId: string, engine: BrowserEngine) {
  const storageKey = engineScopedStorageKey(DELETED_AGENTS_KEY, engine);
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[];
    const ids = new Set(Array.isArray(parsed) ? parsed : []);
    ids.add(agentId);
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    localStorage.setItem(storageKey, JSON.stringify([agentId]));
  }
  window.dispatchEvent(new CustomEvent("xcloud-deleted-agents-changed"));
}

async function removeAgentFromLocalConfig(agentId: string) {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
  const config = JSON.parse(raw) as Record<string, unknown>;
  const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
  const list = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return String((item as Record<string, unknown>).id ?? "") !== agentId;
    })
    : [];
  config.agents = { ...agentsConfig, list };
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
}

async function upsertAgentInLocalConfig(agent: Record<string, unknown>) {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
  const config = JSON.parse(raw) as Record<string, unknown>;
  const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
  const list = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const index = list.findIndex((item) => item.id === agent.id);
  if (index >= 0) list[index] = { ...list[index], ...agent };
  else list.push(agent);
  config.agents = { ...agentsConfig, list };
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
}

function normalizeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function workspaceAgentPrefixes(workspace: WorkspaceInfo) {
  return Array.from(new Set([
    workspace.id,
    workspace.id.replace(/^workspace-/, ""),
    normalizeLookup(workspace.name),
    normalizeLookup(workspace.name).replace(/^workspace-/, ""),
  ].filter(Boolean)));
}

function isWorkspaceOwnedAgent(agent: AgentInfo, workspaces: WorkspaceInfo[]) {
  if (agent.id.startsWith("workspace-")) return true;
  if (agent.isDefault) return false;
  return workspaces.some((workspace) => (
    workspaceAgentPrefixes(workspace).some((prefix) => agent.id.startsWith(`${prefix}-`))
  ));
}

function getAgentIdFromSessionKey(sessionKey: string) {
  if (sessionKey === MAIN_AGENT_ID || sessionKey.startsWith(`${MAIN_AGENT_ID}:`)) return MAIN_AGENT_ID;
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts[1]) return parts[1];
  return MAIN_AGENT_ID;
}

function getDefaultSessionKeyForAgent(agentId: string) {
  return agentId === MAIN_AGENT_ID ? MAIN_AGENT_ID : `agent:${agentId}:main`;
}

function sessionKeysMatch(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a === MAIN_AGENT_ID && b === "agent:main:main") || (b === MAIN_AGENT_ID && a === "agent:main:main");
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

async function syncAgentsToGatewayConfig(engine: BrowserEngine, agents: Record<string, unknown>[]) {
  if (!engine.connected || agents.length === 0) return;
  const configResult = await withTimeout(engine.rpc("config.get", {}), 5_000, "config.get").catch(() => null);
  if (!configResult) return;

  const hash = (configResult as { hash?: string }).hash ?? "";
  const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
  if (!hash) return;

  const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
  const list = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

  let changed = false;
  const addsNonMainAgent = agents.some((agent) => agent.id !== MAIN_AGENT_ID);
  if (addsNonMainAgent && !list.some((item) => item.id === MAIN_AGENT_ID)) {
    list.unshift({ id: MAIN_AGENT_ID, default: true });
    changed = true;
  }

  for (const agent of agents) {
    const index = list.findIndex((item) => item.id === agent.id);
    if (index >= 0) {
      const next = { ...list[index], ...agent };
      if (JSON.stringify(list[index]) !== JSON.stringify(next)) {
        list[index] = next;
        changed = true;
      }
    } else {
      list.push(agent);
      changed = true;
    }
  }

  if (!changed) return;

  await withTimeout(
    engine.patchConfig(JSON.stringify({ agents: { ...agentsConfig, list } }), hash),
    5_000,
    "config.patch",
  ).catch(() => {});
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function withUnicoreWorkspaceSupport(config: Record<string, unknown>) {
  const plugins = asRecord(config.plugins);
  const entries = asRecord(plugins.entries);
  const existingPlugin = asRecord(entries[UNICORE_WORKSPACE_PLUGIN_ID]);
  const nextPlugin = { ...existingPlugin, enabled: true };
  const tools = asRecord(config.tools);
  const currentAlsoAllow = Array.isArray(tools.alsoAllow)
    ? tools.alsoAllow.map(String).filter(Boolean)
    : [];
  const nextAlsoAllow = [
    ...currentAlsoAllow,
    ...UNICORE_ALLOWED_TOOLS.filter((toolName) => !currentAlsoAllow.includes(toolName)),
  ];

  const nextConfig = {
    ...config,
    plugins: {
      ...plugins,
      entries: {
        ...entries,
        [UNICORE_WORKSPACE_PLUGIN_ID]: nextPlugin,
      },
    },
    tools: {
      ...tools,
      alsoAllow: nextAlsoAllow,
    },
  };

  const changed = existingPlugin.enabled !== true
    || nextAlsoAllow.length !== currentAlsoAllow.length;
  return { config: nextConfig, changed };
}

function withActiveRunSteering(config: Record<string, unknown>) {
  const messages = asRecord(config.messages);
  const queue = asRecord(messages.queue);
  const nextQueue = { ...queue, mode: "steer" };
  const nextConfig = {
    ...config,
    messages: {
      ...messages,
      queue: nextQueue,
    },
  };
  return { config: nextConfig, changed: queue.mode !== "steer" };
}

async function ensureUnicoreWorkspaceSupportInLocalConfig() {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
  const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
  const { config, changed } = withUnicoreWorkspaceSupport(parsed);
  if (!changed) return false;
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
  return true;
}

async function ensureActiveRunSteeringInLocalConfig() {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
  const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
  const { config, changed } = withActiveRunSteering(parsed);
  if (!changed) return false;
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
  return true;
}

async function ensureUnicoreWorkspaceSupport(engine: BrowserEngine) {
  if (!engine.isRemote) await ensureUnicoreWorkspaceSupportInLocalConfig().catch(() => false);
  if (!engine.connected) return;

  const configResult = await withTimeout(engine.rpc("config.get", {}), 5_000, "config.get").catch(() => null);
  if (!configResult) return;
  const hash = (configResult as { hash?: string }).hash ?? "";
  const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
  if (!hash) return;

  const { config: nextConfig, changed } = withUnicoreWorkspaceSupport(config);
  if (!changed) return;
  await withTimeout(
    engine.patchConfig(JSON.stringify({ plugins: nextConfig.plugins, tools: nextConfig.tools }), hash),
    5_000,
    "config.patch",
  ).catch(() => {});
}

async function ensureActiveRunSteering(engine: BrowserEngine) {
  if (!engine.isRemote) await ensureActiveRunSteeringInLocalConfig().catch(() => false);
  if (!engine.connected) return;

  const configResult = await withTimeout(engine.rpc("config.get", {}), 5_000, "config.get").catch(() => null);
  if (!configResult) return;
  const hash = (configResult as { hash?: string }).hash ?? "";
  const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
  if (!hash) return;

  const { config: nextConfig, changed } = withActiveRunSteering(config);
  if (!changed) return;
  await withTimeout(
    engine.patchConfig(JSON.stringify({ messages: nextConfig.messages }), hash),
    5_000,
    "config.patch",
  ).catch(() => {});
}

function NewAgentView({
  agents,
  engine,
  sidebarCollapsed,
  isFullscreen,
  onStart,
}: {
  agents: AgentInfo[];
  engine: BrowserEngine;
  sidebarCollapsed?: boolean;
  isFullscreen?: boolean;
  onStart: (agentId: string, prompt?: string) => void;
}) {
  const defaultBuilderId = useMemo(
    () => agents.find((agent) => agent.id === MAIN_AGENT_ID)?.id ?? agents.find((agent) => agent.isDefault)?.id ?? agents[0]?.id ?? null,
    [agents],
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(defaultBuilderId);
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const availableAgents = agents.length > 0 ? agents : [];
  const visibleSuggestions = useMemo(() => {
    const count = Math.min(NEW_AGENT_VISIBLE_SUGGESTIONS, NEW_AGENT_SUGGESTIONS.length);
    return Array.from({ length: count }, (_, index) => NEW_AGENT_SUGGESTIONS[(suggestionOffset + index) % NEW_AGENT_SUGGESTIONS.length]);
  }, [suggestionOffset]);

  useEffect(() => {
    if (!defaultBuilderId) return;
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(defaultBuilderId);
    }
  }, [agents, defaultBuilderId, selectedAgentId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSuggestionOffset((offset) => (offset + NEW_AGENT_VISIBLE_SUGGESTIONS) % NEW_AGENT_SUGGESTIONS.length);
    }, NEW_AGENT_SUGGESTION_ROTATE_MS);

    return () => window.clearInterval(interval);
  }, []);

  const startAgentCreation = useCallback((request?: string) => {
    if (!selectedAgentId) return;
    onStart(selectedAgentId, buildNewAgentPrompt(request));
  }, [onStart, selectedAgentId]);

  const prefillAgentPrompt = useCallback((prompt: string) => {
    window.dispatchEvent(new CustomEvent("xcloud-prefill-prompt", { detail: prompt }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-9 shrink-0 items-center border-b border-border px-4"
        style={{ paddingLeft: sidebarCollapsed ? (isFullscreen ? 50 : 110) : undefined, transition: "padding-left 150ms ease" }}
      >
        <span className="text-[13px] font-medium text-text">New agent</span>
      </header>

      <div className="flex flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col justify-center px-8 pb-[10vh] pt-8">
          <div className="animate-[fadeBlurIn_180ms_ease-out]">
            <h1 className="mb-7 text-center text-[28px] font-semibold leading-tight tracking-normal text-text">
              What agent should we create?
            </h1>

            {availableAgents.length === 0 && (
              <div className="mt-7 rounded-xl border border-white/[0.06] bg-white/[0.035] px-4 py-6 text-center text-[13px] text-text-muted">
                No agents found yet.
              </div>
            )}

            <div className="mb-4 flex flex-wrap justify-center gap-3">
              {visibleSuggestions.map((item, index) => {
                const avatar = NEW_AGENT_SUGGESTION_AVATARS.length > 0
                  ? NEW_AGENT_SUGGESTION_AVATARS[item.avatarSlot % NEW_AGENT_SUGGESTION_AVATARS.length]
                  : undefined;
                return (
                  <button
                    key={`${suggestionOffset}-${item.id}`}
                    type="button"
                    onClick={() => prefillAgentPrompt(item.actionPrompt)}
                    className={cn(
                      "group flex h-12 items-center gap-2.5 rounded-[18px] border border-white/[0.07] bg-white/[0.04] px-3.5 text-left text-[12px] font-medium text-text-muted shadow-[0_12px_28px_rgba(0,0,0,0.16)] transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:rotate-0 hover:bg-white/[0.075] hover:text-text",
                      NEW_AGENT_SUGGESTION_TILTS[index % NEW_AGENT_SUGGESTION_TILTS.length],
                    )}
                    style={{ animation: `newAgentSuggestionIn 320ms cubic-bezier(0.2,0.8,0.2,1) ${index * 55}ms both` }}
                  >
                    {avatar && (
                      <img
                        src={avatar}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-[10px] object-cover ring-1 ring-white/10"
                      />
                    )}
                    <span className="max-w-[170px] truncate">{item.text}</span>
                  </button>
                );
              })}
            </div>

            <div>
              <ChatInput
                onSend={(prompt) => startAgentCreation(prompt)}
                disabled={!engine.connected || !selectedAgentId}
                engine={engine}
                variant="hero"
                contextLabel={selectedAgent ? (selectedAgent.name ?? selectedAgent.id) : "Select builder"}
                contextEmoji={selectedAgent?.emoji}
                contextAvatar={selectedAgent?.avatar}
                contextIsMain={selectedAgent?.isDefault}
                agentOptions={availableAgents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                placeholder="Describe the agent you want to create"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalDock({
  activeKey,
  entries,
  height,
  isOpen,
  disableTransition,
  engine,
  onResizeMouseDown,
  onClose,
}: {
  activeKey: string;
  entries: Array<[string, TerminalContextState]>;
  height: number;
  isOpen: boolean;
  disableTransition: boolean;
  engine: BrowserEngine;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onClose: (key: string) => void;
}) {
  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        height: isOpen ? height : 0,
        transition: disableTransition ? "none" : "height 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-hidden={!isOpen}
    >
      <div
        onMouseDown={onResizeMouseDown}
        data-interactive
        className="relative z-10 h-0 w-full shrink-0 cursor-row-resize"
      >
        <div className="absolute -top-1.5 left-0 w-full h-3 group">
          <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-white/[0.06] transition-colors group-hover:bg-accent" />
        </div>
      </div>
      <div style={{ height }}>
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-bg text-text-muted text-xs">Loading terminal...</div>}>
          {entries.map(([key, state]) => (
            <div
              key={`${key}:${state.remote ? engine.storageScope : "local"}`}
              className="h-full"
              style={{ display: key === activeKey ? undefined : "none" }}
            >
              <TerminalPanel
                initialCommand={state.command}
                remoteEngine={state.remote ? engine : undefined}
                remoteLabel={engine.mode === "mac-mini" ? "Mac mini" : engine.mode === "vps" ? "OpenClaw host" : "Remote"}
                onClose={() => onClose(key)}
              />
            </div>
          ))}
        </Suspense>
      </div>
    </div>
  );
}

export function AppLayout({ engine, reconnecting }: AppLayoutProps) {
  useTheme(); // Initialize theme CSS variables
  const { agents, refresh: refreshAgents } = useAgents(engine);
  const { workspaces, createWorkspace, linkAgent, unlinkAgent, removeAgentFromWorkspaces, deleteWorkspace, getWorkspaceAgents, ensureWorkspaceReady } = useWorkspaces(agents, engine);
  const { getAgentSessions, refresh: refreshSessions } = useSessions(engine);
  const engineStorageScope = engine.storageScope;
  const canvasSurfaceId = (agentId: string) => `${engineStorageScope}:${agentId}`;
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [initialChatPrompt, setInitialChatPrompt] = useState<string | undefined>(undefined);
  const [initialChatPromptHidden, setInitialChatPromptHidden] = useState(false);
  const [showCanvas, setShowCanvas] = useState(() => getCanvasPanelOpen(canvasSurfaceId(MAIN_AGENT_ID)));
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarAnimationKey, setSidebarAnimationKey] = useState(0);
  const [settingsSection, setSettingsSection] = useState<"models" | "keys" | "web-search" | "channels" | "skills" | "integrations" | "memory" | "appearance" | "engine" | "general">("models");
  const [showPreview, setShowPreview] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<DetailPanel | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const appUpdater = useAppUpdater();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(() => {
    const saved = localStorage.getItem("canvasWidth");
    return saved ? Number(saved) : 450;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [canvasTransitioning, setCanvasTransitioning] = useState(false);
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);
  const [canvasLabels, setCanvasLabels] = useState(() => localStorage.getItem("canvasShowLabels") !== "false");
  const [canvasOrbs, setCanvasOrbs] = useState(() => localStorage.getItem("canvasUseOrbs") === "true");
  const [showOnboardingPreview, setShowOnboardingPreview] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [agentImportProgress, setAgentImportProgress] = useState<AgentImportProgress | null>(null);
  const [unreadSessionKeys, setUnreadSessionKeys] = useState<Set<string>>(() => new Set());
  const [workingSessionKeys, setWorkingSessionKeys] = useState<Set<string>>(() => new Set());
  const [agentActivityAt, setAgentActivityAt] = useState<Record<string, number>>({});
  const [terminalByContext, setTerminalByContext] = useState<Record<string, TerminalContextState>>({});
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem("terminalHeight");
    return saved ? Number(saved) : 300;
  });
  const [mountedCanvasAgentIds, setMountedCanvasAgentIds] = useState<string[]>([]);
  const canvasViewportRef = useRef<Record<string, { x: number; y: number; zoom: number }>>({});
  const dragging = useRef(false);
  const draggingCanvas = useRef(false);
  const draggingTerminal = useRef(false);
  const previousTerminalKeyRef = useRef<string | null>(null);
  const ensuringWorkspaceIdsRef = useRef(new Set<string>());
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const workspaceAgents = getWorkspaceAgents(activeWorkspace);
  const globalAgents = agents.filter((agent) => !isWorkspaceOwnedAgent(agent, workspaces));
  const chatAgentOptions = activeWorkspace ? workspaceAgents : globalAgents;
  const hasWorkspaceChat = activeWorkspace !== null && activeAgentId === null && !showNewChat;
  const defaultAgentId = globalAgents.find((a) => a.id === MAIN_AGENT_ID)?.id
    ?? agents.find((a) => a.id === MAIN_AGENT_ID)?.id
    ?? globalAgents.find((a) => a.isDefault)?.id
    ?? agents.find((a) => a.isDefault)?.id
    ?? MAIN_AGENT_ID;
  const activeWorkspaceCoordinatorId = activeWorkspace ? getWorkspaceAgentId(activeWorkspace.id) : null;
  const currentAgentId = activeAgentId ?? activeWorkspaceCoordinatorId ?? defaultAgentId;
  const isWorkspaceCoordinatorActive = Boolean(activeWorkspace && activeWorkspaceCoordinatorId && currentAgentId === activeWorkspaceCoordinatorId);
  const hasChat = activeAgentId !== null && !showNewChat;
  const hasCanvasSurface = hasChat && !hasWorkspaceChat;
  const activeChatSessionKey = hasChat
    ? hasWorkspaceChat
      ? (activeSessionKey ?? `agent:${getWorkspaceAgentId(activeWorkspace!.id)}:general`)
      : (activeSessionKey ?? getDefaultSessionKeyForAgent(currentAgentId))
    : null;
  const activeChatSessionKeyRef = useRef<string | null>(null);
  const unreadAgentIds = useMemo(() => new Set([...unreadSessionKeys].map(getAgentIdFromSessionKey)), [unreadSessionKeys]);
  const workingAgentIds = useMemo(() => new Set([...workingSessionKeys].map(getAgentIdFromSessionKey)), [workingSessionKeys]);
  const activeTerminalKey = showSettings ? "settings" : activeAgentId ? `agent:${currentAgentId}` : hasWorkspaceChat ? `workspace:${activeWorkspace.id}` : showNewChat ? "new-agent" : "workspace";
  const activeTerminal = terminalByContext[activeTerminalKey];
  const showTerminal = activeTerminal?.visible ?? false;
  const composioConnectedStorageKey = engineScopedStorageKey("composioConnected", engine);

  useEffect(() => {
    if (!hasCanvasSurface) {
      setCanvasExpanded(false);
      return;
    }
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(currentAgentId)));
    setCanvasExpanded(false);
  }, [currentAgentId, engineStorageScope, hasCanvasSurface]);

  useEffect(() => {
    if (!hasCanvasSurface) return;
    setMountedCanvasAgentIds((ids) => ids.includes(currentAgentId) ? ids : [...ids, currentAgentId]);
  }, [currentAgentId, hasCanvasSurface]);

  useEffect(() => {
    const knownAgentIds = new Set(agents.map((agent) => agent.id));
    setMountedCanvasAgentIds((ids) => ids.filter((id) => id === currentAgentId || knownAgentIds.has(id)));
  }, [agents, currentAgentId]);

  const renderedCanvasAgentIds = useMemo(() => {
    const ids = mountedCanvasAgentIds.filter((id, index, list) => list.indexOf(id) === index);
    if (hasCanvasSurface && !ids.includes(currentAgentId)) ids.push(currentAgentId);
    return ids;
  }, [currentAgentId, hasCanvasSurface, mountedCanvasAgentIds]);

  const getPreferredAgentSession = useCallback((agentId: string) => {
    return getAgentSessions(agentId)[0]?.key ?? getDefaultSessionKeyForAgent(agentId);
  }, [getAgentSessions]);

  useEffect(() => {
    if (!activeAgentId || showNewChat || showSettings) return;
    const latestSession = getAgentSessions(activeAgentId)[0]?.key;
    if (!latestSession) return;

    const defaultSession = getDefaultSessionKeyForAgent(activeAgentId);
    const legacyWorkspaceSession = activeAgentId === activeWorkspaceCoordinatorId ? `agent:${activeAgentId}:general` : null;
    setActiveSessionKey((current) => {
      if (current && current !== defaultSession && current !== legacyWorkspaceSession) return current;
      return current === latestSession ? current : latestSession;
    });
  }, [activeAgentId, activeWorkspaceCoordinatorId, getAgentSessions, showNewChat, showSettings]);

  const triggerSidebarAnimation = useCallback(() => {
    setSidebarAnimationKey((key) => key + 1);
  }, []);

  const clearUnreadForAgent = useCallback((agentId: string) => {
    setUnreadSessionKeys((current) => {
      const next = new Set([...current].filter((sessionKey) => getAgentIdFromSessionKey(sessionKey) !== agentId));
      return next.size === current.size ? current : next;
    });
  }, []);

  const clearUnreadForSession = useCallback((sessionKey: string) => {
    setUnreadSessionKeys((current) => {
      if (![...current].some((key) => sessionKeysMatch(key, sessionKey))) return current;
      return new Set([...current].filter((key) => !sessionKeysMatch(key, sessionKey)));
    });
  }, []);

  useEffect(() => {
    activeChatSessionKeyRef.current = activeChatSessionKey;
    if (activeChatSessionKey) clearUnreadForSession(activeChatSessionKey);
  }, [activeChatSessionKey, clearUnreadForSession]);

  useEffect(() => {
    void ensureActiveRunSteering(engine).catch(() => {});
  }, [engine]);

  useEffect(() => {
    void refreshSessions();
  }, [agents.length, refreshSessions, workspaces.length]);

  useEffect(() => {
    const handleActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: string; working?: boolean }>).detail;
      const sessionKey = detail?.sessionKey;
      if (!sessionKey) return;
      const agentId = getAgentIdFromSessionKey(sessionKey);
      setAgentActivityAt((current) => ({ ...current, [agentId]: Date.now() }));
      if (typeof detail.working === "boolean") {
        setWorkingSessionKeys((current) => {
          const hasMatching = [...current].some((key) => sessionKeysMatch(key, sessionKey));
          if (detail.working) {
            if (hasMatching) return current;
            return new Set(current).add(sessionKey);
          }
          if (!hasMatching) return current;
          return new Set([...current].filter((key) => !sessionKeysMatch(key, sessionKey)));
        });
      }
      setUnreadSessionKeys((current) => {
        if (sessionKeysMatch(sessionKey, activeChatSessionKeyRef.current)) {
          if (![...current].some((key) => sessionKeysMatch(key, sessionKey))) return current;
          return new Set([...current].filter((key) => !sessionKeysMatch(key, sessionKey)));
        }
        if ([...current].some((key) => sessionKeysMatch(key, sessionKey))) return current;
        return new Set(current).add(sessionKey);
      });
    };

    const handleRead = (event: Event) => {
      const sessionKey = (event as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey;
      if (sessionKey) clearUnreadForSession(sessionKey);
    };

    window.addEventListener("xcloud-chat-session-activity", handleActivity);
    window.addEventListener("xcloud-chat-session-read", handleRead);
    return () => {
      window.removeEventListener("xcloud-chat-session-activity", handleActivity);
      window.removeEventListener("xcloud-chat-session-read", handleRead);
    };
  }, [clearUnreadForSession]);

  const ensureWorkspaceCoordinator = useCallback(async (workspace: WorkspaceInfo) => {
    if (ensuringWorkspaceIdsRef.current.has(workspace.id)) return;
    ensuringWorkspaceIdsRef.current.add(workspace.id);
    try {
      await ensureWorkspaceReady(workspace).catch(() => {});
      const agentId = getWorkspaceAgentId(workspace.id);
      if (engine.isRemote) {
        await ensureUnicoreWorkspaceSupport(engine).catch(() => {});
        window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
        void refreshAgents();
        return;
      }

      await ensureUnicoreWorkspaceSupportInLocalConfig().catch(() => false);
      const home = (await homeDir()).replace(/\/$/, "");
      const workspacePath = `${home}/${getWorkspaceDir(workspace.id)}`;
      const localConfigRaw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home }).catch(() => "{}");
      const config = JSON.parse(localConfigRaw || "{}") as Record<string, unknown>;
      const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
      const defaults = (agentsConfig.defaults as Record<string, unknown> | undefined) ?? {};
      const defaultModel = (defaults.model as Record<string, unknown> | undefined)?.primary as string | undefined;
      const list = Array.isArray(agentsConfig.list)
        ? agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : [];
      const current = list.find((item) => item.id === agentId) ?? null;
      const nextAgent: Record<string, unknown> = {
        id: agentId,
        name: workspace.name,
        workspace: workspacePath,
        ...(defaultModel ? { model: { primary: defaultModel } } : {}),
      };
      const isCurrent = Boolean(current)
        && current?.name === nextAgent.name
        && current?.workspace === nextAgent.workspace;
      if (!isCurrent) {
        await upsertAgentInLocalConfig(nextAgent).catch(() => {});
        window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
        void refreshAgents();
      }
    } finally {
      ensuringWorkspaceIdsRef.current.delete(workspace.id);
    }
  }, [engine, ensureWorkspaceReady, refreshAgents]);

  const openTerminal = useCallback((command?: string, options?: { remote?: boolean }) => {
    setTerminalByContext((prev) => {
      const current = prev[activeTerminalKey];
      return {
        ...prev,
        [activeTerminalKey]: {
          ...current,
          visible: true,
          mounted: true,
          command: command ?? current?.command,
          remote: options?.remote ?? false,
        },
      };
    });
  }, [activeTerminalKey]);

  const toggleTerminal = useCallback(() => {
    setTerminalByContext((prev) => {
      const current = prev[activeTerminalKey];
      return {
        ...prev,
        [activeTerminalKey]: {
          ...current,
          visible: !(current?.visible ?? false),
          mounted: true,
        },
      };
    });
  }, [activeTerminalKey]);

  // Detect fullscreen
  useEffect(() => {
    const win = getCurrentWindow();
    const check = async () => setIsFullscreen(await win.isFullscreen());
    check();
    const unlisten = win.onResized(() => { check(); });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Cmd+K to open command palette
  // Cmd+Shift+P to toggle dev preview
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
      if (e.metaKey && e.shiftKey && e.key === "p") {
        e.preventDefault();
        setShowPreview((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Persist canvas width when drag ends
  useEffect(() => {
    if (!isDragging) {
      localStorage.setItem("canvasWidth", String(canvasWidth));
    }
  }, [isDragging, canvasWidth]);

  // Persist terminal height when drag ends
  useEffect(() => {
    if (!isDragging) {
      localStorage.setItem("terminalHeight", String(terminalHeight));
    }
  }, [isDragging, terminalHeight]);

  // Listen for terminal open requests (from agent tools or UI)
  useEffect(() => {
    function handleOpenTerminal(e: Event) {
      const detail = (e as CustomEvent).detail;
      openTerminal(detail?.command, { remote: detail?.remote === true });
    }
    window.addEventListener("xcloud-open-terminal", handleOpenTerminal);
    return () => window.removeEventListener("xcloud-open-terminal", handleOpenTerminal);
  }, [openTerminal]);

  useEffect(() => {
    if (!activeWorkspace) return;
    const workspace = activeWorkspace;
    void ensureWorkspaceCoordinator(workspace).catch(() => {});
  }, [activeWorkspace, ensureWorkspaceCoordinator]);

  // Cmd+` to toggle terminal
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey && e.key === "`") {
        e.preventDefault();
        toggleTerminal();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleTerminal]);


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
    let frameId = 0;
    let nextWidth = canvasWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingCanvas.current || !cardRef.current) return;
      const cardRect = cardRef.current.getBoundingClientRect();
      nextWidth = Math.round(Math.min(cardRect.width - 200, Math.max(200, cardRect.right - ev.clientX)));
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        setCanvasWidth(nextWidth);
      });
    };

    const onMouseUp = () => {
      draggingCanvas.current = false;
      setIsDragging(false);
      if (frameId) {
        cancelAnimationFrame(frameId);
        setCanvasWidth(nextWidth);
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [canvasWidth]);

  const onTerminalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingTerminal.current = true;
    setIsDragging(true);
    const startY = e.clientY;
    const startHeight = terminalHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingTerminal.current) return;
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.min(600, Math.max(150, startHeight + delta)));
    };

    const onMouseUp = () => {
      draggingTerminal.current = false;
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [terminalHeight]);

  const handleSelectAgent = useCallback((id: string) => {
    clearUnreadForAgent(id);
    setActiveAgentId(id);
    setActiveSessionKey(getPreferredAgentSession(id));
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(id)));
  }, [clearUnreadForAgent, engineStorageScope, getPreferredAgentSession]);

  const handleSelectWorkspace = useCallback((id: string) => {
    const coordinatorId = getWorkspaceAgentId(id);
    triggerSidebarAnimation();
    clearUnreadForAgent(coordinatorId);
    setActiveWorkspaceId(id);
    setActiveAgentId(coordinatorId);
    setActiveSessionKey(getPreferredAgentSession(coordinatorId));
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(coordinatorId)));
    setCanvasExpanded(false);
  }, [clearUnreadForAgent, engineStorageScope, getPreferredAgentSession, triggerSidebarAnimation]);

  const handleSelectWorkspaceOverview = useCallback((id: string) => {
    const coordinatorId = getWorkspaceAgentId(id);
    clearUnreadForAgent(coordinatorId);
    setActiveWorkspaceId(id);
    setActiveAgentId(null);
    setActiveSessionKey(getPreferredAgentSession(coordinatorId));
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(coordinatorId)));
    setCanvasExpanded(false);
  }, [clearUnreadForAgent, engineStorageScope, getPreferredAgentSession]);

  const handleLeaveWorkspace = useCallback(() => {
    triggerSidebarAnimation();
    setActiveWorkspaceId(null);
    setActiveAgentId(null);
    setActiveSessionKey(null);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
  }, [triggerSidebarAnimation]);

  const handleCreateWorkspace = useCallback((name: string) => {
    const workspace = createWorkspace(name);
    if (!workspace) return;
    void ensureWorkspaceCoordinator(workspace).finally(() => {
      handleSelectWorkspace(workspace.id);
    });
  }, [createWorkspace, ensureWorkspaceCoordinator, handleSelectWorkspace]);

  const handleCreateAgentInWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const prompt = `The workspace is "${workspace?.name ?? workspaceId}". It is a workspace/project, not an agent. Help me define one new specialist agent that belongs to this workspace. Ask only what you need about the role. When enough context is clear, create the real persistent specialist with the ${WORKSPACE_AGENT_CREATE_TOOL} tool. The agent id must start with "${workspaceId}-".`;
    const coordinatorId = getWorkspaceAgentId(workspaceId);
    setActiveWorkspaceId(workspaceId);
    setActiveAgentId(coordinatorId);
    setActiveSessionKey(getPreferredAgentSession(coordinatorId));
    setInitialChatPrompt(prompt);
    setInitialChatPromptHidden(false);
    setShowNewChat(false);
    setShowSettings(false);
    setShowPreview(false);
  }, [getPreferredAgentSession, workspaces]);

  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    const deletedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
    const coordinatorId = getWorkspaceAgentId(workspaceId);
    markAgentDeleted(coordinatorId, engine);
    if (!engine.isRemote) void removeAgentFromLocalConfig(coordinatorId).catch(() => {});
    deleteWorkspace(workspaceId);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId(null);
      setActiveAgentId(null);
      setActiveSessionKey(null);
      setInitialChatPrompt(undefined);
      setInitialChatPromptHidden(false);
    }
    if (deletedWorkspace && nodeDetail?.title.includes(deletedWorkspace.name)) {
      setNodeDetail(null);
    }
  }, [activeWorkspaceId, deleteWorkspace, engine, nodeDetail?.title, workspaces]);

  const handleAppTool: AppToolHandler = useCallback(async (request) => {
    if (request.name === "create_workspace") {
      const workspace = createWorkspace(request.args.name ?? "");
      if (!workspace) {
        return {
          message: "No pude crear el workspace porque el nombre está vacío.",
          output: "Workspace creation skipped: empty name.",
        };
      }
      await ensureWorkspaceCoordinator(workspace);
      handleSelectWorkspace(workspace.id);
      return {
        message: `Listo, creé el workspace **${workspace.name}**. Ya lo abrí para que podamos definir su contexto, equipo y agentes vinculados.`,
        output: `Created workspace "${workspace.name}" (${workspace.id}).`,
      };
    }

    if (request.name === "delete_workspace") {
      const requestedName = request.args.name?.trim();
      if (!requestedName) {
        return {
          message: "Necesito el nombre del workspace que quieres eliminar.",
          output: "Workspace deletion skipped: missing name.",
        };
      }

      const lookup = normalizeLookup(requestedName);
      const workspace = workspaces.find((item) => (
        normalizeLookup(item.id) === lookup || normalizeLookup(item.name) === lookup
      ));

      if (!workspace) {
        const available = workspaces.map((item) => item.name).join(", ") || "no hay workspaces creados";
        return {
          message: `No encontré un workspace llamado **${requestedName}**. Workspaces disponibles: ${available}.`,
          output: `Workspace not found: ${requestedName}`,
        };
      }

      handleDeleteWorkspace(workspace.id);
      return {
        message: `Listo, eliminé el workspace **${workspace.name}** y quité su coordinator de la configuración local.`,
        output: `Deleted workspace "${workspace.name}" (${workspace.id}).`,
      };
    }

    if (request.name === "open_workspace") {
      const requestedName = request.args.name?.trim();
      if (!requestedName) {
        return {
          message: "Necesito el nombre del workspace que quieres abrir.",
          output: "Workspace open skipped: missing name.",
        };
      }

      const lookup = normalizeLookup(requestedName);
      const workspace = workspaces.find((item) => (
        normalizeLookup(item.id) === lookup || normalizeLookup(item.name) === lookup
      ));

      if (!workspace) {
        const available = workspaces.map((item) => item.name).join(", ") || "no hay workspaces creados";
        return {
          message: `No encontré un workspace llamado **${requestedName}**. Workspaces disponibles: ${available}.`,
          output: `Workspace not found: ${requestedName}`,
        };
      }

      handleSelectWorkspace(workspace.id);
      return {
        message: `Abrí el workspace **${workspace.name}**. Ahora el chat está en su Workspace Main, separado del Main global.`,
        output: `Opened workspace "${workspace.name}" (${workspace.id}).`,
      };
    }

    if (request.name === "list_workspaces") {
      if (workspaces.length === 0) {
        return {
          message: "Todavía no hay workspaces creados.",
          output: "No workspaces found.",
        };
      }

      const lines = workspaces.map((workspace) => {
        const agentCount = workspace.agentIds.filter((id) => id !== MAIN_AGENT_ID && !id.startsWith("workspace-")).length;
        return `- ${workspace.name} (${workspace.id}) - ${agentCount} linked agent${agentCount === 1 ? "" : "s"}`;
      });
      return {
        message: `Estos son los workspaces actuales:\n\n${lines.join("\n")}`,
        output: lines.join("\n"),
      };
    }

    return {
      message: "Esa herramienta de workspace todavía no está disponible.",
      output: `Unsupported app tool: ${request.name}`,
    };
  }, [createWorkspace, ensureWorkspaceCoordinator, handleDeleteWorkspace, handleSelectWorkspace, workspaces]);

  const handleRemoveAgentFromWorkspace = useCallback((workspaceId: string, agentId: string) => {
    unlinkAgent(workspaceId, agentId);
    if (activeWorkspaceId === workspaceId && activeAgentId === agentId) {
      const coordinatorId = getWorkspaceAgentId(workspaceId);
      setActiveAgentId(coordinatorId);
      setActiveSessionKey(getPreferredAgentSession(coordinatorId));
    }
  }, [activeAgentId, activeWorkspaceId, getPreferredAgentSession, unlinkAgent]);

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent || agent.isDefault || agent.id === MAIN_AGENT_ID) return;

    markAgentDeleted(agentId, engine);
    removeAgentFromWorkspaces(agentId);
    setTerminalByContext((prev) => {
      const next = { ...prev };
      delete next[`agent:${agentId}`];
      return next;
    });
    try {
      const pinned = JSON.parse(localStorage.getItem("pinnedAgents") ?? "[]") as string[];
      localStorage.setItem("pinnedAgents", JSON.stringify(pinned.filter((id) => id !== agentId)));
    } catch {
      localStorage.setItem("pinnedAgents", "[]");
    }

    await deleteOpenClawAgent(engine, agentId).catch(() => {});
    if (!engine.isRemote) await removeAgentFromLocalConfig(agentId).catch(() => {});

    if (activeAgentId === agentId) {
      setActiveAgentId(null);
      setActiveSessionKey(null);
      setShowCanvas(false);
      setNodeDetail(null);
    }
    setTimeout(() => void refreshAgents(), 300);
    setTimeout(() => void refreshAgents(), 1400);
  }, [activeAgentId, agents, engine, refreshAgents, removeAgentFromWorkspaces]);

  const handleExportAgentPackage = useCallback(async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    try {
      const path = await exportAgentPackage(agent);
      if (path) window.alert(`Agent package exported:\n${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not export agent package:\n${message}`);
    }
  }, [agents]);

  const handleImportAgentPackage = useCallback(async () => {
    try {
      const imported = await importAgentPackage(engine, {
        onProgress: setAgentImportProgress,
      });
      if (!imported) {
        setAgentImportProgress(null);
        return;
      }
      setAgentImportProgress({
        phase: "registering",
        message: "Refreshing agent list...",
        progress: 0.96,
        agentId: imported.id,
        agentName: imported.name,
      });
      await syncAgentsToGatewayConfig(engine, [imported]).catch(() => {});
      await refreshAgents();
      setActiveAgentId(imported.id);
      setActiveWorkspaceId(null);
      setActiveSessionKey(getPreferredAgentSession(imported.id));
      setShowNewChat(false);
      setShowSettings(false);
      setShowPreview(false);
      setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(imported.id)));
      setAgentImportProgress({
        phase: "done",
        message: `${imported.name} is ready.`,
        progress: 1,
        agentId: imported.id,
        agentName: imported.name,
      });
      window.setTimeout(() => setAgentImportProgress(null), 1200);
    } catch (error) {
      setAgentImportProgress(null);
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Could not import agent package:\n${message}`);
    }
  }, [engine, engineStorageScope, getPreferredAgentSession, refreshAgents]);

  const handleSelectSession = useCallback((agentId: string, sessionKey: string) => {
    clearUnreadForSession(sessionKey);
    setActiveAgentId(agentId);
    setActiveWorkspaceId(null);
    setActiveSessionKey(sessionKey);
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(agentId)));
  }, [clearUnreadForSession, engineStorageScope]);

  const handleNewChat = useCallback(() => {
    setShowNewChat(true);
    setActiveWorkspaceId(null);
    setActiveAgentId(null);
    setActiveSessionKey(null);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(false);
    setCanvasExpanded(false);
  }, []);

  const handleStartNewChat = useCallback((agentId: string, prompt?: string) => {
    const id = crypto.randomUUID().slice(0, 8);
    setActiveAgentId(agentId);
    setActiveWorkspaceId(null);
    setActiveSessionKey(agentId === "main" ? `main:${id}` : `agent:${agentId}:${id}`);
    setInitialChatPrompt(prompt?.trim() || undefined);
    setInitialChatPromptHidden(false);
    setShowNewChat(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(getCanvasPanelOpen(canvasSurfaceId(agentId)));
    setCanvasExpanded(false);
  }, [engineStorageScope]);

  useEffect(() => {
    function handleWorkspaceRequest(e: Event) {
      const detail = (e as CustomEvent).detail as { name?: string };
      const name = detail?.name?.trim();
      if (!name) return;
      handleCreateWorkspace(name);
    }
    window.addEventListener("xcloud-create-workspace-request", handleWorkspaceRequest);
    return () => window.removeEventListener("xcloud-create-workspace-request", handleWorkspaceRequest);
  }, [handleCreateWorkspace]);

  const showThirdPanel = showPreview || showSettings || (showCanvas && hasCanvasSurface);
  const terminalContextChanged = previousTerminalKeyRef.current !== null && previousTerminalKeyRef.current !== activeTerminalKey;
  const mountedTerminalEntries = Object.entries(terminalByContext).filter(([, state]) => state.mounted);

  useEffect(() => {
    previousTerminalKeyRef.current = activeTerminalKey;
  }, [activeTerminalKey]);

  return (
    <div className={cn("flex h-full flex-col", isDragging && "resize-active")}>
      <div className="flex flex-1 min-h-0">
      {/* Toggle sidebar — fixed next to macOS traffic lights */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed z-20 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
        style={{ top: 14, left: isFullscreen ? 20 : 88 }}
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

      {!sidebarCollapsed && appUpdater.hasUpdate && (
        <button
          type="button"
          onClick={() => void appUpdater.installUpdate()}
          disabled={appUpdater.status === "downloading" || appUpdater.status === "installing"}
          className="fixed z-20 rounded-full bg-[#17A8FD] px-3.5 py-0.5 text-[12px] font-semibold text-white transition-all hover:bg-[#0798ED] active:scale-[0.98] disabled:cursor-default disabled:opacity-80"
          style={{ top: 14, left: isFullscreen ? 54 : 122 }}
          title={`Install xCloud ${appUpdater.update?.version ?? "update"}`}
        >
          {appUpdater.status === "downloading"
            ? `${appUpdater.downloadProgress || 0}%`
            : appUpdater.status === "installing"
              ? "Restarting"
              : "Update"}
        </button>
      )}

      {/* 1. Sidebar — agent list */}
      <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarCollapsed ? 0 : panelWidth, backgroundColor: "rgba(30,30,30,0.30)", overflow: "hidden", transition: isDragging ? "none" : "width 150ms ease" }}>
        <div className="flex flex-1 min-h-0 flex-col" style={{ minWidth: panelWidth }}>
          {showSettings ? (
            /* Settings navigation */
            <div key={`settings:${sidebarAnimationKey}`} className="flex h-full flex-col sidebar-view-enter">
              <div className={`px-3 pb-3 ${isFullscreen ? "pt-12" : "pt-14"}`}>
                <button
                  onClick={() => {
                    triggerSidebarAnimation();
                    setShowSettings(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text-muted transition-colors hover:bg-white/6 hover:text-text"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-[13px] font-medium">Back to app</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3">
                {([
                  { id: "models" as const, label: "Models", icon: Layers },
                  { id: "keys" as const, label: "API Keys", icon: KeyRound },
                  { id: "web-search" as const, label: "Web Search", icon: Search },
                  { id: "channels" as const, label: "Channels", icon: Globe },
                  { id: "skills" as const, label: "Skills", icon: Sparkles },
                  { id: "integrations" as const, label: "Integrations", icon: Plug },
                  { id: "memory" as const, label: "Memory", icon: Brain },
                  { id: "engine" as const, label: "Engine", icon: Server },
                  { id: "appearance" as const, label: "Appearance", icon: Palette },
                  { id: "general" as const, label: "General", icon: SlidersHorizontal },
                ]).map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSettingsSection(s.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text transition-colors ${
                        settingsSection === s.id ? "bg-white/8" : "hover:bg-white/6"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{s.label}</span>
                    </button>
                  );
                }).reduce<React.ReactNode[]>((acc, el, i) => {
                  if (i > 0) acc.push(<div key={`sep-${i}`} className="h-1" />);
                  acc.push(el);
                  return acc;
                }, [])}
              </div>
            </div>
          ) : nodeDetail ? (
            /* Node detail panel */
            <div className="flex h-full flex-col">
              <div className={`px-3 pb-3 ${isFullscreen ? "pt-12" : "pt-14"}`}>
                <button
                  onClick={() => setNodeDetail(null)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text-muted transition-colors hover:bg-white/6 hover:text-text"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-[13px] font-medium">{nodeDetail.title}</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {nodeDetail.type === "markdown" || nodeDetail.type === "info" ? (
                  <div className="prose-chat text-[12px] leading-relaxed text-[#D4D4D4]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{nodeDetail.content}</ReactMarkdown>
                  </div>
                ) : nodeDetail.type === "list" ? (
                  <div className="space-y-0.5">
                    {nodeDetail.items?.map((item) => (
                      <div key={item.label} className="rounded-lg px-2.5 py-2">
                        <span className="text-[11px] font-medium text-text truncate block">{item.label}</span>
                        {item.description && <span className="text-[10px] text-text-muted leading-tight mt-0.5 line-clamp-2 block">{item.description}</span>}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : showCanvasSettings ? (
            /* Canvas settings */
            <div className="flex h-full flex-col">
              <div className={`px-3 pb-3 ${isFullscreen ? "pt-12" : "pt-14"}`}>
                <button
                  onClick={() => setShowCanvasSettings(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text-muted transition-colors hover:bg-white/6 hover:text-text"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-[13px] font-medium">Canvas Settings</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-text">Show labels</span>
                  <button
                    onClick={() => {
                      const v = !canvasLabels;
                      setCanvasLabels(v);
                      localStorage.setItem("canvasShowLabels", String(v));
                      window.dispatchEvent(new CustomEvent("xcloud-canvas-settings"));
                    }}
                    className={`relative h-5 w-9 rounded-full transition-colors ${canvasLabels ? "bg-white/30" : "bg-white/10"}`}
                  >
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${canvasLabels ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-text">Orb style</span>
                  <button
                    onClick={() => {
                      const v = !canvasOrbs;
                      setCanvasOrbs(v);
                      localStorage.setItem("canvasUseOrbs", String(v));
                      window.dispatchEvent(new CustomEvent("xcloud-canvas-settings"));
                    }}
                    className={`relative h-5 w-9 rounded-full transition-colors ${canvasOrbs ? "bg-white/30" : "bg-white/10"}`}
                  >
                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${canvasOrbs ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <HomeScreen
              engine={engine}
              agents={agents}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              activeAgentId={activeAgentId}
              sidebarAnimationKey={sidebarAnimationKey}
              unreadAgentIds={unreadAgentIds}
              workingAgentIds={workingAgentIds}
              agentActivityAt={agentActivityAt}
              onSelectAgent={handleSelectAgent}
              onSelectWorkspace={handleSelectWorkspace}
              onSelectWorkspaceOverview={handleSelectWorkspaceOverview}
              onLeaveWorkspace={handleLeaveWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              onAddAgentToWorkspace={linkAgent}
              onRemoveAgentFromWorkspace={handleRemoveAgentFromWorkspace}
              onCreateAgentInWorkspace={handleCreateAgentInWorkspace}
              onDeleteAgent={handleDeleteAgent}
              onExportAgent={handleExportAgentPackage}
              onImportAgent={handleImportAgentPackage}
              onDeleteWorkspace={handleDeleteWorkspace}
              onSelectSession={handleSelectSession}
              getAgentSessions={getAgentSessions}
              isFullscreen={isFullscreen}
              onRefresh={refreshAgents}
              onOpenSettings={() => {
                triggerSidebarAnimation();
                setShowSettings(true);
                setSettingsSection("integrations");
              }}
              onSearch={() => setShowCommandPalette(true)}
              onNewChat={handleNewChat}
              integrationsStorageKey={composioConnectedStorageKey}
            />
          )}
        </div>

        {/* Sidebar footer — hidden when settings open or detail open */}
        <div className="shrink-0 px-3 pb-3.5 pt-1.5" style={{ minWidth: panelWidth, display: showSettings || nodeDetail ? "none" : undefined }}>
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                triggerSidebarAnimation();
                setShowSettings(!showSettings);
                setShowPreview(false);
              }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1 text-text transition-colors hover:bg-white/6"
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm font-medium">Settings</span>
            </button>
            <div className="flex items-center gap-0.5">
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
          className="flex flex-1 min-h-0 flex-col rounded-xl bg-bg overflow-hidden"
          onMouseDown={async (e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, input, textarea, a, [data-interactive]")) return;
            await getCurrentWindow().startDragging();
          }}
        >
          {/* Settings stays mounted separately so Chat/Canvas can remain alive behind it. */}
          <div
            className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden"
            style={{ display: showSettings ? undefined : "none" }}
          >
              <div className="flex flex-1 min-h-0 justify-center overflow-y-auto">
                <div className="w-full max-w-2xl px-6 py-6">
                  <SettingsPanel
                    engine={engine}
                    agents={agents}
                    section={settingsSection}
                    onPreviewOnboarding={() => setShowOnboardingPreview(true)}
                    onOpenTerminal={(command, options) => {
                      openTerminal(command, options);
                    }}
                  />
                </div>
              </div>
              <TerminalDock
                activeKey={activeTerminalKey}
                entries={mountedTerminalEntries}
                height={terminalHeight}
                isOpen={showTerminal && showSettings}
                disableTransition={isDragging || terminalContextChanged}
                engine={engine}
                onResizeMouseDown={onTerminalMouseDown}
                onClose={(key) => {
                  setTerminalByContext((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], visible: false, mounted: false, command: undefined, remote: false },
                  }));
                }}
              />
            </div>

          <div
            className="flex flex-1 min-h-0 min-w-0 overflow-hidden"
            style={{ display: showSettings ? "none" : undefined }}
          >
          {/* Chat area */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden" style={{ display: canvasExpanded ? "none" : undefined }}>
            {/* Chat area */}
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              {hasWorkspaceChat && activeWorkspace ? (
                <WorkspaceCanvas
                  key={`workspace-overview:${activeWorkspace.id}`}
                  engine={engine}
                  workspace={activeWorkspace}
                  agents={workspaceAgents}
                  onNodeDetail={setNodeDetail}
                />
              ) : hasChat ? (
                <ChatPanel
                  key={hasWorkspaceChat ? `${activeWorkspace!.id}-${activeSessionKey ?? "general"}` : `${currentAgentId}-${activeSessionKey ?? "default"}`}
                  engine={engine}
                  agentId={currentAgentId}
                  sessionKey={activeSessionKey ?? (hasWorkspaceChat ? getDefaultSessionKeyForAgent(getWorkspaceAgentId(activeWorkspace!.id)) : undefined)}
                  agentName={hasWorkspaceChat ? activeWorkspace!.name : agents.find((a) => a.id === currentAgentId)?.name ?? currentAgentId}
                  titleName={hasWorkspaceChat ? activeWorkspace!.name : undefined}
                  workspaceName={hasWorkspaceChat || isWorkspaceCoordinatorActive ? activeWorkspace!.name : undefined}
                  agents={chatAgentOptions}
                  onSwitchAgent={(id) => setActiveAgentId(id)}
                  onSessionChange={setActiveSessionKey}
                  sidebarCollapsed={sidebarCollapsed}
                  isFullscreen={isFullscreen}
                  onRefresh={refreshAgents}
                  initialPrompt={initialChatPrompt}
                  initialPromptHidden={initialChatPromptHidden}
                  terminalLift={showTerminal ? terminalHeight : 0}
                  onToggleTerminal={toggleTerminal}
                  terminalOpen={showTerminal}
                  reserveCanvasControlsSpace={!showThirdPanel && !showSettings && !showPreview}
                  appTools={handleAppTool}
                />
              ) : showNewChat ? (
                <NewAgentView
                  agents={globalAgents}
                  engine={engine}
                  sidebarCollapsed={sidebarCollapsed}
                  isFullscreen={isFullscreen}
                  onStart={handleStartNewChat}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-text-muted">
                  <div className="text-3xl opacity-20">✦</div>
                  <p className="text-sm">Select an agent to start chatting</p>
                </div>
              )}
            </div>
          </div>

          {/* Canvas / Settings / Preview */}
          {/* Resize handle — only when panel is open and not expanded */}
          {showThirdPanel && !canvasExpanded && (
            <div
              onMouseDown={onCanvasMouseDown}
              data-interactive
              className="relative z-10 h-full w-0 shrink-0 cursor-col-resize"
            >
              <div className="absolute -left-1.5 top-0 h-full w-3 group">
                <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/30 transition-colors group-hover:bg-accent" />
              </div>
            </div>
          )}
          <div
            className={cn("flex h-full flex-col overflow-hidden", canvasExpanded ? "flex-1" : "shrink-0")}
            style={{
              width: canvasExpanded ? undefined : (showThirdPanel ? canvasWidth : 0),
              transition: canvasExpanded || isDragging ? "none" : "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div className="flex-1 min-h-0" style={{ minWidth: canvasExpanded ? undefined : canvasWidth }}>
              {/* Canvas surfaces stay mounted per agent so UI previews do not reload on agent switches. */}
              <div className="h-full" style={{ display: showPreview ? "none" : undefined, visibility: canvasTransitioning ? "hidden" : "visible" }}>
                {renderedCanvasAgentIds.map((canvasAgentId) => {
                  const isActiveCanvas = hasCanvasSurface && canvasAgentId === currentAgentId;
                  return (
                    <div key={canvasAgentId} className="h-full" style={{ display: isActiveCanvas ? undefined : "none" }}>
                      <AgentCanvas
                        engine={engine}
                        agentId={canvasAgentId}
                        agentAvatar={agents.find((agent) => agent.id === canvasAgentId)?.avatar}
                        integrationsStorageKey={composioConnectedStorageKey}
                        savedViewport={canvasViewportRef.current[canvasAgentId]}
                        onViewportChange={(vp) => { canvasViewportRef.current[canvasAgentId] = vp; }}
                        onNodeDetail={setNodeDetail}
                        onCanvasSettings={() => setShowCanvasSettings((value) => !value)}
                      />
                    </div>
                  );
                })}
              </div>
              {showPreview && <DevPreview />}
            </div>
          </div>
          </div>
          {/* Terminal panel (full card width) */}
          <TerminalDock
            activeKey={activeTerminalKey}
            entries={mountedTerminalEntries}
            height={terminalHeight}
            isOpen={showTerminal && !showSettings}
            disableTransition={isDragging || terminalContextChanged}
            engine={engine}
            onResizeMouseDown={onTerminalMouseDown}
            onClose={(key) => {
              setTerminalByContext((prev) => ({
                ...prev,
                [key]: { ...prev[key], visible: false, mounted: false, command: undefined, remote: false },
              }));
            }}
          />
        </div>
      </div>

      {/* Canvas controls — fixed top right */}
      {!showSettings && !showPreview && hasCanvasSurface && (
        <div className="fixed z-20 flex items-center gap-1" style={{ top: 14, right: 20 }}>
          {/* Expand/collapse canvas to full width */}
          {showCanvas && (
            <button
              onClick={() => {
                setCanvasTransitioning(true);
                requestAnimationFrame(() => {
                  setCanvasExpanded((v) => !v);
                  requestAnimationFrame(() => setCanvasTransitioning(false));
                });
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
              title={canvasExpanded ? "Collapse canvas" : "Expand canvas"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
                {canvasExpanded ? (
                  <>
                    <path d="M4 14h6v6" /><path d="M20 10h-6V4" />
                    <path d="M14 10l7-7" /><path d="M3 21l7-7" />
                  </>
                ) : (
                  <>
                    <path d="M15 3h6v6" /><path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" /><path d="M3 21l7-7" />
                  </>
                )}
              </svg>
            </button>
          )}
          {/* Show/hide canvas */}
          <button
            onClick={() => {
              const nextOpen = !showCanvas;
              setShowCanvas(nextOpen);
              setCanvasPanelOpen(canvasSurfaceId(currentAgentId), nextOpen);
              if (!nextOpen && canvasExpanded) setCanvasExpanded(false);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
            title={showCanvas ? "Hide canvas" : "Show canvas"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
              <path d="M11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3Z" />
              {showCanvas
                ? <path d="M16 8L16 16" />
                : <path d="M8.00488 16.0049L8.00488 8.00488" />
              }
            </svg>
          </button>
        </div>
      )}

      {/* Onboarding Preview Overlay */}
      {showOnboardingPreview && (
        <div className="fixed inset-0 z-50 bg-bg">
          <button
            onClick={() => setShowOnboardingPreview(false)}
            className="fixed top-4 right-4 z-60 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-text hover:bg-white/15 transition-colors"
          >
            Close Preview
          </button>
          <OnboardingScreen onComplete={() => setShowOnboardingPreview(false)} preview />
        </div>
      )}

      {agentImportProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-panel/95 p-4 shadow-2xl ring-1 ring-black/30">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8">
                {agentImportProgress.phase === "done" ? (
                  <div className="h-3.5 w-3.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.65)]" />
                ) : (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-text">Importing agent</p>
                  <span className="text-[11px] font-medium text-text-muted">
                    {Math.round((agentImportProgress.progress ?? 0.08) * 100)}%
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {agentImportProgress.message}
                </p>
              </div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(6, Math.min(100, Math.round((agentImportProgress.progress ?? 0.08) * 100)))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-muted/70">
              <span>{agentImportProgress.phase}</span>
              {agentImportProgress.agentName && <span className="max-w-[160px] truncate normal-case tracking-normal">{agentImportProgress.agentName}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        agents={chatAgentOptions}
        getAgentSessions={getAgentSessions}
        onSelectAgent={(id) => { handleSelectAgent(id); }}
        onSelectSession={handleSelectSession}
        onOpenSettings={(section) => {
          triggerSidebarAnimation();
          setShowSettings(true);
          setSettingsSection(section as typeof settingsSection);
        }}
        onOpenTerminal={() => openTerminal()}
      />
      </div>

      {/* Reconnecting banner — bottom, pushes layout up */}
      {reconnecting && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-4 pb-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] text-amber-400 font-medium">Reconnecting...</span>
          <button
            onClick={() => window.location.reload()}
            className="ml-1 rounded-md bg-white/10 px-2.5 py-0.5 text-[10px] text-text font-medium hover:bg-white/15 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
