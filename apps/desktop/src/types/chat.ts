export type MessageRole = "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  tools?: ToolCallInfo[];
  tool?: ToolCallInfo;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  title?: string;
  output?: string;
  status: "running" | "done" | "error";
  timestamp: number;
}
