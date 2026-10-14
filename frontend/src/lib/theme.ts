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
    // Pause transitions for the swap, or every hover colour fades on its own and the switch smears.
    const pause = document.createElement("style");
    pause.textContent = "*,*::before,*::after{transition:none !important}";
    document.head.append(pause);
    document.documentElement.classList.toggle("dark", next === "dark");
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => pause.remove()));
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the toggle still works for this tab.
    }
    setTheme(next);
  }
  return { theme, toggle };
}
