import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";

const SLIDE_MS = 200;
const LAND_MS = 220;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
const SLIDE_ID = "board-slide";

interface CardPosition {
  list: Element | null;
  top: number;
}

export interface Landing {
  code: string;
  ghostCopy: HTMLElement;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function currentShiftY(card: HTMLElement): number {
  const { transform } = getComputedStyle(card);
  return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
}

function slideCard(card: HTMLElement, fromY: number): void {
  const startY = fromY + currentShiftY(card);
  card.getAnimations().forEach((animation) => animation.id === SLIDE_ID && animation.cancel());
  card.animate([{ transform: `translateY(${startY}px)` }, { transform: "none" }], { id: SLIDE_ID, duration: SLIDE_MS, easing: EASE_OUT });
}

export function copyGhost(ghost: HTMLElement): HTMLElement | null {
  const ghostCopy = ghost.cloneNode(true);
  if (!(ghostCopy instanceof HTMLElement)) return null;
  ghostCopy.style.animation = "none";
  document.body.append(ghostCopy);
  return ghostCopy;
}

function flyGhostCopyTo(card: HTMLElement, ghostCopy: HTMLElement): void {
  const from = ghostCopy.getBoundingClientRect();
  const to = card.getBoundingClientRect();
  const deltaX = to.left + to.width / 2 - (from.left + from.width / 2);
  const deltaY = to.top + to.height / 2 - (from.top + from.height / 2);
  card.animate([{ opacity: 0 }, { opacity: 0 }], { duration: LAND_MS });
  const flight = ghostCopy.animate(
    [{ transform: "rotate(2deg) scale(1.03)" }, { transform: `translate(${deltaX}px, ${deltaY}px)` }],
    { duration: LAND_MS, easing: EASE_OUT, fill: "forwards" },
  );
  const removeCopy = (): void => ghostCopy.remove();
  flight.onfinish = removeCopy;
  flight.oncancel = removeCopy;
}

// Cards are compared by their layout position inside their list, so scrolling a column never counts as a move.
export function useCardMotion(board: RefObject<HTMLElement>, landing: MutableRefObject<Landing | null>): void {
  const positions = useRef(new Map<string, CardPosition>());

  useLayoutEffect(() => {
    const isReduced = prefersReducedMotion();
    const landed = landing.current;
    landing.current = null;
    const nextPositions = new Map<string, CardPosition>();

    board.current?.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
      const code = card.dataset.card ?? "";
      const position = { list: card.offsetParent, top: card.offsetTop };
      nextPositions.set(code, position);
      const previous = positions.current.get(code);
      if (isReduced || code === landed?.code) return;
      if (previous?.list === position.list && previous.top !== position.top) slideCard(card, previous.top - position.top);
    });
    positions.current = nextPositions;

    if (!landed) return;
    const card = board.current?.querySelector<HTMLElement>(`[data-card="${landed.code}"]`);
    if (card && !isReduced) flyGhostCopyTo(card, landed.ghostCopy);
    else landed.ghostCopy.remove();
  });
}
