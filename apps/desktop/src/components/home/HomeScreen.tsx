import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentInfo } from "@/hooks/use-agents";
import type { SessionInfo } from "@/hooks/use-sessions";
import type { WorkspaceInfo } from "@/hooks/use-workspaces";
import { Search, MessageSquarePlus, Download, MoreHorizontal, Pin, Boxes, Plus, ArrowLeft, GitBranch, Link2, UserPlus, CornerDownRight, X, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmojiPicker } from "../ui/EmojiPicker";
import { AgentAvatar } from "../ui/AgentAvatar";
import { updateAgentEmoji } from "@/lib/update-identity";
import gmailIcon from "@/assets/setup-icons/gmail.svg";
import slackIcon from "@/assets/setup-icons/slack.svg";
import notionIcon from "@/assets/setup-icons/notion.svg";
import { Letters } from "@kumailnanji/letters";
import orbVideo from "@/assets/setup-icons/orb-video.mp4";

interface HomeScreenProps {
  agents: AgentInfo[];
  workspaces?: WorkspaceInfo[];
  activeWorkspaceId?: string | null;
  activeAgentId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectWorkspace?: (id: string) => void;
  onLeaveWorkspace?: () => void;
  onCreateWorkspace?: (name: string) => void;
  onAddAgentToWorkspace?: (workspaceId: string, agentId: string) => void;
  onCreateAgentInWorkspace?: (workspaceId: string) => void;
  onOpenWorkspaceContext?: (workspaceId: string) => void;
  onSelectSession?: (agentId: string, sessionKey: string) => void;
  getAgentSessions?: (agentId: string) => SessionInfo[];
  isFullscreen?: boolean;
  onRefresh?: () => Promise<void>;
  onOpenSettings?: () => void;
  onSearch?: () => void;
  onNewChat?: () => void;
}

function SetupGuide({ mainAgent, agents, onSelectAgent, onOpenSettings }: { mainAgent: AgentInfo; agents: AgentInfo[]; onSelectAgent: (id: string) => void; onOpenSettings?: () => void }) {
  const [viewIdx, setViewIdx] = useState(0);

  const hasName = !!(mainAgent.name && mainAgent.name !== mainAgent.id);
  const hasIntegrations = (() => { try { return JSON.parse(localStorage.getItem("composioConnected") ?? "[]").length > 0; } catch { return false; } })();
  const hasSubAgents = agents.length > 1;

  const completed = (hasName ? 1 : 0) + (hasIntegrations ? 1 : 0) + (hasSubAgents ? 1 : 0);
  if (completed >= 3) return null;

  const steps = [
    { done: hasName, title: "Name your agent", description: "Ask it to pick a name and personality", action: () => {
      onSelectAgent(mainAgent.id);
      setTimeout(() => window.dispatchEvent(new CustomEvent("xcloud-prefill-prompt", {
        detail: "Hey! I'd like to finish setting up your identity. Can you pick a name for yourself, choose an emoji, and describe your personality? Update your IDENTITY.md with a name, creature type, vibe, and emoji that feels right for you."
      })), 200);
    }},
    { done: hasIntegrations, title: "Connect your apps", description: "Link Gmail, Notion, Slack and more", action: () => onOpenSettings?.() },
    { done: hasSubAgents, title: "Create a sub-agent", description: "Ask your agent to create a specialist", action: () => {
      onSelectAgent(mainAgent.id);
      setTimeout(() => window.dispatchEvent(new CustomEvent("xcloud-prefill-prompt", {
        detail: "I want you to create a new sub-agent. It should be a specialized assistant — pick a role that would be useful (like a researcher, coder, writer, or data analyst). Give it a unique name, personality, and configure its IDENTITY.md, SOUL.md, and workspace. Make it good!"
      })), 200);
    }},
  ];

  const step = steps[viewIdx] ?? steps[0]!;

  return (
    <div className="shrink-0 px-3 pb-3">
      <button
        onClick={() => setViewIdx((viewIdx + 1) % 3)}
        className="group relative w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-left transition-all hover:bg-white/[0.05]"
        style={{ transform: "rotate(0deg)" }}
      >
        {/* Icon */}
        <div className="mb-2">
          {viewIdx === 0 ? (
            <Letters key="letters-name" text="name me" autoPlay loop loopPauseMs={1000} color="white" strokeWidth={1.5} className="h-8 w-auto" />
          ) : viewIdx === 1 ? (
            <div key={`apps-${viewIdx}`} className="flex items-center -space-x-1">
              {[gmailIcon, slackIcon, notionIcon].map((icon, i) => (
                <img key={i} src={icon} alt="" className="h-8 w-8 rounded-lg"
                  style={{ animation: `bounceIn${i + 1} 0.4s ${i * 0.1}s ease-out both` }} />
              ))}
            </div>
          ) : (
            <div key={`orb-${viewIdx}`} className="h-8 w-8 rounded-full overflow-hidden border-2 border-white" style={{ animation: "rollIn 0.6s ease-out both" }}>
              <video src={orbVideo} autoPlay loop muted playsInline className="h-full w-full object-cover" />
            </div>
          )}
        </div>

        {/* Text */}
        <div className="relative inline-block">
          <p className={cn("text-[14px] font-bold leading-tight", step.done ? "text-white/50" : "text-white")}>
            {step.title}
          </p>
          {step.done && (
            <svg className="absolute top-1/2 left-0 w-full h-3 -translate-y-1/2 pointer-events-none" viewBox="0 0 120 10" preserveAspectRatio="none">
              <path
                d="M0 5 Q10 0 20 5 T40 5 T60 5 T80 5 T100 5 T120 5"
                fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"
                strokeDasharray="130" strokeDashoffset="130"
              >
                <animate attributeName="stroke-dashoffset" from="130" to="0" dur="0.6s" fill="freeze" />
              </path>
            </svg>
          )}
        </div>
        <p className="text-[12px] text-white/60 mt-1.5 leading-snug">
          {step.description}
        </p>

        {/* Circular progress */}
        <div className="absolute top-3.5 right-4">
          <svg className="h-7 w-7 -rotate-90" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
            <circle cx="14" cy="14" r="11" fill="none" stroke="white" strokeWidth="2"
              strokeDasharray={2 * Math.PI * 11} strokeDashoffset={2 * Math.PI * 11 - (completed / 3) * 2 * Math.PI * 11}
              strokeLinecap="round" className="transition-all duration-500" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white/50">{completed}/3</span>
        </div>
      </button>

      {/* Action */}
      <button
        onClick={step.action}
        className="w-full mt-2 bg-white/10 py-2.5 text-[12px] text-white font-medium hover:bg-white/15 transition-colors"
        style={{ borderRadius: "12px", WebkitBorderRadius: "12px" }}
      >
        {viewIdx === 1 ? "Open Settings" : "Open chat"}
      </button>
    </div>
  );
}

