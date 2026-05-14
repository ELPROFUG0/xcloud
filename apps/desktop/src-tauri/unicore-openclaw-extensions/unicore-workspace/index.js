import { t as definePluginEntry } from "../../plugin-entry-DyZc6JGI.js";
import { t as agentsAddCommand } from "../../agents.commands.add-D3K-MXUw.js";
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
	}))
});

const XCloudContextSchema = Type.Object({
	includeGuide: Type.Optional(Type.Boolean({
		description: "Include the connected UI guide file when available. Default false."
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
	const agentId = resolveAgentId(ctx);
	const workspaceDir = resolveAgentWorkspaceDir(ctx);
	const uiConfig = await readJsonFile(path.join(workspaceDir, "ui-config.json"));
	const repoPath = typeof uiConfig?.repoPath === "string" && uiConfig.repoPath.trim()
		? path.resolve(workspaceDir, uiConfig.repoPath.trim())
		: null;
	const toolsRecord = await readJsonFile(path.join(workspaceDir, ".xcloud", "ui-tools.json"));
	const uiTools = normalizeUiTools(toolsRecord?.tools);
	const guidePath = repoPath ? path.join(repoPath, "XCLOUD-UI.md") : null;
	const guide = args?.includeGuide && guidePath ? await readTextFileOptional(guidePath) : null;

	return {
		ok: true,
		agentId,
		workspaceDir,
		ui: {
			connected: Boolean(repoPath),
			repoPath,
			guidePath,
			guide,
			runtimeTools: uiTools,
			instructions: [
				"If the user asks to change the connected preview/UI, edit the connected UI repo.",
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

var unicore_workspace_default = definePluginEntry({
	id: "unicore-workspace",
	name: "Unicore Workspace",
	description: "Workspace-scoped tools for Unicore.",
	register(api) {
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
			name: "workspace_agent_create",
			label: "Workspace Agent Create",
			description: "Create or update a real OpenClaw specialist agent for the current Unicore workspace. Agent ids must be prefixed with the workspace id and include tailored identity, soul, instructions, and project brief content.",
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
				return jsonResult({
					ok: true,
					agentId,
					name,
					workspaceId,
					workspace: agentWorkspacePath,
					created: addResult.created,
					files: [
						"IDENTITY.md",
						"SOUL.md",
						"AGENTS.md",
						"PROJECT_BRIEF.md",
						"SOURCE_SPEC.md"
					]
				});
			}
		}), { names: ["workspace_agent_create"] });
	}
});

export { unicore_workspace_default as default };
