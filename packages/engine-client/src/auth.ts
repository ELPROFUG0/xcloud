import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceIdentity } from "./types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_IDENTITY_PATH = path.join(os.homedir(), ".openclaw", "identity", "device.json");

/** Encode a buffer as base64url (no padding) */
export function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

/** Load device identity from disk */
export function loadDeviceIdentity(filePath?: string): DeviceIdentity {
  const p = filePath ?? DEFAULT_IDENTITY_PATH;
  const raw = fs.readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as {
    version: number;
    deviceId: string;
    publicKeyPem: string;
    privateKeyPem: string;
  };

  if (parsed.version !== 1) {
    throw new Error(`Unsupported device identity version: ${parsed.version}`);
  }

  return {
    deviceId: parsed.deviceId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
  };
}

/** Extract raw 32-byte public key from PEM and encode as base64url */
export function getPublicKeyBase64Url(pem: string): string {
  const spki = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length);
  return base64UrlEncode(raw);
}

/** Sign a payload string with the device's private key, return base64url */
export function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

/** Build the v2 device auth signing payload */
export function buildSigningPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
}): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
  ].join("|");
}

/** Build the connect params including device signing */
export function buildConnectParams(params: {
  token: string;
  identity: DeviceIdentity;
  nonce: string;
  scopes?: string[];
}): Record<string, unknown> {
  const scopes = params.scopes ?? ["operator.read", "operator.write"];
  const signedAt = Date.now();

  const sigPayload = buildSigningPayload({
    deviceId: params.identity.deviceId,
    clientId: "cli",
    clientMode: "cli",
    role: "operator",
    scopes,
    signedAtMs: signedAt,
    token: params.token,
    nonce: params.nonce,
  });

  const signature = signPayload(params.identity.privateKeyPem, sigPayload);
  const publicKey = getPublicKeyBase64Url(params.identity.publicKeyPem);

  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: { id: "cli", version: "0.1.0", platform: "macos", mode: "cli" },
    role: "operator",
    scopes,
    auth: { token: params.token },
    device: {
      id: params.identity.deviceId,
      publicKey,
      signature,
      signedAt,
      nonce: params.nonce,
    },
  };
}
