// Screenshots and photos are re-encoded as WebP before upload to save storage.
// GIF (animation), SVG, WebP, video and PDF pass through untouched.
const CONVERTIBLE = /^image\/(png|jpeg|heic|heif)$/;
const MAX_SIDE = 2560;
const QUALITY = 0.85;

export async function compressImage(file: File): Promise<File> {
  if (!CONVERTIBLE.test(file.type)) return file;
  try {
    // HEIC only decodes in Safari; elsewhere this throws and the original is kept.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
    // Browsers without a WebP encoder hand back PNG; tiny images can come out bigger. Keep the original then.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
