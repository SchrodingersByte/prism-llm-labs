"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "prism-theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Toggle the `.dark` class to match the requested theme; returns the resolved value. */
function applyTheme(theme: Theme): "light" | "dark" {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

/**
 * Lightweight theme manager. Reuses the existing `prism-theme` localStorage key
 * (the pre-hydration script in app/layout.tsx reads the same key to avoid a flash),
 * so we deliberately avoid next-themes and its separate storage key. "system"
 * is represented as the absence of the key.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial: Theme = stored === "light" || stored === "dark" ? stored : "system";
    setThemeState(initial);
    setResolvedTheme(applyTheme(initial));
  }, []);

  // Follow OS changes while in "system" mode.
  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolvedTheme(applyTheme("system"));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    if (t === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, t);
    setResolvedTheme(applyTheme(t));
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
