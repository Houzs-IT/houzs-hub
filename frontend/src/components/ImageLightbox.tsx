import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const TAP_ZOOM = 2.5;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [view, setView] = useState<View>(FIT);
  const [isDragging, setIsDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  // The parent re-renders on every ticket poll; a ref keeps the key listener from re-binding.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Zooms by `factor`, keeping the point at (pointX, pointY) from the screen centre still.
  function zoomBy(factor: number, pointX = 0, pointY = 0) {
    setView((v) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * factor));
      if (scale === MIN_ZOOM) return FIT;
      const ratio = scale / v.scale;
      return { scale, x: pointX - (pointX - v.x) * ratio, y: pointY - (pointY - v.y) * ratio };
    });
  }

  function fromCentre(clientX: number, clientY: number) {
    const rect = overlayRef.current!.getBoundingClientRect();
    return [clientX - rect.left - rect.width / 2, clientY - rect.top - rect.height / 2] as const;
  }

  useEffect(() => {
    const overlay = overlayRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    // React's wheel listener is passive, so it cannot stop the page (or browser) zooming.
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      zoomBy(Math.exp(-delta * 0.002), ...fromCentre(e.clientX, e.clientY));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
      else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") setView(FIT);
      else if (e.key === "Tab") {
        const buttons = [...overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const edge = e.shiftKey ? buttons[0] : buttons[buttons.length - 1];
        if (document.activeElement === edge || !overlay.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
        }
      }
    }
    overlay.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKey);
    return () => {
      overlay.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, []);

  function startDrag(e: PointerEvent<HTMLImageElement>) {
    if (view.scale === MIN_ZOOM) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragFrom.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  }
  function moveDrag(e: PointerEvent<HTMLImageElement>) {
    const from = dragFrom.current;
    if (!from) return;
    dragFrom.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + e.clientX - from.x, y: v.y + e.clientY - from.y }));
  }
  function endDrag() {
    dragFrom.current = null;
    setIsDragging(false);
  }

  const isZoomed = view.scale > MIN_ZOOM;
  const control =
    "grid h-10 w-10 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent";

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(e) => !isZoomed && zoomBy(TAP_ZOOM, ...fromCentre(e.clientX, e.clientY))}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        className={`max-h-[85vh] max-w-[92vw] touch-none select-none object-contain ${
          isZoomed ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
        } ${isDragging ? "" : "transition-transform duration-150 ease-out motion-reduce:transition-none"}`}
      />

      <div className="absolute right-4 top-4 flex items-center gap-1 rounded-[10px] bg-black/60 p-1">
        <button className={control} onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!isZoomed} aria-label="Zoom out" title="Zoom out (-)">
          <ZoomOut className="h-5 w-5" />
        </button>
        <span className="w-12 text-center font-docno text-[12px] tabular-nums text-white/85">{Math.round(view.scale * 100)}%</span>
        <button className={control} onClick={() => zoomBy(ZOOM_STEP)} disabled={view.scale >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (+)">
          <ZoomIn className="h-5 w-5" />
        </button>
        <button className={control} onClick={() => setView(FIT)} disabled={!isZoomed} aria-label="Reset zoom" title="Reset (0)">
          <RotateCcw className="h-5 w-5" />
        </button>
        <button ref={closeRef} className={control} onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 truncate text-center text-[13px] text-white/80">{alt}</div>
    </div>,
    document.body,
  );
}
