import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentInfo } from "./use-agents";
import { BaseDirectory, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

export interface WorkspaceInfo {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceDraftAgent {
  id: string;
  agentId?: string;
  name: string;
  fileName: string;
  path: string;
  content: string;
  role?: string;
  identityMd?: string;
  soulMd?: string;
  agentsMd?: string;
  projectBriefMd?: string;
  sourceSpecMd?: string;
}

const STORAGE_KEY = "xcloudWorkspaces";
const MEMORY_PLACEHOLDER = "Write what this workspace is about here.";
const GOALS_PLACEHOLDER = "- Define the purpose of this workspace.";

export function getWorkspaceAgentId(workspaceId: string) {
  return `workspace-${workspaceId}`;
}

export function getWorkspaceDir(workspaceId: string) {
  return `.openclaw/workspace/${getWorkspaceAgentId(workspaceId)}`;
}

function readWorkspaces(): WorkspaceInfo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as WorkspaceInfo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWorkspaces(workspaces: WorkspaceInfo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  window.dispatchEvent(new CustomEvent("xcloud-workspaces-changed"));
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

function formatAgentLine(agent: AgentInfo) {
  const name = agent.name ?? agent.id;
  const role = agent.isDefault ? "main coordinator" : "specialist";
  return `- ${name} (${agent.id}) - ${role}`;
}

function buildWorkspaceAgentsMd(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const teamSummary = agents.length > 0
    ? agents.map(formatAgentLine).join("\n")
    : "- No linked specialist agents yet.";

  return `# ${workspace.name} Workspace

This is a Unicore workspace. Treat this folder as the canonical context for the project "${workspace.name}".

## Workspace Contract

- You are working inside the "${workspace.name}" workspace.
- Use this workspace context before answering project-level questions.
- Keep work organized around the linked agents and their roles.
- When the user asks to create, modify, or organize a workspace, update the app-visible workspace structure when tools are available and document the decision here.
- If a task belongs to a specialist, say which linked agent should own it and why.
- When you learn durable project context, update MEMORY.md or TEAM.md instead of relying on chat history.

## Workspace Setup Mode

If MEMORY.md or GOALS.md still contains placeholder setup text, treat the general chat as a workspace setup conversation.

- You are the normal OpenClaw main agent, with normal OpenClaw setup, agent creation, automation, channel, integration, and operator behavior.
- This file only adds a workspace overlay. It does not replace your normal OpenClaw behavior.
- Start by asking the user what this workspace is for in a short, natural way.
- Ask only the next useful question or two at a time. Avoid long forms.
- Gather enough context to understand the business/project, audience, goals, constraints, preferred working style, and specialist roles that would help.
- As durable information becomes clear, update MEMORY.md, GOALS.md, and TEAM.md.
- When the user asks to create agents, tools, automations, channels, schedules, or integrations, use normal OpenClaw mechanisms whenever available.
- Any specialist agents you create should be real OpenClaw agents and should be organized under this workspace.
- If direct OpenClaw config/tools are unavailable from this session, create a fallback setup file at agents/<agent-slug>.md. Unicore watches that folder and promotes each setup file into a real OpenClaw agent.
- If the user asks for recurring work, create or propose the real automation/cron schedule.
- If a task needs an external app like X/Twitter, verify whether the integration is connected. If it is not connected, ask the user to connect it. Never publish externally without explicit approval unless the user configured auto-publish.
- In the general chat, act as the workspace coordinator: route work, create/adjust agents, keep context current, and help the user organize the workspace.

Fallback setup file format for Unicore installation:

# Agent Setup: <Agent Name>
Agent ID: ${workspace.id}-<agent-slug>
Role: <short role>

## IDENTITY.md
<full IDENTITY.md content>

## SOUL.md
<full SOUL.md content>

## AGENTS.md
<full AGENTS.md content>

## PROJECT_BRIEF.md
<full PROJECT_BRIEF.md content>

## SOURCE_SPEC.md
<optional extra source notes>

## Linked Agents

The current generated team map lives in TEAM.md. Summary at creation/sync time:

${teamSummary}

## Files

- AGENTS.md - operating instructions for this workspace
- MEMORY.md - durable project memory
- TEAM.md - linked agents and responsibilities
- GOALS.md - current priorities and backlog
`;
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
    ? agents.map((agent) => `## ${agent.name ?? agent.id}\n\n- Agent id: ${agent.id}\n- Role: ${agent.isDefault ? "Main coordinator" : "Specialist"}\n- Use when: Define this agent's responsibility inside ${workspace.name}.\n`).join("\n")
    : "No linked agents yet.\n";

  return `# ${workspace.name} Team

${team}`;
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
    if (existing.trim() && !existing.includes("This is a Unicore workspace. Treat this folder as the canonical context")) {
      return;
    }
  } catch {
    // File does not exist yet.
  }
  await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
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
  await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
}

async function syncWorkspaceFiles(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const dir = getWorkspaceDir(workspace.id);
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await mkdir(`${dir}/memory`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});

  await writeManagedAgentsFile(`${dir}/AGENTS.md`, buildWorkspaceAgentsMd(workspace, agents));
  await writeManagedTeamFile(`${dir}/TEAM.md`, buildWorkspaceTeamMd(workspace, agents));
  await writeIfMissing(`${dir}/MEMORY.md`, buildWorkspaceMemoryMd(workspace));
  await writeIfMissing(`${dir}/GOALS.md`, buildWorkspaceGoalsMd(workspace));
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

function stripMarkdownTitle(value: string) {
  return value
    .replace(/^Agent:\s*/i, "")
    .replace(/\s+[—-]\s+.+$/, "")
    .trim();
}

function extractSetupSection(content: string, title: string) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${title.toLowerCase()}`);
  if (start === -1) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim() || undefined;
}

function parseDraftAgent(fileName: string, content: string, dir: string): WorkspaceDraftAgent {
  const title = content.match(/^#\s+(?:Agent Setup:\s*)?(.+)$/im)?.[1]?.trim();
  const agentId = content.match(/^Agent ID:\s*([a-z0-9][a-z0-9-]*)\s*$/im)?.[1]?.trim();
  const explicitRole = content.match(/^Role:\s*(.+)$/im)?.[1]?.trim();
  const role = content.match(/##\s+Rol\s*\n+([\s\S]*?)(?:\n##|\n#|$)/i)?.[1]?.trim()
    ?? content.match(/##\s+Role\s*\n+([\s\S]*?)(?:\n##|\n#|$)/i)?.[1]?.trim()
    ?? content.match(/##\s+Purpose\s*\n+([\s\S]*?)(?:\n##|\n#|$)/i)?.[1]?.trim();
  const fallbackName = fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ");
  return {
    id: fileName.replace(/\.md$/i, ""),
    agentId,
    name: stripMarkdownTitle(title ?? fallbackName),
    fileName,
    path: `${dir}/agents/${fileName}`,
    content,
    role: explicitRole ?? (role ? role.split("\n")[0]?.replace(/^-\s*/, "").trim() : undefined),
    identityMd: extractSetupSection(content, "IDENTITY.md"),
    soulMd: extractSetupSection(content, "SOUL.md"),
    agentsMd: extractSetupSection(content, "AGENTS.md"),
    projectBriefMd: extractSetupSection(content, "PROJECT_BRIEF.md"),
    sourceSpecMd: extractSetupSection(content, "SOURCE_SPEC.md"),
  };
}

export async function listWorkspaceDraftAgents(workspaceId: string): Promise<WorkspaceDraftAgent[]> {
  const dir = getWorkspaceDir(workspaceId);
  const agentsDir = `${dir}/agents`;
  const entries = await readDir(agentsDir, { baseDir: BaseDirectory.Home }).catch(() => []);
  const files = entries
    .map((entry) => entry.name)
    .filter((name): name is string => Boolean(name) && name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(files.map(async (fileName) => {
    const content = await readTextFile(`${agentsDir}/${fileName}`, { baseDir: BaseDirectory.Home }).catch(() => "");
    return parseDraftAgent(fileName, content, dir);
  }));
}

export function useWorkspaces(agents: AgentInfo[]) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(() => readWorkspaces());

  const persist = useCallback((updater: (prev: WorkspaceInfo[]) => WorkspaceInfo[]) => {
    setWorkspaces((prev) => {
      const next = updater(prev);
      writeWorkspaces(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const refresh = () => setWorkspaces(readWorkspaces());
    window.addEventListener("storage", refresh);
    window.addEventListener("xcloud-workspaces-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("xcloud-workspaces-changed", refresh);
    };
  }, []);

  const createWorkspace = useCallback((name: string, agentIds: string[] = []) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const mainId = agents.find((a) => a.isDefault)?.id ?? agents[0]?.id ?? "main";
    const cleanAgentIds = Array.from(new Set([mainId, ...agentIds])).filter(Boolean);
    const prev = readWorkspaces();
    const now = Date.now();
    const created: WorkspaceInfo = {
      id: uniqueId(trimmed, prev),
      name: trimmed,
      agentIds: cleanAgentIds,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...prev, created];
    writeWorkspaces(next);
    setWorkspaces(next);
    void syncWorkspaceFiles(created, agents.filter((agent) => cleanAgentIds.includes(agent.id)));
    return created;
  }, [agents]);

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
    void remove(getWorkspaceDir(workspaceId), { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  }, [persist]);

  const getWorkspaceAgents = useCallback((workspace: WorkspaceInfo | null | undefined) => {
    if (!workspace) return [];
    return workspace.agentIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter(Boolean) as AgentInfo[];
  }, [agents]);

  useEffect(() => {
    for (const workspace of workspaces) {
      void syncWorkspaceFiles(workspace, getWorkspaceAgents(workspace));
    }
  }, [workspaces, getWorkspaceAgents]);

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
      const inferredAgentIds = agents
        .filter((agent) => !agent.isDefault && agent.id.startsWith(`${workspace.id}-`))
        .map((agent) => agent.id);
      const agentIds = Array.from(new Set([...workspace.agentIds, ...inferredAgentIds]));
      if (agentIds.length === workspace.agentIds.length) return workspace;
      changed = true;
      return { ...workspace, agentIds, updatedAt: Date.now() };
    });
    if (!changed) return;
    setWorkspaces(next);
    writeWorkspaces(next);
  }, [agents, workspaces]);

  return {
    workspaces,
    workspacesWithAgents,
    createWorkspace,
    linkAgent,
    unlinkAgent,
    removeAgentFromWorkspaces,
    deleteWorkspace,
    getWorkspaceAgents,
  };
}
