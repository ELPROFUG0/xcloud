/**
 * Browser-compatible WebSocket client for OpenClaw Gateway.
 *
 * Uses Web Crypto API for ed25519 device signing (supported in modern browsers).
 * Supports auto-reconnection with exponential backoff.
 */

export interface SlashCommand {
  name: string;
  description: string;
  category: string;
  acceptsArgs?: boolean;
}

export interface EngineAttachment {
  type: "file";
  mimeType?: string;
  fileName?: string;
  content?: string;
  source?: {
    type: "base64";
    media_type?: string;
    data: string;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface EngineConfig {
  url: string;
  token: string;
  deviceId: string;
  publicKeyBase64Url: string;
  privateKeyPkcs8Base64: string;
  mode?: "local" | "mac-mini" | "vps";
  scopeKey?: string;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";
export type FrameHandler = (frame: Record<string, unknown>) => void;

const GATEWAY_MIN_PROTOCOL = 3;
const GATEWAY_MAX_PROTOCOL = 4;
const OPERATOR_ADMIN_SCOPES = ["operator.admin"];

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class BrowserEngine {
  private ws: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }>();
  private eventHandlers = new Set<FrameHandler>();
  private _connected = false;
  private signingKey: CryptoKey | null = null;

  // Reconnection state
  private _state: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 20;
  private stateChangeHandlers = new Set<(state: ConnectionState) => void>();
  private fatalHandlers = new Set<(error: string) => void>();
  private wasConnected = false;

  constructor(private config: EngineConfig) {}

  get connected(): boolean { return this._connected; }
  get state(): ConnectionState { return this._state; }
  get authToken(): string { return this.config.token; }
  get mode(): EngineConfig["mode"] { return this.config.mode ?? "local"; }
  get isRemote(): boolean { return this.mode !== "local"; }
  get storageScope(): string { return this.config.scopeKey ?? (this.isRemote ? (this.mode ?? "remote") : "local"); }
  get wsUrl(): string { return this.config.url; }
  get httpBaseUrl(): string {
    if (this.config.url.startsWith("wss://")) return `https://${this.config.url.slice("wss://".length).replace(/\/+$/, "")}`;
    if (this.config.url.startsWith("ws://")) return `http://${this.config.url.slice("ws://".length).replace(/\/+$/, "")}`;
    return this.config.url.replace(/\/+$/, "");
  }

  /** Update config (e.g. after token change) and reset reconnect backoff */
  updateConfig(partial: Partial<EngineConfig>) {
    Object.assign(this.config, partial);
    this.reconnectAttempt = 0;
  }

  /** Subscribe to connection state changes */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  /** Subscribe to fatal errors (max reconnects exceeded) */
  onFatal(handler: (error: string) => void): () => void {
    this.fatalHandlers.add(handler);
    return () => this.fatalHandlers.delete(handler);
  }

  private setState(s: ConnectionState) {
    this._state = s;
    for (const h of this.stateChangeHandlers) h(s);
  }

  private async getSigningKey(): Promise<CryptoKey> {
    if (this.signingKey) return this.signingKey;

    const pkcs8 = base64ToArrayBuffer(this.config.privateKeyPkcs8Base64);
    this.signingKey = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    return this.signingKey;
  }

  private async signPayload(payload: string): Promise<string> {
    const key = await this.getSigningKey();
    const encoded = new TextEncoder().encode(payload);
    const signature = await crypto.subtle.sign("Ed25519", key, encoded);
    return base64UrlEncode(signature);
  }

  private deviceAuthStorageKey(role = "operator"): string {
    return `xcloud:gateway-device-token:${this.config.url}:${this.config.deviceId}:${role}`;
  }

  private loadDeviceToken(role = "operator"): string | null {
    try {
      return localStorage.getItem(this.deviceAuthStorageKey(role));
    } catch {
      return null;
    }
  }

  private storeDeviceToken(token: string, role = "operator"): void {
    try {
      localStorage.setItem(this.deviceAuthStorageKey(role), token);
    } catch {
      // Ignore storage failures; the shared gateway token can still reconnect.
    }
  }

  async connect(): Promise<{ scopes: string[]; serverVersion: string }> {
    this.setState("connecting");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;
      let settled = false;
      let handshakeError: Error | null = null;
      let sawSocketError = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const clearConnectTimeout = () => {
        if (!timeout) return;
        clearTimeout(timeout);
        timeout = null;
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        clearConnectTimeout();
        this.setState("disconnected");
        try {
          if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
        } catch { /* ignore close failures */ }
        reject(error);
      };
      const resolveOnce = (value: { scopes: string[]; serverVersion: string }) => {
        if (settled) return;
        settled = true;
        clearConnectTimeout();
        resolve(value);
      };

      timeout = setTimeout(() => {
        rejectOnce(new Error(`${this.isRemote ? "Remote engine" : "Gateway"} connection timed out`));
      }, this.isRemote ? 12_000 : 15_000);

      ws.onmessage = async (event) => {
        const frame = JSON.parse(event.data as string);

        // Handshake: respond to challenge with device signing
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = frame.payload.nonce as string;
          const signedAt = Date.now();
          const scopes = ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing", "operator.talk.secrets"];
          const storedDeviceToken = this.loadDeviceToken("operator");
          const authToken = this.config.token || storedDeviceToken || "";

          const sigPayload = [
            "v2",
            this.config.deviceId,
            "cli", "cli", "operator",
            scopes.join(","),
            String(signedAt),
            authToken,
            nonce,
          ].join("|");

          this.signPayload(sigPayload).then((signature) => {
            ws.send(JSON.stringify({
              type: "req",
              id: "__handshake",
              method: "connect",
              params: {
                minProtocol: GATEWAY_MIN_PROTOCOL,
                maxProtocol: GATEWAY_MAX_PROTOCOL,
                client: { id: "cli", version: "0.1.0", platform: "darwin", mode: "cli" },
                role: "operator",
                scopes,
                auth: {
                  ...(this.config.token ? { token: this.config.token } : {}),
                  ...(!this.config.token && storedDeviceToken ? { deviceToken: storedDeviceToken } : {}),
                },
                device: {
                  id: this.config.deviceId,
                  publicKey: this.config.publicKeyBase64Url,
                  signature,
                  signedAt,
                  nonce,
                },
              },
            }));
          }).catch((err) => {
            rejectOnce(new Error("Signing failed: " + (err instanceof Error ? err.message : String(err))));
          });
          return;
        }

        // Handshake response
        if (frame.type === "res" && frame.id === "__handshake") {
          if (frame.ok) {
            const auth = frame.payload?.auth as { deviceToken?: string; role?: string } | undefined;
            if (auth?.deviceToken) this.storeDeviceToken(auth.deviceToken, auth.role ?? "operator");
            this._connected = true;
            this.wasConnected = true;
            this.reconnectAttempt = 0;
            this.setState("connected");
            resolveOnce({
              scopes: frame.payload?.auth?.scopes ?? [],
              serverVersion: frame.payload?.server?.version ?? "unknown",
            });
          } else {
            this.setState("disconnected");
            const details = frame.error?.details as { requestId?: string } | undefined;
            const requestId = typeof details?.requestId === "string" ? details.requestId.trim() : "";
            const baseMessage = frame.error?.message ?? "Handshake failed";
            handshakeError = new Error(
              requestId && !baseMessage.includes(requestId)
                ? `${baseMessage} (requestId: ${requestId})`
                : baseMessage,
            );
            rejectOnce(handshakeError);
          }
          return;
        }

        // RPC responses
        if (frame.type === "res" && frame.id) {
          const p = this.pending.get(frame.id);
          if (p) {
            this.pending.delete(frame.id);
            if (frame.ok) p.resolve(frame.payload ?? {});
            else {
              const payload = frame.payload as { error?: unknown } | undefined;
              const payloadError = typeof payload?.error === "string" ? payload.error : "";
              const details = frame.error?.details as { requestId?: string } | undefined;
              const requestId = typeof details?.requestId === "string" ? details.requestId.trim() : "";
              const message = frame.error?.message ?? payloadError ?? "RPC error";
              p.reject(new Error(requestId && !message.includes(requestId) ? `${message} (requestId: ${requestId})` : message));
            }
          }
          return;
        }

        // Events
        if (frame.type === "event") {
          for (const handler of this.eventHandlers) handler(frame);
        }
      };

      ws.onclose = (event) => {
        const wasActive = this._connected;
        this._connected = false;
        for (const [, p] of this.pending) p.reject(new Error("Connection closed"));
        this.pending.clear();

        if (wasActive && this.wasConnected) {
          // Was connected, lost connection — auto-reconnect
          this.scheduleReconnect();
        }

        if (!settled) {
          const closeReason = event.reason?.trim();
          rejectOnce(
            handshakeError
              ?? new Error(closeReason ? `gateway closed (${event.code}): ${closeReason}` : sawSocketError ? "WebSocket failed" : "Connection closed"),
          );
        }
      };

      ws.onerror = () => {
        sawSocketError = true;
        this.setState("disconnected");
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      for (const h of this.fatalHandlers) h("Max reconnect attempts exceeded");
      return;
    }

    this.setState("reconnecting");
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() failed, onclose will trigger another scheduleReconnect
      }
    }, delay);
  }

  async approvePendingDevice(requestId: string): Promise<void> {
    const cleanRequestId = requestId.trim();
    if (!cleanRequestId) throw new Error("Missing device pairing request id.");
    if (!this.config.token.trim()) throw new Error("Missing gateway token.");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      let settled = false;
      let connectOk = false;
      let timeout: ReturnType<typeof setTimeout>;
      const closeQuietly = () => {
        try {
          if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
        } catch { /* ignore close failures */ }
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        closeQuietly();
        reject(error);
      };
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        closeQuietly();
        resolve();
      };
      const frameMessage = (frame: Record<string, any>, fallback: string) => {
        const error = frame.error;
        if (error?.message) return String(error.message);
        try {
          return JSON.stringify(error ?? frame);
        } catch {
          return fallback;
        }
      };
      timeout = setTimeout(() => {
        rejectOnce(new Error("Device approval timed out."));
      }, 12_000);

      ws.onerror = () => rejectOnce(new Error("Could not connect to the gateway approval channel."));
      ws.onclose = () => {
        if (!settled) rejectOnce(new Error("Gateway approval channel closed before approval finished."));
      };
      ws.onmessage = (event) => {
        let frame: Record<string, any>;
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          rejectOnce(new Error("Gateway sent an invalid approval response."));
          return;
        }

        if (frame.type === "event" && frame.event === "connect.challenge") {
          ws.send(JSON.stringify({
            type: "req",
            id: "__approval_connect",
            method: "connect",
            params: {
              minProtocol: GATEWAY_MIN_PROTOCOL,
              maxProtocol: GATEWAY_MAX_PROTOCOL,
              client: {
                id: "gateway-client",
                version: "0.1.0",
                platform: navigator.platform || "darwin",
                mode: "backend",
              },
              role: "operator",
              scopes: OPERATOR_ADMIN_SCOPES,
              auth: { token: this.config.token },
              caps: [],
            },
          }));
          return;
        }

        if (frame.type === "res" && frame.id === "__approval_connect") {
          if (!frame.ok) {
            rejectOnce(new Error(frameMessage(frame, "Gateway approval handshake failed.")));
            return;
          }
          connectOk = true;
          ws.send(JSON.stringify({
            type: "req",
            id: "__approval_device",
            method: "device.pair.approve",
            params: { requestId: cleanRequestId },
          }));
          return;
        }

        if (frame.type === "res" && frame.id === "__approval_device") {
          if (frame.ok) resolveOnce();
          else rejectOnce(new Error(frameMessage(frame, "Device approval failed.")));
        }
      };
      ws.onopen = () => {
        setTimeout(() => {
          if (!settled && !connectOk && ws.readyState === WebSocket.OPEN) {
            rejectOnce(new Error("Gateway did not start the approval handshake."));
          }
        }, 4_000);
      };
    });
  }

  disconnect(): void {
    this.wasConnected = false; // Prevent auto-reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this.setState("disconnected");
  }

  onEvent(handler: FrameHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Not connected");

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      this.ws!.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  async subscribe(sessionKey: string): Promise<string> {
    const result = await this.rpc("sessions.messages.subscribe", { key: sessionKey });
    return (result as { key: string }).key;
  }

  async sendMessage(sessionKey: string, message: string, attachments?: EngineAttachment[]): Promise<{ runId: string; status: string }> {
    const result = await this.rpc("chat.send", {
      sessionKey,
      message,
      ...(attachments?.length ? { attachments } : {}),
      idempotencyKey: crypto.randomUUID(),
    });
    return result as { runId: string; status: string };
  }

  async abortChat(sessionKey: string, runId?: string): Promise<{ ok: boolean; aborted: boolean; runIds: string[] }> {
    const result = await this.rpc("chat.abort", { sessionKey, ...(runId ? { runId } : {}) });
    return result as { ok: boolean; aborted: boolean; runIds: string[] };
  }

  async listCommands(): Promise<SlashCommand[]> {
    const result = await this.rpc("commands.list", {});
    return (result as { commands: SlashCommand[] }).commands ?? [];
  }

  async listModels(): Promise<ModelInfo[]> {
    const result = await this.rpc("models.list", {});
    return (result as { models: ModelInfo[] }).models ?? [];
  }

  async getConfig(): Promise<Record<string, unknown>> {
    const result = await this.rpc("config.get", {});
    return (result as { config: Record<string, unknown> }).config ?? result;
  }

  async patchConfig(raw: string, baseHash: string): Promise<void> {
    await this.rpc("config.patch", { raw, baseHash });
  }
}
