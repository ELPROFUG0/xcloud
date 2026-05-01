import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";

export interface SessionInfo {
  key: string;
  agentId: string;
  preview: string;
  updatedAt: number;
  status: "working" | "completed" | "idle";
}

export function useSessions(engine: BrowserEngine) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await engine.rpc("sessions.list", {}) as Record<string, unknown>;
      const raw = result.sessions as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined;

      const list: SessionInfo[] = [];

      if (Array.isArray(raw)) {
        for (const s of raw) {
          const key = s.key as string;
          if (!key) continue;
          list.push({
            key,
            agentId: extractAgentId(key),
            preview: (s.preview as string) ?? (s.title as string) ?? "",
            updatedAt: (s.updatedAt as number) ?? Date.now(),
            status: (s.status as SessionInfo["status"]) ?? "idle",
          });
        }
      } else if (raw && typeof raw === "object") {
        for (const [key, s] of Object.entries(raw)) {
          list.push({
            key,
            agentId: extractAgentId(key),
            preview: (s.preview as string) ?? (s.title as string) ?? "",
            updatedAt: (s.updatedAt as number) ?? Date.now(),
            status: (s.status as SessionInfo["status"]) ?? "idle",
          });
        }
      }

      list.sort((a, b) => b.updatedAt - a.updatedAt);

      // Load first user message as preview for sessions without one
      for (const session of list) {
        if (!session.preview) {
          try {
            const histResult = await engine.rpc("chat.history", { sessionKey: session.key }) as Record<string, unknown>;
            const messages = (histResult.messages as Array<Record<string, unknown>>) ?? [];
            const firstUser = messages.find(m => m.role === "user");
            if (firstUser) {
              const content = typeof firstUser.content === "string"
                ? firstUser.content
                : Array.isArray(firstUser.content)
                  ? (firstUser.content as Array<Record<string, unknown>>).find(b => b.type === "text")?.text as string ?? ""
                  : "";
              session.preview = content.slice(0, 80).replace(/\n/g, " ").trim();
            }
          } catch { /* ignore */ }
        }
        if (!session.preview) {
          session.preview = session.key.split(":").pop() ?? session.key;
        }
      }

      setSessions(list);
    } catch {
      // sessions.list may not be available
    }
  }, [engine]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh on session changes
  useEffect(() => {
    const unsub = engine.onEvent((frame) => {
      if ((frame.event as string) === "sessions.changed") {
        refresh();
      }
    });
    return unsub;
  }, [engine, refresh]);

  const getAgentSessions = useCallback((agentId: string) => {
    return sessions.filter(s => s.agentId === agentId);
  }, [sessions]);

  return { sessions, getAgentSessions, refresh };
}

function extractAgentId(key: string): string {
  if (key === "main") return "main";
  const parts = key.split(":");
  if (parts[0] === "agent" && parts.length >= 2) return parts[1]!;
  return "main";
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
