import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/types/chat";
import { Bot, User } from "lucide-react";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-accent" : "bg-surface-hover",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-user-bubble text-text" : "bg-agent-bubble text-text",
          message.isStreaming && "animate-pulse",
        )}
      >
        {message.content || (
          <span className="text-text-muted italic">Thinking...</span>
        )}

        {/* Streaming cursor */}
        {message.isStreaming && message.content && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent" />
        )}
      </div>
    </div>
  );
}
