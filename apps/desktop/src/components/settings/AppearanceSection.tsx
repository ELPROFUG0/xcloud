import { useState, useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme, type ThemeName, type ThemeColors } from "@/hooks/use-theme";
import type { BrowserEngine } from "@/lib/engine";

interface AppearanceSectionProps {
  engine: BrowserEngine;
}

export function AppearanceSection({ engine: _engine }: AppearanceSectionProps) {
  const { theme, setTheme, colors: themeColors, setColor, resetColor, isCustomized, contrast, setContrast } = useTheme();
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showThemeDropdown) return;
    function handleClick(e: MouseEvent) {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setShowThemeDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showThemeDropdown]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <h3 className="text-base font-semibold">Appearance</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-4">
          {/* Theme */}
          <div className="rounded-lg bg-container p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text">Theme</span>
              <div className="relative" ref={themeDropdownRef}>
                <button
                  onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                  className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 cursor-pointer transition-colors hover:bg-surface-hover"
                >
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-md text-[8px] font-bold"
                    style={{ backgroundColor: themeColors.userBubble, color: themeColors.accent }}
                  >
                    Aa
                  </div>
                  <span className="text-xs font-mono text-text-muted">{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </button>

                {showThemeDropdown && (
                  <div
                    className="absolute right-0 top-full mt-2 z-30 w-48 rounded-2xl p-1 shadow-2xl animate-[slideUp_150ms_ease-out]"
                    style={{
                      backgroundColor: "rgba(30, 30, 30, 0.85)",
                      backdropFilter: "blur(20px) saturate(180%)",
                      WebkitBackdropFilter: "blur(20px) saturate(180%)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    {([
                      { id: "neutral" as ThemeName, label: "Neutral", accent: "#d4d4d8", bubble: "#1D1D1D" },
                      { id: "blue" as ThemeName, label: "Blue", accent: "#3b82f6", bubble: "#01366A" },
                      { id: "claude" as ThemeName, label: "Claude", accent: "#d97706", bubble: "#2c2417" },
                      { id: "cursor" as ThemeName, label: "Cursor", accent: "#22d3ee", bubble: "#0c2a33" },
                      { id: "emerald" as ThemeName, label: "Emerald", accent: "#10b981", bubble: "#132a1f" },
                      { id: "rose" as ThemeName, label: "Rose", accent: "#f43f5e", bubble: "#2a1318" },
                      { id: "purple" as ThemeName, label: "Purple", accent: "#a855f7", bubble: "#1e1530" },
                      { id: "sunset" as ThemeName, label: "Sunset", accent: "#f97316", bubble: "#2a1a0e" },
                    ]).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setTheme(t.id); setShowThemeDropdown(false); }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors",
                          theme === t.id ? "bg-white/10" : "hover:bg-white/6",
                        )}
                      >
                        <div
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[8px] font-bold"
                          style={{ backgroundColor: t.bubble, color: t.accent }}
                        >
                          Aa
                        </div>
                        <span className="text-[11px] font-medium text-text">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Colors */}
          <div className="rounded-lg bg-container p-4">
            <h4 className="text-[13px] font-medium mb-3">Colors</h4>
            {([
              { label: "Accent", key: "accent" as keyof ThemeColors },
              { label: "Chat bubble", key: "userBubble" as keyof ThemeColors },
              { label: "Inline code", key: "inlineCodeColor" as keyof ThemeColors },
            ]).map((item, i, arr) => (
              <div key={item.key} className={cn("flex items-center justify-between py-3", i < arr.length - 1 && "border-b border-border/50")}>
                <span className="text-sm text-text">{item.label}</span>
                <div className="flex items-center gap-2">
                  {isCustomized(item.key) && (
                    <button
                      onClick={() => resetColor(item.key)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-text hover:bg-white/8"
                      title="Reset to default"
                    >
                      <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className="relative h-5 w-5 rounded-full overflow-hidden" style={{ backgroundColor: themeColors[item.key] }}>
                      <input
                        type="color"
                        value={themeColors[item.key]}
                        onChange={(e) => setColor(item.key, e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <span className="rounded-lg bg-surface px-3 py-1.5 text-xs font-mono text-text-muted">{themeColors[item.key].toUpperCase()}</span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* Typography & Display */}
          <div className="rounded-lg bg-container p-4">
            <h4 className="text-[13px] font-medium mb-3">Display</h4>

            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <span className="text-sm text-text">UI font</span>
              <span className="text-xs text-text-muted">Inter</span>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border/50">
              <span className="text-sm text-text">Code font</span>
              <span className="text-xs text-text-muted font-mono">JetBrains Mono</span>
            </div>

            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-text">Contrast</span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-32 accent-accent appearance-none h-1 rounded-full bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <span className="text-xs text-text-muted w-6 text-right">{contrast}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
