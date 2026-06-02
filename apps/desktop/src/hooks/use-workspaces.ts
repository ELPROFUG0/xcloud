import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo } from "./use-agents";
import type { BrowserEngine } from "@/lib/engine";
import { BaseDirectory, mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { engineScopedStorageKey } from "@/lib/engine-storage";
import {
  deleteOpenClawAgent,
  readEngineHomeText,
  readOpenClawAgentFile,
  upsertOpenClawAgent,
  writeEngineHomeText,
  writeOpenClawAgentFile,
} from "@/lib/openclaw-store";

export interface WorkspaceInfo {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "xcloudWorkspaces";
const DURABLE_WORKSPACES_PATH = ".openclaw/xcloud-workspaces.json";
const MEMORY_PLACEHOLDER = "Write what this workspace is about here.";
const GOALS_PLACEHOLDER = "- Define the purpose of this workspace.";
const GLOBAL_WORKSPACES_START = "<!-- UNICORE_WORKSPACES_START -->";
const GLOBAL_WORKSPACES_END = "<!-- UNICORE_WORKSPACES_END -->";
const WORKSPACE_MAIN_START = "<!-- UNICORE_WORKSPACE_MAIN_START -->";
const WORKSPACE_MAIN_END = "<!-- UNICORE_WORKSPACE_MAIN_END -->";

export function getWorkspaceAgentId(workspaceId: string) {
  if (workspaceId.startsWith("workspace-")) return workspaceId;
  return `workspace-${workspaceId}`;
}

export function getWorkspaceDir(workspaceId: string) {
  return `.openclaw/workspace/${getWorkspaceAgentId(workspaceId)}`;
}

function normalizeWorkspace(value: unknown): WorkspaceInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) return null;
  const agentIds = Array.isArray(record.agentIds)
    ? Array.from(new Set(record.agentIds.map(String).filter(Boolean)))
    : [];
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
    ? record.createdAt
    : Date.now();
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : createdAt;
  return { id, name, agentIds, createdAt, updatedAt };
}

function normalizeWorkspaces(value: unknown): WorkspaceInfo[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { workspaces?: unknown }).workspaces)
      ? (value as { workspaces: unknown[] }).workspaces
      : [];
  const seen = new Set<string>();
  return raw
    .map(normalizeWorkspace)
    .filter((workspace): workspace is WorkspaceInfo => {
      if (!workspace || seen.has(workspace.id)) return false;
      seen.add(workspace.id);
      return true;
    });
}

