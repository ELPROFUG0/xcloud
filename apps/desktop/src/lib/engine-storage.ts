import type { BrowserEngine } from "@/lib/engine";

export function engineScopedStorageKey(baseKey: string, engine: BrowserEngine) {
  return engine.isRemote ? `${baseKey}:${engine.storageScope}` : baseKey;
}
