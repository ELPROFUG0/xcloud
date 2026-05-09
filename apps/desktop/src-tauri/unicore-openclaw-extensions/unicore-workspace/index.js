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

var unicore_workspace_default = definePluginEntry({
	id: "unicore-workspace",
	name: "Unicore Workspace",
	description: "Workspace-scoped tools for Unicore.",
	register(api) {
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
