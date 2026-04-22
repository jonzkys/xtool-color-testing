import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "./IconButton";

type Mode = "light" | "dark" | "system";
const STORAGE_KEY = "xcs-gen:theme";

function preferredInitial(): Mode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

function applyMode(mode: Mode) {
  if (typeof document === "undefined") return;
  const useDark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", useDark);
  document.documentElement.style.colorScheme = useDark ? "dark" : "light";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(() => preferredInitial());

  useEffect(() => {
    applyMode(mode);
    if (mode === "system" && typeof window !== "undefined") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyMode("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [mode]);

  function cycle() {
    const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const icon =
    mode === "light" ? (
      <Sun className="h-4 w-4" />
    ) : mode === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Monitor className="h-4 w-4" />
    );
  const label =
    mode === "light"
      ? "Light — click for dark"
      : mode === "dark"
        ? "Dark — click for system"
        : "System — click for light";

  return (
    <IconButton
      variant="ghost"
      size="sm"
      icon={icon}
      aria-label={`Theme: ${mode}. Click to cycle.`}
      title={label}
      onClick={cycle}
    />
  );
}

/**
 * Inline script content to apply the saved theme before React mounts so
 * the first paint already matches (avoids a flash of light on dark-mode
 * preference). Injected from main.tsx → index.html via a <script> tag
 * isn't possible at runtime, so we call this directly as part of bootstrap.
 */
export function initThemeEagerly() {
  applyMode(preferredInitial());
}
