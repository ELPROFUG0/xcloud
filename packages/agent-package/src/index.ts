import { execFile } from "node:child_process";
import { constants, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGENT_PACKAGE_SCHEMA_VERSION = 1;
export const AGENT_PACKAGE_EXTENSION = ".xcloud-agent";

const COPY_SKIP_NAMES = new Set([
  ".git",
  ".DS_Store",
  ".env",
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
]);

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
  model?: string | { primary?: string };
};

type LocalConfig = {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: LocalConfigAgent[];
  };
};

export type InspectResult = {
  file: string;
  manifest: AgentPackageManifest;
  entries: string[];
  hasAgentContext: boolean;
  hasUi: boolean;
};

export type InstallOptions = {
  home?: string;
  id?: string;
};

export type InstallResult = {
  id: string;
  name: string;
  workspace: string;
  uiIncluded: boolean;
};

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

async function exists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listArchiveEntries(packagePath: string) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", packagePath]);
  return stdout
    .split(/\r?\n/)
    .map((entry: string) => entry.trim())
    .filter(Boolean);
}

function assertSafeEntries(entries: string[]) {
  const unsafe = entries.find((entry) => (
    entry.startsWith("/")
    || entry.split("/").includes("..")
  ));
  if (unsafe) throw new Error(`Package contains unsafe path: ${unsafe}`);
}

async function extractPackage(packagePath: string, destination: string) {
  const entries = await listArchiveEntries(packagePath);
  assertSafeEntries(entries);
  await execFileAsync("unzip", ["-q", packagePath, "-d", destination]);
  return entries;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function assertManifest(value: AgentPackageManifest): AgentPackageManifest {
  if (
    !value
    || value.schema !== AGENT_PACKAGE_SCHEMA_VERSION
    || value.format !== "xcloud-agent"
    || !value.agent?.id
    || !value.agent?.name
  ) {
    throw new Error("Invalid xCloud agent package manifest.");
  }
  return value;
}

async function readLocalConfig(openclawConfigPath: string): Promise<LocalConfig> {
  if (!await exists(openclawConfigPath)) return {};
  try {
    return JSON.parse(await readFile(openclawConfigPath, "utf8")) as LocalConfig;
  } catch {
    return {};
  }
}

async function writeLocalConfig(openclawConfigPath: string, config: LocalConfig) {
  await mkdir(path.dirname(openclawConfigPath), { recursive: true });
  await writeFile(openclawConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function uniqueAgentId(baseId: string, existingIds: Set<string>) {
  const base = slugify(baseId);
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function shouldSkipCopy(src: string) {
  const name = path.basename(src);
  return COPY_SKIP_NAMES.has(name)
    || name.startsWith(".env.")
    || name.endsWith(".log");
}

async function copyFiltered(src: string, dest: string) {
  await cp(src, dest, {
    recursive: true,
    force: true,
    filter: (source: string) => !shouldSkipCopy(source),
  });
}

export async function inspectAgentPackage(packagePath: string): Promise<InspectResult> {
  const absolutePath = path.resolve(packagePath);
  const stage = await mkdtemp(path.join(tmpdir(), "xcloud-agent-inspect-"));
  try {
    const entries = await extractPackage(absolutePath, stage);
    const manifest = assertManifest(await readJson<AgentPackageManifest>(path.join(stage, "manifest.json")));
    return {
      file: absolutePath,
      manifest,
      entries,
      hasAgentContext: entries.some((entry: string) => entry.startsWith("agent/")),
      hasUi: entries.some((entry: string) => entry.startsWith("ui/")),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function installAgentPackage(packagePath: string, options: InstallOptions = {}): Promise<InstallResult> {
  const absolutePath = path.resolve(packagePath);
  const home = path.resolve(options.home ?? homedir());
  const stage = await mkdtemp(path.join(tmpdir(), "xcloud-agent-install-"));
  try {
    await extractPackage(absolutePath, stage);
    const manifest = assertManifest(await readJson<AgentPackageManifest>(path.join(stage, "manifest.json")));
    const configPath = path.join(home, ".openclaw", "openclaw.json");
    const config = await readLocalConfig(configPath);
    const agentsConfig = config.agents ?? {};
    const list = Array.isArray(agentsConfig.list) ? agentsConfig.list.filter(Boolean) : [];
    const existingIds = new Set(list.map((agent) => agent.id).filter(Boolean));
    const baseAgentId = manifest.agent.id === "main" ? manifest.agent.name : manifest.agent.id;
    const agentId = options.id ? slugify(options.id) : uniqueAgentId(baseAgentId, existingIds);
    if (existingIds.has(agentId)) throw new Error(`Agent "${agentId}" already exists.`);

    const workspace = path.join(home, ".openclaw", "workspace", agentId);
    const agentDir = path.join(stage, "agent");
    if (!await exists(agentDir)) throw new Error("Package does not contain an agent/ directory.");

    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await copyFiltered(agentDir, workspace);

    const uiDir = path.join(stage, "ui");
    const hasUi = await exists(uiDir);
    if (hasUi) {
      await copyFiltered(uiDir, path.join(workspace, "ui"));
      await writeFile(
        path.join(workspace, "ui-config.json"),
        `${JSON.stringify({ repoPath: path.join(workspace, "ui") }, null, 2)}\n`,
        "utf8",
      );
    }

    const importedAgent: LocalConfigAgent = {
      id: agentId,
      name: manifest.agent.name,
      workspace,
      ...(manifest.agent.model ? { model: { primary: manifest.agent.model } } : {}),
    };
    await writeLocalConfig(configPath, {
      ...config,
      agents: {
        ...agentsConfig,
        list: [...list, importedAgent],
      },
    });

    return {
      id: agentId,
      name: manifest.agent.name,
      workspace,
      uiIncluded: hasUi,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
