import { homeDir } from "@tauri-apps/api/path";
import { readFile, BaseDirectory } from "@tauri-apps/plugin-fs";

let homeDirCache: string | null = null;

async function getHomeDir(): Promise<string> {
  if (!homeDirCache) homeDirCache = await homeDir();
  return homeDirCache;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  gif: "image/gif",
};

/**
 * Resolve an agent's avatar field to a data URL.
 * Reads the file and converts to base64.
 */
export async function resolveAvatarUrl(agentId: string, avatarField?: string): Promise<string | undefined> {
  if (!avatarField || !avatarField.trim()) return undefined;

  const wsPath = agentId === "main"
    ? `.openclaw/workspace/${avatarField}`
    : `.openclaw/workspace/${agentId}/${avatarField}`;

  try {
    const bytes = await readFile(wsPath, { baseDir: BaseDirectory.Home });
    const ext = avatarField.split(".").pop()?.toLowerCase() ?? "png";
    const mime = MIME_TYPES[ext] ?? "image/png";
    const base64 = uint8ToBase64(bytes);
    return `data:${mime};base64,${base64}`;
  } catch {
    // Try as absolute path
    if (avatarField.startsWith("/")) {
      try {
        const home = await getHomeDir();
        const relative = avatarField.startsWith(home) ? avatarField.slice(home.length) : avatarField;
        const bytes = await readFile(relative, { baseDir: BaseDirectory.Home });
        const ext = avatarField.split(".").pop()?.toLowerCase() ?? "png";
        const mime = MIME_TYPES[ext] ?? "image/png";
        const base64 = uint8ToBase64(bytes);
        return `data:${mime};base64,${base64}`;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
