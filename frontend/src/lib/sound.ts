const TONES = {
  chime: { notes: [880, 1320], noteSeconds: 0.3 },
  soft: { notes: [660], noteSeconds: 0.5 },
  bell: { notes: [1047, 1319, 1568], noteSeconds: 0.35 },
} as const;

export const SOUND_LABELS = { off: "Off", chime: "Chime", soft: "Soft", bell: "Bell", custom: "Custom" } as const;

export type SoundChoice = keyof typeof SOUND_LABELS;
export const DEFAULT_SOUND: SoundChoice = "off";
// localStorage holds about 5 MB per site and a data URL is a third bigger than the file.
export const MAX_CUSTOM_BYTES = 500_000;
const KEY = "it-hub-sound";
const CUSTOM_FILE_KEY = "it-hub-sound-file";
const CUSTOM_NAME_KEY = "it-hub-sound-name";

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

export function loadCustomSoundName(): string | null {
  return readStorage(CUSTOM_NAME_KEY);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the file.")));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function saveCustomSound(file: File): Promise<void> {
  if (!file.type.startsWith("audio/")) throw new Error("Pick an audio file, like .mp3 or .wav.");
  if (file.size > MAX_CUSTOM_BYTES) throw new Error(`File is too big. Keep it under ${MAX_CUSTOM_BYTES / 1000} KB.`);
  const dataUrl = await readAsDataUrl(file);
  try {
    localStorage.setItem(CUSTOM_FILE_KEY, dataUrl);
    localStorage.setItem(CUSTOM_NAME_KEY, file.name);
  } catch {
    throw new Error("This browser would not save the file. Try a smaller one.");
  }
}

function playTones({ notes, noteSeconds }: (typeof TONES)[keyof typeof TONES]): void {
  try {
    const audio = new AudioContext();
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const startAt = audio.currentTime + index * 0.12;
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, startAt);
      volume.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, startAt + noteSeconds);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + noteSeconds);
    });
    setTimeout(() => audio.close(), (notes.length * 0.12 + noteSeconds) * 1000 + 300);
  } catch {}
}

export function playSound(choice: SoundChoice = loadSound()): void {
  if (choice === "off") return;
  if (choice === "custom") {
    const file = readStorage(CUSTOM_FILE_KEY);
    if (file) new Audio(file).play().catch(() => {});
    return;
  }
  playTones(TONES[choice]);
}
