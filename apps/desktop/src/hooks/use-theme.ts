import { useState, useEffect, useCallback } from "react";

export type ThemeName = "neutral" | "blue" | "claude" | "cursor" | "emerald" | "rose" | "purple" | "sunset" | "custom";

export interface ThemeColors {
  accent: string;
  bg: string;
  text: string;
  userBubble: string;
  inlineCodeBg: string;
  inlineCodeBorder: string;
  inlineCodeColor: string;
}

const THEMES: Record<Exclude<ThemeName, "custom">, ThemeColors> = {
  neutral: {
    accent: "#d4d4d8",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#1D1D1D",
    inlineCodeBg: "rgba(255, 255, 255, 0.06)",
    inlineCodeBorder: "rgba(255, 255, 255, 0.08)",
    inlineCodeColor: "#c9d1d9",
  },
  blue: {
    accent: "#3b82f6",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#01366A",
    inlineCodeBg: "rgba(56, 139, 253, 0.1)",
    inlineCodeBorder: "rgba(56, 139, 253, 0.2)",
    inlineCodeColor: "#79c0ff",
  },
  claude: {
    accent: "#d97706",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#2c2417",
    inlineCodeBg: "rgba(217, 119, 6, 0.1)",
    inlineCodeBorder: "rgba(217, 119, 6, 0.2)",
    inlineCodeColor: "#fbbf24",
  },
  cursor: {
    accent: "#22d3ee",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#0c2a33",
    inlineCodeBg: "rgba(34, 211, 238, 0.08)",
    inlineCodeBorder: "rgba(34, 211, 238, 0.15)",
    inlineCodeColor: "#67e8f9",
  },
  emerald: {
    accent: "#10b981",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#132a1f",
    inlineCodeBg: "rgba(16, 185, 129, 0.1)",
    inlineCodeBorder: "rgba(16, 185, 129, 0.2)",
    inlineCodeColor: "#6ee7b7",
  },
  rose: {
    accent: "#f43f5e",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#2a1318",
    inlineCodeBg: "rgba(244, 63, 94, 0.1)",
    inlineCodeBorder: "rgba(244, 63, 94, 0.2)",
    inlineCodeColor: "#fda4af",
  },
  purple: {
    accent: "#a855f7",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#1e1530",
    inlineCodeBg: "rgba(168, 85, 247, 0.1)",
    inlineCodeBorder: "rgba(168, 85, 247, 0.2)",
    inlineCodeColor: "#c4b5fd",
  },
  sunset: {
    accent: "#f97316",
    bg: "#141414",
    text: "#e8e8e8",
    userBubble: "#2a1a0e",
    inlineCodeBg: "rgba(249, 115, 22, 0.1)",
    inlineCodeBorder: "rgba(249, 115, 22, 0.2)",
    inlineCodeColor: "#fdba74",
  },
};

function loadCustomColors(): Record<string, Partial<ThemeColors>> {
  try {
    const raw = localStorage.getItem("themeCustomColors");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function applyColors(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty("--color-accent", colors.accent);
  root.style.setProperty("--color-accent-hover", colors.accent + "cc");
  root.style.setProperty("--color-bg", colors.bg);
  root.style.setProperty("--color-text", colors.text);
  root.style.setProperty("--color-user-bubble", colors.userBubble);
  root.style.setProperty("--inline-code-bg", colors.inlineCodeBg);
  root.style.setProperty("--inline-code-border", colors.inlineCodeBorder);
  root.style.setProperty("--inline-code-color", colors.inlineCodeColor);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    return (localStorage.getItem("theme") as ThemeName) ?? "neutral";
  });

  const [contrast, setContrastState] = useState<number>(() => {
    return Number(localStorage.getItem("themeContrast") ?? "60");
  });

  const [allCustomColors, setAllCustomColors] = useState<Record<string, Partial<ThemeColors>>>(loadCustomColors);

  const customColors = allCustomColors[theme] ?? {};

  const getActiveColors = useCallback((): ThemeColors => {
    const base = theme === "custom" ? THEMES.neutral : THEMES[theme];
    return { ...base, ...customColors };
  }, [theme, customColors]);

  const [activeColors, setActiveColors] = useState<ThemeColors>(getActiveColors);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem("theme", t);
  }, []);

  const setContrast = useCallback((value: number) => {
    setContrastState(value);
    localStorage.setItem("themeContrast", String(value));
  }, []);

  const setColor = useCallback((key: keyof ThemeColors, value: string) => {
    setAllCustomColors(prev => {
      const current = prev[theme] ?? {};
      const updated = { ...current, [key]: value };
      if (key === "inlineCodeColor") {
        updated.inlineCodeBg = `${value}1a`;
        updated.inlineCodeBorder = `${value}33`;
      }
      const next = { ...prev, [theme]: updated };
      localStorage.setItem("themeCustomColors", JSON.stringify(next));
      return next;
    });
  }, [theme]);

  // Update active colors and apply
  useEffect(() => {
    const colors = getActiveColors();
    setActiveColors(colors);
    applyColors(colors);
  }, [theme, allCustomColors, getActiveColors]);

  // Apply contrast
  useEffect(() => {
    // Map 0-100 to border/surface opacity adjustments
    const factor = contrast / 60; // 60 is "normal"
    const root = document.documentElement;
    root.style.setProperty("--color-border", `hsl(0 0% ${Math.round(10 + factor * 7)}%)`);
    root.style.setProperty("--color-surface", `hsl(0 0% ${Math.round(6 + factor * 4)}%)`);
    root.style.setProperty("--color-surface-hover", `hsl(0 0% ${Math.round(8 + factor * 6)}%)`);
    root.style.setProperty("--color-container", `hsl(0 0% ${Math.round(7 + factor * 5)}%)`);
  }, [contrast]);

  const resetColor = useCallback((key: keyof ThemeColors) => {
    setAllCustomColors(prev => {
      const current = { ...(prev[theme] ?? {}) };
      delete current[key];
      if (key === "inlineCodeColor") {
        delete current.inlineCodeBg;
        delete current.inlineCodeBorder;
      }
      const next = { ...prev, [theme]: current };
      localStorage.setItem("themeCustomColors", JSON.stringify(next));
      return next;
    });
  }, [theme]);

  const isCustomized = useCallback((key: keyof ThemeColors) => {
    return key in customColors;
  }, [customColors]);

  return { theme, setTheme, colors: activeColors, setColor, resetColor, isCustomized, contrast, setContrast, presets: THEMES };
}
