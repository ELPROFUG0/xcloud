import { t as definePluginEntry } from "../../plugin-entry-DyZc6JGI.js";
import { t as agentsAddCommand } from "../../agents.commands.add-D3K-MXUw.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";

const WORKSPACE_PREFIX = "workspace-";
let agentConfigQueue = Promise.resolve();

const WorkspaceAgentCreateSchema = Type.Object({
	agentId: Type.String({
		description: "Stable OpenClaw agent id. It must start with the workspace id prefix, for example veev-ee-growth."
	}),
	name: Type.Optional(Type.String({
		description: "Human-friendly agent name."
	})),
	role: Type.Optional(Type.String({
		description: "Short responsibility summary for this specialist."
	})),
	model: Type.Optional(Type.String({
		description: "Optional OpenClaw model id, for example openai-codex/gpt-5.5."
	})),
	workspaceId: Type.Optional(Type.String({
		description: "Workspace id without the workspace- coordinator prefix."
	})),
	identityMd: Type.String({
		description: "Complete IDENTITY.md content for the new agent."
	}),
	soulMd: Type.String({
		description: "Complete SOUL.md content for the new agent."
	}),
	agentsMd: Type.String({
		description: "Complete AGENTS.md instruction content for the new agent."
	}),
	projectBriefMd: Type.String({
		description: "Complete PROJECT_BRIEF.md content for the new agent."
	}),
	sourceSpecMd: Type.Optional(Type.String({
		description: "Optional SOURCE_SPEC.md content with workspace-specific source/context notes."
	})),
	createUi: Type.Optional(Type.Boolean({
		description: "Create and link a separate Agent UI folder for this specialist inside that specialist's own OpenClaw agent folder. Set true when the user asks the new agent to have a UI/interface/preview/app."
	})),
	uiBriefMd: Type.Optional(Type.String({
		description: "Optional brief describing what the specialist's UI should do. Used only when createUi is true."
	}))
});

const XCloudAgentCreateSchema = Type.Object({
	agentId: Type.String({
		description: "Stable OpenClaw agent id for a normal/global agent. Use this exact id as the owner for any UI created for the agent."
	}),
	name: Type.Optional(Type.String({
		description: "Human-friendly agent name."
	})),
	role: Type.Optional(Type.String({
		description: "Short responsibility summary for this agent."
	})),
	model: Type.Optional(Type.String({
		description: "Optional OpenClaw model id, for example openai-codex/gpt-5.5."
	})),
	identityMd: Type.String({
		description: "Complete IDENTITY.md content for the new agent."
	}),
	soulMd: Type.String({
		description: "Complete SOUL.md content for the new agent."
	}),
	agentsMd: Type.String({
		description: "Complete AGENTS.md instruction content for the new agent."
	}),
	projectBriefMd: Type.String({
		description: "Complete PROJECT_BRIEF.md content for the new agent."
	}),
	sourceSpecMd: Type.Optional(Type.String({
		description: "Optional SOURCE_SPEC.md content with source/context notes."
	})),
	createUi: Type.Optional(Type.Boolean({
		description: "Create and link a separate Agent UI folder inside this agent's own OpenClaw agent folder, normally ~/.openclaw/workspace/<agentId>/ui. This is not the same thing as an xCloud Workspace/project."
	})),
	uiBriefMd: Type.Optional(Type.String({
		description: "Optional brief describing what the new agent's UI should do. Used only when createUi is true."
	}))
});

const XCloudContextSchema = Type.Object({
	includeGuide: Type.Optional(Type.Boolean({
		description: "Include the connected UI guide file when available. Default false."
	})),
	targetAgentId: Type.Optional(Type.String({
		description: "Optional agent id to inspect. Use this when the user asks about another agent's UI; omit for the current agent."
	}))
});

const XCloudUiActionSchema = Type.Object({
	instruction: Type.String({
		description: "Plain-language UI action to execute in the connected xCloud preview."
	}),
	preferredTool: Type.Optional(Type.String({
		description: "Optional registered frontend UI tool name to prefer."
	})),
	timeoutMs: Type.Optional(Type.Number({
		description: "Optional timeout in milliseconds. Default 15000."
	}))
});

