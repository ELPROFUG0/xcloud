import type { ChatMessage } from "@/types/chat";

export interface Page {
  userMessage: ChatMessage;
  responses: ChatMessage[];
}

const UI_ACTION_DIRECTIVE_RENDER_RE = /<!--\s*xcloud:ui-action\b[\s\S]*?(?:-->|$)/g;
const UI_ACTION_DIRECTIVE_RENDER_START = "<!-- xcloud:ui-action";

export function stripHiddenUiActionDirectives(content: string) {
  let visible = content.replace(UI_ACTION_DIRECTIVE_RENDER_RE, "").trim();
  const commentStart = visible.lastIndexOf("<!--");
  if (commentStart >= 0) {
    const tail = visible.slice(commentStart).replace(/\s+/g, " ");
    if (UI_ACTION_DIRECTIVE_RENDER_START.startsWith(tail) || tail.startsWith(UI_ACTION_DIRECTIVE_RENDER_START)) {
      visible = visible.slice(0, commentStart).trim();
    }
  }
  return visible;
}

function isMutationToolName(name: string) {
  const lower = name.toLowerCase();
  return lower.includes("write")
    || lower.includes("edit")
    || lower.includes("patch")
    || lower.includes("apply");
}

export function isRedundantMutationTool(message: ChatMessage, pageHasCodeChanges: boolean) {
  if (!pageHasCodeChanges || message.role !== "tool" || !message.tool) return false;
  if (message.tool.changes?.length) return false;
  if (!isMutationToolName(message.tool.name)) return false;
  if (message.tool.status !== "done") return false;

  const output = message.tool.output?.toLowerCase().trim();
  return !output || output.includes("success") || output.includes("updated") || output.includes("written");
}

export function paginate(messages: ChatMessage[]): Page[] {
  const pages: Page[] = [];
  let current: Page | null = null;
  for (const msg of messages) {
    if (msg.role === "user") {
      current = { userMessage: msg, responses: [] };
      pages.push(current);
    } else if (current) {
      current.responses.push(msg);
    }
  }
  return pages;
}

export function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}
