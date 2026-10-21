import { Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SoundTrim } from "../lib/sound";

const BAR_COUNT = 120;
const MIN_SECONDS = 0.2;
const EDGES = ["start", "end"] as const;

type Edge = (typeof EDGES)[number];

export interface SoundTrimSource {
  dataUrl: string;
  name: string;
  trim: SoundTrim | null;
}

interface Clip {
  duration: number;
  peaks: number[];
}

interface SoundTrimDialogProps {
  source: SoundTrimSource | null;
  volume: number;
  onSave: (trim: SoundTrim) => void;
  onClose: () => void;
}

async function decodeClip(dataUrl: string): Promise<Clip> {
  const response = await fetch(dataUrl);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const samples = buffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(samples.length / BAR_COUNT));
    const peaks = Array.from({ length: BAR_COUNT }, (_, bar) => {
      let peak = 0;
      const last = Math.min(samples.length, (bar + 1) * bucketSize);
      for (let i = bar * bucketSize; i < last; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
      return peak;
    });
    const loudest = Math.max(...peaks, 0.0001);
    return { duration: buffer.duration, peaks: peaks.map((peak) => peak / loudest) };
  } catch {
    throw new Error("This browser cannot play that file. Try an .mp3.");
  } finally {
    void context.close();
  }
}

export default function SoundTrimDialog({ source, volume, onSave, onClose }: SoundTrimDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playhead, setPlayhead] = useState<number | null>(null);

  useEffect(() => {
    if (!source) return;
    let isCurrent = true;
    setClip(null);
    setError(null);
    dialog.current?.showModal();
    (async () => {
      try {
        const decoded = await decodeClip(source.dataUrl);
        if (!isCurrent) return;
        const savedEnd = source.trim?.end ?? decoded.duration;
        setClip(decoded);
        setStart(Math.max(0, Math.min(source.trim?.start ?? 0, decoded.duration - MIN_SECONDS)));
        setEnd(Math.min(savedEnd, decoded.duration));
      } catch (err) {
        if (isCurrent) setError((err as Error).message);
      }
    })();
    return () => {
      isCurrent = false;
      stopPreview();
      dialog.current?.close();
    };
  }, [source]);

  function stopPreview() {
    player.current?.pause();
    player.current = null;
    setPlayhead(null);
  }

  async function togglePreview() {
    if (player.current || !source) return stopPreview();
    const audio = new Audio(source.dataUrl);
    audio.volume = volume / 100;
    audio.currentTime = start;
    player.current = audio;
    const followPlayback = () => {
      if (player.current !== audio) return;
      if (audio.ended || audio.currentTime >= end) return stopPreview();
      setPlayhead(audio.currentTime);
      requestAnimationFrame(followPlayback);
    };
    try {
      await audio.play();
      requestAnimationFrame(followPlayback);
    } catch {
      stopPreview();
    }
  }

  function moveEdge(edge: Edge, seconds: number) {
    if (!clip) return;
    if (edge === "start") setStart(Math.max(0, Math.min(seconds, end - MIN_SECONDS)));
    else setEnd(Math.min(clip.duration, Math.max(seconds, start + MIN_SECONDS)));
  }

  function toSeconds(clientX: number): number {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || !clip) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * clip.duration;
  }

  function nudgeEdge(e: KeyboardEvent, edge: Edge, seconds: number) {
    if (!clip) return;
    const step = e.shiftKey ? 1 : 0.1;
    const targets: Record<string, number> = {
      ArrowLeft: seconds - step,
      ArrowDown: seconds - step,
      ArrowRight: seconds + step,
      ArrowUp: seconds + step,
      Home: 0,
      End: clip.duration,
    };
    const target = targets[e.key];
    if (target === undefined) return;
    e.preventDefault();
    stopPreview();
    moveEdge(edge, target);
  }

  const toPercent = (seconds: number): string => `${clip ? (seconds / clip.duration) * 100 : 0}%`;

  return (
    <dialog
      ref={dialog}
      aria-label="Trim sound"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="card w-[560px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex items-center gap-2 border-b border-line py-2 pl-5 pr-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">Trim sound</div>
          <div className="truncate text-[12px] text-ink-subtle">{source?.name}</div>
        </div>
        <button type="button" className="btn-subtle h-10 w-10 px-0" aria-label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 py-4">
        <p className="text-[12px] text-ink-subtle">Drag the two handles to pick the part that plays.</p>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-loz-red px-3 py-2 text-[12.5px] font-medium text-loz-red-ink">
            {error}
          </p>
        )}
        {!error && !clip && <div className="mt-3 h-24 animate-pulse rounded-md bg-surface-2" aria-label="Loading sound" />}
        {clip && (
          <div className="mt-3 flex items-center gap-5 rounded-md bg-surface-2 py-3 pl-3 pr-5">
            <div className="flex w-14 shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-ink shadow-sm hover:bg-surface-dim"
                aria-label={playhead === null ? "Play the selected part" : "Stop"}
                onClick={togglePreview}
              >
                {playhead === null ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              <span className="text-[12px] font-semibold tabular-nums text-primary">{(end - start).toFixed(2)}s</span>
            </div>

            <div ref={track} className="relative h-24 min-w-0 flex-1">
              <svg viewBox={`0 0 ${BAR_COUNT} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                {clip.peaks.map((peak, bar) => {
                  const height = Math.max(2, peak * 92);
                  const barSeconds = ((bar + 0.5) / BAR_COUNT) * clip.duration;
                  const isSelected = barSeconds >= start && barSeconds <= end;
                  return (
                    <rect
                      key={bar}
                      x={bar + 0.2}
                      y={50 - height / 2}
                      width={0.6}
                      height={height}
                      className={isSelected ? "fill-ink" : "fill-ink-disabled"}
                    />
                  );
                })}
              </svg>
              {playhead !== null && (
                <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary" style={{ left: toPercent(playhead) }} />
              )}
              {EDGES.map((edge) => {
                const seconds = edge === "start" ? start : end;
                return (
                  <div
                    key={edge}
                    role="slider"
                    tabIndex={0}
                    aria-label={edge === "start" ? "Start" : "End"}
                    aria-valuemin={0}
                    aria-valuemax={Number(clip.duration.toFixed(2))}
                    aria-valuenow={Number(seconds.toFixed(2))}
                    aria-valuetext={`${seconds.toFixed(2)} seconds`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      stopPreview();
                    }}
                    onPointerMove={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) moveEdge(edge, toSeconds(e.clientX));
                    }}
                    onKeyDown={(e) => nudgeEdge(e, edge, seconds)}
                    style={{ left: toPercent(seconds) }}
                    className="group absolute inset-y-0 z-10 flex w-10 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
                  >
                    <span className="absolute inset-y-0 w-[3px] rounded-full bg-ink" />
                    <span className="relative h-7 w-3 rounded-full border-2 border-surface-2 bg-ink group-focus-visible:ring-2 group-focus-visible:ring-primary" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {clip && (
          <div className="mt-1.5 flex justify-between pl-[88px] pr-5 text-[11.5px] tabular-nums text-ink-subtle">
            <span>Start {start.toFixed(2)}s</span>
            <span>End {end.toFixed(2)}s</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 px-5 pb-4">
        <button type="button" className="btn-default min-h-10" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary min-h-10" disabled={!clip} onClick={() => clip && onSave({ start, end, duration: clip.duration })}>
          Save
        </button>
      </div>
    </dialog>
  );
}
