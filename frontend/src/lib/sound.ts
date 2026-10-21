export const SOUND_LABELS = { chime: "Chime", off: "Off", custom: "Custom" } as const;

export type SoundChoice = keyof typeof SOUND_LABELS;
export const DEFAULT_SOUND: SoundChoice = "chime";
// localStorage holds about 5 MB per site and a data URL is a third bigger than the file.
export const MAX_CUSTOM_BYTES = 500_000;
const KEY = "it-hub-sound";
const CUSTOM_FILE_KEY = "it-hub-sound-file";
const CUSTOM_NAME_KEY = "it-hub-sound-name";
const CUSTOM_TRIM_KEY = "it-hub-sound-trim";
const VOLUME_KEY = "it-hub-sound-volume";
export const DEFAULT_VOLUME = 80;

function isSoundChoice(value: string | null): value is SoundChoice {
  return value !== null && Object.hasOwn(SOUND_LABELS, value);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Personal preference per browser, like the theme. No choice saved means the team default.
export function loadSound(): SoundChoice {
  const saved = readStorage(KEY);
  return isSoundChoice(saved) ? saved : DEFAULT_SOUND;
}

export function saveSound(choice: SoundChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private mode: the choice lasts for this tab only.
  }
}

export function loadVolume(): number {
  const saved = Number(readStorage(VOLUME_KEY) ?? DEFAULT_VOLUME);
  return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : DEFAULT_VOLUME;
}

export function saveVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {}
}

export function loadCustomSoundName(): string | null {
  return readStorage(CUSTOM_NAME_KEY);
}

// Seconds. Only the part from start to end plays.
export interface SoundTrim {
  start: number;
  end: number;
  duration: number;
}

function isSoundTrim(value: unknown): value is SoundTrim {
  return (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    typeof value.start === "number" &&
    "end" in value &&
    typeof value.end === "number" &&
    "duration" in value &&
    typeof value.duration === "number"
  );
}

export function loadCustomTrim(): SoundTrim | null {
  try {
    const saved: unknown = JSON.parse(readStorage(CUSTOM_TRIM_KEY) ?? "null");
    return isSoundTrim(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function loadCustomSoundFile(): string | null {
  return readStorage(CUSTOM_FILE_KEY);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the file.")));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function readCustomSoundFile(file: File): Promise<string> {
  if (!file.type.startsWith("audio/")) throw new Error("Pick an audio file, like .mp3 or .wav.");
  if (file.size > MAX_CUSTOM_BYTES) throw new Error(`File is too big. Keep it under ${MAX_CUSTOM_BYTES / 1000} KB.`);
  return readAsDataUrl(file);
}

export function saveCustomSound(dataUrl: string, name: string, trim: SoundTrim): void {
  try {
    localStorage.setItem(CUSTOM_FILE_KEY, dataUrl);
    localStorage.setItem(CUSTOM_NAME_KEY, name);
    localStorage.setItem(CUSTOM_TRIM_KEY, JSON.stringify(trim));
  } catch {
    throw new Error("This browser would not save the file. Try a smaller one.");
  }
}

function playChime(volumeScale: number): void {
  if (volumeScale <= 0) return;
  try {
    const audio = new AudioContext();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const startAt = audio.currentTime + index * 0.12;
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, startAt);
      volume.gain.exponentialRampToValueAtTime(0.08 * volumeScale, startAt + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.3);
    });
    setTimeout(() => audio.close(), 800);
  } catch {}
}

export function playSound(choice: SoundChoice = loadSound(), volume: number = loadVolume()): void {
  if (choice === "off") return;
  const volumeScale = volume / 100;
  const file = choice === "custom" ? readStorage(CUSTOM_FILE_KEY) : null;
  // Custom picked but nothing uploaded yet: Chime, so a new ticket is never silent by accident.
  if (!file) return playChime(volumeScale);
  void playCustom(file, volumeScale, loadCustomTrim());
}

async function playCustom(file: string, volumeScale: number, trim: SoundTrim | null): Promise<void> {
  const audio = new Audio(file);
  audio.volume = volumeScale;
  if (trim) audio.currentTime = trim.start;
  try {
    await audio.play();
  } catch {
    return;
  }
  if (trim && trim.end < trim.duration) setTimeout(() => audio.pause(), (trim.end - trim.start) * 1000);
}
