import { invoke } from "@tauri-apps/api/core";
import { homeDir, tempDir } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AgentInfo } from "@/hooks/use-agents";

const PACKAGE_SCHEMA_VERSION = 1;
const PACKAGE_EXTENSION = "xcloud-agent";

const SAFE_AGENT_FILES = [
  "IDENTITY.md",
  "SOUL.md",
  "AGENTS.md",
  "MEMORY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "PROJECT_BRIEF.md",
  "SOURCE_SPEC.md",
  "TEAM.md",
  "GOALS.md",
  "README.md",
];

const COPY_EXCLUDES = [
  ".git",
  ".DS_Store",
  ".env",
  ".env.*",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  ".cache",
  "coverage",
  "logs",
  "*.log",
];

type AgentPackageManifest = {
  schema: number;
  format: "xcloud-agent";
  createdAt: string;
  agent: {
    id: string;
    name: string;
    model?: string;
  };
  ui: {
    included: boolean;
    source?: "internal" | "linked-repo";
  };
};

type LocalConfigAgent = {
  id: string;
  name?: string;
  workspace?: string;
  model?: { primary?: string } | string;
};

type LocalConfig = {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: LocalConfigAgent[];
  };
};

export type ImportedAgentPackage = {
  id: string;
  name: string;
  workspace: string;
  model?: { primary?: string };
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runShell(cmd: string) {
  return invoke<string>("run_shell", { cmd });
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "agent";
}

function ensurePackagePath(path: string) {
  return path.endsWith(`.${PACKAGE_EXTENSION}`) ? path : `${path}.${PACKAGE_EXTENSION}`;
}

function escapeJsonForShell(value: unknown) {
  return shellQuote(`${JSON.stringify(value, null, 2)}\n`);
}

function rsyncExcludeArgs() {
  return COPY_EXCLUDES.map((item) => `--exclude ${shellQuote(item)}`).join(" ");
}

async function pathExists(path: string) {
  const result = await runShell(`[ -e ${shellQuote(path)} ] && printf yes || true`).catch(() => "");
  return result.trim() === "yes";
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  const raw = await readTextFile(path).catch(() => runShell(`cat ${shellQuote(path)} 2>/dev/null`).catch(() => ""));
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readLocalConfig(): Promise<LocalConfig> {
  const raw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home }).catch(() => "{}");
  try {
    return JSON.parse(raw) as LocalConfig;
  } catch {
    return {};
  }
}

async function writeLocalConfig(config: LocalConfig) {
  await writeTextFile(".openclaw/openclaw.json", `${JSON.stringify(config, null, 2)}\n`, { baseDir: BaseDirectory.Home });
}

function uniqueAgentId(baseId: string, existingIds: Set<string>) {
  const base = slugify(baseId);
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function getAgentWorkspace(agent: AgentInfo, home: string) {
  if (agent.workspace?.startsWith("/")) return agent.workspace.replace(/\/$/, "");
  if (agent.id === "main") return `${home}/.openclaw/workspace`;
  return `${home}/.openclaw/workspace/${agent.id}`;
}

async function readUiConfig(workspacePath: string): Promise<{ repoPath?: string } | null> {
  return readJsonFile<{ repoPath?: string }>(`${workspacePath}/ui-config.json`);
}

async function inferUiSource(workspacePath: string, uiConfig: { repoPath?: string } | null) {
  const internalUiPath = `${workspacePath}/ui`;
  if (uiConfig?.repoPath && await pathExists(uiConfig.repoPath)) {
    return {
      path: uiConfig.repoPath,
      source: uiConfig.repoPath.replace(/\/$/, "") === internalUiPath ? "internal" as const : "linked-repo" as const,
    };
  }
  if (await pathExists(internalUiPath)) return { path: internalUiPath, source: "internal" as const };
  return null;
}

export async function exportAgentPackage(agent: AgentInfo) {
  const home = (await homeDir()).replace(/\/$/, "");
  const workspacePath = getAgentWorkspace(agent, home);
  const workspaceExists = await pathExists(workspacePath);
  if (!workspaceExists) {
    throw new Error(`No workspace folder found for ${agent.name ?? agent.id}.`);
  }

  const suggestedName = `${slugify(agent.name ?? agent.id)}.${PACKAGE_EXTENSION}`;
  const destination = await saveDialog({
    title: "Export agent package",
    defaultPath: suggestedName,
    filters: [{ name: "xCloud Agent", extensions: [PACKAGE_EXTENSION] }],
    canCreateDirectories: true,
  });
  if (!destination) return null;

  const outPath = ensurePackagePath(destination);
  const tempRoot = (await tempDir()).replace(/\/$/, "");
  const stage = `${tempRoot}/xcloud-agent-export-${slugify(agent.id)}-${Date.now()}`;
  const uiConfig = await readUiConfig(workspacePath);
  const uiSource = await inferUiSource(workspacePath, uiConfig);
  const exportedAgentId = agent.id === "main" ? slugify(agent.name ?? "main-agent") : slugify(agent.id);
  const manifest: AgentPackageManifest = {
    schema: PACKAGE_SCHEMA_VERSION,
    format: "xcloud-agent",
    createdAt: new Date().toISOString(),
    agent: {
      id: exportedAgentId,
      name: agent.name ?? agent.id,
      ...(agent.model?.primary ? { model: agent.model.primary } : {}),
    },
    ui: {
      included: Boolean(uiSource),
      ...(uiSource ? { source: uiSource.source } : {}),
    },
  };

  const safeFileCopies = SAFE_AGENT_FILES
    .map((file) => `[ -f ${shellQuote(`${workspacePath}/${file}`)} ] && cp ${shellQuote(`${workspacePath}/${file}`)} ${shellQuote(`${stage}/agent/${file}`)} || true`)
    .join("\n");
  const command = `
set -e
rm -rf ${shellQuote(stage)}
mkdir -p ${shellQuote(`${stage}/agent`)}
printf %s ${escapeJsonForShell(manifest)} > ${shellQuote(`${stage}/manifest.json`)}
${safeFileCopies}
find ${shellQuote(workspacePath)} -maxdepth 1 -type f \\( -name 'avatar.*' -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.gif' \\) -exec cp {} ${shellQuote(`${stage}/agent/`)} \\;
if [ -d ${shellQuote(`${workspacePath}/notes`)} ]; then
  mkdir -p ${shellQuote(`${stage}/agent/notes`)}
  rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${workspacePath}/notes/`)} ${shellQuote(`${stage}/agent/notes/`)}
