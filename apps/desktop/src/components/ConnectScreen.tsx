import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";

interface ConnectScreenProps {
  onConnect: (token: string) => void;
  defaultToken?: string;
  error?: string | null;
}

export function ConnectScreen({ onConnect, defaultToken = "", error }: ConnectScreenProps) {
  const [token, setToken] = useState(defaultToken);

  const handleSubmit = useCallback(() => {
    if (token.trim()) onConnect(token.trim());
  }, [token, onConnect]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">xCloud</h1>
        <p className="mt-2 text-sm text-text-muted">
          Connect to your OpenClaw Gateway
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-text-muted">Gateway Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Paste your gateway auth token"
            className={cn(
              "w-full rounded-xl border border-border bg-bg px-4 py-3",
              "text-sm text-text placeholder:text-text-muted",
              "focus:border-accent focus:outline-none",
            )}
          />
          <p className="mt-1.5 text-xs text-text-muted">
            Found in ~/.openclaw/openclaw.json → gateway.auth.token
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!token.trim()}
          className={cn(
            "w-full rounded-xl bg-accent py-3 text-sm font-medium text-white",
            "transition-colors hover:bg-accent-hover",
            "disabled:cursor-not-allowed disabled:opacity-30",
          )}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
