import { useState, useEffect } from "react";
import { BrowserEngine } from "@/lib/engine";
import { AppLayout } from "@/components/AppLayout";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

interface OpenClawIdentity {
  deviceId: string;
  publicKeyBase64Url: string;
  privateKeyPkcs8Base64: string;
  token: string;
}

/** Read OpenClaw identity and token from ~/.openclaw/ */
async function loadOpenClawIdentity(): Promise<OpenClawIdentity> {
  // Read device identity
  const deviceRaw = await readTextFile(".openclaw/identity/device.json", { baseDir: BaseDirectory.Home });
  const device = JSON.parse(deviceRaw);

  // Extract raw public key as base64url
  const pubPem = device.publicKeyPem as string;
  const pubB64 = pubPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  // SPKI DER for ed25519 is 44 bytes, last 32 are the raw key
  const spkiBytes = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0));
  const rawPub = spkiBytes.slice(-32);
  const publicKeyBase64Url = btoa(String.fromCharCode(...rawPub))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

  // Extract PKCS8 base64 from PEM
  const privPem = device.privateKeyPem as string;
  const privateKeyPkcs8Base64 = privPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");

  // Read gateway token
  const configRaw = await readTextFile(".openclaw/openclaw.json", { baseDir: BaseDirectory.Home });
  const config = JSON.parse(configRaw);
  const token = config.gateway?.auth?.token;

  if (!token) throw new Error("No gateway token found");

  return {
    deviceId: device.deviceId,
    publicKeyBase64Url,
    privateKeyPkcs8Base64,
    token,
  };
}

export default function App() {
  const [engine, setEngine] = useState<BrowserEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function autoConnect() {
      try {
        // Ensure OpenClaw gateway is running (starts it if not)
        const status = await invoke<{ running: boolean; port: number }>("engine_ensure_running");

        const identity = await loadOpenClawIdentity();
        const client = new BrowserEngine({
          url: `ws://127.0.0.1:${status.port}`,
          ...identity,
        });
        await client.connect();
        if (!cancelled) {
          setEngine(client);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to connect");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    autoConnect();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-center">
          <div className="text-lg font-medium text-text">Connecting...</div>
          <div className="mt-1 text-xs text-text-muted">Reading OpenClaw configuration</div>
        </div>
      </div>
    );
  }

  if (error || !engine) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-center max-w-sm px-4">
          <div className="text-lg font-medium text-text">Connection Failed</div>
          <div className="mt-2 text-xs text-red-400">{error}</div>
          <div className="mt-4 text-xs text-text-muted">
            Make sure OpenClaw is installed and running.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <AppLayout engine={engine} />;
}
