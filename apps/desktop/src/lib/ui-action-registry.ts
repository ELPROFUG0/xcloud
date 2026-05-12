export interface XCloudUiToolDefinition {
  name: string;
  description?: string;
  aliases?: string[];
  parameters?: Record<string, unknown>;
}

export interface XCloudUiActionRequest {
  agentId: string;
  instruction: string;
  preferredTool?: string;
}

export interface XCloudUiActionResult {
  ok: boolean;
  message: string;
  toolName?: string;
  output?: unknown;
}

const toolsByAgent = new Map<string, XCloudUiToolDefinition[]>();
const listeners = new Set<() => void>();

function normalizeTool(tool: XCloudUiToolDefinition): XCloudUiToolDefinition | null {
  const name = tool.name?.trim();
  if (!name) return null;
  return {
    name,
    description: tool.description?.trim(),
    aliases: Array.isArray(tool.aliases) ? tool.aliases.map(String).filter(Boolean) : [],
    parameters: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : undefined,
  };
}

export function setRegisteredUiTools(agentId: string, tools: XCloudUiToolDefinition[]) {
  const normalized = tools.map(normalizeTool).filter((tool): tool is XCloudUiToolDefinition => Boolean(tool));
  toolsByAgent.set(agentId, normalized);
  for (const listener of listeners) listener();
}

export function getRegisteredUiTools(agentId: string) {
  return toolsByAgent.get(agentId) ?? [];
}

export function subscribeRegisteredUiTools(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function executeRegisteredUiAction(request: XCloudUiActionRequest): Promise<XCloudUiActionResult> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("xcloud-ui-action-request", {
      detail: {
        ...request,
        resolve,
      },
    }));
  });
}
