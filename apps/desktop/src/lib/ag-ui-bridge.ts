import { EventType, type AGUIEvent, type AgentCapabilities } from "@ag-ui/core";

export const XCLOUD_AG_UI_EVENT = "xcloud-ag-ui-event";

type AgUiBridgeDetail = {
  sessionKey: string;
  event: AGUIEvent;
};

const runMessageIds = new Map<string, string>();
const startedTextMessages = new Set<string>();
const latestTextByRun = new Map<string, string>();
const sessionToolCallIds = new Map<string, string>();

function timestamp() {
  return Date.now();
}

function getRunId(payload: Record<string, unknown>) {
  return typeof payload.runId === "string" ? payload.runId : `run-${timestamp()}`;
}

function getMessageId(sessionKey: string, runId: string) {
  const key = `${sessionKey}:${runId}`;
  const current = runMessageIds.get(key);
  if (current) return current;
  const next = `message-${runId}`;
  runMessageIds.set(key, next);
  return next;
}

function getRunKey(sessionKey: string, runId: string) {
  return `${sessionKey}:${runId}`;
}

function forgetMessageId(sessionKey: string, runId: string) {
  const runKey = getRunKey(sessionKey, runId);
  runMessageIds.delete(runKey);
  latestTextByRun.delete(runKey);
  startedTextMessages.delete(`${runKey}:assistant-start`);
}

function asAgUiEvent(event: Record<string, unknown>): AGUIEvent {
  return event as AGUIEvent;
}

function stringifyToolArgs(input: unknown) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function stringifyToolResult(input: unknown) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function getToolName(data: Record<string, unknown> | undefined) {
  const tool = data?.tool as Record<string, unknown> | undefined;
  return (data?.name as string | undefined)
    ?? (tool?.name as string | undefined)
    ?? "unknown";
}

function getToolInput(data: Record<string, unknown> | undefined) {
  const tool = data?.tool as Record<string, unknown> | undefined;
  return data?.input ?? tool?.input;
}

function getToolOutput(data: Record<string, unknown> | undefined) {
  return data?.output ?? data?.result ?? data?.error;
}

function getToolCallId(sessionKey: string, runId: string, data: Record<string, unknown> | undefined, now: number) {
  const directId = (data?.toolCallId as string | undefined)
    ?? (data?.tool_call_id as string | undefined)
    ?? (data?.id as string | undefined)
    ?? ((data?.tool as Record<string, unknown> | undefined)?.id as string | undefined);
  if (directId) return directId;

  const name = getToolName(data);
  const fingerprint = `${sessionKey}:${runId}:${name}:${stringifyToolArgs(getToolInput(data))}`;
  const current = sessionToolCallIds.get(fingerprint);
  if (current) return current;
  const next = `${name}-${now}`;
  sessionToolCallIds.set(fingerprint, next);
  return next;
}

function textDelta(sessionKey: string, runId: string, data: Record<string, unknown> | undefined) {
  const delta = typeof data?.delta === "string" ? data.delta : "";
  if (delta) {
    const runKey = getRunKey(sessionKey, runId);
    latestTextByRun.set(runKey, `${latestTextByRun.get(runKey) ?? ""}${delta}`);
    return delta;
  }

  if (typeof data?.text !== "string") return "";
  const runKey = getRunKey(sessionKey, runId);
  const previous = latestTextByRun.get(runKey) ?? "";
  const text = data.text;
  latestTextByRun.set(runKey, text);
  return text.startsWith(previous) ? text.slice(previous.length) : text;
}

export function emitAgUiEvent(sessionKey: string, event: AGUIEvent) {
  window.dispatchEvent(new CustomEvent<AgUiBridgeDetail>(XCLOUD_AG_UI_EVENT, {
    detail: { sessionKey, event },
  }));
}

export function emitAgUiEvents(sessionKey: string, events: AGUIEvent[]) {
  for (const event of events) emitAgUiEvent(sessionKey, event);
}

export function userMessageToAgUiEvents(content: string): AGUIEvent[] {
  const messageId = `user-${timestamp()}`;
  return [
    asAgUiEvent({ type: EventType.TEXT_MESSAGE_START, messageId, role: "user", timestamp: timestamp() }),
    asAgUiEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: content, timestamp: timestamp() }),
    asAgUiEvent({ type: EventType.TEXT_MESSAGE_END, messageId, timestamp: timestamp() }),
  ];
}

export function xcloudCapabilities(agentId: string, tools: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }> = []): AgentCapabilities {
  return {
    identity: {
      name: agentId === "main" ? "xCloud Main Agent" : `xCloud Agent ${agentId}`,
      type: "openclaw",
      provider: "xCloud",
    },
    transport: {
      streaming: true,
      websocket: true,
    },
    tools: {
      supported: true,
      clientProvided: true,
      items: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? `Frontend tool ${tool.name}`,
        parameters: tool.parameters ?? { type: "object", properties: {}, required: [] },
      })),
    },
    state: {
      snapshots: true,
      deltas: false,
      memory: true,
      persistentState: true,
    },
    custom: {
      host: "xcloud-desktop",
      bridgeEvent: XCLOUD_AG_UI_EVENT,
    },
  };
}