const XCloudAgentUiCreateSchema = Type.Object({
	agentId: Type.String({
		description: "Agent id that owns this UI. Use the new/specialist agent id, not the current agent, when creating a UI for another agent."
	}),
	repoPath: Type.Optional(Type.String({
		description: "Existing UI repo/folder to link to this agent. Omit to create the isolated default UI folder inside the agent's own OpenClaw agent folder."
	})),
	uiBriefMd: Type.Optional(Type.String({
		description: "Optional brief describing what this agent's UI should do."
	}))
});

function normalizeAgentId(value) {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!normalized) throw new Error("agentId is required.");
	if (normalized === "main") throw new Error('"main" is reserved. Choose another agent id.');
	return normalized;
}

function normalizeOptionalText(value) {
	if (typeof value !== "string") return "";
	return value.trim();
}

function requireText(value, label) {
	const normalized = normalizeOptionalText(value);
	if (!normalized) throw new Error(`${label} is required and cannot be empty.`);
	return normalized;
}

function resolveWorkspaceId(ctx, params) {
	const explicit = normalizeOptionalText(params.workspaceId);
	if (explicit) return normalizeAgentId(explicit.replace(/^workspace-/i, ""));
	const agentId = normalizeOptionalText(ctx.agentId);
	if (agentId.startsWith(WORKSPACE_PREFIX)) return normalizeAgentId(agentId.slice(WORKSPACE_PREFIX.length));
	const workspaceBase = path.basename(normalizeOptionalText(ctx.workspaceDir));
	if (workspaceBase.startsWith(WORKSPACE_PREFIX)) return normalizeAgentId(workspaceBase.slice(WORKSPACE_PREFIX.length));
	throw new Error("workspaceId is required when this tool is not running from a workspace coordinator.");
}

function resolveWorkspaceBaseDir(ctx) {
	const workspaceDir = normalizeOptionalText(ctx.workspaceDir);
	if (workspaceDir) {
		const resolved = path.resolve(workspaceDir);
		if (path.basename(resolved).startsWith(WORKSPACE_PREFIX)) return path.dirname(resolved);
	}
	return path.join(os.homedir(), ".openclaw", "workspace");
}

function resolveAgentId(ctx) {
	const agentId = normalizeOptionalText(ctx.agentId);
	if (agentId) return agentId;
	const workspaceDir = normalizeOptionalText(ctx.workspaceDir);
	const base = workspaceDir ? path.basename(path.resolve(workspaceDir)) : "";
	return base || "main";
}

function resolveAgentWorkspaceDir(ctx) {
	const workspaceDir = normalizeOptionalText(ctx.workspaceDir);
	if (workspaceDir) return path.resolve(workspaceDir);
	const agentId = resolveAgentId(ctx);
	return agentId === "main"
		? path.join(os.homedir(), ".openclaw", "workspace")
		: path.join(os.homedir(), ".openclaw", "workspace", agentId);
}

function normalizeUiOwnerAgentId(value) {
	const agentId = normalizeOptionalText(value);
	if (!agentId) throw new Error("agentId is required.");
	if (agentId === "main") return "main";
	return normalizeAgentId(agentId);
}

function resolveAgentWorkspaceDirById(agentId) {
	return agentId === "main"
		? path.join(os.homedir(), ".openclaw", "workspace")
		: path.join(os.homedir(), ".openclaw", "workspace", agentId);
}

function expandHome(value) {
	return value.replace(/^~(?=\/|$)/, os.homedir());
}

function resolveRepoPath(workspaceDir, repoPath) {
	const expanded = expandHome(repoPath.trim());
	return path.isAbsolute(expanded) ? expanded : path.resolve(workspaceDir, expanded);
}

function resolveConfig(ctx) {
	return ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? {};
}

function listConfigAgents(config) {
	const list = config?.agents?.list;
	return Array.isArray(list) ? list.filter((entry) => entry && typeof entry === "object") : [];
}