fi
${uiSource ? `
mkdir -p ${shellQuote(`${stage}/ui`)}
rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${uiSource.path.replace(/\/$/, "")}/`)} ${shellQuote(`${stage}/ui/`)}
printf %s ${escapeJsonForShell({ repoPath: "ui" })} > ${shellQuote(`${stage}/ui-config.json`)}
` : ""}
rm -f ${shellQuote(outPath)}
(cd ${shellQuote(stage)} && zip -qry ${shellQuote(outPath)} .)
rm -rf ${shellQuote(stage)}
printf %s ${shellQuote(outPath)}
`;

  await runShell(command);
  return outPath;
}

export async function importAgentPackage(): Promise<ImportedAgentPackage | null> {
  const selected = await openDialog({
    title: "Import agent package",
    multiple: false,
    directory: false,
    filters: [{ name: "xCloud Agent", extensions: [PACKAGE_EXTENSION, "zip"] }],
  });
  if (!selected || Array.isArray(selected)) return null;

  const home = (await homeDir()).replace(/\/$/, "");
  const tempRoot = (await tempDir()).replace(/\/$/, "");
  const stage = `${tempRoot}/xcloud-agent-import-${Date.now()}`;
  await runShell(`
set -e
rm -rf ${shellQuote(stage)}
mkdir -p ${shellQuote(stage)}
if zipinfo -1 ${shellQuote(selected)} | grep -E '(^/|(^|/)\\.\\.(/|$))' >/dev/null; then
  echo "Archive contains unsafe paths" >&2
  exit 64
fi
unzip -q ${shellQuote(selected)} -d ${shellQuote(stage)}
`);

  const manifest = await readJsonFile<AgentPackageManifest>(`${stage}/manifest.json`);
  if (!manifest || manifest.format !== "xcloud-agent" || manifest.schema !== PACKAGE_SCHEMA_VERSION) {
    await runShell(`rm -rf ${shellQuote(stage)}`).catch(() => "");
    throw new Error("This is not a valid xCloud agent package.");
  }

  const config = await readLocalConfig();
  const agentsConfig = config.agents ?? {};
  const list = Array.isArray(agentsConfig.list) ? agentsConfig.list.filter(Boolean) : [];
  const existingIds = new Set(list.map((agent) => agent.id).filter(Boolean));
  const agentId = uniqueAgentId(manifest.agent.id || manifest.agent.name, existingIds);
  const agentName = manifest.agent.name || agentId;
  const workspacePath = `${home}/.openclaw/workspace/${agentId}`;

  await runShell(`
set -e
rm -rf ${shellQuote(workspacePath)}
mkdir -p ${shellQuote(workspacePath)}
rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${stage}/agent/`)} ${shellQuote(`${workspacePath}/`)}
if [ -d ${shellQuote(`${stage}/ui`)} ]; then
  mkdir -p ${shellQuote(`${workspacePath}/ui`)}
  rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${stage}/ui/`)} ${shellQuote(`${workspacePath}/ui/`)}
fi
rm -rf ${shellQuote(stage)}
`);

  if (manifest.ui.included) {
    await writeTextFile(
      `.openclaw/workspace/${agentId}/ui-config.json`,
      `${JSON.stringify({ repoPath: `${workspacePath}/ui` }, null, 2)}\n`,
      { baseDir: BaseDirectory.Home },
    );
  }

  const defaults = agentsConfig.defaults ?? {};
  const importedAgent: ImportedAgentPackage = {
    id: agentId,
    name: agentName,
    workspace: workspacePath,
    model: manifest.agent.model ? { primary: manifest.agent.model } : undefined,
  };
  const nextList = [...list, importedAgent];
  await writeLocalConfig({
    ...config,
    agents: {
      ...agentsConfig,
      defaults,
      list: nextList,
    },
  });
  window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
  return importedAgent;
}