export function openClawFrameToAgUiEvents(sessionKey: string, frameEvent: string, payload: Record<string, unknown>): AGUIEvent[] {
  const runId = getRunId(payload);
  const now = timestamp();

  if (frameEvent === "agent") {
    const stream = payload.stream as string;
    const data = payload.data as Record<string, unknown> | undefined;

    if (stream === "lifecycle") {
      const phase = data?.phase;
      if (phase === "start") {
        return [asAgUiEvent({
          type: EventType.RUN_STARTED,
          threadId: sessionKey,
          runId,
          timestamp: now,
          rawEvent: payload,
        })];
      }
      if (phase === "end") {
        const messageId = getMessageId(sessionKey, runId);
        const hadStartedMessage = startedTextMessages.has(`${getRunKey(sessionKey, runId)}:assistant-start`);
        forgetMessageId(sessionKey, runId);
        return [
          ...(hadStartedMessage ? [asAgUiEvent({ type: EventType.TEXT_MESSAGE_END, messageId, timestamp: now, rawEvent: payload })] : []),
          asAgUiEvent({ type: EventType.RUN_FINISHED, threadId: sessionKey, runId, timestamp: now, rawEvent: payload }),
        ];
      }
    }

    if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
      const delta = textDelta(sessionKey, runId, data);
      const messageId = getMessageId(sessionKey, runId);
      const startKey = `${getRunKey(sessionKey, runId)}:assistant-start`;
      const events: AGUIEvent[] = [];
      if (!startedTextMessages.has(startKey)) {
        startedTextMessages.add(startKey);
        events.push(asAgUiEvent({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
          timestamp: now,
          rawEvent: payload,
        }));
      }
      if (delta) {
        events.push(asAgUiEvent({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta,
          timestamp: now,
          rawEvent: payload,
        }));
      }
      return events;
    }

    if ((stream === "item" && data?.kind === "tool") || (stream === "tool" && data)) {
      const toolData = data;
      const phase = toolData.phase as string;
      const name = getToolName(toolData);
      const toolCallId = getToolCallId(sessionKey, runId, toolData, now);
      const messageId = getMessageId(sessionKey, runId);
      const input = getToolInput(toolData);
      const output = getToolOutput(toolData);
      if (phase === "start" || phase === "running" || (!phase && input != null)) {
        return [
          asAgUiEvent({
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: name,
            parentMessageId: messageId,
            timestamp: now,
            rawEvent: payload,
          }),
          asAgUiEvent({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: stringifyToolArgs(input),
            timestamp: now,
            rawEvent: payload,
          }),
        ];
      }
      if (phase === "end" || phase === "completed" || phase === "failed" || output != null) {
        return [
          asAgUiEvent({
            type: EventType.TOOL_CALL_END,
            toolCallId,
            timestamp: now,
            rawEvent: payload,
          }),
          ...(output != null ? [asAgUiEvent({
            type: EventType.TOOL_CALL_RESULT,
            messageId: `tool-result-${toolCallId}`,
            toolCallId,
            content: stringifyToolResult(output),
            role: "tool",
            timestamp: now,
            rawEvent: payload,
          })] : []),
        ];
      }
    }

    if (stream === "command_output" && data) {
      const toolCallId = data.toolCallId as string | undefined;
      const output = data.output as string | undefined;
      if (toolCallId && output) {
        return [asAgUiEvent({
          type: EventType.TOOL_CALL_RESULT,
          messageId: `tool-result-${toolCallId}`,
          toolCallId,
          content: output,
          role: "tool",
          timestamp: now,
          rawEvent: payload,
        })];
      }
    }
  }

  if (frameEvent === "session.tool") {
    const data = payload as Record<string, unknown>;
    const status = data.status as string | undefined;
    const name = getToolName(data);
    const toolCallId = getToolCallId(sessionKey, runId, data, now);
    const messageId = getMessageId(sessionKey, runId);
    const output = getToolOutput(data);

    if (status === "running" || status === "started" || status === "start") {
      return [
        asAgUiEvent({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: name,
          parentMessageId: messageId,
          timestamp: now,
          rawEvent: payload,
        }),
        asAgUiEvent({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: stringifyToolArgs(getToolInput(data)),
          timestamp: now,
          rawEvent: payload,
        }),
      ];
    }

    if (status === "completed" || status === "done" || status === "error" || status === "failed") {
      return [
        asAgUiEvent({ type: EventType.TOOL_CALL_END, toolCallId, timestamp: now, rawEvent: payload }),
        ...(output != null ? [asAgUiEvent({
          type: EventType.TOOL_CALL_RESULT,
          messageId: `tool-result-${toolCallId}`,
          toolCallId,
          content: stringifyToolResult(output),
          role: "tool",
          timestamp: now,
          rawEvent: payload,
        })] : []),
      ];
    }
  }

  if (frameEvent === "chat") {
    const state = payload.state as string;
    if (state === "aborted" || state === "error") {
      forgetMessageId(sessionKey, runId);
      return [asAgUiEvent({
        type: EventType.RUN_ERROR,
        message: state === "aborted" ? "Run aborted" : "Run failed",
        code: state,
        timestamp: now,
        rawEvent: payload,
      })];
    }
  }

  return [];
}
