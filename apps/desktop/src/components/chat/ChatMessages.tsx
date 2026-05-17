import { useState } from "react";
import type { BrowserEngine } from "@/lib/engine";
import type { Page } from "./chat-message-utils";
import { dedupeDuplicateCodeChangeTools, formatTime, isRedundantMutationTool } from "./chat-message-utils";
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
      {pages.map((page, index) => (
        <ChatMessagePage
          key={page.userMessage?.id ?? page.responses[0]?.id ?? `page-${index}`}
          page={page}
          engine={engine}
          hoveredMsgId={hoveredMsgId}
          setHoveredMsgId={setHoveredMsgId}
          onPreviewImage={onPreviewImage}
        />
      ))}
    </div>
  );
}

function ChatMessagePage({
  page,
  engine,
  hoveredMsgId,
  setHoveredMsgId,
  onPreviewImage,
}: {
  page: Page;
  engine: BrowserEngine;
  hoveredMsgId: string | null;
  setHoveredMsgId: (id: string | null) => void;
  onPreviewImage: (preview: ImagePreviewState) => void;
}) {
  const userMessage = page.userMessage;
  const responses = dedupeDuplicateCodeChangeTools(page.responses);
  const pageHasCodeChanges = responses.some((response) => response.role === "tool" && Boolean(response.tool?.changes?.length));

  return (
    <div>
      {userMessage ? (
        <div
          className="flex flex-col items-end py-4"
          onMouseEnter={() => setHoveredMsgId(userMessage.id)}
          onMouseLeave={() => setHoveredMsgId(null)}
        >
          {userMessage.content ? (
            <div className="max-w-[85%] rounded-2xl bg-user-bubble px-4 py-2 text-[13px] leading-relaxed text-text break-words overflow-hidden">
              {userMessage.content}
            </div>
          ) : null}
          {userMessage.attachments?.length ? (
            <MessageAttachments attachments={userMessage.attachments} engine={engine} align="end" onPreviewImage={onPreviewImage} />
          ) : null}
          <div className={`flex items-center gap-1 mt-1 ${hoveredMsgId === userMessage.id ? "visible" : "invisible"}`}>
            <span className="text-[11px] text-text-muted/70">{formatTime(userMessage.timestamp)}</span>
            <CopyButton text={userMessage.content} />
          </div>
        </div>
      ) : null}

      <div className="py-4">
        {responses
          .filter((msg) => !isRedundantMutationTool(msg, pageHasCodeChanges))
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
  );
}
