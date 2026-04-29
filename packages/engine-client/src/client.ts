import WebSocket from "ws";
import crypto from "node:crypto";
import { TypedEmitter } from "./emitter.js";
import { loadDeviceIdentity, buildConnectParams } from "./auth.js";
import { Session } from "./session.js";
import type {
  EngineClientConfig,
  EngineEvents,
  DeviceIdentity,
  Frame,
  ResponseFrame,
  EventFrame,
  HelloOkPayload,
  AgentEvent,
  ChatEvent,
  SessionMessageEvent,
  SessionToolEvent,
  SessionInfo,
  AgentInfo,
} from "./types.js";

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const RPC_TIMEOUT_MS = 30_000;

/**
 * Client for the OpenClaw Gateway WebSocket API.
 *
 * @example
 * ```ts
 * const engine = new EngineClient({
 *   url: 'ws://127.0.0.1:18789',
 *   token: '...',
 * });
 *
 * await engine.connect();
 * const session = engine.session('main');
 * session.on('delta', ({ delta }) => process.stdout.write(delta));
 * session.on('response', ({ text }) => console.log('Done:', text));
 * await session.send('Hello!');
 * ```
 */
export class EngineClient extends TypedEmitter<EngineEvents> {
  private ws: WebSocket | null = null;
  private identity: DeviceIdentity;
  private pending = new Map<string, PendingRequest>();
  private sessions = new Map<string, Session>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private _connected = false;
  private _serverVersion = "";

  readonly config: Readonly<Required<EngineClientConfig>>;

  constructor(config: EngineClientConfig) {
    super();
    this.config = {
      autoReconnect: true,
      reconnectBaseDelay: 1000,
      reconnectMaxDelay: 30_000,
      identityPath: "",
      ...config,
    };
    this.identity = loadDeviceIdentity(this.config.identityPath || undefined);
  }

  /** Whether the client is currently connected and authenticated */
  get connected(): boolean {
    return this._connected;
  }

  /** The gateway server version (available after connect) */
  get serverVersion(): string {
    return this._serverVersion;
  }

  /** Connect to the gateway */
  async connect(): Promise<void> {
    this.intentionalClose = false;
    await this.createConnection();
  }

