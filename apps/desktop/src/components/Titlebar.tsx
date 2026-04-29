import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { Settings } from "lucide-react";

interface TitlebarProps {
  onToggleSettings: () => void;
  settingsOpen: boolean;
}

export function Titlebar({ onToggleSettings, settingsOpen }: TitlebarProps) {
  const startDrag = useCallback(async (e: React.MouseEvent) => {
    // Only drag on left click and not on interactive elements
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    await getCurrentWindow().startDragging();
  }, []);

  return (
    <div
      onMouseDown={startDrag}
      className="flex h-9 shrink-0 items-center justify-end border-b border-border bg-bg px-3 cursor-default select-none"
    >
      <button
        onClick={onToggleSettings}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
          settingsOpen
            ? "bg-container text-text"
            : "text-text-muted hover:text-text",
        )}
        title="Settings"
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  );
}
