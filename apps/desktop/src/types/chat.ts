export type MessageRole = "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
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
  args?: Record<string, unknown>;
  changes?: CodeChangeInfo[];
  status: "running" | "done" | "error";
  timestamp: number;
}

export interface CodeChangeInfo {
  path: string;
  diff?: string;
  firstChangedLine?: number;
  additions: number;
  deletions: number;
  kind?: "added" | "modified" | "deleted";
}
