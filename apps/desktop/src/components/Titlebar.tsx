import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/cn";
import { Settings, Eye } from "lucide-react";

interface TitlebarProps {
  onToggleSettings: () => void;
  onTogglePreview?: () => void;
  settingsOpen: boolean;
  previewOpen?: boolean;
}

export function Titlebar({ onToggleSettings, onTogglePreview, settingsOpen, previewOpen }: TitlebarProps) {
  const startDrag = useCallback(async (e: React.MouseEvent) => {
    // Only drag on left click and not on interactive elements
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    await getCurrentWindow().startDragging();
  }, []);

  return (
    <div
      onMouseDown={startDrag}
      className="flex h-9 shrink-0 items-center justify-end px-3 cursor-default select-none"
    >
      <div className="flex items-center gap-1">
        {onTogglePreview && (
          <button
            onClick={onTogglePreview}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              previewOpen
                ? "bg-container text-text"
                : "text-text-muted hover:text-text",
            )}
            title="Dev Preview"
          >
            <Eye className="h-4 w-4" />
          </button>
        )}
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
    </div>
  );
}