function resolveDefaultModel(config) {
	const value = config?.agents?.defaults?.model?.primary;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function createNonExitingRuntime() {
	const logs = [];
	return {
		log: (...args) => logs.push(args.map(String).join(" ")),
		error: (...args) => logs.push(args.map(String).join(" ")),
		writeJson: (value) => logs.push(JSON.stringify(value, null, 2)),
		exit: (code) => {
			throw new Error(`openclaw agents add exited with code ${code}`);
		},
		getLogs: () => logs
	};
}

function enqueueAgentConfigWrite(task) {
	const run = agentConfigQueue.then(task, task);
	agentConfigQueue = run.catch(() => {});
	return run;
}

function resolveConfigPath() {
	const explicit = normalizeOptionalText(process.env.OPENCLAW_CONFIG_PATH);
	if (explicit) return explicit.replace(/^~(?=\/|$)/, os.homedir());
	return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

async function readConfigFromDisk(fallbackConfig) {
	try {
		const raw = await fs.readFile(resolveConfigPath(), "utf8");
		return JSON.parse(raw);
	} catch {
		return fallbackConfig;
	}
}

async function addAgentIfMissing(params) {
	return enqueueAgentConfigWrite(async () => {
		const config = await readConfigFromDisk(resolveConfig(params.ctx));
		const exists = listConfigAgents(config).some((agent) => normalizeOptionalText(agent.id) === params.agentId);
		if (exists) return { created: false };
		const runtime = createNonExitingRuntime();
		await agentsAddCommand({
			name: params.agentId,
			workspace: params.agentWorkspacePath,
			model: params.model ?? resolveDefaultModel(config),
			nonInteractive: true,
			json: true
		}, runtime, { hasFlags: true });
		return { created: true, logs: runtime.getLogs() };
	});
}

async function updateAgentConfigName(params) {
	const name = normalizeOptionalText(params.name);
	if (!name) return;
	return enqueueAgentConfigWrite(async () => {
		const config = await readConfigFromDisk(resolveConfig(params.ctx));
		const list = listConfigAgents(config);
		const agent = list.find((entry) => normalizeOptionalText(entry.id) === params.agentId);
		if (!agent || agent.name === name) return;
		agent.name = name;
		await fs.writeFile(resolveConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
	});
}

async function writeAgentFiles(params) {
	await fs.mkdir(params.agentWorkspacePath, { recursive: true });
	const files = [
		["IDENTITY.md", requireText(params.input.identityMd, "identityMd")],
		["SOUL.md", requireText(params.input.soulMd, "soulMd")],
		["AGENTS.md", requireText(params.input.agentsMd, "agentsMd")],
		["PROJECT_BRIEF.md", requireText(params.input.projectBriefMd, "projectBriefMd")],
		["SOURCE_SPEC.md", normalizeOptionalText(params.input.sourceSpecMd) || `# Source Spec\n\n${params.role || params.name}\n`]
	];
	await Promise.all(files.map(([file, content]) => fs.writeFile(path.join(params.agentWorkspacePath, file), content, "utf8")));
}

async function readAgentContextSnippet(agentWorkspacePath) {
	const files = [
		["IDENTITY.md", "Identity"],
		["SOUL.md", "Personality"],
		["AGENTS.md", "Instructions"],
		["PROJECT_BRIEF.md", "Project Brief"]
	];
	const parts = [];
	for (const [file, label] of files) {
		const content = await readTextFileOptional(path.join(agentWorkspacePath, file), 6_000);
		if (content) parts.push(`## ${label}\n\n${content}`);
	}
	return parts.join("\n\n");
}

async function writeFileIfMissing(file, content) {
	try {
		const existing = await fs.readFile(file, "utf8");
		if (existing.trim()) return;
	} catch {
		// File does not exist yet.
	}
	await fs.writeFile(file, content, "utf8");
}

async function ensureAgentUi(params) {
	const agentId = normalizeUiOwnerAgentId(params.agentId);
	const agentWorkspacePath = resolveAgentWorkspaceDirById(agentId);
	const repoPath = normalizeOptionalText(params.repoPath)
		? resolveRepoPath(agentWorkspacePath, normalizeOptionalText(params.repoPath))
		: path.join(agentWorkspacePath, "ui");
	const uiBrief = normalizeOptionalText(params.uiBriefMd);

	await fs.mkdir(agentWorkspacePath, { recursive: true });
	await fs.mkdir(repoPath, { recursive: true });

	const agentContext = await readAgentContextSnippet(agentWorkspacePath);
	const context = `# Agent UI Context

This UI belongs to agent \`${agentId}\`.

Do not put this UI inside another agent's connected repo. Keep its files in:

\`${repoPath}\`

${uiBrief ? `## UI Brief\n\n${uiBrief}\n\n` : ""}${agentContext || "No agent context files exist yet."}

## Runtime

xCloud injects a realtime bridge into previews. Use \`window.xcloud.agent\` when the UI should react to agent activity.
`;

	await fs.writeFile(path.join(repoPath, "AGENT-CONTEXT.md"), context, "utf8");
	await writeFileIfMissing(path.join(repoPath, "CLAUDE.md"), `# CLAUDE.md

You are building the isolated UI for agent \`${agentId}\`.

Read AGENT-CONTEXT.md before editing. Keep this UI inside this folder unless the user explicitly links a different repo.
`);
	await writeFileIfMissing(path.join(repoPath, ".cursorrules"), `You are building the isolated UI for agent ${agentId}.
Read AGENT-CONTEXT.md before editing.
Keep UI files inside this folder unless the user explicitly links a different repo.
`);

	const now = new Date().toISOString();
	const uiConfig = {
		repoPath,
		ownerAgentId: agentId,
		openInPreview: true,
		updatedAt: now
	};
	await fs.writeFile(path.join(agentWorkspacePath, "ui-config.json"), `${JSON.stringify(uiConfig, null, 2)}\n`, "utf8");

	return {
		agentId,
		agentFolder: agentWorkspacePath,
		workspace: agentWorkspacePath,
		repoPath,
		configPath: path.join(agentWorkspacePath, "ui-config.json"),
		openInPreview: true
	};
}

function jsonResult(payload) {
	return {
		content: [{
			type: "text",
			text: JSON.stringify(payload, null, 2)
		}],
		details: payload
	};
}

async function readJsonFile(file) {
	try {
		const raw = await fs.readFile(file, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function readTextFileOptional(file, limit = 12_000) {
	try {
		const content = await fs.readFile(file, "utf8");
		return content.length > limit ? `${content.slice(0, limit)}\n\n[truncated]` : content;
	} catch {
		return null;
	}
}

function normalizeUiTools(raw) {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((tool) => tool && typeof tool === "object" && typeof tool.name === "string" && tool.name.trim())
		.map((tool) => ({
			name: tool.name.trim(),
			description: typeof tool.description === "string" ? tool.description.trim() : undefined,
			aliases: Array.isArray(tool.aliases) ? tool.aliases.map(String).filter(Boolean) : [],
			parameters: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : undefined
		}));
}

async function buildXCloudContext(ctx, args) {
	const currentAgentId = resolveAgentId(ctx);
	const agentId = normalizeOptionalText(args?.targetAgentId)
		? normalizeUiOwnerAgentId(args.targetAgentId)
		: currentAgentId;
	const workspaceDir = agentId === currentAgentId
		? resolveAgentWorkspaceDir(ctx)
		: resolveAgentWorkspaceDirById(agentId);
	const uiConfig = await readJsonFile(path.join(workspaceDir, "ui-config.json"));
	const repoPath = typeof uiConfig?.repoPath === "string" && uiConfig.repoPath.trim()
		? resolveRepoPath(workspaceDir, uiConfig.repoPath.trim())
		: null;
	const toolsRecord = await readJsonFile(path.join(workspaceDir, ".xcloud", "ui-tools.json"));
	const uiTools = normalizeUiTools(toolsRecord?.tools);
	const guidePath = repoPath ? path.join(repoPath, "XCLOUD-UI.md") : null;
	const guide = args?.includeGuide && guidePath ? await readTextFileOptional(guidePath) : null;

	return {
		ok: true,
		agentId,
		currentAgentId,
		workspaceDir,
		ui: {
			ownerAgentId: agentId,
			connected: Boolean(repoPath),
			repoPath,
			configPath: path.join(workspaceDir, "ui-config.json"),
			defaultRepoPath: path.join(workspaceDir, "ui"),
			guidePath,
			guide,
			runtimeTools: uiTools,
			instructions: [
				"xCloud Workspaces/projects are separate from OpenClaw's per-agent workspace folders.",
				"Every agent, including global agents that are not inside an xCloud Workspace/project, owns a separate OpenClaw agent folder.",
				"Every agent owns a separate UI config and UI repo/folder in its own OpenClaw agent folder unless the user explicitly links an external repo.",
				"The connected UI repo in this response belongs only to ui.ownerAgentId.",
				"If the user asks to change this agent's preview/UI, edit this agent's connected UI repo.",
				"If the user asks to create a new normal/global agent with a UI/interface/app, call xcloud_agent_create with createUi: true.",
				"If the user asks to create a workspace specialist with a UI/interface/app, call workspace_agent_create with createUi: true.",
				"If the user asks to create or link a UI for another existing agent, call xcloud_agent_ui_create with that target agent id. Do not edit the current agent's connected UI repo for another agent.",
				"Connected UI repos receive realtime agent state through window.xcloud.agent and AG-UI events.",
				"To control the live preview with a registered frontend UI tool, call the native xcloud_ui_action tool with an instruction and optional preferredTool.",
				"Do not emit hidden HTML directives unless the native tool is unavailable."
			]
		}
	};
}

function clampTimeout(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 15_000;
	return Math.max(1_000, Math.min(60_000, Math.round(numeric)));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResultFile(file) {
	try {
		const raw = await fs.readFile(file, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function removeFileQuietly(file) {
	try {
		await fs.unlink(file);
	} catch {
		// Best effort cleanup only.
	}
}

async function executeXCloudUiAction(ctx, args) {
	const input = args ?? {};
	const instruction = requireText(input.instruction, "instruction");
	const preferredTool = normalizeOptionalText(input.preferredTool) || undefined;
	const timeoutMs = clampTimeout(input.timeoutMs);
	const agentId = resolveAgentId(ctx);
	const workspaceDir = resolveAgentWorkspaceDir(ctx);
	const bridgeDir = path.join(workspaceDir, ".xcloud", "ui-action-requests");
	const requestId = `ui-action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const requestPath = path.join(bridgeDir, `${requestId}.request.json`);
	const resultPath = path.join(bridgeDir, `${requestId}.result.json`);

	await fs.mkdir(bridgeDir, { recursive: true });
	await fs.writeFile(requestPath, `${JSON.stringify({
		id: requestId,
		agentId,
		instruction,
		preferredTool,
		timeoutMs,
		createdAt: new Date().toISOString()
	}, null, 2)}\n`, "utf8");

	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const result = await readResultFile(resultPath);
		if (result && typeof result === "object") {
			await removeFileQuietly(requestPath);
			await removeFileQuietly(resultPath);
			return {
				ok: result.ok === true,
				toolName: typeof result.toolName === "string" ? result.toolName : preferredTool,
				message: typeof result.message === "string" ? result.message : result.ok === true ? "UI tool executed." : "UI tool failed.",
				output: result.output,
				requestId
			};
		}
		await sleep(150);
	}

	await removeFileQuietly(requestPath);
	return {
		ok: false,
		toolName: preferredTool,
		message: "Timed out waiting for xCloud UI bridge. Make sure the Agent UI preview is open and the frontend has registered UI tools.",
		requestId
	};
}

const remotePtySessions = new Map();
let ptyModulePromise = null;

async function loadPtyModule() {
	ptyModulePromise ??= (async () => {
		let lastError = null;
		for (const specifier of ["@lydell/node-pty", "@lydell/node-pty/index.js"]) {
			try {
				return await import(specifier);
			} catch (err) {
				lastError = err;
			}
		}
		throw lastError ?? new Error("Cannot load @lydell/node-pty.");
	})();
	const module = await ptyModulePromise;
	const spawn = module.spawn ?? module.default?.spawn;
	if (!spawn) throw new Error("PTY support is unavailable on this engine.");
	return { spawn };
}

function coerceInt(value, fallback, min, max) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeCommand(value) {
	return typeof value === "string" && value.trim() ? value : "";
}

function resolveAuthProfilesPath() {
	return path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
}

function getAuthProfileProvider(profile) {
	if (!profile || typeof profile !== "object") return "";
	if (typeof profile.provider === "string" && profile.provider) return profile.provider;
	const credential = profile.credential;
	if (credential && typeof credential === "object" && typeof credential.provider === "string") {
		return credential.provider;
	}
	return "";
}

function hasAuthProvider(profiles, provider) {
	if (!profiles || typeof profiles !== "object") return false;
	return Object.entries(profiles).some(([id, profile]) => (
		getAuthProfileProvider(profile) === provider ||
		(typeof id === "string" && id.startsWith(`${provider}:`))
	));
}

async function disconnectAuthProvider(providerRaw) {
	const provider = normalizeCommand(providerRaw).trim();
	if (!provider) throw new Error("Auth provider is required.");
	const profilesPath = resolveAuthProfilesPath();
	let raw = "";
	try {
		raw = await fs.readFile(profilesPath, "utf8");
	} catch (err) {
		if (err && typeof err === "object" && err.code === "ENOENT") {
			return {
				ok: true,
				provider,
				removed: 0,
				status: { openaiCodex: false, githubCopilot: false }
			};
		}
		throw err;
	}

	const value = JSON.parse(raw || "{}");
	const profiles = value?.profiles && typeof value.profiles === "object" && !Array.isArray(value.profiles)
		? value.profiles
		: null;
	if (!profiles) {
		return {
			ok: true,
			provider,
			removed: 0,
			status: { openaiCodex: false, githubCopilot: false }
		};
	}

	let removed = 0;
	for (const [id, profile] of Object.entries(profiles)) {
		if (getAuthProfileProvider(profile) === provider || (typeof id === "string" && id.startsWith(`${provider}:`))) {
			delete profiles[id];
			removed += 1;
		}
	}
	if (removed > 0) {
		await fs.writeFile(profilesPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	}

	return {
		ok: true,
		provider,
		removed,
		status: {
			openaiCodex: hasAuthProvider(profiles, "openai-codex"),
			githubCopilot: hasAuthProvider(profiles, "github-copilot")
		}
	};
}

function resolvePtyShell(command) {
	if (process.platform === "win32") {
		const shell = process.env.ComSpec || "cmd.exe";
		return {
			shell,
			args: command ? ["/d", "/s", "/c", command] : []
		};
	}
	const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
	return {
		shell,
		args: command ? ["-lc", command] : ["-l"]
	};
}

function pushPtyChunk(session, data) {
	session.seq += 1;
	session.chunks.push({ seq: session.seq, data });
	if (session.chunks.length > 2_000) {
		session.chunks.splice(0, session.chunks.length - 2_000);
	}
	session.updatedAt = Date.now();
}

function getPtySession(id) {
	const normalized = normalizeCommand(id);
	if (!normalized) throw new Error("PTY id is required.");
	const session = remotePtySessions.get(normalized);
	if (!session) throw new Error("Remote terminal session not found.");
	return session;
}

function cleanupOldPtySessions() {
	const now = Date.now();
	for (const [id, session] of remotePtySessions) {
		if (!session.exited) continue;
		if (now - session.updatedAt > 5 * 60_000) remotePtySessions.delete(id);
	}
}

function registerXCloudPtyGatewayMethods(api) {
	const sendError = (respond, err) => {
		respond(false, void 0, {
			code: "UNAVAILABLE",
			message: err instanceof Error ? err.message : String(err)
		});
	};

	api.registerGatewayMethod("xcloud.pty.spawn", async ({ params, respond }) => {
		try {
			cleanupOldPtySessions();
			const { spawn } = await loadPtyModule();
			const command = normalizeCommand(params?.command);
			const cols = coerceInt(params?.cols, 80, 20, 400);
			const rows = coerceInt(params?.rows, 24, 8, 120);
			const cwdRaw = normalizeCommand(params?.cwd);
			const cwd = cwdRaw ? (cwdRaw.startsWith("~") ? cwdRaw.replace(/^~(?=\/|$)/, os.homedir()) : cwdRaw) : os.homedir();
			const shellLaunch = resolvePtyShell(command);
			const env = {
				...process.env,
				TERM: process.env.TERM || "xterm-256color"
			};
			const pty = spawn(shellLaunch.shell, shellLaunch.args, {
				name: "xterm-256color",
				cols,
				rows,
				cwd,
				env
			});
			const id = randomUUID();
			const session = {
				id,
				pty,
				chunks: [],
				seq: 0,
				exited: false,
				exitCode: null,
				signal: null,
				updatedAt: Date.now()
			};
			pty.onData((data) => pushPtyChunk(session, data));
			pty.onExit((event) => {
				session.exited = true;
				session.exitCode = typeof event.exitCode === "number" ? event.exitCode : null;
				session.signal = typeof event.signal === "number" || typeof event.signal === "string" ? event.signal : null;
				session.updatedAt = Date.now();
			});
			remotePtySessions.set(id, session);
			respond(true, { id, pid: pty.pid ?? null, cols, rows });
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });

	api.registerGatewayMethod("xcloud.pty.read", async ({ params, respond }) => {
		try {
			const session = getPtySession(params?.id);
			const after = coerceInt(params?.after, 0, 0, Number.MAX_SAFE_INTEGER);
			const chunks = session.chunks.filter((chunk) => chunk.seq > after);
			respond(true, {
				id: session.id,
				chunks,
				lastSeq: session.seq,
				exited: session.exited,
				exitCode: session.exitCode,
				signal: session.signal
			});
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });

	api.registerGatewayMethod("xcloud.pty.write", async ({ params, respond }) => {
		try {
			const session = getPtySession(params?.id);
			const data = typeof params?.data === "string" ? params.data : "";
			if (data && !session.exited) session.pty.write(data);
			respond(true, { ok: true });
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });

	api.registerGatewayMethod("xcloud.pty.resize", async ({ params, respond }) => {
		try {
			const session = getPtySession(params?.id);
			const cols = coerceInt(params?.cols, 80, 20, 400);
			const rows = coerceInt(params?.rows, 24, 8, 120);
			if (!session.exited) session.pty.resize(cols, rows);
			respond(true, { ok: true, cols, rows });
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });

	api.registerGatewayMethod("xcloud.pty.kill", async ({ params, respond }) => {
		try {
			const session = getPtySession(params?.id);
			try {
				session.pty.kill();
			} catch {}
			remotePtySessions.delete(session.id);
			respond(true, { ok: true });
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });

	api.registerGatewayMethod("xcloud.auth.disconnect", async ({ params, respond }) => {
		try {
			respond(true, await disconnectAuthProvider(params?.provider));
		} catch (err) {
			sendError(respond, err);
		}
	}, { scope: "operator.admin" });
}

var unicore_workspace_default = definePluginEntry({
	id: "unicore-workspace",
	name: "Unicore Workspace",
	description: "Workspace-scoped tools for Unicore.",
	register(api) {
		registerXCloudPtyGatewayMethods(api);

		api.registerTool((ctx) => ({
			name: "xcloud_context",
			label: "xCloud Context",
			description: "Get xCloud desktop context for the current agent: connected UI repo, AG-UI guide path, registered frontend UI tools, and workspace metadata. Use this before changing or controlling the connected UI/app preview instead of relying on hidden prompt text.",
			parameters: XCloudContextSchema,
			async execute(_toolCallId, args) {
				return jsonResult(await buildXCloudContext(ctx, args ?? {}));
			}
		}), { names: ["xcloud_context"] });

		api.registerTool((ctx) => ({
			name: "xcloud_ui_action",
			label: "xCloud UI Action",
			description: "Execute a registered frontend UI tool in the connected xCloud preview and return the real result as a native tool result. Use this instead of hidden HTML directives when the user asks to control the live UI.",
			parameters: XCloudUiActionSchema,
			async execute(_toolCallId, args) {
				return jsonResult(await executeXCloudUiAction(ctx, args ?? {}));
			}
		}), { names: ["xcloud_ui_action"] });

		api.registerTool((ctx) => ({
			name: "xcloud_agent_ui_create",
			label: "xCloud Agent UI Create",
			description: "Create or link a separate Agent UI repo/folder for a specific agent. Use this when the user asks any agent to create a UI/interface/preview/app for itself or for another existing agent. Never use the current agent's connected UI repo for a different agent.",
			parameters: XCloudAgentUiCreateSchema,
			async execute(_toolCallId, args) {
				const input = args ?? {};
				const ui = await ensureAgentUi({
					agentId: requireText(input.agentId, "agentId"),
					repoPath: normalizeOptionalText(input.repoPath) || undefined,
					uiBriefMd: normalizeOptionalText(input.uiBriefMd) || undefined
				});
				return jsonResult({ ok: true, ...ui });
			}
		}), { names: ["xcloud_agent_ui_create"] });

		api.registerTool((ctx) => ({
			name: "xcloud_agent_create",
			label: "xCloud Agent Create",
			description: "Create or update a normal/global OpenClaw agent. This is for agents that are not inside an xCloud Workspace/project. If the user asks the new agent to have a UI/interface/preview/app, set createUi true so the UI is created inside that agent's own OpenClaw agent folder, never inside Main's connected UI repo.",
			parameters: XCloudAgentCreateSchema,
			async execute(_toolCallId, args) {
				const input = args ?? {};
				const agentId = normalizeAgentId(input.agentId);
				if (agentId.startsWith(WORKSPACE_PREFIX)) {
					throw new Error("Use workspace_agent_create for workspace coordinator/specialist agents.");
				}
				const agentWorkspacePath = resolveAgentWorkspaceDirById(agentId);
				const name = normalizeOptionalText(input.name) || agentId;
				const role = normalizeOptionalText(input.role);
				const model = normalizeOptionalText(input.model) || undefined;
				const addResult = await addAgentIfMissing({
					ctx,
					agentId,
					agentWorkspacePath,
					model
				});
					await writeAgentFiles({
						agentWorkspacePath,
						workspaceId: null,
						name,
						role,
						input
					});
					await updateAgentConfigName({ ctx, agentId, name });
					const ui = input.createUi === true
						? await ensureAgentUi({
							agentId,
						uiBriefMd: normalizeOptionalText(input.uiBriefMd) || role || name
					})
					: null;
				return jsonResult({
					ok: true,
					agentId,
					name,
					agentFolder: agentWorkspacePath,
					workspace: agentWorkspacePath,
					created: addResult.created,
					files: [
						"IDENTITY.md",
						"SOUL.md",
						"AGENTS.md",
						"PROJECT_BRIEF.md",
						"SOURCE_SPEC.md"
					],
					ui
				});
			}
		}), { names: ["xcloud_agent_create"] });

		api.registerTool((ctx) => ({
			name: "workspace_agent_create",
			label: "Workspace Agent Create",
			description: "Create or update a real OpenClaw specialist agent inside the current xCloud Workspace/project. Agent ids must be prefixed with the xCloud Workspace id and include tailored identity, soul, instructions, and project brief content. If the user asks the specialist to have a UI/interface/preview/app, set createUi true so the UI is linked to the new specialist agent, not to the current agent.",
			parameters: WorkspaceAgentCreateSchema,
			async execute(_toolCallId, args) {
				const input = args ?? {};
				const workspaceId = resolveWorkspaceId(ctx, input);
				const agentId = normalizeAgentId(input.agentId);
				if (!agentId.startsWith(`${workspaceId}-`)) {
					throw new Error(`Agent id "${agentId}" must start with "${workspaceId}-" for this workspace.`);
				}
				const workspaceBaseDir = resolveWorkspaceBaseDir(ctx);
				const agentWorkspacePath = path.join(workspaceBaseDir, agentId);
				const name = normalizeOptionalText(input.name) || agentId;
				const role = normalizeOptionalText(input.role);
				const model = normalizeOptionalText(input.model) || undefined;
				const addResult = await addAgentIfMissing({
					ctx,
					agentId,
					agentWorkspacePath,
					model
				});
					await writeAgentFiles({
						agentWorkspacePath,
						workspaceId,
						name,
						role,
						input
					});
					await updateAgentConfigName({ ctx, agentId, name });
					const ui = input.createUi === true
						? await ensureAgentUi({
							agentId,
						uiBriefMd: normalizeOptionalText(input.uiBriefMd) || role || name
					})
					: null;
				return jsonResult({
					ok: true,
					agentId,
					name,
					workspaceId,
					agentFolder: agentWorkspacePath,
					workspace: agentWorkspacePath,
					created: addResult.created,
					files: [
						"IDENTITY.md",
						"SOUL.md",
						"AGENTS.md",
						"PROJECT_BRIEF.md",
						"SOURCE_SPEC.md"
					],
					ui
				});
			}
		}), { names: ["workspace_agent_create"] });
	}
});

export { unicore_workspace_default as default };
