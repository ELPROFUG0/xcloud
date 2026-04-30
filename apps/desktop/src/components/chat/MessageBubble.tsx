import type { ChatMessage } from "@/types/chat";
import { Bot } from "lucide-react";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="px-4 py-1.5">
        <div className="rounded-lg border border-[#444] bg-container px-3 py-2 text-[13px] leading-snug text-text">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 px-4 py-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-hover mt-0.5">
        <Bot className="h-3.5 w-3.5 text-text-muted" />
      </div>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-text">
        {message.content || (
          <span className="text-text-muted italic">Thinking...</span>
        )}
        {message.isStreaming && message.content && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-accent" />
        )}
      </div>
    </div>
  );
}
