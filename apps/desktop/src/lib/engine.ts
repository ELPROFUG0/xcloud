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
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";
export type FrameHandler = (frame: Record<string, unknown>) => void;

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
                minProtocol: 3,
                maxProtocol: 3,
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
            if (!settled) {
              settled = true;
              this.setState("disconnected");
              reject(new Error("Signing failed: " + (err instanceof Error ? err.message : String(err))));
            }
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
            if (!settled) {
              settled = true;
              resolve({
                scopes: frame.payload?.auth?.scopes ?? [],
                serverVersion: frame.payload?.server?.version ?? "unknown",
              });
            }
          } else {
            this.setState("disconnected");
            if (!settled) {
              settled = true;
              const details = frame.error?.details as { requestId?: string } | undefined;
              const requestId = typeof details?.requestId === "string" ? details.requestId.trim() : "";
              const baseMessage = frame.error?.message ?? "Handshake failed";
              handshakeError = new Error(
                requestId && !baseMessage.includes(requestId)
                  ? `${baseMessage} (requestId: ${requestId})`
                  : baseMessage,
              );
              reject(handshakeError);
            }
          }
          return;
        }

        // RPC responses
        if (frame.type === "res" && frame.id) {
          const p = this.pending.get(frame.id);
          if (p) {
            this.pending.delete(frame.id);
            if (frame.ok) p.resolve(frame.payload ?? {});
            else p.reject(new Error(frame.error?.message ?? "RPC error"));
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
          settled = true;
          const closeReason = event.reason?.trim();
          reject(
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
