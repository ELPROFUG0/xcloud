import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentInfo } from "./use-agents";
import { BaseDirectory, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface WorkspaceInfo {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "xcloudWorkspaces";

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

async function syncWorkspaceFiles(workspace: WorkspaceInfo, agents: AgentInfo[]) {
  const dir = getWorkspaceDir(workspace.id);
  await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await mkdir(`${dir}/memory`, { baseDir: BaseDirectory.Home, recursive: true }).catch(() => {});

  await writeIfMissing(`${dir}/AGENTS.md`, buildWorkspaceAgentsMd(workspace, agents));
  await writeTextFile(`${dir}/TEAM.md`, buildWorkspaceTeamMd(workspace, agents), { baseDir: BaseDirectory.Home });
  await writeIfMissing(`${dir}/MEMORY.md`, buildWorkspaceMemoryMd(workspace));
  await writeIfMissing(`${dir}/GOALS.md`, buildWorkspaceGoalsMd(workspace));
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

  return {
    workspaces,
    workspacesWithAgents,
    createWorkspace,
    linkAgent,
    unlinkAgent,
    getWorkspaceAgents,
  };
}
