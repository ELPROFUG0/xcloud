import type { ChatMessage } from "@/types/chat";

export interface Page {
  userMessage?: ChatMessage;
  responses: ChatMessage[];
}

const UI_ACTION_DIRECTIVE_RENDER_RE = /<!--\s*xcloud:ui-action\b[\s\S]*?(?:-->|$)/g;
const UI_ACTION_DIRECTIVE_RENDER_START = "<!-- xcloud:ui-action";
const USER_HISTORY_ECHO_WINDOW_MS = 30 * 60_000;
const USER_HISTORY_ECHO_CLOCK_SKEW_MS = 1_000;

function normalizeEpochMillis(value: number) {
  return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
}

function parseMessageTimestamp(value: unknown, fallback = Date.now()) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? time : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return normalizeEpochMillis(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return normalizeEpochMillis(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

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

function normalizeChangePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/Users\/[^/]+\//, "~/");
}

function codeChangeSignature(message: ChatMessage) {
  if (message.role !== "tool" || !message.tool?.changes?.length) return null;
  return message.tool.changes
    .map((change) => [
      normalizeChangePath(change.path),
      change.kind ?? "",
      change.diff?.trim() || `${change.additions}:${change.deletions}:${change.firstChangedLine ?? ""}`,
    ].join("::"))
    .sort()
    .join("\n---file---\n");
}

function codeChangeToolScore(message: ChatMessage) {
  const tool = message.role === "tool" ? message.tool : undefined;
  if (!tool?.changes?.length) return 0;
  let score = 0;
  if (tool.status === "done") score += 40;
  if (tool.status === "error") score += 20;
  if (tool.status === "running") score += 5;
  if (tool.output) score += 4;
  score += tool.changes.filter((change) => change.diff).length * 3;
  return score;
}

export function dedupeDuplicateCodeChangeTools(messages: ChatMessage[]) {
  const chosenBySignature = new Map<string, ChatMessage>();
  for (const message of messages) {
    const signature = codeChangeSignature(message);
    if (!signature) continue;
    const current = chosenBySignature.get(signature);
    if (!current || codeChangeToolScore(message) >= codeChangeToolScore(current)) {
      chosenBySignature.set(signature, message);
    }
  }

  if (chosenBySignature.size === 0) return messages;

  const emitted = new Set<string>();
  return messages.filter((message) => {
    const signature = codeChangeSignature(message);
    if (!signature) return true;
    const chosen = chosenBySignature.get(signature);
    if (!chosen || emitted.has(signature) || chosen.id !== message.id) return false;
    emitted.add(signature);
    return true;
  });
}

function isEmptyStreamingAssistant(message: ChatMessage) {
  return message.role === "assistant"
    && Boolean(message.isStreaming)
    && !message.content.trim()
    && !message.thinking
    && !message.attachments?.length;
}

function isFinalAssistantResponse(message: ChatMessage) {
  return message.role === "assistant"
    && !message.isStreaming
    && Boolean(message.content.trim() || message.thinking || message.attachments?.length);
}

function pageHasFinalAssistant(page: Page) {
  return page.responses.some(isFinalAssistantResponse);
}

function lastFinalAssistantTimestamp(page: Page) {
  for (let index = page.responses.length - 1; index >= 0; index--) {
    const response = page.responses[index]!;
    if (isFinalAssistantResponse(response)) return parseMessageTimestamp(response.timestamp);
  }
  return null;
}

function compactStreamingPlaceholders(responses: ChatMessage[]) {
  const hasFinalAssistant = responses.some(isFinalAssistantResponse);
  let lastEmptyStreaming: ChatMessage | null = null;

  for (const message of responses) {
    if (isEmptyStreamingAssistant(message)) lastEmptyStreaming = message;
  }

  const compacted = responses.filter((message) => {
    if (!isEmptyStreamingAssistant(message)) return true;
    return false;
  });

  if (!hasFinalAssistant && lastEmptyStreaming) compacted.push(lastEmptyStreaming);
  return compacted;
}

function attachmentListSignature(message: ChatMessage) {
  return message.attachments
    ?.map((attachment) => `${attachment.mediaType ?? ""}:${attachment.filename ?? attachment.alt ?? attachment.url}`)
    .join("|") ?? "";
}

function comparableMessageContent(message: ChatMessage) {
  return stripHiddenUiActionDirectives(message.content)
    .replace(/(?:^|\n)[ \t]*\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+[A-Z]{2,5}\][ \t]*/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function isSyntheticHistoryUserEcho(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false;
  const aIsHistory = a.id.startsWith("history-");
  const bIsHistory = b.id.startsWith("history-");
  const aIsLive = a.id.startsWith("user-");
  const bIsLive = b.id.startsWith("user-");
  if (!((aIsHistory && bIsLive) || (bIsHistory && aIsLive))) return false;
  const historyTimestamp = parseMessageTimestamp(aIsHistory ? a.timestamp : b.timestamp);
  const liveTimestamp = parseMessageTimestamp(aIsLive ? a.timestamp : b.timestamp);
  const historyMinusLive = historyTimestamp - liveTimestamp;
  return comparableMessageContent(a) === comparableMessageContent(b)
    && attachmentListSignature(a) === attachmentListSignature(b)
    && historyMinusLive >= -USER_HISTORY_ECHO_CLOCK_SKEW_MS
    && historyMinusLive <= USER_HISTORY_ECHO_WINDOW_MS;
}

export function paginate(messages: ChatMessage[]): Page[] {
  const pages: Page[] = [];
  let current: Page | null = null;
  let carriedEmptyStreaming: ChatMessage | null = null;

  const appendResponse = (page: Page, message: ChatMessage) => {
    page.responses = compactStreamingPlaceholders([...page.responses, message]);
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      const finalAssistantTimestamp = current ? lastFinalAssistantTimestamp(current) : null;
      const incomingIsHistoryEchoForLiveUser = msg.id.startsWith("history-") && current?.userMessage?.id.startsWith("user-");
      const belongsToCurrentTurn = finalAssistantTimestamp === null
        || incomingIsHistoryEchoForLiveUser
        || parseMessageTimestamp(msg.timestamp) <= finalAssistantTimestamp + 1_000;
      if (current?.userMessage && isSyntheticHistoryUserEcho(current.userMessage, msg) && belongsToCurrentTurn) {
        current.userMessage = current.userMessage.id.startsWith("history-") ? current.userMessage : msg;
        continue;
      }
      current = { userMessage: msg, responses: carriedEmptyStreaming ? [carriedEmptyStreaming] : [] };
      current.responses = compactStreamingPlaceholders(current.responses);
      carriedEmptyStreaming = null;
      pages.push(current);
    } else {
      if (isEmptyStreamingAssistant(msg) && (!current || pageHasFinalAssistant(current))) {
        carriedEmptyStreaming = msg;
        continue;
      }
      if (!current) {
        current = { responses: [] };
        pages.push(current);
      }
      appendResponse(current, msg);
    }
  }
  return pages;
}

export function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const d = new Date(parseMessageTimestamp(timestamp));
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
