import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { resolveAvatarUrl } from "@/lib/avatar";

export interface AgentInfo {
  id: string;
  name?: string;
  emoji?: string;
  avatar?: string;
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

/** Parse IDENTITY.md frontmatter-style fields */
function parseIdentity(content: string): { name?: string; emoji?: string; avatar?: string } {
  const result: { name?: string; emoji?: string; avatar?: string } = {};
  const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/i) ?? content.match(/^-\s*\*\*Name:\*\*\s*(.+)/mi);
  if (nameMatch) result.name = nameMatch[1]!.trim();
  const emojiMatch = content.match(/\*\*Emoji:\*\*\s*(.+)/i) ?? content.match(/^-\s*\*\*Emoji:\*\*\s*(.+)/mi);
  if (emojiMatch) result.emoji = emojiMatch[1]!.trim();
  const avatarMatch = content.match(/\*\*Avatar:\*\*\s*(.+)/i) ?? content.match(/^-\s*\*\*Avatar:\*\*\s*(.+)/mi);
  if (avatarMatch && avatarMatch[1]!.trim()) result.avatar = avatarMatch[1]!.trim();
  return result;
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

      // Read IDENTITY.md for each agent from their workspace
      for (const agent of list) {
        const wsPath = agent.isDefault
          ? ".openclaw/workspace/IDENTITY.md"
          : `.openclaw/workspace/${agent.id}/IDENTITY.md`;
        readTextFile(wsPath, { baseDir: BaseDirectory.Home })
          .then((content) => {
            const identity = parseIdentity(content);
            if (identity.name || identity.emoji || identity.avatar) {
              // Resolve avatar URL if present
              if (identity.avatar) {
                resolveAvatarUrl(agent.id, identity.avatar).then((url) => {
                  setAgents((prev) =>
                    prev.map((a) =>
                      a.id === agent.id
                        ? { ...a, name: identity.name ?? a.name, emoji: identity.emoji ?? a.emoji, avatar: url }
                        : a,
                    ),
                  );
                }).catch(() => {});
              } else {
                setAgents((prev) =>
                  prev.map((a) =>
                    a.id === agent.id
                      ? { ...a, name: identity.name ?? a.name, emoji: identity.emoji ?? a.emoji }
                      : a,
                  ),
                );
              }
            }
          })
          .catch(() => { /* IDENTITY.md may not exist */ });
      }

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

  // Auto-refresh when agent finishes responding (may have changed identity/name)
  useEffect(() => {
    const unsub = engine.onEvent((frame) => {
      const event = frame.event as string;
      const payload = frame.payload as Record<string, unknown>;

      // Refresh after agent lifecycle ends or sessions change
      if (event === "agent") {
        const stream = payload.stream as string;
        const data = payload.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && data?.phase === "end") {
          refresh();
        }
      }
      if (event === "sessions.changed") {
        refresh();
      }
    });
    return unsub;
  }, [engine, refresh]);

  return { agents, selectedId, select: setSelectedId, refresh, loading };
}
