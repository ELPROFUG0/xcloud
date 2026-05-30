import { invoke } from "@tauri-apps/api/core";
import { homeDir, tempDir } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AgentInfo } from "@/hooks/use-agents";
import type { BrowserEngine } from "@/lib/engine";
import { agentUiConfigStorageKey } from "@/lib/agent-ui-config";
import { patchOpenClawConfig, readOpenClawConfig, runRemoteEngineShell, writeOpenClawAgentFile } from "@/lib/openclaw-store";

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

export type AgentImportProgressPhase = "selecting" | "unpacking" | "packing" | "preparing" | "uploading" | "extracting" | "registering" | "done";

export type AgentImportProgress = {
  phase: AgentImportProgressPhase;
  message: string;
  progress?: number;
  agentId?: string;
  agentName?: string;
};

export type AgentImportOptions = {
  onProgress?: (progress: AgentImportProgress) => void;
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

function escapeDoubleQuotedPath(value: string) {
  return value.replace(/(["\\`$])/g, "\\$1");
}

function engineHomePath(path: string) {
  const cleanPath = path.trim().replace(/\/+$/, "");
  if (cleanPath.startsWith("~/")) return `"$HOME/${escapeDoubleQuotedPath(cleanPath.slice(2))}"`;
  if (!cleanPath.startsWith("/")) return `"$HOME/${escapeDoubleQuotedPath(cleanPath)}"`;
  return shellQuote(cleanPath);
}

function uint8ToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

function getConfigAgentList(config: LocalConfig | Record<string, unknown>) {
  const agentsConfig = (config.agents && typeof config.agents === "object" ? config.agents : {}) as { list?: unknown };
  return Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((agent): agent is LocalConfigAgent => Boolean(agent) && typeof agent === "object" && typeof (agent as LocalConfigAgent).id === "string")
    : [];
}

async function readRemoteConfigAgents(engine: BrowserEngine) {
  const { config } = await readOpenClawConfig(engine);
  const configAgents = getConfigAgentList(config);
  const runtime = await engine.rpc("agents.list", {}).catch(() => null) as { agents?: Array<{ id?: string }> } | null;
  const runtimeAgents = Array.isArray(runtime?.agents)
    ? runtime.agents.flatMap((agent) => typeof agent.id === "string" ? [{ id: agent.id }] : [])
    : [];
  return [...configAgents, ...runtimeAgents];
}

async function patchRemoteAgentConfig(engine: BrowserEngine, agent: ImportedAgentPackage) {
  const { config, hash } = await readOpenClawConfig(engine);
  const agentsConfig = (config.agents && typeof config.agents === "object" ? config.agents : {}) as Record<string, unknown>;
  const list = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

  if (agent.id !== "main" && !list.some((item) => item.id === "main")) {
    list.unshift({ id: "main", default: true });
  }

  const nextAgent = {
    id: agent.id,
    name: agent.name,
    workspace: agent.workspace,
    ...(agent.model ? { model: agent.model } : {}),
  };
  const index = list.findIndex((item) => item.id === agent.id);
  if (index >= 0) list[index] = { ...list[index], ...nextAgent };
  else list.push(nextAgent);

  await patchOpenClawConfig(engine, { agents: { ...agentsConfig, list } }, hash);
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

async function createLocalImportArchive(stage: string, agentId: string) {
  const archiveRel = `.openclaw/tmp/xcloud-agent-import-${slugify(agentId)}-${Date.now()}.tgz`;
  await runShell(`
set -e
ARCHIVE="$HOME/${archiveRel}"
mkdir -p "$(dirname "$ARCHIVE")"
rm -f "$ARCHIVE"
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" -C ${shellQuote(stage)} .
printf %s ${shellQuote(archiveRel)}
`);
  return archiveRel;
}

async function appendRemoteBase64Chunk(engine: BrowserEngine, path: string, chunk: string, replace: boolean) {
  const operator = replace ? ">" : ">>";
  await runRemoteEngineShell(
    engine,
    `mkdir -p "$(dirname ${engineHomePath(path)})" && cat ${operator} ${engineHomePath(path)} << 'XCLOUD_B64'\n${chunk}\nXCLOUD_B64`,
    20_000,
  );
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

async function importAgentPackageToRemote(
  engine: BrowserEngine,
  manifest: AgentPackageManifest,
  stage: string,
  options: AgentImportOptions = {},
): Promise<ImportedAgentPackage> {
  const existingAgents = await readRemoteConfigAgents(engine);
  const existingIds = new Set(existingAgents.map((agent) => agent.id).filter(Boolean));
  const baseAgentId = manifest.agent.id === "main" ? manifest.agent.name : manifest.agent.id;
  const agentId = uniqueAgentId(baseAgentId || manifest.agent.name, existingIds);
  const agentName = manifest.agent.name || agentId;
  const workspacePath = `.openclaw/workspace/${agentId}`;
  const archivePath = `.openclaw/tmp/xcloud-agent-import-${slugify(agentId)}-${Date.now()}.tgz`;
  const archiveB64Path = `${archivePath}.b64`;
  const safeAgentId = slugify(agentId);
  let localArchive = "";

  try {
    options.onProgress?.({
      phase: "packing",
      message: `Packing ${agentName} for the remote engine...`,
      progress: 0.16,
      agentId,
      agentName,
    });
    localArchive = await createLocalImportArchive(stage, agentId);
    const archiveBytes = await readFile(localArchive, { baseDir: BaseDirectory.Home });
    const maxArchiveBytes = 150 * 1024 * 1024;
    if (archiveBytes.length > maxArchiveBytes) {
      throw new Error("This agent package is too large to import into a remote engine directly.");
    }

    const base64 = uint8ToBase64(archiveBytes);
    options.onProgress?.({
      phase: "preparing",
      message: "Preparing the remote engine...",
      progress: 0.24,
      agentId,
      agentName,
    });
    await runRemoteEngineShell(
      engine,
      `mkdir -p "$HOME/.openclaw/tmp" && rm -f ${engineHomePath(archivePath)} ${engineHomePath(archiveB64Path)}`,
      20_000,
    );

    const chunkSize = 48_000;
    const chunks = Math.ceil(base64.length / chunkSize);
    for (let index = 0; index < chunks; index += 1) {
      options.onProgress?.({
        phase: "uploading",
        message: `Uploading package ${index + 1}/${chunks}...`,
        progress: 0.24 + (index / Math.max(chunks, 1)) * 0.5,
        agentId,
        agentName,
      });
      await appendRemoteBase64Chunk(engine, archiveB64Path, base64.slice(index * chunkSize, (index + 1) * chunkSize), index === 0);
      options.onProgress?.({
        phase: "uploading",
        message: `Uploading package ${index + 1}/${chunks}...`,
        progress: 0.24 + ((index + 1) / Math.max(chunks, 1)) * 0.5,
        agentId,
        agentName,
      });
    }

    const decodeScript = "const fs=require('node:fs');const input=fs.readFileSync(process.argv[1],'utf8').replace(/\\s+/g,'');fs.writeFileSync(process.argv[2],Buffer.from(input,'base64'));";
    options.onProgress?.({
      phase: "extracting",
      message: "Extracting agent files on the remote engine...",
      progress: 0.8,
      agentId,
      agentName,
    });
    await runRemoteEngineShell(
      engine,
      `set -e
TARGET=${engineHomePath(workspacePath)}
STAGING="$HOME/.openclaw/tmp/xcloud-agent-import-${safeAgentId}-staging"
node -e ${shellQuote(decodeScript)} ${engineHomePath(archiveB64Path)} ${engineHomePath(archivePath)}
rm -rf "$STAGING" "$TARGET"
mkdir -p "$STAGING" "$TARGET"
tar -xzf ${engineHomePath(archivePath)} -C "$STAGING"
if [ ! -d "$STAGING/agent" ]; then
  echo "Package is missing agent files" >&2
  exit 64
fi
(cd "$STAGING/agent" && tar -cf - .) | tar -xf - -C "$TARGET"
if [ -d "$STAGING/ui" ]; then
  mkdir -p "$TARGET/ui"
  (cd "$STAGING/ui" && tar -cf - .) | tar -xf - -C "$TARGET/ui"
fi
rm -rf "$STAGING"
rm -f ${engineHomePath(archivePath)} ${engineHomePath(archiveB64Path)}`,
      120_000,
    );

    options.onProgress?.({
      phase: "registering",
      message: "Registering agent and UI config...",
      progress: 0.9,
      agentId,
      agentName,
    });
    const importedAgent: ImportedAgentPackage = {
      id: agentId,
      name: agentName,
      workspace: workspacePath,
      model: manifest.agent.model ? { primary: manifest.agent.model } : undefined,
    };

    if (manifest.ui.included) {
      const uiConfig = `${JSON.stringify({ repoPath: `${workspacePath}/ui` }, null, 2)}\n`;
      await writeOpenClawAgentFile(engine, agentId, "ui-config.json", uiConfig);
      localStorage.setItem(agentUiConfigStorageKey(agentId, engine), uiConfig);
    }

    await patchRemoteAgentConfig(engine, importedAgent);
    window.dispatchEvent(new CustomEvent("xcloud-agents-local-config-changed"));
    return importedAgent;
  } finally {
    if (localArchive) await runShell(`rm -f "$HOME/${escapeDoubleQuotedPath(localArchive)}"`).catch(() => "");
  }
}

async function importAgentPackageToLocal(
  manifest: AgentPackageManifest,
  stage: string,
  options: AgentImportOptions = {},
): Promise<ImportedAgentPackage> {
  const home = (await homeDir()).replace(/\/$/, "");
  const config = await readLocalConfig();
  const agentsConfig = config.agents ?? {};
  const list = getConfigAgentList(config);
  const existingIds = new Set(list.map((agent) => agent.id).filter(Boolean));
  const baseAgentId = manifest.agent.id === "main" ? manifest.agent.name : manifest.agent.id;
  const agentId = uniqueAgentId(baseAgentId || manifest.agent.name, existingIds);
  const agentName = manifest.agent.name || agentId;
  const workspacePath = `${home}/.openclaw/workspace/${agentId}`;

  options.onProgress?.({
    phase: "registering",
    message: `Copying ${agentName} into local OpenClaw...`,
    progress: 0.58,
    agentId,
    agentName,
  });
  await runShell(`
set -e
rm -rf ${shellQuote(workspacePath)}
mkdir -p ${shellQuote(workspacePath)}
rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${stage}/agent/`)} ${shellQuote(`${workspacePath}/`)}
if [ -d ${shellQuote(`${stage}/ui`)} ]; then
  mkdir -p ${shellQuote(`${workspacePath}/ui`)}
  rsync -a ${rsyncExcludeArgs()} ${shellQuote(`${stage}/ui/`)} ${shellQuote(`${workspacePath}/ui/`)}
fi
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

export async function importAgentPackage(engine: BrowserEngine, options: AgentImportOptions = {}): Promise<ImportedAgentPackage | null> {
  options.onProgress?.({
    phase: "selecting",
    message: "Choose an agent package to import...",
    progress: 0.04,
  });
  const selected = await openDialog({
    title: "Import agent package",
    multiple: false,
    directory: false,
    filters: [{ name: "xCloud Agent", extensions: [PACKAGE_EXTENSION, "zip"] }],
  });
  if (!selected || Array.isArray(selected)) return null;

  const tempRoot = (await tempDir()).replace(/\/$/, "");
  const stage = `${tempRoot}/xcloud-agent-import-${Date.now()}`;
  try {
    options.onProgress?.({
      phase: "unpacking",
      message: "Reading package manifest...",
      progress: 0.08,
    });
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
      throw new Error("This is not a valid xCloud agent package.");
    }

    return engine.isRemote
      ? await importAgentPackageToRemote(engine, manifest, stage, options)
      : await importAgentPackageToLocal(manifest, stage, options);
  } finally {
    await runShell(`rm -rf ${shellQuote(stage)}`).catch(() => "");
  }
}
