import { useEffect, useRef } from "react";

// Polling is the realtime mechanism (same as Houzs ERP). Skips ticks while
// the tab is hidden and refreshes as soon as it becomes visible again.
export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    const onVis = () => document.visibilityState === "visible" && ref.current();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
}
