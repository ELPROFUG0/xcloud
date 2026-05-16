import { useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import type { Page } from "./chat-message-utils";
import { formatTime, isRedundantMutationTool } from "./chat-message-utils";
import { MessageAttachments, type ImagePreviewState } from "./MessageAttachments";
import { CopyButton, MessageBubbleContent } from "./MessageContent";
import { ToolCallBadge } from "./ToolCallBadge";
import { ThinkingBlock } from "./ThinkingBlock";
import { Shimmer } from "../ai-elements/shimmer";

interface ChatMessagesProps {
  pages: Page[];
  engine: BrowserEngine;
  onPreviewImage: (preview: ImagePreviewState) => void;
}

export function ChatMessages({ pages, engine, onPreviewImage }: ChatMessagesProps) {
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl px-6">
      {pages.map((page) => (
        <div key={page.userMessage.id}>
          <div
            className="flex flex-col items-end py-4"
            onMouseEnter={() => setHoveredMsgId(page.userMessage.id)}
            onMouseLeave={() => setHoveredMsgId(null)}
          >
            {page.userMessage.content ? (
              <div className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2 text-[13px] leading-relaxed text-text break-words overflow-hidden">
                {page.userMessage.content}
              </div>
            ) : null}
            {page.userMessage.attachments?.length ? (
              <MessageAttachments attachments={page.userMessage.attachments} engine={engine} align="end" onPreviewImage={onPreviewImage} />
            ) : null}
            <div className={`flex items-center gap-1 mt-1 ${hoveredMsgId === page.userMessage.id ? "visible" : "invisible"}`}>
              <span className="text-[11px] text-text-muted/70">{formatTime(page.userMessage.timestamp)}</span>
              <CopyButton text={page.userMessage.content} />
            </div>
          </div>

          <div className="py-4">
            {page.responses
              .filter((msg) => !isRedundantMutationTool(
                msg,
                page.responses.some((response) => response.role === "tool" && Boolean(response.tool?.changes?.length)),
              ))
              .map((msg) =>
                msg.role === "tool" && msg.tool ? (
                  <div key={msg.id} className="py-1">
                    <ToolCallBadge tool={msg.tool} />
                  </div>
                ) : (
                  <div
                    key={msg.id}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}
                  >
                    {msg.thinking && (
                      <ThinkingBlock thinking={msg.thinking} isStreaming={msg.isStreaming && !msg.content} />
                    )}
                    <div className="text-[13px] leading-relaxed text-text prose-chat">
                      {msg.content ? (
                        <MessageBubbleContent content={msg.content} />
                      ) : msg.isStreaming ? (
                        <Shimmer className="text-[13px]" duration={1.5}>Thinking...</Shimmer>
                      ) : null}
                    </div>
                    {msg.attachments?.length ? (
                      <MessageAttachments attachments={msg.attachments} engine={engine} onPreviewImage={onPreviewImage} />
                    ) : null}
                    {(msg.content || msg.attachments?.length) && (
                      <div className={`flex items-center gap-1 mt-1 ${hoveredMsgId === msg.id ? "visible" : "invisible"}`}>
                        <CopyButton text={msg.content} />
                        <span className="text-[11px] text-text-muted/70">{formatTime(msg.timestamp)}</span>
                      </div>
                    )}
                  </div>
                ),
              )}
          </div>
        </div>
      ))}
    </div>
  );
}
