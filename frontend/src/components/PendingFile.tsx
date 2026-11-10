import { FileText, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import ImageLightbox from "./ImageLightbox";
import VideoLightbox, { isVideoFile } from "./VideoLightbox";

export interface PendingFileProps {
  file: File;
  onRemove: () => void;
}

export default function PendingFile({ file, onRemove }: PendingFileProps): JSX.Element | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isViewing, setIsViewing] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!previewUrl) return null;
  const isVideo = isVideoFile(file.type, file.name);
  return (
    <div className="relative w-28 overflow-hidden rounded border border-line bg-surface">
      {isViewing &&
        (isVideo ? (
          <VideoLightbox src={previewUrl} title={file.name} onClose={() => setIsViewing(false)} />
        ) : (
          <ImageLightbox src={previewUrl} alt={file.name} onClose={() => setIsViewing(false)} />
        ))}
      {file.type.startsWith("image/") ? (
        <button type="button" className="block w-full" aria-label={`Preview ${file.name}`} onClick={() => setIsViewing(true)}>
          <img src={previewUrl} alt="" className="h-20 w-full object-cover hover:opacity-90" />
        </button>
      ) : isVideo ? (
        <button type="button" className="grid h-20 w-full place-items-center hover:bg-hover" aria-label={`Play ${file.name}`} onClick={() => setIsViewing(true)}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/80 text-surface">
            <Play className="h-4 w-4 translate-x-px fill-current" />
          </span>
        </button>
      ) : (
        <a href={previewUrl} target="_blank" rel="noreferrer" aria-label={`Open ${file.name}`} className="grid h-20 place-items-center hover:bg-hover">
          <FileText className="h-6 w-6 text-ink-subtle" />
        </a>
      )}
      <div className="truncate border-t border-line px-2 py-1 text-xs text-ink-subtle" title={file.name}>
        {file.name}
      </div>
      <button
        type="button"
        className="tap absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
