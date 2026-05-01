import { useState, useRef, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { ImagePlus } from "lucide-react";
import { updateAgentAvatar } from "@/lib/update-identity";

interface EmojiPickerProps {
  /** Called when an emoji is selected */
  onSelect: (emoji: string) => void;
  /** Called when an image is selected — returns the file path */
  onSelectImage?: (path: string) => void;
  /** Agent ID for saving the image to workspace */
  agentId?: string;
  onClose: () => void;
}

const EMOJI_LIST = [
  "🤖", "🧠", "⚡", "🔮", "✨", "🌟", "💫", "🎯",
  "🚀", "💡", "🔥", "❄️", "🌊", "🌈", "☀️", "🌙",
  "🦊", "🐱", "🐶", "🦁", "🐺", "🦅", "🐉", "🦋",
  "💎", "🏆", "👑", "🎭", "🎪", "🎨", "🎵", "🎮",
  "🛡️", "⚔️", "🔑", "🧩", "📡", "🔬", "🧪", "💻",
  "👻", "🤡", "👽", "🤯", "😎", "🥷", "🧙", "🦸",
  "🍀", "🌸", "🌺", "🍄", "🌵", "🎄", "🌴", "🍁",
  "💜", "💙", "💚", "💛", "🧡", "❤️", "🖤", "🤍",
];

export function EmojiPicker({ onSelect, onSelectImage, agentId, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleImageUpload = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });

    if (!selected) return;

    const filePath = typeof selected === "string" ? selected : (selected as unknown as { path: string }).path;
    if (!filePath) return;

    // Copy image to agent workspace
    const ext = filePath.split(".").pop() ?? "png";
    const destDir = agentId && agentId !== "main"
      ? `.openclaw/workspace/${agentId}`
      : ".openclaw/workspace";
    const destPath = `${destDir}/avatar.${ext}`;

    try {
      await copyFile(filePath, destPath, { toPathBaseDir: BaseDirectory.Home });
      if (agentId) await updateAgentAvatar(agentId, `avatar.${ext}`);
      onSelectImage?.(destPath);
    } catch {
      // Fallback — just pass the original path
      if (agentId) await updateAgentAvatar(agentId, filePath);
      onSelectImage?.(filePath);
    }

    onClose();
  }, [agentId, onSelectImage, onClose]);

  return (
    <div
      ref={ref}
      className="w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
    >
      <div className="p-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type an emoji..."
          className="w-full rounded-lg bg-container px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-muted"
          autoFocus
        />
      </div>

      {/* Upload image button */}
      <div className="px-2 pb-2">
        <button
          onClick={handleImageUpload}
          className="flex w-full items-center gap-2 rounded-lg bg-container px-3 py-2 text-xs text-text transition-colors hover:bg-surface-hover"
        >
          <ImagePlus className="h-3.5 w-3.5 text-text-muted" />
          <span>Upload image</span>
        </button>
      </div>

      <div className="grid grid-cols-8 gap-0.5 px-2 pb-2 max-h-48 overflow-y-auto">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-white/10"
          >
            {emoji}
          </button>
        ))}
      </div>
      {search && (
        <div className="border-t border-border px-2 py-2">
          <button
            onClick={() => { if (search.trim()) onSelect(search.trim()); }}
            className="flex w-full items-center justify-center rounded-lg bg-container px-3 py-1.5 text-xs text-text transition-colors hover:bg-surface-hover"
          >
            Use "{search}"
          </button>
        </div>
      )}
    </div>
  );
}
