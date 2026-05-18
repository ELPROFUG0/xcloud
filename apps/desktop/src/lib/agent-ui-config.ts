import type { BrowserEngine } from "@/lib/engine";
import { engineScopedStorageKey } from "@/lib/engine-storage";

export interface AgentUiConfig {
  repoPath?: string;
  port?: number;
  updatedAt?: number;
  openInPreview?: boolean;
}

export function agentUiConfigStorageKey(agentId: string, engine: BrowserEngine) {
  return engineScopedStorageKey(`xcloudAgentUiConfig:${agentId}`, engine);
}

