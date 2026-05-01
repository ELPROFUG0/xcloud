import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";

function getIdentityPath(agentId: string): string {
  return agentId === "main"
    ? ".openclaw/workspace/IDENTITY.md"
    : `.openclaw/workspace/${agentId}/IDENTITY.md`;
}

async function updateField(agentId: string, field: string, value: string): Promise<void> {
  const path = getIdentityPath(agentId);
  const regex = new RegExp(`(\\*\\*${field}:\\*\\*\\s*).+`, "i");
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
    const content = `- **${field}:** ${value}\n`;
    await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  }
}

export async function updateAgentEmoji(agentId: string, emoji: string): Promise<void> {
  // Clear avatar when setting emoji
  await updateField(agentId, "Emoji", emoji);
  try {
    await updateField(agentId, "Avatar", "");
  } catch { /* ok */ }
}

export async function updateAgentAvatar(agentId: string, filename: string): Promise<void> {
  await updateField(agentId, "Avatar", filename);
}
