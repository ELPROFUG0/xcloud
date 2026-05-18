const avatarModules = import.meta.glob("@/assets/avatars/avatar-*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const DEFAULT_AVATARS = Object.values(avatarModules).sort();

function hashKey(key: string) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getStableDefaultAvatarUrl(key: string): string | undefined {
  if (DEFAULT_AVATARS.length === 0) return undefined;
  return DEFAULT_AVATARS[hashKey(key) % DEFAULT_AVATARS.length];
}
