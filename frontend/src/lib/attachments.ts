import type { ClipboardEvent } from "react";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface PickedFiles {
  files: File[];
  error: string | null;
}

// Same limits as the server, told up front instead of after a long upload.
export function mergePickedFiles(current: File[], picked: File[]): PickedFiles {
  const tooBig = picked.filter((file) => file.size > MAX_FILE_BYTES);
  const merged = [...current, ...picked.filter((file) => file.size <= MAX_FILE_BYTES)];
  const error = tooBig.length
    ? `${tooBig.map((file) => file.name).join(", ")}: over 10 MB, not attached`
    : merged.length > MAX_FILES
      ? `Up to ${MAX_FILES} files at a time; the rest were not attached`
      : null;
  return { files: merged.slice(0, MAX_FILES), error };
}

export function takePastedFiles(event: ClipboardEvent): File[] {
  const pasted = Array.from(event.clipboardData.files);
  // Excel and Word also put a picture of copied text on the clipboard; paste that as text.
  if (!pasted.length || event.clipboardData.types.includes("text/plain")) return [];
  event.preventDefault();
  return pasted;
}
