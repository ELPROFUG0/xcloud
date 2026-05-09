import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { useAgents } from "@/hooks/use-agents";
import type { AgentInfo } from "@/hooks/use-agents";
import { getWorkspaceAgentId, getWorkspaceDir, listWorkspaceDraftAgents, useWorkspaces, workspaceHasContext } from "@/hooks/use-workspaces";
import type { WorkspaceDraftAgent, WorkspaceInfo } from "@/hooks/use-workspaces";
import { Settings, Eye, Layers, KeyRound, Globe, SlidersHorizontal, ArrowLeft, Palette, Server, Sparkles, Plug, Brain, MessageCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { HomeScreen } from "./home/HomeScreen";
import { useSessions } from "@/hooks/use-sessions";
import { HIDDEN_PROMPT_MARKER } from "@/hooks/use-chat";
import type { AppToolHandler } from "@/hooks/use-chat";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatInput } from "./chat/ChatInput";
import { AgentCanvas, type DetailPanel } from "./canvas/AgentCanvas";
import { WorkspaceCanvas } from "./canvas/WorkspaceCanvas";
import { SettingsPanel } from "./SettingsPanel";
import { DevPreview } from "./DevPreview";
import { OnboardingScreen } from "./OnboardingScreen";
const TerminalPanel = lazy(() => import("./terminal/TerminalPanel").then(m => ({ default: m.TerminalPanel })));
import { getCurrentWindow } from "@tauri-apps/api/window";
import { homeDir } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
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

const NEW_CHAT_SUGGESTIONS = [
  {
    id: "blank-conversation",
    icon: MessageCircle,
    text: "Start with a blank conversation",
    actionPrompt: undefined,
  },
  {
    id: "useful-next-step",
    icon: Sparkles,
    text: "Ask this agent to suggest a useful next step",
    actionPrompt: "Suggest the most useful next step for this agent and help me start it.",
  },
  {
    id: "review-capabilities",
    icon: Search,
    text: "Review what this agent can do",
    actionPrompt: "Review your current capabilities, tools, and workspace. Then suggest what I should ask you to do first.",
  },
];

const MAIN_AGENT_ID = "main";
const PROMOTED_WORKSPACE_AGENTS_KEY = "xcloudPromotedWorkspaceAgents";
const DELETED_AGENTS_KEY = "xcloudDeletedAgents";

interface TerminalContextState {
  visible: boolean;
  mounted: boolean;
  command?: string;
}

function buildWorkspaceSetupPrompt(workspaceName: string, workspaceId: string) {
  return `${HIDDEN_PROMPT_MARKER}
You are the normal OpenClaw main agent. Keep your normal OpenClaw behavior, tools, setup abilities, agent creation behavior, automation behavior, and operator judgment.

For this session, you are operating inside the Unicore workspace "${workspaceName}".

Important separation:
- "${workspaceName}" is a workspace/project, not a specialist agent.
- Do not ask for "${workspaceName}"'s agent role. Ask what the workspace/project is for.
- The durable workspace files live in ~/.openclaw/workspace/workspace-${workspaceId}/.

Workspace overlay rules:
- Treat this as normal OpenClaw main, plus workspace organization.
- When the user asks to create agents, tools, automations, channels, schedules, or integrations, do it using normal OpenClaw mechanisms whenever available.
- Any specialist agents you create should be real OpenClaw agents and should be organized under this workspace.
- Keep workspace context in ~/.openclaw/workspace/workspace-${workspaceId}/MEMORY.md, GOALS.md, and TEAM.md.
- When creating agent files yourself, write the real agent files: IDENTITY.md, SOUL.md, AGENTS.md, and PROJECT_BRIEF.md.
- If direct OpenClaw config/tools are unavailable from this session, write a structured setup file in ~/.openclaw/workspace/workspace-${workspaceId}/agents/<agent-slug>.md so Unicore can install it automatically as a real agent.
- If the user asks for recurring work, create or propose the real automation/cron schedule.
- If a task needs an external app like X/Twitter, verify whether the integration is connected. If it is not connected, ask the user to connect it. Never publish externally without explicit approval unless the user configured auto-publish.

If this workspace has little or no durable context yet, start a real conversational setup in the chat:
- Briefly say you will help define the workspace and assemble the right team.
- Ask the first one or two questions needed to understand what this workspace is for.
- As the user answers, keep asking only what is useful and not tedious.
- When enough context is clear, update MEMORY.md, GOALS.md, and TEAM.md.

Fallback setup file format for Unicore installation:

# Agent Setup: <Agent Name>
Agent ID: ${workspaceId}-<agent-slug>
Role: <short role>
## IDENTITY.md
<full IDENTITY.md content>
## SOUL.md
<full SOUL.md content>
## AGENTS.md
<full AGENTS.md content>
## PROJECT_BRIEF.md
<full PROJECT_BRIEF.md content>

Keep the first message short and natural.`;
}

