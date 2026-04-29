/**
 * PoC WebSocket Client for OpenClaw Gateway
 *
 * Validates that a custom client can:
 * 1. Read the gateway token from ~/.openclaw/openclaw.json
 * 2. Connect via WebSocket with device identity signing
 * 3. Subscribe to session message streaming
 * 4. Send a message and receive the agent's response in real-time
 * 5. Cleanly close on completion
 *
 * Usage: npx tsx scripts/poc-websocket.ts [message]
 */

import WebSocket from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────

const GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789;
const GATEWAY_URL = `ws://127.0.0.1:${GATEWAY_PORT}`;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_HOME, "openclaw.json");
const IDENTITY_PATH = path.join(OPENCLAW_HOME, "identity", "device.json");
const TIMEOUT_MS = 90_000;

const userMessage = process.argv[2] || "Say exactly: Hello Agent Studio!";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GatewayConfig {
  gateway: {
    auth: { token: string };
  };
}

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

interface Frame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  event?: string;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  seq?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function b64url(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function loadConfig(): GatewayConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as GatewayConfig;
}

function loadIdentity(): DeviceIdentity {
  const raw = fs.readFileSync(IDENTITY_PATH, "utf-8");
  return JSON.parse(raw) as DeviceIdentity;
}

function getPublicKeyBase64Url(pem: string): string {
  const spki = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length);
  return b64url(raw);
}

function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return b64url(sig);
}

function log(prefix: string, msg: string): void {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${ts}] ${prefix} ${msg}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load config and identity
  const config = loadConfig();
  const token = config.gateway.auth.token;
  const identity = loadIdentity();
  const pubKeyB64 = getPublicKeyBase64Url(identity.publicKeyPem);

  log("CONFIG", `Gateway: ${GATEWAY_URL}`);
  log("CONFIG", `Device: ${identity.deviceId.substring(0, 16)}...`);
  log("CONFIG", `Message: "${userMessage}"`);
  console.log("");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    let done = false;
    let streamChunks: string[] = [];
    let messageSent = false;
    let lifecycleEndCount = 0;

    const timeout = setTimeout(() => {
      log("ERROR", "Timeout reached. Closing.");
      ws.close();
      reject(new Error("Timeout"));
    }, TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      done = true;
    }

    ws.on("open", () => {
      log("WS", "Connected to gateway");
    });

    function finishResponse(): void {
      if (done) return;
      console.log("\n");
      log("AGENT", `Response complete (${streamChunks.length} chunks streamed)`);
      log("AGENT", `Full response: "${streamChunks.join("")}"`);
      cleanup();
      setTimeout(() => ws.close(), 500);
    }

    ws.on("message", (data: Buffer) => {
      const frame: Frame = JSON.parse(data.toString());

      // ── Step 1: Respond to challenge ──
      if (frame.event === "connect.challenge") {
        const nonce = (frame.payload as { nonce: string }).nonce;
        const signedAt = Date.now();
        const scopes = ["operator.read", "operator.write"];
        const sigPayload = [
          "v2", identity.deviceId, "cli", "cli", "operator",
          scopes.join(","), String(signedAt), token, nonce,
        ].join("|");
        const signature = signPayload(identity.privateKeyPem, sigPayload);

        log("AUTH", "Signing challenge nonce...");

        ws.send(JSON.stringify({
          type: "req",
          id: "connect-1",
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "cli", version: "0.1.0", platform: "macos", mode: "cli" },
            role: "operator",
            scopes,
            auth: { token },
            device: {
              id: identity.deviceId,
              publicKey: pubKeyB64,
              signature,
              signedAt,
              nonce,
            },
          },
        }));
      }

      // ── Step 2: Handle hello-ok ──
      if (frame.id === "connect-1") {
        if (frame.ok) {
          const auth = frame.payload?.auth as { scopes: string[] } | undefined;
          log("AUTH", `Authenticated! Scopes: ${JSON.stringify(auth?.scopes)}`);

          // Subscribe to session messages
          ws.send(JSON.stringify({
            type: "req",
            id: "subscribe",
            method: "sessions.messages.subscribe",
            params: { key: "main" },
          }));
        } else {
          log("ERROR", `Connect failed: ${frame.error?.message}`);
          cleanup();
          ws.close();
          reject(new Error(frame.error?.message));
        }
      }

      // ── Step 3: Send message after subscribing ──
      if (frame.id === "subscribe") {
        if (frame.ok) {
          log("SESSION", `Subscribed to: ${(frame.payload as { key: string }).key}`);
          log("SEND", `Sending: "${userMessage}"`);

          ws.send(JSON.stringify({
            type: "req",
            id: "send-msg",
            method: "chat.send",
            params: {
              sessionKey: "main",
              message: userMessage,
              idempotencyKey: crypto.randomUUID(),
            },
          }));
        } else {
          log("ERROR", `Subscribe failed: ${frame.error?.message}`);
        }
      }

      // ── Step 4: Message accepted ──
      if (frame.id === "send-msg") {
        if (frame.ok) {
          messageSent = true;
          const status = (frame.payload as { status: string }).status;
          log("AGENT", `Run ${status} (runId: ${(frame.payload as { runId: string }).runId?.substring(0, 8)}...)`);
        } else {
          log("ERROR", `Send failed: ${frame.error?.message}`);
        }
      }

      // ── Step 5: Stream agent response ──
      if (frame.event === "agent") {
        const p = frame.payload as {
          stream: string;
          data: { delta?: string; text?: string; phase?: string };
          runId?: string;
        };

        if (p.stream === "assistant" && p.data?.delta) {
          process.stdout.write(streamChunks.length === 0 ? `\n  > ` : "");
          process.stdout.write(p.data.delta);
          streamChunks.push(p.data.delta);
        }

        if (p.stream === "lifecycle" && p.data?.phase === "start") {
          log("AGENT", `Agent run started`);
        }

        if (p.stream === "lifecycle" && p.data?.phase === "end") {
          lifecycleEndCount++;
          log("AGENT", `Agent run ended (lifecycle #${lifecycleEndCount})`);
        }
      }

      // ── Chat final event (backup completion signal) ──
      if (frame.event === "chat") {
        const p = frame.payload as {
          state: string;
          message?: { role: string; content: Array<{ type: string; text?: string }> };
          runId?: string;
        };

        if (p.state === "final" && p.message?.role === "assistant" && messageSent && !done) {
          // Extract text from final chat event
          if (p.message.content) {
            const text = p.message.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("");
            if (text && streamChunks.length === 0) {
              console.log(`\n  > ${text}`);
              streamChunks.push(text);
            }
          }
          finishResponse();
        }
      }

      // ── Tool calls ──
      if (frame.event === "session.tool") {
        const p = frame.payload as { tool?: { name: string }; status?: string };
        log("TOOL", `${p.tool?.name || "unknown"} [${p.status || "?"}]`);
      }

      // ── Skip noisy events ──
      if (frame.event === "tick" || frame.event === "health" || frame.event === "heartbeat") {
        return;
      }
    });

    ws.on("close", (code: number) => {
      log("WS", `Connection closed (code: ${code})`);
      if (!done) {
        cleanup();
        resolve();
      } else {
        resolve();
      }
    });

    ws.on("error", (err: Error) => {
      log("ERROR", `WebSocket error: ${err.message}`);
      cleanup();
      reject(err);
    });
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main()
  .then(() => {
    console.log("\n✅ PoC complete — WebSocket connection to OpenClaw Gateway works!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ PoC failed:", err.message);
    process.exit(1);
  });
