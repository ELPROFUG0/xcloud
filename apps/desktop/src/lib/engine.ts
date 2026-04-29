/**
 * Browser-compatible WebSocket client for OpenClaw Gateway.
 *
 * Uses Web Crypto API for ed25519 device signing (supported in modern browsers).
 * Loads device identity from a hardcoded config (in dev) or from Tauri fs (later).
 */

export interface EngineConfig {
  url: string;
  token: string;
  deviceId: string;
  publicKeyBase64Url: string;
  privateKeyPkcs8Base64: string;
}

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

  constructor(private config: EngineConfig) {}

  get connected(): boolean {
    return this._connected;
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

  async connect(): Promise<{ scopes: string[]; serverVersion: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;
      let settled = false;

      ws.onmessage = async (event) => {
        const frame = JSON.parse(event.data as string);

        // Handshake: respond to challenge with device signing
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = frame.payload.nonce as string;
          const signedAt = Date.now();
          const scopes = ["operator.read", "operator.write"];

          // Build v2 signing payload
          const sigPayload = [
            "v2",
            this.config.deviceId,
            "cli", "cli", "operator",
            scopes.join(","),
            String(signedAt),
            this.config.token,
            nonce,
          ].join("|");

          try {
            const signature = await this.signPayload(sigPayload);

            ws.send(JSON.stringify({
              type: "req",
              id: "__handshake",
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: { id: "cli", version: "0.1.0", platform: "macos", mode: "cli" },
                role: "operator",
                scopes,
                auth: { token: this.config.token },
                device: {
                  id: this.config.deviceId,
                  publicKey: this.config.publicKeyBase64Url,
                  signature,
                  signedAt,
                  nonce,
                },
              },
            }));
          } catch (err) {
            if (!settled) {
              settled = true;
              reject(new Error("Signing failed: " + (err instanceof Error ? err.message : String(err))));
            }
          }
          return;
        }

        // Handshake response
        if (frame.type === "res" && frame.id === "__handshake") {
          if (frame.ok) {
            this._connected = true;
            if (!settled) {
              settled = true;
              resolve({
                scopes: frame.payload?.auth?.scopes ?? [],
                serverVersion: frame.payload?.server?.version ?? "unknown",
              });
            }
          } else {
            if (!settled) {
              settled = true;
              reject(new Error(frame.error?.message ?? "Handshake failed"));
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

      ws.onclose = () => {
        this._connected = false;
        for (const [, p] of this.pending) p.reject(new Error("Connection closed"));
        this.pending.clear();
        if (!settled) { settled = true; reject(new Error("Connection closed")); }
      };

      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error("WebSocket failed")); }
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this._connected = false;
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

  async sendMessage(sessionKey: string, message: string): Promise<{ runId: string; status: string }> {
    const result = await this.rpc("chat.send", {
      sessionKey,
      message,
      idempotencyKey: crypto.randomUUID(),
    });
    return result as { runId: string; status: string };
  }
}
