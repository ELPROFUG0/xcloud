import { useState, useCallback, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { SendHorizonal } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Message your agent...",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-border bg-bg px-4 py-3",
            "text-sm text-text placeholder:text-text-muted",
            "focus:border-accent focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            "bg-accent text-white transition-colors",
            "hover:bg-accent-hover",
            "disabled:cursor-not-allowed disabled:opacity-30",
          )}
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
