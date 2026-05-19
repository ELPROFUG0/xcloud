import type { BrowserEngine } from "@/lib/engine";

function migrateLegacyRemoteStorageKey(baseKey: string, engine: BrowserEngine, nextKey: string) {
  if (!engine.isRemote) return;
  try {
    const currentValue = localStorage.getItem(nextKey);
    if (currentValue != null) return;

    const mode = engine.mode ?? "remote";
    const prefix = `${baseKey}:${mode}:`;
    const preferredLegacyKey = `${prefix}${engine.wsUrl}`;
    const legacyKeys = [preferredLegacyKey];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== preferredLegacyKey) legacyKeys.push(key);
    }

    const legacyKey = legacyKeys.find((key) => localStorage.getItem(key) != null);
    if (!legacyKey) return;

    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue == null) return;
    localStorage.setItem(nextKey, legacyValue);
  } catch {
    // Storage migration is best-effort. The stable key still works for new data.
  }
}

export function engineScopedStorageKey(baseKey: string, engine: BrowserEngine) {
  if (!engine.isRemote) return baseKey;
  const nextKey = `${baseKey}:${engine.storageScope}`;
  migrateLegacyRemoteStorageKey(baseKey, engine, nextKey);
  return nextKey;
}
