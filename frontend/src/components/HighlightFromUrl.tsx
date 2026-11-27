import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { findHighlightTarget, withoutHighlight } from "../lib/highlight-match";

const SEARCH_MS = 3000;
const CLASS = "help-highlight";

type Tip = { top: number; left: number };

/**
 * Centres the element in its own scrolling panel. Not scrollIntoView: that also scrolls the
 * overflow-hidden <main> of Layout.tsx, which leaves the page shifted under the header.
 */
function scrollToCentre(el: HTMLElement): void {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) {
      const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - p.clientHeight / 2 + el.offsetHeight / 2;
      p.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }
  }
}

/**
 * `?highlight=<label>` (links from the AI Connector's how_to, where_is and explain_screen): waits for
 * the page, finds the visible element with that label (retrying about 3 s while data loads), scrolls
 * to it, outlines it in pulsing gold for about 6 s with a small "Here" tooltip, then drops the
 * parameter with history.replaceState. No parameter = does nothing. It never clicks or edits.
 */
export function HighlightFromUrl() {
  const location = useLocation();
  const label = new URLSearchParams(location.search).get("highlight");
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!label) return;
    const started = performance.now();
    let frame = 0;
    let target: HTMLElement | null = null;
    const drop = () => window.history.replaceState(window.history.state, "", withoutHighlight(window.location.href));
    const finish = () => {
      target?.classList.remove(CLASS);
      setTip(null);
    };
    const follow = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      setTip({ top: Math.max(4, r.top - 30), left: Math.max(4, r.left) });
      frame = requestAnimationFrame(follow);
    };
    const seek = () => {
      target = findHighlightTarget(document, label);
      if (target) {
        scrollToCentre(target);
        target.classList.add(CLASS);
        target.addEventListener("animationend", () => {
          cancelAnimationFrame(frame);
          finish();
        }, { once: true });
        drop();
        frame = requestAnimationFrame(follow);
        return;
      }
      if (performance.now() - started > SEARCH_MS) {
        drop();
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => {
      cancelAnimationFrame(frame);
      finish();
    };
  }, [label, location.pathname]);

  if (!tip) return null;
  return createPortal(
    <div role="status" aria-live="polite" className="help-highlight-tip" style={{ top: tip.top, left: tip.left }}>
      Here
    </div>,
    document.body,
  );
}
