import { mkdir, readTextFile, writeFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";

const avatarModules = import.meta.glob("@/assets/avatars/avatar-*.jpg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const INTERNAL_AVATARS = Object.values(avatarModules).sort();
const AVATAR_OPT_OUT_KEY = "xcloudAvatarOptOutAgents";

function getIdentityPath(agentId: string): string {
  return agentId === "main"
    ? ".openclaw/workspace/IDENTITY.md"
    : `.openclaw/workspace/${agentId}/IDENTITY.md`;
}

function readAvatarOptOutIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_OPT_OUT_KEY) ?? "[]") as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function setAvatarOptOut(agentId: string, optedOut: boolean) {
  try {
    const ids = readAvatarOptOutIds();
    if (optedOut) ids.add(agentId);
    else ids.delete(agentId);
    localStorage.setItem(AVATAR_OPT_OUT_KEY, JSON.stringify([...ids]));
  } catch { /* ignore localStorage failures */ }
}

export function isAgentAvatarOptedOut(agentId: string) {
  return readAvatarOptOutIds().has(agentId);
}

function hashAgentId(agentId: string) {
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i += 1) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickInternalAvatar(agentId: string) {
  if (INTERNAL_AVATARS.length === 0) return undefined;
  return INTERNAL_AVATARS[hashAgentId(agentId) % INTERNAL_AVATARS.length];
}

function humanizeAgentId(agentId: string) {
  if (agentId === "main") return "Main";
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function updateField(agentId: string, field: string, value: string): Promise<void> {
  const path = getIdentityPath(agentId);
  const regex = new RegExp(`(\\*\\*${field}:\\*\\*\\s*)[^\\r\\n]*`, "i");
  const addRegex = new RegExp(`(\\*\\*Name:\\*\\*\\s*.+)`, "i");

  try {
    let content = await readTextFile(path, { baseDir: BaseDirectory.Home });

    if (regex.test(content)) {
      content = content.replace(regex, `$1${value}`);
    } else if (addRegex.test(content)) {
      content = content.replace(addRegex, `$1\n- **${field}:** ${value}`);
    } else {
      content = `- **${field}:** ${value}\n${content}`;
    }

    await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  } catch {
    const name = field.toLowerCase() === "name" ? value : humanizeAgentId(agentId);
    const content = `# IDENTITY.md\n\n- **Name:** ${name}\n- **${field}:** ${value}\n`;
    await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  }
}

export async function updateAgentEmoji(agentId: string, emoji: string): Promise<void> {
  // Clear avatar when setting emoji
  setAvatarOptOut(agentId, true);
  await updateField(agentId, "Emoji", emoji);
  try {
    await updateField(agentId, "Avatar", "");
  } catch { /* ok */ }
}

export async function updateAgentAvatar(agentId: string, filename: string): Promise<void> {
  setAvatarOptOut(agentId, false);
  await updateField(agentId, "Avatar", filename);
}

export async function ensureAgentDefaultAvatar(agentId: string): Promise<string | undefined> {
  if (isAgentAvatarOptedOut(agentId)) return undefined;

  const src = pickInternalAvatar(agentId);
  if (!src) return undefined;

  const destDir = agentId === "main" ? ".openclaw/workspace" : `.openclaw/workspace/${agentId}`;
  const destPath = `${destDir}/avatar.jpg`;

  const resp = await fetch(src);
  const buffer = new Uint8Array(await (await resp.blob()).arrayBuffer());
  try { await mkdir(destDir, { baseDir: BaseDirectory.Home, recursive: true }); } catch { /* ok */ }
  await writeFile(destPath, buffer, { baseDir: BaseDirectory.Home });
  const identityContent = await readTextFile(getIdentityPath(agentId), { baseDir: BaseDirectory.Home }).catch(() => "");
  if (identityContent.trim()) {
    await updateAgentAvatar(agentId, "avatar.jpg");
  }
  return "avatar.jpg";
}
