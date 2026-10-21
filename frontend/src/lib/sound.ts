export const SOUNDS = {
  chime: { label: "Chime", notes: [880, 1320], noteSeconds: 0.3 },
  soft: { label: "Soft", notes: [660], noteSeconds: 0.5 },
  bell: { label: "Bell", notes: [1047, 1319, 1568], noteSeconds: 0.35 },
  off: { label: "Off", notes: [], noteSeconds: 0 },
} as const;

export type SoundChoice = keyof typeof SOUNDS;
export const DEFAULT_SOUND: SoundChoice = "chime";
const KEY = "it-hub-sound";

function isSoundChoice(value: string | null): value is SoundChoice {
  return value !== null && Object.hasOwn(SOUNDS, value);
}

// Personal preference per browser, like the theme. No choice saved means the team default.
export function loadSound(): SoundChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return isSoundChoice(saved) ? saved : DEFAULT_SOUND;
  } catch {
    return DEFAULT_SOUND;
  }
}

export function saveSound(choice: SoundChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private mode: the choice lasts for this tab only.
  }
}

export function playSound(choice: SoundChoice = loadSound()): void {
  const { notes, noteSeconds } = SOUNDS[choice];
  if (!notes.length) return;
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
