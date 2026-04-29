/** Configuration for creating an EngineClient */
export interface EngineClientConfig {
  /** WebSocket URL of the gateway (e.g. ws://127.0.0.1:18789) */
  url: string;
  /** Gateway auth token from openclaw.json */
  token: string;
  /** Path to device identity JSON file. If omitted, auto-detects from ~/.openclaw/identity/device.json */
  identityPath?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  reconnectMaxDelay?: number;
}

/** Persisted device identity from OpenClaw */
export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

// ─── Protocol Frames ──────────────────────────────────────────────────────────

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface EventFrame {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq?: number;
  stateVersion?: number;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

// ─── Hello-OK ─────────────────────────────────────────────────────────────────

export interface HelloOkPayload {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  auth: {
    role: string;
    scopes: string[];
    deviceToken?: string;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
  snapshot?: Record<string, unknown>;
}

// ─── Agent Events ─────────────────────────────────────────────────────────────

export interface AgentStreamDelta {
  runId: string;
  stream: "assistant";
  data: {
    text: string;
    delta: string;
  };
  sessionKey: string;
  seq: number;
  ts: number;
}

export interface AgentLifecycle {
  runId: string;
  stream: "lifecycle";
  data: {
    phase: "start" | "end";
    startedAt?: number;
    endedAt?: number;
    livenessState?: string;
  };
  sessionKey: string;
  seq: number;
  ts: number;
}

export interface AgentToolStream {
  runId: string;
  stream: "tool";
  data: Record<string, unknown>;
  sessionKey: string;
  seq: number;
  ts: number;
}

export type AgentEvent = AgentStreamDelta | AgentLifecycle | AgentToolStream;

// ─── Chat Events ──────────────────────────────────────────────────────────────

export interface ChatContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string | ChatContentBlock[];
  timestamp: number;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final";
  message?: ChatMessage;
}

// ─── Session Events ───────────────────────────────────────────────────────────

export interface SessionMessageEvent {
  sessionKey: string;
  message: ChatMessage;
  messageSeq: number;
  messageId?: string;
  session: {
    key: string;
    kind: string;
    chatType: string;
  };
}

export interface SessionToolEvent {
  sessionKey: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
  };
  status?: string;
}

// ─── Client Events (emitted by EngineClient) ─────────────────────────────────

export type EngineEvents = {
  /** Connected and authenticated with the gateway */
  connected: (info: { scopes: string[]; serverVersion: string }) => void;
  /** Disconnected from the gateway */
  disconnected: (info: { code: number; reason: string; willReconnect: boolean }) => void;
  /** Reconnecting attempt */
  reconnecting: (info: { attempt: number; delayMs: number }) => void;
  /** Error occurred */
  error: (error: Error) => void;
};

export type SessionEvents = {
  /** Streaming text delta from the agent */
  delta: (data: { text: string; delta: string; runId: string }) => void;
  /** Agent response is complete */
  response: (data: { text: string; runId: string }) => void;
  /** Tool call started/completed */
  toolCall: (data: { name: string; status: string; input?: Record<string, unknown> }) => void;
  /** Agent run lifecycle event */
  lifecycle: (data: { phase: "start" | "end"; runId: string }) => void;
  /** Raw session message (includes thinking blocks) */
  message: (data: SessionMessageEvent) => void;
};

// ─── RPC Results ──────────────────────────────────────────────────────────────

export interface SessionInfo {
  key: string;
  kind?: string;
  chatType?: string;
  updatedAt?: number;
  sessionId?: string;
}

export interface AgentInfo {
  id: string;
  default?: boolean;
  workspace?: string;
  model?: Record<string, unknown>;
}

export interface SendResult {
  runId: string;
  status: string;
}
