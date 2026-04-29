import { useState, useCallback } from "react";
import { BrowserEngine } from "@/lib/engine";
import { ConnectScreen } from "@/components/ConnectScreen";
import { AppLayout } from "@/components/AppLayout";

// Dev defaults — loaded from ~/.openclaw/identity/device.json
const DEV_DEVICE = {
  deviceId: "3d8ffe999874e45cd72a294017694befe081402688216a5a78850bce8f2e07e0",
  publicKeyBase64Url: "Ke8OBE1E-QJF5Bq2rKP0Wg6suLNxy7hitiY-61xOQco",
  privateKeyPkcs8Base64: "MC4CAQAwBQYDK2VwBCIEIKxIprkUpvb/+6yG5cZ0b3HIAf29w8FcCE9eKiIA2ySY",
};

export default function App() {
  const [engine, setEngine] = useState<BrowserEngine | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = useCallback(async (token: string) => {
    setConnectError(null);
    const client = new BrowserEngine({
      url: "ws://127.0.0.1:18789",
      token,
      ...DEV_DEVICE,
    });
    try {
      const info = await client.connect();
      if (info.scopes.length === 0) {
        throw new Error("Connected but no scopes granted. Check device pairing.");
      }
      setEngine(client);
    } catch (err) {
      client.disconnect();
      setConnectError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, []);

  if (!engine) {
    return <ConnectScreen onConnect={handleConnect} error={connectError} />;
  }

  return <AppLayout engine={engine} />;
}