  /** Disconnect from the gateway */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.rejectAllPending("Client disconnected");
  }

  /**
   * Get or create a session for the given key.
   * Call session.subscribe() to start receiving events, then session.send() to chat.
   */
  session(key: string): Session {
    let s = this.sessions.get(key);
    if (!s) {
      s = new Session(key, (method, params) => this.rpc(method, params));
      this.sessions.set(key, s);
    }
    return s;
  }

  /** Send an RPC request and wait for the response */
  async rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to gateway");
    }

    const id = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${RPC_TIMEOUT_MS}ms)`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  /** List all sessions */
  async listSessions(): Promise<SessionInfo[]> {
    const result = await this.rpc("sessions.list");
    return (result as { sessions?: SessionInfo[] }).sessions ?? [];
  }

  /** List all agents */
  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.rpc("agents.list");
    return (result as { agents?: AgentInfo[] }).agents ?? [];
  }

  // ─── Connection lifecycle ───────────────────────────────────────────────────

  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;
      let settled = false;

      ws.on("message", (data: Buffer) => {
        const frame: Frame = JSON.parse(data.toString());

        // Handle connect.challenge
        if (frame.type === "event" && (frame as EventFrame).event === "connect.challenge") {
          const nonce = ((frame as EventFrame).payload as { nonce: string }).nonce;
          const connectParams = buildConnectParams({
            token: this.config.token,
            identity: this.identity,
            nonce,
          });
          ws.send(JSON.stringify({
            type: "req",
            id: "__handshake",
            method: "connect",
            params: connectParams,
          }));
          return;
        }

        // Handle handshake response
        if (frame.type === "res" && (frame as ResponseFrame).id === "__handshake") {
          const res = frame as ResponseFrame;
          if (res.ok) {
            const helloOk = res.payload as unknown as HelloOkPayload;
            this._connected = true;
            this._serverVersion = helloOk.server.version;
            this.reconnectAttempt = 0;

            this.emit("connected", {
              scopes: helloOk.auth.scopes,
              serverVersion: helloOk.server.version,
            });

            // Re-subscribe existing sessions
            this.resubscribeSessions();

            if (!settled) { settled = true; resolve(); }
          } else {
            const err = new Error(res.error?.message ?? "Handshake failed");
            if (!settled) { settled = true; reject(err); }
          }
          return;
        }

        // Normal frame handling (post-handshake)
        this.handleFrame(frame);
      });

      ws.on("close", (code: number, reason: Buffer) => {
        const wasConnected = this._connected;
        this._connected = false;
        const willReconnect = !this.intentionalClose && this.config.autoReconnect;

        this.rejectAllPending("Connection closed");

        if (wasConnected) {
          this.emit("disconnected", {
            code,
            reason: reason.toString(),
            willReconnect,
          });
        }

        if (!settled) {
          settled = true;
          reject(new Error(`Connection closed before handshake (code: ${code})`));
        }

        if (willReconnect) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        this.emit("error", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  // ─── Frame routing ──────────────────────────────────────────────────────────

  private handleFrame(frame: Frame): void {
    if (frame.type === "res") {
      this.handleResponse(frame as ResponseFrame);
    } else if (frame.type === "event") {
      this.handleEvent(frame as EventFrame);
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const req = this.pending.get(frame.id);
    if (!req) return;

    clearTimeout(req.timer);
    this.pending.delete(frame.id);

    if (frame.ok) {
      req.resolve(frame.payload ?? {});
    } else {
      req.reject(new Error(frame.error?.message ?? "RPC error"));
    }
  }

  private handleEvent(frame: EventFrame): void {
    const { event, payload } = frame;

    // Route agent streaming events to matching sessions
    if (event === "agent") {
      const sessionKey = (payload as { sessionKey?: string }).sessionKey;
      if (sessionKey) {
        this.routeToSessions(sessionKey, (s) =>
          s.handleAgentEvent(payload as unknown as AgentEvent),
        );
      }
      return;
    }

    if (event === "chat") {
      const sessionKey = (payload as { sessionKey?: string }).sessionKey;
      if (sessionKey) {
        this.routeToSessions(sessionKey, (s) =>
          s.handleChatEvent(payload as unknown as ChatEvent),
        );
      }
      return;
    }

    if (event === "session.message") {
      const sessionKey = (payload as { sessionKey?: string }).sessionKey;
      if (sessionKey) {
        this.routeToSessions(sessionKey, (s) =>
          s.handleSessionMessage(payload as unknown as SessionMessageEvent),
        );
      }
      return;
    }

    if (event === "session.tool") {
      const sessionKey = (payload as { sessionKey?: string }).sessionKey;
      if (sessionKey) {
        this.routeToSessions(sessionKey, (s) =>
          s.handleSessionTool(payload as unknown as SessionToolEvent),
        );
      }
    }
  }

  private routeToSessions(sessionKey: string, handler: (s: Session) => void): void {
    for (const session of this.sessions.values()) {
      if (session.matchesKey(sessionKey)) {
        handler(session);
      }
    }
  }

  // ─── Reconnection ──────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const base = this.config.reconnectBaseDelay;
    const max = this.config.reconnectMaxDelay;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempt - 1), max);

    this.emit("reconnecting", { attempt: this.reconnectAttempt, delayMs: delay });

    this.reconnectTimer = setTimeout(() => {
      this.createConnection().catch(() => {
        // Connection failed — scheduleReconnect will be called from close handler
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async resubscribeSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      try {
        await session.subscribe();
      } catch {
        // Subscription may fail if session doesn't exist yet — that's OK
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
