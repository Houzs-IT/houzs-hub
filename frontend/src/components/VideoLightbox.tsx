import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface VideoLightboxProps {
  src: string;
  title: string;
  onClose: () => void;
}

const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|ogv)$/i;

export function isVideoFile(mime: string, filename: string): boolean {
  return mime.startsWith("video/") || VIDEO_EXTENSION.test(filename);
}

export default function VideoLightbox({ src, title, onClose }: VideoLightboxProps): JSX.Element {
  const [hasPlaybackError, setHasPlaybackError] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // The parent re-renders on every ticket poll; a ref keeps the key listener from re-binding.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, []);

  const control = "grid h-10 w-10 place-items-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {hasPlaybackError ? (
        <div className="max-w-sm rounded-lg bg-black/60 p-6 text-center text-sm text-white/85">
          <p>This video can't play here. The file may be missing or in a format the browser doesn't support.</p>
          <a href={src} download={title} className="btn-default mt-4 inline-flex h-10 items-center gap-2 px-4">
            <Download className="h-4 w-4" /> Download it
          </a>
        </div>
      ) : (
        <video
          src={src}
          controls
          autoPlay
          playsInline
          onError={() => setHasPlaybackError(true)}
          className="max-h-[80dvh] max-w-full rounded-md bg-black shadow-2xl"
        />
      )}

      <div className="absolute right-4 top-4 flex items-center gap-1 rounded-[10px] bg-black/60 p-1">
        <a className={control} href={src} download={title} aria-label="Download" title="Download">
          <Download className="h-5 w-5" />
        </a>
        <button ref={closeButtonRef} className={control} onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 truncate text-center text-[13px] text-white/80">{title}</div>
    </div>,
    document.body,
  );
}
