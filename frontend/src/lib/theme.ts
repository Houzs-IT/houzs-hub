import { useState } from "react";

export type Theme = "light" | "dark";
const KEY = "it-hub-theme";

// Personal preference, so localStorage (not URL). index.html applies it before
// first paint to avoid a light flash.
function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the toggle still works for this tab.
    }
    setTheme(next);
  }
  return { theme, toggle };
}
