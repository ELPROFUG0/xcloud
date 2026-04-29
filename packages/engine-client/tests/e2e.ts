/**
 * End-to-end test: connects to live OpenClaw Gateway, sends a message,
 * and verifies streaming response.
 *
 * Usage: npx tsx packages/engine-client/tests/e2e.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "../src/index.ts";

const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const token: string = config.gateway.auth.token;

async function main(): Promise<void> {
  console.log("--- E2E Test: @agent-studio/engine-client ---\n");

  // 1. Create client
  const engine = new EngineClient({
    url: "ws://127.0.0.1:18789",
    token,
    autoReconnect: false, // Don't reconnect for test
  });

  engine.on("connected", (info) => {
    console.log(`[connected] scopes=${JSON.stringify(info.scopes)} server=${info.serverVersion}`);
  });

  engine.on("disconnected", (info) => {
    console.log(`[disconnected] code=${info.code} willReconnect=${info.willReconnect}`);
  });

  engine.on("error", (err) => {
    console.error(`[error] ${err.message}`);
  });

  // 2. Connect
  console.log("Connecting...");
  await engine.connect();
  console.log(`Connected! server=${engine.serverVersion}\n`);

  // 3. Create and subscribe to session
  const session = engine.session("main");
  await session.subscribe();
  console.log(`Subscribed to session: ${session.canonicalKey}\n`);

  // 4. Send message and collect streaming response
  const deltas: string[] = [];

  session.on("delta", ({ delta }) => {
    process.stdout.write(deltas.length === 0 ? "  Agent: " : "");
    process.stdout.write(delta);
    deltas.push(delta);
  });

  const responsePromise = new Promise<string>((resolve) => {
    session.on("response", ({ text }) => {
      resolve(text);
    });
  });

  console.log("Sending: 'What is 3+3? Reply with just the number.'\n");
  const result = await session.send("What is 3+3? Reply with just the number.");
  console.log(`  Run: ${result.runId.substring(0, 8)}... status=${result.status}`);

  // Wait for response with timeout
  const response = await Promise.race([
    responsePromise,
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Response timeout (60s)")), 60_000),
    ),
  ]);

  console.log(`\n\n  Full response: "${response}"`);
  console.log(`  Stream chunks: ${deltas.length}`);

  // 5. Verify
  const passed = response.includes("6");
  console.log(`\n  Result: ${passed ? "PASS" : "FAIL"}`);

  // 6. Disconnect
  engine.disconnect();
  console.log("\n--- Test complete ---");

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
