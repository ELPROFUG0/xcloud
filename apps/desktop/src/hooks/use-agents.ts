import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";

export interface AgentInfo {
  id: string;
  name?: string;
  workspace: string;
  model?: { primary?: string };
  isDefault?: boolean;
  status: "active" | "idle" | "error";
}

interface UseAgentsReturn {
  agents: AgentInfo[];
  selectedId: string;
  select: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}

export function useAgents(engine: BrowserEngine): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedId, setSelectedId] = useState("main");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await engine.rpc("agents.list", {});
      const payload = result as {
        defaultId?: string;
        agents?: Array<{
          id: string;
          name?: string;
          workspace?: string;
          model?: { primary?: string };
        }>;
      };

      const list: AgentInfo[] = (payload.agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        workspace: a.workspace ?? "",
        model: a.model,
        isDefault: a.id === payload.defaultId,
        status: "active" as const,
      }));

      setAgents(list);

      // If selected agent no longer exists, fallback to default
      if (!list.find((a) => a.id === selectedId)) {
        setSelectedId(payload.defaultId ?? "main");
      }
    } catch {
      // Keep existing agents on error
    } finally {
      setLoading(false);
    }
  }, [engine, selectedId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, selectedId, select: setSelectedId, refresh, loading };
}