export function HomeScreen({
  agents,
  workspaces = [],
  activeWorkspaceId,
  activeAgentId,
  onSelectAgent,
  onSelectWorkspace,
  onLeaveWorkspace,
  onCreateWorkspace,
  onAddAgentToWorkspace,
  onCreateAgentInWorkspace,
  onOpenWorkspaceContext,
  isFullscreen,
  onRefresh,
  onOpenSettings,
  onSearch,
  onNewChat,
}: HomeScreenProps) {
  const mainAgent = agents.find((a) => a.isDefault) ?? agents[0];
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinnedAgents") ?? "[]"); } catch { return []; }
  });
  const togglePin = (id: string) => {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      localStorage.setItem("pinnedAgents", JSON.stringify(next));
      return next;
    });
  };
  const pinnedAgents = agents.filter(a => a.id !== mainAgent?.id && pinnedIds.includes(a.id));
  const otherAgents = agents.filter(a => a.id !== mainAgent?.id && !pinnedIds.includes(a.id));
  const [menuAgentId, setMenuAgentId] = useState<string | null>(null);
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null);
  const [showWorkspaceCreator, setShowWorkspaceCreator] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [showAddAgent, setShowAddAgent] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceAgents = activeWorkspace
    ? activeWorkspace.agentIds.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean) as AgentInfo[]
    : [];
  const importableAgents = activeWorkspace
    ? agents.filter((agent) => !activeWorkspace.agentIds.includes(agent.id))
    : [];

  // Close menu on click outside
  useEffect(() => {
    if (!menuAgentId) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuAgentId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuAgentId]);

  useEffect(() => {
    if (!showWorkspaceCreator && !showAddAgent) return;
    function handleClick(e: MouseEvent) {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setShowWorkspaceCreator(false);
        setShowAddAgent(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showWorkspaceCreator, showAddAgent]);

  const handleEmojiSelect = useCallback(async (agentId: string, emoji: string) => {
    setShowEmojiFor(null);
    setMenuAgentId(null);
    await updateAgentEmoji(agentId, emoji);
    onRefresh?.();
  }, [onRefresh]);

  const renderAgent = (agent: AgentInfo, isMain: boolean) => {
    return (
      <div key={agent.id}>
        <div className="flex items-center">
          {/* Agent row */}
          <button
            onClick={() => onSelectAgent(agent.id)}
            className={cn(
              "group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 ml-1 text-left transition-colors",
              activeAgentId === agent.id ? "bg-white/8" : "hover:bg-white/6 active:bg-white/8",
            )}
          >
            <AgentAvatar emoji={agent.emoji} avatar={agent.avatar} isMain={isMain} />
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-text">
                {agent.name ?? agent.id}
              </span>
            </div>
            {/* Status dot — hidden on hover, replaced by 3 dots */}
            <div className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full group-hover:hidden",
              agent.status === "active" ? "bg-emerald-400" : "bg-text-muted/40",
            )} />
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuAgentId(menuAgentId === agent.id ? null : agent.id); }}
                className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              {/* Agent menu */}
              {menuAgentId === agent.id && (
                <div ref={menuRef} className="absolute right-0 top-full mt-1 z-30 w-40 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out] p-1">
                  {!isMain && (
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(agent.id); setMenuAgentId(null); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-hover"
                    >
                      <Pin className="h-3.5 w-3.5" />
                      {pinnedIds.includes(agent.id) ? "Unpin" : "Pin"}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowEmojiFor(agent.id); setMenuAgentId(null); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-hover"
                  >
                    Change emoji
                  </button>
                </div>
              )}

              {/* Emoji picker */}
              {showEmojiFor === agent.id && (
                <div className="absolute right-0 top-full mt-1 z-30">
                  <EmojiPicker
                    agentId={agent.id}
                    onSelect={(emoji) => handleEmojiSelect(agent.id, emoji)}
                    onSelectImage={() => { setShowEmojiFor(null); onRefresh?.(); }}
                    onClose={() => setShowEmojiFor(null)}
                  />
                </div>
              )}
            </div>
          </button>
        </div>
      </div>
    );
  };

  const submitWorkspace = () => {
    const name = workspaceName.trim();
    if (!name) return;
    onCreateWorkspace?.(name);
    setWorkspaceName("");
    setShowWorkspaceCreator(false);
  };

  if (activeWorkspace) {
    return (
      <div className="flex h-full flex-col">
        <div className={`px-3 pb-3 ${isFullscreen ? "pt-12" : "pt-14"}`}>
          <button
            onClick={onLeaveWorkspace}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text-muted transition-colors hover:bg-white/6 hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-[13px] font-medium">Back to agents</span>
          </button>
        </div>

        <div className="px-3 pb-3">
          <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/[0.08] text-text">
                <Boxes className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">{activeWorkspace.name}</div>
                <div className="text-[10px] text-text-muted">{workspaceAgents.length} linked agents</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5">
          <button
            onClick={() => onSelectWorkspace?.(activeWorkspace.id)}
            className={cn(
              "group ml-1 flex w-[calc(100%-4px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
              !activeAgentId ? "bg-white/8" : "hover:bg-white/6",
            )}
          >
            <MessageSquarePlus className="h-4 w-4 text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">General chat</span>
          </button>

          <button
            onClick={() => onOpenWorkspaceContext?.(activeWorkspace.id)}
            className="group ml-1 flex w-[calc(100%-4px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/6"
          >
            <FileText className="h-4 w-4 text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">Context files</span>
          </button>

          <div className="px-2.5 pb-1 pt-4">
            <span className="text-[12px] font-medium text-text/90">Team tree</span>
          </div>

          <div className="space-y-1">
            <div className="ml-4 border-l border-white/[0.10] pl-3">
              {workspaceAgents.map((agent) => (
                <div key={agent.id} className="relative py-0.5">
                  <div className="absolute -left-3 top-1/2 h-px w-2 bg-white/[0.10]" />
                  <button
                    onClick={() => onSelectAgent(agent.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                      activeAgentId === agent.id ? "bg-white/8" : "hover:bg-white/6",
                    )}
                  >
                    <AgentAvatar emoji={agent.emoji} avatar={agent.avatar} isMain={agent.isDefault} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">{agent.name ?? agent.id}</span>
                    {agent.isDefault && <GitBranch className="h-3.5 w-3.5 text-text-muted/70" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative shrink-0 px-3 pb-2" ref={workspaceMenuRef}>
          {showAddAgent && (
            <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-[14px] border border-border bg-surface p-1.5 shadow-2xl animate-[slideUp_120ms_ease-out]">
              <button
                onClick={() => {
                  onCreateAgentInWorkspace?.(activeWorkspace.id);
                  setShowAddAgent(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-text transition-colors hover:bg-white/6"
              >
                <UserPlus className="h-3.5 w-3.5 text-text-muted" />
                Create new agent
              </button>
              {importableAgents.length > 0 && <div className="my-1 h-px bg-white/[0.06]" />}
              {importableAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    onAddAgentToWorkspace?.(activeWorkspace.id, agent.id);
                    setShowAddAgent(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-text transition-colors hover:bg-white/6"
                >
                  <Link2 className="h-3.5 w-3.5 text-text-muted" />
                  <AgentAvatar emoji={agent.emoji} avatar={agent.avatar} isMain={agent.isDefault} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{agent.name ?? agent.id}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowAddAgent((v) => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-white/10 px-3 py-2 text-[12px] font-medium text-text transition-colors hover:bg-white/15"
          >
            <Plus className="h-3.5 w-3.5" />
            Add agent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top actions — padded for macOS traffic lights */}
      <div className={`flex flex-col gap-1 px-3 pb-2 ${isFullscreen ? "pt-12" : "pt-14"}`}>
        <button onClick={onNewChat} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <MessageSquarePlus className="h-4 w-4" />
          <span className="text-[13px] font-medium">New chat</span>
        </button>
        <button onClick={onSearch} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <Search className="h-4 w-4" />
          <span className="text-[13px] font-medium">Search</span>
        </button>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-white/6">
          <Download className="h-4 w-4" />
          <span className="text-[13px] font-medium">Import agent</span>
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {/* Main agent */}
        {mainAgent && (
          <>
            <div className="px-2.5 pb-1 pt-3">
              <span className="text-[12px] font-medium text-text/90">Main</span>
            </div>
            <div className="space-y-0.5">
              {renderAgent(mainAgent, true)}
            </div>

          </>
        )}

        {/* Pinned agents */}
        {pinnedAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">Pinned</span>
            </div>
            <div className="space-y-0.5">
              {pinnedAgents.map((agent) => renderAgent(agent, false))}
            </div>
          </>
        )}

        {/* Other agents */}
        {otherAgents.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4">
              <span className="text-[12px] font-medium text-text/90">Agents</span>
            </div>
            <div className="space-y-0.5">
              {otherAgents.map((agent) => renderAgent(agent, false))}
            </div>
          </>
        )}

        <div className="px-2.5 pb-1 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-text/90">Workspaces</span>
            <div className="relative" ref={workspaceMenuRef}>
              <button
                onClick={() => setShowWorkspaceCreator((v) => !v)}
                className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/8 hover:text-text"
                title="Create workspace"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {showWorkspaceCreator && (
                <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-[14px] border border-border bg-surface p-2 shadow-2xl animate-[slideUp_120ms_ease-out]">
                  <div className="flex items-center gap-2 rounded-[10px] bg-white/[0.06] px-2.5 py-2">
                    <Search className="h-3.5 w-3.5 text-text-muted" />
                    <input
                      autoFocus
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitWorkspace();
                        if (e.key === "Escape") setShowWorkspaceCreator(false);
                      }}
                      placeholder="Workspace name..."
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-muted"
                    />
                    {workspaceName && (
                      <button onClick={() => setWorkspaceName("")} className="text-text-muted hover:text-text">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={submitWorkspace}
                    disabled={!workspaceName.trim()}
                    className="mt-2 flex w-full items-center justify-center rounded-[10px] bg-white px-3 py-2 text-[12px] font-medium text-black transition-opacity disabled:opacity-40"
                  >
                    Create workspace
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-0.5">
          {workspaces.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[11px] text-text-muted/70">No workspaces yet</div>
          ) : (
            workspaces.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => onSelectWorkspace?.(workspace.id)}
                className="group ml-1 flex w-[calc(100%-4px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/6"
              >
                <Boxes className="h-4 w-4 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-text">{workspace.name}</span>
                </div>
                <CornerDownRight className="h-3.5 w-3.5 text-text-muted/50 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>

      </div>

      {/* Setup guide — bottom */}
      {mainAgent && (
        <SetupGuide mainAgent={mainAgent} agents={agents} onSelectAgent={onSelectAgent} onOpenSettings={onOpenSettings} />
      )}
    </div>
  );
}
