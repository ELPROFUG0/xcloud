export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  timestamp: number;
}