function slugifyAgentId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `agent-${Date.now().toString(36)}`;
}

function readPromotedWorkspaceAgents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMOTED_WORKSPACE_AGENTS_KEY) ?? "[]") as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function markWorkspaceAgentPromoted(key: string) {
  const promoted = readPromotedWorkspaceAgents();
  promoted.add(key);
  localStorage.setItem(PROMOTED_WORKSPACE_AGENTS_KEY, JSON.stringify([...promoted]));
}

function markAgentDeleted(agentId: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_AGENTS_KEY) ?? "[]") as string[];
    const ids = new Set(Array.isArray(parsed) ? parsed : []);
    ids.add(agentId);
    localStorage.setItem(DELETED_AGENTS_KEY, JSON.stringify([...ids]));
  } catch {
    localStorage.setItem(DELETED_AGENTS_KEY, JSON.stringify([agentId]));
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

function uniqueAgentId(base: string, existingIds: Set<string>) {
  let id = base;
  let i = 2;
  while (existingIds.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  existingIds.add(id);
  return id;
}

function normalizeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPromotedIdentity(workspace: WorkspaceInfo, draft: WorkspaceDraftAgent) {
  return draft.identityMd ?? `# IDENTITY.md - Agent Identity

**Name:** ${draft.name}
**Emoji:** 
**Creature:** specialist agent
**Vibe:** focused workspace specialist

## Workspace
${workspace.name}

## Role
${draft.role ?? "Specialist for this workspace."}
`;
}

function buildPromotedSoul(workspace: WorkspaceInfo, draft: WorkspaceDraftAgent) {
  return draft.soulMd ?? `# SOUL.md

You are ${draft.name}, a specialist agent for the "${workspace.name}" workspace.

## Workspace Context

You belong to the "${workspace.name}" workspace. Read PROJECT_BRIEF.md and SOURCE_SPEC.md before giving project-level answers.

## Role

${draft.role ?? "Use SOURCE_SPEC.md as your primary role definition."}

## Operating Style

- Stay specific to ${workspace.name}.
- Coordinate with the workspace general chat and other linked agents when useful.
- Prefer concrete, ready-to-use outputs.
- Keep durable discoveries in the workspace files when appropriate.

## Source Specification

${draft.content}
`;
}

function buildPromotedAgentsMd(workspace: WorkspaceInfo, draft: WorkspaceDraftAgent) {
  return draft.agentsMd ?? `# ${draft.name}

You are a real OpenClaw specialist agent linked to the "${workspace.name}" workspace.

## Instructions

- Read IDENTITY.md, SOUL.md, PROJECT_BRIEF.md, and SOURCE_SPEC.md.
- Own this specialist role: ${draft.role ?? draft.name}.
- Keep outputs practical and directly useful to the workspace.
- If your task needs another specialist, say which workspace agent should help.
- Do not treat "${workspace.name}" as your own name; it is the workspace/project you serve.
`;
}

function buildPromotedProjectBrief(workspace: WorkspaceInfo, draft: WorkspaceDraftAgent, memory: string, goals: string) {
  return draft.projectBriefMd ?? `# ${workspace.name} Project Brief

## Memory

${memory || "No MEMORY.md yet."}

## Goals

${goals || "No GOALS.md yet."}
`;
}

function NewChatView({
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
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dismissedNewChatSuggestions") ?? "[]") as string[];
      return new Set(saved);
    } catch {
      return new Set();
    }
  });
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const availableAgents = agents.length > 0 ? agents : [];
  const visibleSuggestions = NEW_CHAT_SUGGESTIONS.filter((item) => !dismissedSuggestions.has(item.id));

  const dismissSuggestion = useCallback((id: string) => {
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("dismissedNewChatSuggestions", JSON.stringify([...next]));
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex h-9 shrink-0 items-center border-b border-border px-4"
        style={{ paddingLeft: sidebarCollapsed ? (isFullscreen ? 50 : 110) : undefined, transition: "padding-left 150ms ease" }}
      >
        <span className="text-[13px] font-medium text-text">New chat</span>
      </header>

      <div className="flex flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[820px] flex-col justify-center px-8 pb-[10vh] pt-8">
          <div className="animate-[fadeBlurIn_180ms_ease-out]">
            <h1 className="text-center text-[28px] font-semibold leading-tight tracking-normal text-text">
              Choose an agent to chat with
            </h1>

            {availableAgents.length === 0 && (
              <div className="mt-7 rounded-xl border border-white/[0.06] bg-white/[0.035] px-4 py-6 text-center text-[13px] text-text-muted">
                No agents found yet.
              </div>
            )}

            <div className="mt-7">
              <ChatInput
                onSend={(prompt) => {
                  if (!selectedAgentId) return;
                  onStart(selectedAgentId, prompt);
                }}
                disabled={!engine.connected || !selectedAgentId}
                engine={engine}
                variant="hero"
                contextLabel={selectedAgent ? (selectedAgent.name ?? selectedAgent.id) : "Select an agent"}
                contextEmoji={selectedAgent?.emoji}
                contextAvatar={selectedAgent?.avatar}
                contextIsMain={selectedAgent?.isDefault}
                agentOptions={availableAgents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                placeholder={selectedAgent ? `Give ${selectedAgent.name ?? selectedAgent.id} a task` : "Select an agent first"}
              />
            </div>

            {visibleSuggestions.length > 0 && (
              <div className="mt-4 divide-y divide-white/[0.06]">
                {visibleSuggestions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      className="group flex items-center gap-2 px-4 py-3 text-text-muted transition-colors hover:text-text"
                    >
                      <button
                        onClick={() => selectedAgentId && onStart(selectedAgentId, item.actionPrompt)}
                        disabled={!selectedAgentId}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left text-[13px] disabled:opacity-35"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.text}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissSuggestion(item.id)}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-text-muted/70 opacity-0 transition-all hover:bg-white/[0.14] hover:text-text group-hover:opacity-100"
                        aria-label="Hide suggestion"
                        title="Hide suggestion"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
  onResizeMouseDown,
  onClose,
}: {
  activeKey: string;
  entries: Array<[string, TerminalContextState]>;
  height: number;
  isOpen: boolean;
  disableTransition: boolean;
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
            <div key={key} className="h-full" style={{ display: key === activeKey ? undefined : "none" }}>
              <TerminalPanel initialCommand={state.command} onClose={() => onClose(key)} />
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
  const { workspaces, createWorkspace, linkAgent, unlinkAgent, removeAgentFromWorkspaces, deleteWorkspace, getWorkspaceAgents } = useWorkspaces(agents);
  const { getAgentSessions } = useSessions(engine);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [initialChatPrompt, setInitialChatPrompt] = useState<string | undefined>(undefined);
  const [initialChatPromptHidden, setInitialChatPromptHidden] = useState(false);
  const [showCanvas, setShowCanvas] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"models" | "keys" | "channels" | "skills" | "integrations" | "memory" | "appearance" | "engine" | "general">("models");
  const [showPreview, setShowPreview] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<DetailPanel | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
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
  const [terminalByContext, setTerminalByContext] = useState<Record<string, TerminalContextState>>({});
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem("terminalHeight");
    return saved ? Number(saved) : 300;
  });
  const canvasViewportRef = useRef<Record<string, { x: number; y: number; zoom: number }>>({});
  const dragging = useRef(false);
  const draggingCanvas = useRef(false);
  const draggingTerminal = useRef(false);
  const previousTerminalKeyRef = useRef<string | null>(null);
  const promotingDraftAgentsRef = useRef(false);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const workspaceAgents = getWorkspaceAgents(activeWorkspace);
  const hasWorkspaceChat = activeWorkspace !== null && activeAgentId === null && !showNewChat;
  const defaultAgentId = agents.find((a) => a.isDefault)?.id ?? MAIN_AGENT_ID;
  const activeWorkspaceCoordinatorId = activeWorkspace ? getWorkspaceAgentId(activeWorkspace.id) : null;
  const currentAgentId = activeAgentId ?? activeWorkspaceCoordinatorId ?? defaultAgentId;
  const hasChat = (activeAgentId !== null || hasWorkspaceChat) && !showNewChat;
  const activeTerminalKey = showSettings ? "settings" : activeAgentId ? `agent:${currentAgentId}` : hasWorkspaceChat ? `workspace:${activeWorkspace.id}` : showNewChat ? "new-chat" : "workspace";
  const activeTerminal = terminalByContext[activeTerminalKey];
  const showTerminal = activeTerminal?.visible ?? false;

  const promoteWorkspaceDraftAgents = useCallback(async (workspace: WorkspaceInfo) => {
    if (promotingDraftAgentsRef.current || !engine.connected) return;
    promotingDraftAgentsRef.current = true;
    try {
      const drafts = await listWorkspaceDraftAgents(workspace.id);
      if (drafts.length === 0) return;

      const promoted = readPromotedWorkspaceAgents();
      const configResult = await engine.rpc("config.get", {});
      const hash = (configResult as { hash?: string }).hash ?? "";
      const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
      const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
      const defaults = (agentsConfig.defaults as Record<string, unknown> | undefined) ?? {};
      const defaultModel = (defaults.model as Record<string, unknown> | undefined)?.primary as string | undefined;
      const list = Array.isArray(agentsConfig.list)
        ? [...agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")]
        : [];
      const existingIds = new Set<string>([
        ...agents.map((agent) => agent.id),
        ...list.map((agent) => String(agent.id ?? "")).filter(Boolean),
      ]);
      const home = (await homeDir()).replace(/\/$/, "");
      const idsToLink: string[] = [];
      let changed = false;

      for (const draft of drafts) {
        const promotionKey = `${workspace.id}:${draft.fileName}`;
        const baseId = slugifyAgentId(draft.agentId ?? `${workspace.id}-${draft.id}`);
        const alreadyRegistered = existingIds.has(baseId);
        if (alreadyRegistered) {
          idsToLink.push(baseId);
          markWorkspaceAgentPromoted(promotionKey);
          continue;
        }
        if (promoted.has(promotionKey)) {
          markWorkspaceAgentPromoted(promotionKey);
        }

        const agentId = uniqueAgentId(baseId, existingIds);
        const agentDir = `.openclaw/workspace/${agentId}`;
        const [memory, goals] = await Promise.all([
          readTextFile(`${getWorkspaceDir(workspace.id)}/MEMORY.md`, { baseDir: BaseDirectory.Home }).catch(() => ""),
          readTextFile(`${getWorkspaceDir(workspace.id)}/GOALS.md`, { baseDir: BaseDirectory.Home }).catch(() => ""),
        ]);

        await mkdir(agentDir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
        await writeTextFile(`${agentDir}/IDENTITY.md`, buildPromotedIdentity(workspace, draft), { baseDir: BaseDirectory.Home });
        await writeTextFile(`${agentDir}/SOUL.md`, buildPromotedSoul(workspace, draft), { baseDir: BaseDirectory.Home });
        await writeTextFile(`${agentDir}/AGENTS.md`, buildPromotedAgentsMd(workspace, draft), { baseDir: BaseDirectory.Home });
        await writeTextFile(`${agentDir}/SOURCE_SPEC.md`, draft.sourceSpecMd ?? draft.content, { baseDir: BaseDirectory.Home });
        await writeTextFile(`${agentDir}/PROJECT_BRIEF.md`, buildPromotedProjectBrief(workspace, draft, memory, goals), { baseDir: BaseDirectory.Home });

        list.push({
          id: agentId,
          name: draft.name,
          workspace: `${home}/.openclaw/workspace/${agentId}`,
          ...(defaultModel ? { model: { primary: defaultModel } } : {}),
        });
        idsToLink.push(agentId);
        markWorkspaceAgentPromoted(promotionKey);
        changed = true;
      }

      if (changed) {
        const patch = JSON.stringify({
          agents: {
            ...agentsConfig,
            list,
          },
        });
        await engine.patchConfig(patch, hash).catch(() => {});
      }

      for (const agentId of idsToLink) {
        linkAgent(workspace.id, agentId);
      }
      if (idsToLink.length > 0) {
        setTimeout(() => void refreshAgents(), 900);
        setTimeout(() => void refreshAgents(), 2200);
      }
    } finally {
      promotingDraftAgentsRef.current = false;
    }
  }, [agents, engine, linkAgent, refreshAgents]);

  const ensureWorkspaceCoordinator = useCallback(async (workspace: WorkspaceInfo) => {
    if (!engine.connected) return;
    const agentId = getWorkspaceAgentId(workspace.id);
    const home = (await homeDir()).replace(/\/$/, "");
    const workspacePath = `${home}/${getWorkspaceDir(workspace.id)}`;
    const configResult = await engine.rpc("config.get", {});
    const hash = (configResult as { hash?: string }).hash ?? "";
    const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
    const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
    const defaults = (agentsConfig.defaults as Record<string, unknown> | undefined) ?? {};
    const defaultModel = (defaults.model as Record<string, unknown> | undefined)?.primary as string | undefined;
    const list = Array.isArray(agentsConfig.list)
      ? agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
    const nextAgent = {
      id: agentId,
      name: workspace.name,
      workspace: workspacePath,
      ...(defaultModel ? { model: { primary: defaultModel } } : {}),
    };
    const index = list.findIndex((item) => item.id === agentId);
    const current = index >= 0 ? list[index]! : null;
    const isCurrent = current
      && current.name === nextAgent.name
      && current.workspace === nextAgent.workspace;
    if (!isCurrent) {
      const nextList = [...list];
      if (index >= 0) nextList[index] = { ...current, ...nextAgent };
      else nextList.push(nextAgent);
      await engine.patchConfig(JSON.stringify({ agents: { ...agentsConfig, list: nextList } }), hash).catch(() => {});
      await upsertAgentInLocalConfig(nextAgent).catch(() => {});
      setTimeout(() => void refreshAgents(), 700);
      setTimeout(() => void refreshAgents(), 1800);
    }
  }, [engine, refreshAgents]);

  const openTerminal = useCallback((command?: string) => {
    setTerminalByContext((prev) => {
      const current = prev[activeTerminalKey];
      return {
        ...prev,
        [activeTerminalKey]: {
          ...current,
          visible: true,
          mounted: true,
          command: command ?? current?.command,
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
      const cmd = (e as CustomEvent).detail?.command;
      openTerminal(cmd);
    }
    window.addEventListener("xcloud-open-terminal", handleOpenTerminal);
    return () => window.removeEventListener("xcloud-open-terminal", handleOpenTerminal);
  }, [openTerminal]);

  useEffect(() => {
    if (!activeWorkspace) return;
    void ensureWorkspaceCoordinator(activeWorkspace).catch(() => {});
    void promoteWorkspaceDraftAgents(activeWorkspace);
    const interval = window.setInterval(() => void promoteWorkspaceDraftAgents(activeWorkspace), 2500);
    return () => window.clearInterval(interval);
  }, [activeWorkspace, ensureWorkspaceCoordinator, promoteWorkspaceDraftAgents]);

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

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingCanvas.current || !cardRef.current) return;
      const cardRect = cardRef.current.getBoundingClientRect();
      const newWidth = Math.min(cardRect.width - 200, Math.max(200, cardRect.right - ev.clientX));
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
    setActiveAgentId(id);
    setActiveSessionKey(null);
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
  }, []);

  const handleSelectWorkspace = useCallback((id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    setActiveWorkspaceId(id);
    setActiveAgentId(null);
    setActiveSessionKey(`agent:${getWorkspaceAgentId(id)}:general`);
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
    setShowCanvas(true);
    setCanvasExpanded(false);
    if (!workspace) return;

    void ensureWorkspaceCoordinator(workspace).catch(() => {});
    const setupKey = `xcloudWorkspaceSetupPrompted:v2:${id}`;
    void workspaceHasContext(id).then((hasContext) => {
      if (hasContext) return;
      localStorage.setItem(setupKey, "true");
      setInitialChatPrompt(buildWorkspaceSetupPrompt(workspace.name, workspace.id));
      setInitialChatPromptHidden(true);
    });
  }, [ensureWorkspaceCoordinator, workspaces]);

  const handleLeaveWorkspace = useCallback(() => {
    setActiveWorkspaceId(null);
    setActiveAgentId(null);
    setActiveSessionKey(null);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
  }, []);

  const handleCreateWorkspace = useCallback((name: string) => {
    const workspace = createWorkspace(name);
    if (workspace) handleSelectWorkspace(workspace.id);
  }, [createWorkspace, handleSelectWorkspace]);

  const handleCreateAgentInWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const prompt = `The workspace is "${workspace?.name ?? workspaceId}". It is a workspace/project, not an agent. Help me create a new specialist agent that belongs to this workspace. Ask only what you need about the specialist role, then write a complete agent setup file in this workspace at agents/<agent-slug>.md. Include "Agent ID: ${workspaceId}-<agent-slug>" and exact sections "## IDENTITY.md", "## SOUL.md", "## AGENTS.md", and "## PROJECT_BRIEF.md" with the full content you want installed for the real OpenClaw agent. Unicore will automatically install that setup file as a real agent and link it to the "${workspace?.name ?? workspaceId}" workspace.`;
    setActiveWorkspaceId(workspaceId);
    setActiveAgentId(null);
    setActiveSessionKey(`agent:${getWorkspaceAgentId(workspaceId)}:general`);
    setInitialChatPrompt(prompt);
    setInitialChatPromptHidden(false);
    setShowNewChat(false);
    setShowSettings(false);
    setShowPreview(false);
    if (workspace) void ensureWorkspaceCoordinator(workspace).catch(() => {});
  }, [ensureWorkspaceCoordinator, workspaces]);

  const handleOpenWorkspaceContext = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const dir = getWorkspaceDir(workspaceId);
    const files = await Promise.all(["AGENTS.md", "TEAM.md", "GOALS.md", "MEMORY.md"].map(async (file) => {
      const content = await readTextFile(`${dir}/${file}`, { baseDir: BaseDirectory.Home }).catch(() => `No ${file}`);
      return `# ${file}\n\n${content}`;
    }));
    setNodeDetail({
      title: workspace?.name ? `${workspace.name} Context` : "Workspace Context",
      type: "markdown",
      content: files.join("\n\n---\n\n"),
    });
  }, [workspaces]);

  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    const deletedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
    const coordinatorId = getWorkspaceAgentId(workspaceId);
    markAgentDeleted(coordinatorId);
    void removeAgentFromLocalConfig(coordinatorId).catch(() => {});
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
  }, [activeWorkspaceId, deleteWorkspace, nodeDetail?.title, workspaces]);

  const handleAppTool: AppToolHandler = useCallback(async (request) => {
    if (request.name === "create_workspace") {
      const workspace = createWorkspace(request.args.name ?? "");
      if (!workspace) {
        return {
          message: "No pude crear el workspace porque el nombre está vacío.",
          output: "Workspace creation skipped: empty name.",
        };
      }
      window.setTimeout(() => handleSelectWorkspace(workspace.id), 450);
      void ensureWorkspaceCoordinator(workspace).catch(() => {});
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
      setActiveAgentId(null);
      setActiveSessionKey(`agent:${getWorkspaceAgentId(workspaceId)}:general`);
    }
  }, [activeAgentId, activeWorkspaceId, unlinkAgent]);

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent || agent.isDefault || agent.id === MAIN_AGENT_ID) return;

    markAgentDeleted(agentId);
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

    try {
      const configResult = await engine.rpc("config.get", {});
      const hash = (configResult as { hash?: string }).hash ?? "";
      const config = ((configResult as { config?: Record<string, unknown> }).config ?? configResult) as Record<string, unknown>;
      const agentsConfig = (config.agents as Record<string, unknown> | undefined) ?? {};
      const list = Array.isArray(agentsConfig.list)
        ? agentsConfig.list.filter((item) => {
          if (!item || typeof item !== "object") return false;
          return String((item as Record<string, unknown>).id ?? "") !== agentId;
        })
        : [];
      await engine.patchConfig(JSON.stringify({ agents: { ...agentsConfig, list } }), hash).catch(() => {});
    } catch {
      // The gateway may restart or be temporarily unavailable while config changes apply.
    }

    await removeAgentFromLocalConfig(agentId).catch(() => {});

    await Promise.all([
      remove(`.openclaw/workspace/${agentId}`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {}),
      remove(`.openclaw/agents/${agentId}`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {}),
    ]);

    if (activeAgentId === agentId) {
      setActiveAgentId(null);
      setActiveSessionKey(null);
      setShowCanvas(false);
      setNodeDetail(null);
    }
    setTimeout(() => void refreshAgents(), 300);
    setTimeout(() => void refreshAgents(), 1400);
  }, [activeAgentId, agents, engine, refreshAgents, removeAgentFromWorkspaces]);

  const handleSelectSession = useCallback((agentId: string, sessionKey: string) => {
    setActiveAgentId(agentId);
    setActiveWorkspaceId(null);
    setActiveSessionKey(sessionKey);
    setShowNewChat(false);
    setInitialChatPrompt(undefined);
    setInitialChatPromptHidden(false);
    setShowSettings(false);
    setShowPreview(false);
  }, []);

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
    setShowCanvas(false);
    setCanvasExpanded(false);
  }, []);

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

  const showThirdPanel = showPreview || showSettings || showCanvas;
  const terminalContextChanged = previousTerminalKeyRef.current !== null && previousTerminalKeyRef.current !== activeTerminalKey;
  const mountedTerminalEntries = Object.entries(terminalByContext).filter(([, state]) => state.mounted);

  useEffect(() => {
    previousTerminalKeyRef.current = activeTerminalKey;
  }, [activeTerminalKey]);

  return (
    <div className="flex flex-col h-full">
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

      {/* 1. Sidebar — agent list */}
      <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarCollapsed ? 0 : panelWidth, backgroundColor: "rgba(30,30,30,0.30)", overflow: "hidden", transition: isDragging ? "none" : "width 150ms ease" }}>
        <div className="flex flex-1 min-h-0 flex-col" style={{ minWidth: panelWidth }}>
          {showSettings ? (
            /* Settings navigation */
            <div className="flex h-full flex-col">
              <div className={`px-3 pb-3 ${isFullscreen ? "pt-12" : "pt-14"}`}>
                <button
                  onClick={() => setShowSettings(false)}
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
              agents={agents}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              activeAgentId={activeAgentId}
              onSelectAgent={handleSelectAgent}
              onSelectWorkspace={handleSelectWorkspace}
              onLeaveWorkspace={handleLeaveWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              onAddAgentToWorkspace={linkAgent}
              onRemoveAgentFromWorkspace={handleRemoveAgentFromWorkspace}
              onCreateAgentInWorkspace={handleCreateAgentInWorkspace}
              onOpenWorkspaceContext={handleOpenWorkspaceContext}
              onDeleteAgent={handleDeleteAgent}
              onDeleteWorkspace={handleDeleteWorkspace}
              onSelectSession={handleSelectSession}
              getAgentSessions={getAgentSessions}
              isFullscreen={isFullscreen}
              onRefresh={refreshAgents}
              onOpenSettings={() => { setShowSettings(true); setSettingsSection("integrations"); }}
              onSearch={() => setShowCommandPalette(true)}
              onNewChat={handleNewChat}
            />
          )}
        </div>

        {/* Sidebar footer — hidden when settings open or detail open */}
        <div className="shrink-0 px-3 py-1.5" style={{ minWidth: panelWidth, display: showSettings || nodeDetail ? "none" : undefined }}>
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setShowSettings(!showSettings); setShowPreview(false); }}
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
          {showSettings ? (
            /* Settings + Terminal (vertical split) */
            <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
              <div className="flex flex-1 min-h-0 justify-center overflow-y-auto">
                <div className="w-full max-w-2xl px-6 py-6">
                  <SettingsPanel
                    engine={engine}
                    section={settingsSection}
                    onPreviewOnboarding={() => setShowOnboardingPreview(true)}
                    onOpenTerminal={(command) => {
                      openTerminal(command);
                    }}
                  />
                </div>
              </div>
              <TerminalDock
                activeKey={activeTerminalKey}
                entries={mountedTerminalEntries}
                height={terminalHeight}
                isOpen={showTerminal}
                disableTransition={isDragging || terminalContextChanged}
                onResizeMouseDown={onTerminalMouseDown}
                onClose={(key) => {
                  setTerminalByContext((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], visible: false, mounted: false, command: undefined },
                  }));
                }}
              />
            </div>
          ) : (
            <>
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          {/* Chat area */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden" style={{ display: canvasExpanded ? "none" : undefined }}>
            {/* Chat area */}
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              {hasChat ? (
                <ChatPanel
                  key={hasWorkspaceChat ? `${activeWorkspace!.id}-${activeSessionKey ?? "general"}` : `${currentAgentId}-${activeSessionKey ?? "default"}`}
                  engine={engine}
                  agentId={currentAgentId}
                  sessionKey={hasWorkspaceChat ? (activeSessionKey ?? `agent:${getWorkspaceAgentId(activeWorkspace!.id)}:general`) : (activeSessionKey ?? undefined)}
                  agentName={hasWorkspaceChat ? activeWorkspace!.name : agents.find((a) => a.id === currentAgentId)?.name ?? currentAgentId}
                  titleName={hasWorkspaceChat ? activeWorkspace!.name : undefined}
                  workspaceName={hasWorkspaceChat ? activeWorkspace!.name : undefined}
                  agents={agents}
                  onSwitchAgent={(id) => setActiveAgentId(id)}
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
                <NewChatView
                  agents={agents}
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
              transition: canvasExpanded ? "none" : "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div className="flex-1 min-h-0" style={{ minWidth: canvasExpanded ? undefined : canvasWidth }}>
              {/* Canvas — always mounted, hidden when preview active */}
              <div className="h-full" style={{ display: showPreview ? "none" : undefined, visibility: canvasTransitioning ? "hidden" : "visible" }}>
                {hasWorkspaceChat && activeWorkspace ? (
                  <WorkspaceCanvas
                    key={`workspace:${activeWorkspace.id}`}
                    workspace={activeWorkspace}
                    agents={workspaceAgents}
                    onSelectAgent={handleSelectAgent}
                  />
                ) : (
                  <AgentCanvas
                    key={currentAgentId}
                    engine={engine}
                    agentId={currentAgentId}
                    agentAvatar={agents.find(a => a.id === currentAgentId)?.avatar}
                    savedViewport={canvasViewportRef.current[currentAgentId]}
                    onViewportChange={(vp) => { canvasViewportRef.current[currentAgentId] = vp; }}
                    onNodeDetail={setNodeDetail}
                    onCanvasSettings={() => setShowCanvasSettings(!showCanvasSettings)}
                  />
                )}
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
            isOpen={showTerminal}
            disableTransition={isDragging || terminalContextChanged}
            onResizeMouseDown={onTerminalMouseDown}
            onClose={(key) => {
              setTerminalByContext((prev) => ({
                ...prev,
                [key]: { ...prev[key], visible: false, mounted: false, command: undefined },
              }));
            }}
          />
            </>
          )}
        </div>
      </div>

      {/* Canvas controls — fixed top right */}
      {!showSettings && !showPreview && (
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
            onClick={() => { setShowCanvas(!showCanvas); if (canvasExpanded) setCanvasExpanded(false); }}
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

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        agents={agents}
        getAgentSessions={getAgentSessions}
        onSelectAgent={(id) => { handleSelectAgent(id); }}
        onSelectSession={handleSelectSession}
        onOpenSettings={(section) => {
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