function mergeWorkspaces(primary: WorkspaceInfo[], secondary: WorkspaceInfo[]) {
  const byId = new Map<string, WorkspaceInfo>();
  for (const workspace of [...secondary, ...primary]) {
    const existing = byId.get(workspace.id);
    if (!existing) {
      byId.set(workspace.id, workspace);
      continue;
    }
    byId.set(workspace.id, {
      ...existing,
      ...workspace,
      agentIds: Array.from(new Set([...existing.agentIds, ...workspace.agentIds])),
      createdAt: Math.min(existing.createdAt, workspace.createdAt),
      updatedAt: Math.max(existing.updatedAt, workspace.updatedAt),
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function readWorkspaces(storageKey: string): WorkspaceInfo[] {
  try {
    return normalizeWorkspaces(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  } catch {
    return [];
  }
}

function writeCachedWorkspaces(storageKey: string, workspaces: WorkspaceInfo[]) {
  localStorage.setItem(storageKey, JSON.stringify(workspaces));
}

async function readDurableWorkspaces(engine: BrowserEngine) {
  const raw = await readEngineHomeText(engine, DURABLE_WORKSPACES_PATH, "");
  if (!raw.trim()) return [];
  try {
    return normalizeWorkspaces(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeDurableWorkspaces(engine: BrowserEngine, workspaces: WorkspaceInfo[]) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    workspaces,
  };
  await writeEngineHomeText(engine, DURABLE_WORKSPACES_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function slugifyName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `workspace-${Date.now().toString(36)}`;
}

function uniqueId(name: string, existing: WorkspaceInfo[]) {
  const base = slugifyName(name);
  let id = base;
  let i = 2;
  while (existing.some((w) => w.id === id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  return id;
}

function workspaceAgentPrefixes(workspace: WorkspaceInfo) {
  return Array.from(new Set([
    workspace.id,
    workspace.id.replace(/^workspace-/, ""),
    slugifyName(workspace.name),
    slugifyName(workspace.name).replace(/^workspace-/, ""),
  ].filter(Boolean)));
}

function isWorkspaceSpecialistAgent(agent: AgentInfo, workspace: WorkspaceInfo) {
  if (agent.isDefault || agent.id.startsWith("workspace-")) return false;
  return workspaceAgentPrefixes(workspace).some((prefix) => agent.id.startsWith(`${prefix}-`));
}

function workspaceNameFromCoordinator(agent: AgentInfo, workspaceId: string) {
  const raw = (agent.name ?? workspaceId)
    .replace(/\s+Main$/i, "")
    .replace(/^workspace[-_\s]+/i, "")
    .trim();
  return raw || workspaceId.replace(/^workspace-/, "").replace(/-/g, " ");
}

function inferWorkspacesFromAgents(agents: AgentInfo[]) {
  const now = Date.now();
  return agents
    .filter((agent) => agent.id.startsWith("workspace-"))
    .map((agent) => {
      const id = agent.id.replace(/^workspace-/, "");
      const name = workspaceNameFromCoordinator(agent, id);
      const agentIds = agents
        .filter((candidate) => isWorkspaceSpecialistAgent(candidate, { id, name, agentIds: [], createdAt: now, updatedAt: now }))
        .map((candidate) => candidate.id);
      return {
        id,
        name,
        agentIds,
        createdAt: now,
        updatedAt: now,
      };
    });
}

function formatAgentLine(agent: AgentInfo) {
  const name = agent.name ?? agent.id;
  const role = agent.id.startsWith("workspace-") ? "workspace coordinator" : agent.isDefault ? "main coordinator" : "specialist";
  return `- ${name} (${agent.id}) - ${role}`;
}

async function readHomeText(path: string) {
  return readTextFile(path, { baseDir: BaseDirectory.Home }).catch(() => "");
}

async function writeHomeTextIfChanged(path: string, content: string) {
  const current = await readHomeText(path);
  if (current === content) return false;
  await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  return true;
}

function stripMarkedBlock(content: string, start: string, end: string) {
  const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "g"), "\n").trim();
}

function stripUnicoreBlocks(content: string) {
  return stripMarkedBlock(
    stripMarkedBlock(content, GLOBAL_WORKSPACES_START, GLOBAL_WORKSPACES_END),
    WORKSPACE_MAIN_START,
    WORKSPACE_MAIN_END,
  ).trim();
}

function fallbackMainAgentsMd() {
  return `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Session Startup

Use runtime-provided startup context first.

## Memory

You wake up fresh each session. These files are your continuity. Capture what matters in workspace files instead of relying only on chat history.

## Tools

Use the available OpenClaw tools directly when they fit the task.`;
}

async function readGlobalMainAgentsBase() {
  const globalAgents = await readHomeText(".openclaw/workspace/AGENTS.md");
  const clean = stripUnicoreBlocks(globalAgents);
  return clean || fallbackMainAgentsMd();
}

function buildWorkspaceMainOverlay(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const teamSummary = agents.length > 0
    ? agents.map(formatAgentLine).join("\n")
    : "- No linked specialist agents yet.";

  return `${WORKSPACE_MAIN_START}

## Unicore Workspace Main

You are the workspace-scoped Main agent for "${workspace.name}". Behave like the normal OpenClaw Main agent, with the same setup, tool use, agent creation, automation, channel, integration, memory, and delegation behavior, but scope durable context and team decisions to this workspace.

Important separation:

- "${workspace.name}" is a workspace/project, not a specialist agent.
- Your agent id is ${getWorkspaceAgentId(workspace.id)}.
- Your durable workspace folder is ~/.openclaw/workspace/${getWorkspaceAgentId(workspace.id)}/.
- Do not use or claim the global Main agent's identity, MEMORY.md, GOALS.md, or TEAM.md as your own.
- Keep this workspace's memory, goals, team, agents, automations, and decisions separate from global Main and other workspaces.

Workspace operating rules:

- Use this folder as the canonical context for "${workspace.name}".
- When the user asks to create agents, tools, automations, channels, schedules, or integrations, use normal OpenClaw mechanisms whenever available.
- When the user asks for a team or specialist agents, reason from the project first. Ask at most one or two concise clarification questions only if the request is too vague.
- When enough context is clear, create real persistent specialists with the workspace_agent_create tool. Do not stop at only writing TEAM.md, MEMORY.md, or local notes.
- Specialist agent ids must start with "${workspace.id}-" so Unicore can attach them to this workspace tree.
- For every specialist, provide tailored IDENTITY.md, SOUL.md, AGENTS.md, PROJECT_BRIEF.md, and SOURCE_SPEC.md content through workspace_agent_create. Do not use a fixed template unless it genuinely fits the project.
- If the user asks a specialist to have its own UI, interface, preview, or app, set createUi: true in workspace_agent_create. That UI belongs in the specialist agent's own OpenClaw agent folder, never in this workspace main UI repo.
- If a task belongs to a specialist, delegate or route it to the linked agent when OpenClaw session/subagent tools are available; otherwise say clearly which linked agent should own it.
- If the user asks for recurring work, create or propose the real automation/cron schedule.
- If a task needs an external app like X/Twitter, verify whether the integration is connected. If it is not connected, ask the user to connect it. Never publish externally without explicit approval unless the user configured auto-publish.

Workspace setup mode:

If MEMORY.md or GOALS.md still contains placeholder setup text, treat the general chat as a workspace setup conversation.

- Start by asking the user what this workspace is for in a short, natural way.
- Ask only the next useful question or two at a time. Avoid long forms.
- Gather enough context to understand the business/project, audience, goals, constraints, preferred working style, and specialist roles that would help.
- As durable information becomes clear, update MEMORY.md, GOALS.md, and TEAM.md.

Linked agents:

The current generated team map lives in TEAM.md. Summary at creation/sync time:

${teamSummary}

Workspace files:

- AGENTS.md - operating instructions for this workspace
- MEMORY.md - durable project memory
- TEAM.md - linked agents and responsibilities
- GOALS.md - current priorities and backlog
${WORKSPACE_MAIN_END}
`;
}

async function buildWorkspaceAgentsMd(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const base = await readGlobalMainAgentsBase();
  return `${base}\n\n${buildWorkspaceMainOverlay(workspace, agents)}`;
}

function buildWorkspaceMemoryMd(workspace: WorkspaceInfo) {
  return `# ${workspace.name} Memory

Durable context for this workspace.

## Project Summary

Write what this workspace is about here.

## Decisions

- Created workspace "${workspace.name}".

## Notes

- Keep important business, product, technical, and user-preference context here.
`;
}

function buildWorkspaceTeamMd(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const team = agents.length > 0
    ? agents.map((agent) => `## ${agent.name ?? agent.id}\n\n- Agent id: ${agent.id}\n- Role: ${agent.id === getWorkspaceAgentId(workspace.id) ? "Workspace Main coordinator" : "Specialist"}\n- Use when: Define this agent's responsibility inside ${workspace.name}.\n`).join("\n")
    : "No linked agents yet.\n";

  return `# ${workspace.name} Team

${team}`;
}

function buildWorkspaceIdentityMd(workspace: WorkspaceInfo) {
  return `# IDENTITY.md - Who Am I?

**Name:** ${workspace.name} Main
**Creature:** workspace-scoped OpenClaw main agent
**Vibe:** capable project coordinator
**Emoji:**
**Avatar:**

## Workspace

${workspace.name}

You are the Main-style coordinator for this workspace. You are not the global Main agent.
`;
}

function buildWorkspaceGoalsMd(workspace: WorkspaceInfo) {
  return `# ${workspace.name} Goals

## Active Goals

- Define the purpose of this workspace.

## Backlog

- Add linked specialist agents.
- Clarify responsibilities and workflows.
`;
}

async function writeIfMissing(path: string, content: string) {
  try {
    const existing = await readTextFile(path, { baseDir: BaseDirectory.Home });
    if (existing.trim()) return;
  } catch {
    // File does not exist yet.
  }
  await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
}

async function writeManagedAgentsFile(path: string, content: string) {
  try {
    const existing = await readTextFile(path, { baseDir: BaseDirectory.Home });
    const isManaged = existing.includes(WORKSPACE_MAIN_START)
      || existing.includes("This is a Unicore workspace. Treat this folder as the canonical context")
      || existing.includes("workspace_agent_create tool")
      || existing.includes("# AGENTS.md - Your Workspace")
      || existing.includes("_Fill this in during your first conversation._");
    if (existing.trim() && !isManaged) {
      return;
    }
  } catch {
    // File does not exist yet.
  }
  await writeHomeTextIfChanged(path, content);
}

async function writeManagedIdentityFile(path: string, content: string) {
  return writeHomeTextIfChanged(path, content);
}

async function writeManagedMainCompanionFile(path: string, sourcePath: string) {
  const source = await readHomeText(sourcePath);
  if (!source.trim()) return;

  const existing = await readHomeText(path);
  if (existing.trim()) return;
  await writeHomeTextIfChanged(path, source);
}

async function writeManagedTeamFile(path: string, content: string) {
  try {
    const existing = await readTextFile(path, { baseDir: BaseDirectory.Home });
    const isOldGeneratedTeam = existing.includes("Use when: Define this agent's responsibility")
      || existing.includes("No linked agents yet.");
    if (existing.trim() && !isOldGeneratedTeam) {
      return;
    }
  } catch {
    // File does not exist yet.
  }
  await writeHomeTextIfChanged(path, content);
}

function firstUsefulLine(markdown: string, placeholders: string[]) {
  const placeholderSet = new Set(placeholders.map((item) => item.toLowerCase()));
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .find((line) => (
      line
      && !line.startsWith("#")
      && !line.startsWith("<!--")
      && !placeholderSet.has(line.toLowerCase())
      && !/^created workspace\b/i.test(line)
    ));
}

async function getWorkspaceSummary(workspace: WorkspaceInfo) {
  const dir = getWorkspaceDir(workspace.id);
  const memory = await readHomeText(`${dir}/MEMORY.md`);
  const goals = await readHomeText(`${dir}/GOALS.md`);
  return {
    summary: firstUsefulLine(memory, [MEMORY_PLACEHOLDER]) ?? "No durable summary yet.",
    focus: firstUsefulLine(goals, [GOALS_PLACEHOLDER]) ?? "No active focus yet.",
  };
}

async function buildGlobalWorkspacesIndex(workspaces: WorkspaceInfo[], getAgents: (workspace: WorkspaceInfo) => AgentInfo[]) {
  const sections = await Promise.all(workspaces.map(async (workspace) => {
    const agents = getAgents(workspace);
    const specialists = agents.filter((agent) => agent.id !== getWorkspaceAgentId(workspace.id));
    const { summary, focus } = await getWorkspaceSummary(workspace);
    const linked = specialists.length > 0
      ? specialists.map((agent) => agent.name ?? agent.id).join(", ")
      : "No linked specialists yet.";

    return `## ${workspace.name}

- Workspace id: ${workspace.id}
- Coordinator agent: ${getWorkspaceAgentId(workspace.id)}
- Context path: ~/.openclaw/workspace/${getWorkspaceAgentId(workspace.id)}
- Summary: ${summary}
- Current focus: ${focus}
- Linked specialists: ${linked}
- Routing: when the user wants detailed work on this project, open or route to the workspace coordinator instead of absorbing the full workspace context into global Main.`;
  }));

  return `# Workspaces Index

This file is a lightweight index for the global Main agent.

Use it to know which Unicore workspaces exist, what each project is broadly about, and which workspace coordinator should handle detailed work. Do not load every workspace's full MEMORY.md/GOALS.md/TEAM.md by default; use the coordinator path only when the user asks to work inside that workspace.

${sections.length > 0 ? sections.join("\n\n") : "No workspaces created yet."}
`;
}

function buildGlobalWorkspaceOverlay() {
  return `${GLOBAL_WORKSPACES_START}

## Unicore Workspaces

You are the global Main agent. Keep your own global context separate from workspace-specific context.

- Read WORKSPACES.md as a lightweight index of the user's workspaces.
- Use that index to know what projects exist and which coordinator agent owns each project.
- Do not treat a workspace's MEMORY.md, GOALS.md, or TEAM.md as your own memory.
- When the user asks to continue or do detailed work in a workspace, route them to/open that workspace coordinator instead of mixing its context into global Main.
- If the user asks to create, list, or delete workspaces, use the Unicore workspace tools when available.

${GLOBAL_WORKSPACES_END}
`;
}

async function syncGlobalWorkspaceFiles(workspaces: WorkspaceInfo[], getAgents: (workspace: WorkspaceInfo) => AgentInfo[]) {
  await mkdir(".openclaw/workspace", { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await writeHomeTextIfChanged(".openclaw/workspace/WORKSPACES.md", await buildGlobalWorkspacesIndex(workspaces, getAgents));

  const globalAgents = await readHomeText(".openclaw/workspace/AGENTS.md");
  if (!globalAgents.trim()) return;
  const base = stripMarkedBlock(globalAgents, GLOBAL_WORKSPACES_START, GLOBAL_WORKSPACES_END);
  await writeHomeTextIfChanged(".openclaw/workspace/AGENTS.md", `${base.trim()}\n\n${buildGlobalWorkspaceOverlay()}`);
}

async function syncWorkspaceFiles(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const dir = getWorkspaceDir(workspace.id);
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await mkdir(`${dir}/memory`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});

  const identityChanged = await writeManagedIdentityFile(`${dir}/IDENTITY.md`, buildWorkspaceIdentityMd(workspace));
  await writeManagedAgentsFile(`${dir}/AGENTS.md`, await buildWorkspaceAgentsMd(workspace, agents));
  await writeManagedMainCompanionFile(`${dir}/SOUL.md`, ".openclaw/workspace/SOUL.md");
  await writeManagedMainCompanionFile(`${dir}/USER.md`, ".openclaw/workspace/USER.md");
  await writeManagedMainCompanionFile(`${dir}/TOOLS.md`, ".openclaw/workspace/TOOLS.md");
  await writeManagedTeamFile(`${dir}/TEAM.md`, buildWorkspaceTeamMd(workspace, agents));
  await writeIfMissing(`${dir}/MEMORY.md`, buildWorkspaceMemoryMd(workspace));
  await writeIfMissing(`${dir}/GOALS.md`, buildWorkspaceGoalsMd(workspace));
  return identityChanged;
}

function buildWorkspaceSoulMd(workspace: WorkspaceInfo) {
  return `# SOUL.md

You are the workspace-scoped Main coordinator for "${workspace.name}".

Be practical, concise, and project-aware. Keep this workspace separate from the user's global Main agent and from other workspaces.
`;
}

async function syncRemoteWorkspaceFiles(engine: BrowserEngine, workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const agentId = getWorkspaceAgentId(workspace.id);
  await upsertOpenClawAgent(engine, {
    agentId,
    name: `${workspace.name} Main`,
    workspace: `~/.openclaw/workspace/${agentId}`,
  });

  const mainAgents = stripUnicoreBlocks(await readOpenClawAgentFile(engine, "main", "AGENTS.md"));
  const agentsContent = `${(mainAgents || fallbackMainAgentsMd()).trim()}\n\n${buildWorkspaceMainOverlay(workspace, agents)}`;
  const existingMemory = await readOpenClawAgentFile(engine, agentId, "MEMORY.md");

  await Promise.all([
    writeOpenClawAgentFile(engine, agentId, "IDENTITY.md", buildWorkspaceIdentityMd(workspace)),
    writeOpenClawAgentFile(engine, agentId, "SOUL.md", buildWorkspaceSoulMd(workspace)),
    writeOpenClawAgentFile(engine, agentId, "AGENTS.md", agentsContent),
    writeOpenClawAgentFile(engine, agentId, "TEAM.md", buildWorkspaceTeamMd(workspace, agents)),
    writeOpenClawAgentFile(engine, agentId, "GOALS.md", buildWorkspaceGoalsMd(workspace)),
    !existingMemory.trim()
      ? writeOpenClawAgentFile(engine, agentId, "MEMORY.md", buildWorkspaceMemoryMd(workspace))
      : Promise.resolve(),
  ]);
}

export async function workspaceHasContext(workspaceId: string) {
  const dir = getWorkspaceDir(workspaceId);
  const [memory, goals] = await Promise.all([
    readTextFile(`${dir}/MEMORY.md`, { baseDir: BaseDirectory.Home }).catch(() => ""),
    readTextFile(`${dir}/GOALS.md`, { baseDir: BaseDirectory.Home }).catch(() => ""),
  ]);
  const memoryText = memory.trim();
  const goalsText = goals.trim();
  const hasMemory = memoryText.length > 0 && !memoryText.includes(MEMORY_PLACEHOLDER);
  const hasGoals = goalsText.length > 0 && !goalsText.includes(GOALS_PLACEHOLDER);
  return hasMemory || hasGoals;
}

export function useWorkspaces(agents: AgentInfo[], engine: BrowserEngine) {
  const storageKey = engineScopedStorageKey(STORAGE_KEY, engine);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(() => readWorkspaces(storageKey));
  const remoteSyncKeysRef = useRef(new Set<string>());
  const hydratedScopesRef = useRef(new Set<string>());

  const persist = useCallback((updater: (prev: WorkspaceInfo[]) => WorkspaceInfo[]) => {
    setWorkspaces((prev) => {
      const next = updater(prev);
      writeCachedWorkspaces(storageKey, next);
      void writeDurableWorkspaces(engine, next).catch(() => {});
      return next;
    });
  }, [engine, storageKey]);

  useEffect(() => {
    const refresh = () => setWorkspaces(readWorkspaces(storageKey));
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
    };
  }, [storageKey]);

  useEffect(() => {
    setWorkspaces(readWorkspaces(storageKey));
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    const scope = engine.storageScope;
    const hydrationKey = `${scope}:${agents.map((agent) => `${agent.id}:${agent.name ?? ""}`).sort().join("|")}`;
    if (hydratedScopesRef.current.has(hydrationKey)) return;
    hydratedScopesRef.current.add(hydrationKey);

    (async () => {
      const cached = readWorkspaces(storageKey);
      const durable = await readDurableWorkspaces(engine);
      const inferred = inferWorkspacesFromAgents(agents);
      const merged = mergeWorkspaces(mergeWorkspaces(durable, cached), inferred);
      if (cancelled || merged.length === 0) return;
      setWorkspaces((current) => {
        const next = mergeWorkspaces(merged, current);
        writeCachedWorkspaces(storageKey, next);
        void writeDurableWorkspaces(engine, next).catch(() => {});
        return next;
      });
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [agents, engine, storageKey]);

  const createWorkspace = useCallback((name: string, agentIds: string[] = []) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const cleanAgentIds = Array.from(new Set(agentIds))
      .filter((id) => {
        const agent = agents.find((item) => item.id === id);
        return id && !id.startsWith("workspace-") && !agent?.isDefault;
      });
    const prev = readWorkspaces(storageKey);
    const now = Date.now();
    const created: WorkspaceInfo = {
      id: uniqueId(trimmed, prev),
      name: trimmed,
      agentIds: cleanAgentIds,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...prev, created];
    writeCachedWorkspaces(storageKey, next);
    void writeDurableWorkspaces(engine, next).catch(() => {});
    setWorkspaces(next);
    if (engine.isRemote) {
      void syncRemoteWorkspaceFiles(engine, created, agents.filter((agent) => cleanAgentIds.includes(agent.id))).catch(() => {});
    } else {
      void syncWorkspaceFiles(created, agents.filter((agent) => cleanAgentIds.includes(agent.id)))
        .then((identityChanged) => {
          if (identityChanged) window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
        });
    }
    return created;
  }, [agents, engine, storageKey]);

  const linkAgent = useCallback((workspaceId: string, agentId: string) => {
    persist((prev) => prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      if (workspace.agentIds.includes(agentId)) return workspace;
      return { ...workspace, agentIds: [...workspace.agentIds, agentId], updatedAt: Date.now() };
    }));
  }, [persist]);

  const unlinkAgent = useCallback((workspaceId: string, agentId: string) => {
    persist((prev) => prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const nextAgentIds = workspace.agentIds.filter((id) => id !== agentId);
      return { ...workspace, agentIds: nextAgentIds, updatedAt: Date.now() };
    }));
  }, [persist]);

  const removeAgentFromWorkspaces = useCallback((agentId: string) => {
    persist((prev) => prev.map((workspace) => {
      if (!workspace.agentIds.includes(agentId)) return workspace;
      return {
        ...workspace,
        agentIds: workspace.agentIds.filter((id) => id !== agentId),
        updatedAt: Date.now(),
      };
    }));
  }, [persist]);

  const deleteWorkspace = useCallback((workspaceId: string) => {
    persist((prev) => prev.filter((workspace) => workspace.id !== workspaceId));
    localStorage.removeItem(`xcloudWorkspaceSetupPrompted:${workspaceId}`);
    localStorage.removeItem(`xcloudWorkspaceSetupPrompted:v2:${workspaceId}`);
    if (engine.isRemote) {
      void deleteOpenClawAgent(engine, getWorkspaceAgentId(workspaceId))
        .finally(() => window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed")));
    } else {
      void remove(getWorkspaceDir(workspaceId), { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
    }
  }, [engine, persist]);

  const getWorkspaceAgents = useCallback((workspace: WorkspaceInfo | null | undefined) => {
    if (!workspace) return [];
    const coordinator = agents.find((agent) => agent.id === getWorkspaceAgentId(workspace.id));
    const linkedAgents = agents.filter((agent) => {
      if (agent.isDefault) return false;
      if (agent.id === coordinator?.id) return false;
      if (workspace.agentIds.includes(agent.id)) return true;
      return isWorkspaceSpecialistAgent(agent, workspace);
    });
    return coordinator ? [coordinator, ...linkedAgents] : linkedAgents;
  }, [agents]);

  const ensureWorkspaceReady = useCallback(async (workspace: WorkspaceInfo) => {
    const workspaceAgents = getWorkspaceAgents(workspace);
    if (engine.isRemote) {
      await syncRemoteWorkspaceFiles(engine, workspace, workspaceAgents);
      window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
      return;
    }
    const identityChanged = await syncWorkspaceFiles(workspace, workspaceAgents);
    if (identityChanged) window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
  }, [engine, getWorkspaceAgents]);

  useEffect(() => {
    if (engine.isRemote) {
      for (const workspace of workspaces) {
        const workspaceAgents = getWorkspaceAgents(workspace);
        const syncKey = JSON.stringify({
          engine: engine.storageScope,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          agentIds: workspaceAgents.map((agent) => `${agent.id}:${agent.name ?? ""}`).sort(),
          updatedAt: workspace.updatedAt,
        });
        if (remoteSyncKeysRef.current.has(syncKey)) continue;
        remoteSyncKeysRef.current.add(syncKey);
        void syncRemoteWorkspaceFiles(engine, workspace, workspaceAgents).catch(() => {
          remoteSyncKeysRef.current.delete(syncKey);
        });
      }
      return;
    }
    for (const workspace of workspaces) {
      void syncWorkspaceFiles(workspace, getWorkspaceAgents(workspace))
        .then((identityChanged) => {
          if (identityChanged) window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
        });
    }
    void syncGlobalWorkspaceFiles(workspaces, getWorkspaceAgents);
  }, [engine, workspaces, getWorkspaceAgents]);

  const workspacesWithAgents = useMemo(() => (
    workspaces.map((workspace) => ({
      ...workspace,
      agents: getWorkspaceAgents(workspace),
    }))
  ), [workspaces, getWorkspaceAgents]);

  useEffect(() => {
    if (workspaces.length === 0 || agents.length === 0) return;
    let changed = false;
    const next = workspaces.map((workspace) => {
      const currentAgentIds = workspace.agentIds.filter((id) => {
        const agent = agents.find((item) => item.id === id);
        return !id.startsWith("workspace-") && !agent?.isDefault;
      });
      if (currentAgentIds.length !== workspace.agentIds.length) changed = true;
      const inferredAgentIds = agents
        .filter((agent) => isWorkspaceSpecialistAgent(agent, workspace))
        .map((agent) => agent.id);
      const agentIds = Array.from(new Set([...currentAgentIds, ...inferredAgentIds]));
      const sameAgentIds = agentIds.length === workspace.agentIds.length
        && agentIds.every((agentId, index) => agentId === workspace.agentIds[index]);
      if (sameAgentIds) return workspace;
      changed = true;
      return { ...workspace, agentIds, updatedAt: Date.now() };
    });
    if (!changed) return;
    setWorkspaces(next);
    writeCachedWorkspaces(storageKey, next);
    void writeDurableWorkspaces(engine, next).catch(() => {});
  }, [agents, engine, storageKey, workspaces]);

  return {
    workspaces,
    workspacesWithAgents,
    createWorkspace,
    linkAgent,
    unlinkAgent,
    removeAgentFromWorkspaces,
    deleteWorkspace,
    getWorkspaceAgents,
    ensureWorkspaceReady,
  };
}
