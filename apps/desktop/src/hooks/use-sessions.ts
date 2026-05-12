import { useCallback, useEffect, useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import { BaseDirectory, readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";

export interface SessionInfo {
  key: string;
  agentId: string;
  preview: string;
  updatedAt: number;
  status: "working" | "completed" | "idle";
}

const SESSIONS_CACHE_KEY = "xcloudCachedSessionsV2";

function readCachedSessions(): SessionInfo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_CACHE_KEY) ?? "[]") as SessionInfo[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => session && typeof session.key === "string")
      .map((session) => ({
        key: session.key,
        agentId: session.agentId || extractAgentId(session.key),
        preview: session.preview || "",
        updatedAt: Number(session.updatedAt || 0),
        status: session.status || "idle",
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeCachedSessions(sessions: SessionInfo[]) {
  try {
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage failures; live sessions still work.
  }
}

function parseTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? time : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function mergeSessions(...sources: SessionInfo[][]): SessionInfo[] {
  const merged = new Map<string, SessionInfo>();
  for (const sessions of sources) {
    for (const session of sessions) {
      const existing = merged.get(session.key);
      merged.set(session.key, {
        key: session.key,
        agentId: session.agentId || existing?.agentId || extractAgentId(session.key),
        preview: session.preview || existing?.preview || "",
        updatedAt: Math.max(session.updatedAt || 0, existing?.updatedAt || 0),
        status: session.status === "working" || existing?.status === "working"
          ? "working"
          : session.status || existing?.status || "idle",
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function extractIndexedSessions(raw: string): Array<{ key: string; sessionId?: string; updatedAt: number }> {
  const sessions: Array<{ key: string; sessionId?: string; updatedAt: number }> = [];
  const prettyEntryPattern = /^\s{2}"([^"]+)":\s*\{\s*[\r\n]+\s{4}"sessionId":\s*"([^"]+)"([\s\S]*?)(?=^\s{2}"[^"]+":\s*\{|\n\})/gm;
  for (const match of raw.matchAll(prettyEntryPattern)) {
    const key = match[1];
    if (!key) continue;
    const body = match[3] ?? "";
    sessions.push({
      key,
      sessionId: match[2],
      updatedAt: parseTimestamp(body.match(/"updatedAt":\s*([0-9]+)/)?.[1])
        ?? parseTimestamp(body.match(/"lastInteractionAt":\s*([0-9]+)/)?.[1])
        ?? parseTimestamp(body.match(/"sessionStartedAt":\s*([0-9]+)/)?.[1])
        ?? 0,
    });
  }
  if (sessions.length > 0) return sessions;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).map(([key, value]) => {
      const entry = value && typeof value === "object"
        ? value as Record<string, unknown>
        : undefined;
      return {
        key,
        sessionId: typeof value === "string"
          ? value
          : typeof entry?.sessionId === "string"
            ? entry.sessionId
            : undefined,
        updatedAt: parseTimestamp(entry?.updatedAt)
          ?? parseTimestamp(entry?.lastInteractionAt)
          ?? parseTimestamp(entry?.sessionStartedAt)
          ?? 0,
      };
    }).filter((session) => session.key);
  } catch {
    return [];
  }
}

async function readOpenClawDiskSessions(): Promise<SessionInfo[]> {
  try {
    const agents = await readDir(".openclaw/agents", { baseDir: BaseDirectory.Home });
    const results = await Promise.all(agents
      .filter((agent) => agent.isDirectory && agent.name)
      .map(async (agent) => {
        try {
          const indexPath = `.openclaw/agents/${agent.name}/sessions/sessions.json`;
          const raw = await readTextFile(indexPath, { baseDir: BaseDirectory.Home });
          const sessions: SessionInfo[] = [];

          for (const indexed of extractIndexedSessions(raw)) {
            let updatedAt = indexed.updatedAt;
            if (!updatedAt && indexed.sessionId) {
              const fileInfo = await stat(`.openclaw/agents/${agent.name}/sessions/${indexed.sessionId}.jsonl`, {
                baseDir: BaseDirectory.Home,
              }).catch(() => undefined);
              updatedAt = parseTimestamp(fileInfo?.mtime) ?? 0;
            }

            sessions.push({
              key: indexed.key,
              agentId: extractAgentId(indexed.key),
              preview: "",
              updatedAt,
              status: "idle",
            });
          }

          return sessions;
        } catch {
          return [];
        }
      }));

    return mergeSessions(...results);
  } catch {
    return [];
  }
}

export function useSessions(engine: BrowserEngine) {
  const [sessions, setSessions] = useState<SessionInfo[]>(() => readCachedSessions());

  const refresh = useCallback(async () => {
    try {
      const result = await engine.rpc("sessions.list", {}) as Record<string, unknown>;
      const raw = result.sessions as Array<Record<string, unknown>> | Record<string, Record<string, unknown>> | undefined;

      const list: SessionInfo[] = [];
      const cachedByKey = new Map(readCachedSessions().map((session) => [session.key, session]));

      if (Array.isArray(raw)) {
        for (const s of raw) {
          const key = s.key as string;
          if (!key) continue;
          const cached = cachedByKey.get(key);
          list.push({
            key,
            agentId: extractAgentId(key),
            preview: (s.preview as string) ?? (s.title as string) ?? cached?.preview ?? "",
            updatedAt: parseTimestamp(s.updatedAt) ?? cached?.updatedAt ?? 0,
            status: (s.status as SessionInfo["status"]) ?? "idle",
          });
        }
      } else if (raw && typeof raw === "object") {
        for (const [key, s] of Object.entries(raw)) {
          const cached = cachedByKey.get(key);
          list.push({
            key,
            agentId: extractAgentId(key),
            preview: (s.preview as string) ?? (s.title as string) ?? cached?.preview ?? "",
            updatedAt: parseTimestamp((s as Record<string, unknown>).updatedAt) ?? cached?.updatedAt ?? 0,
            status: (s.status as SessionInfo["status"]) ?? "idle",
          });
        }
      }

      list.sort((a, b) => b.updatedAt - a.updatedAt);

      // Load first user message as preview and derive a real timestamp if sessions.list omits one.
      for (const session of list) {
        if (!session.preview || !session.updatedAt) {
          try {
            const histResult = await engine.rpc("chat.history", { sessionKey: session.key }) as Record<string, unknown>;
            const messages = (histResult.messages as Array<Record<string, unknown>>) ?? [];
            const firstUser = messages.find(m => m.role === "user");
            const latestTimestamp = Math.max(0, ...messages.map((message) => parseTimestamp(message.timestamp) ?? 0));
            if (!session.updatedAt && latestTimestamp > 0) {
              session.updatedAt = latestTimestamp;
            }
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

      const merged = mergeSessions(readCachedSessions(), list);
      writeCachedSessions(merged);
      setSessions(merged);
    } catch {
      // sessions.list may not be available
    }
  }, [engine]);

  useEffect(() => {
    let cancelled = false;
    void readOpenClawDiskSessions().then((diskSessions) => {
      if (cancelled || diskSessions.length === 0) return;
      const merged = mergeSessions(readCachedSessions(), diskSessions);
      writeCachedSessions(merged);
      setSessions(merged);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timers = [0, 500, 1500, 3000].map((delay) => window.setTimeout(() => {
      if (!cancelled) void refresh();
    }, delay));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [refresh]);

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
