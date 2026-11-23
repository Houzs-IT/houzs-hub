// The few pieces the Meetings page needs from the app, in one file, so the page files stay the same as
// Houzs ERP's (one hub, several front ends): the JSON calls, the sub-tabs, a date input, the unread count.
import { useCallback, useEffect, useState, type ReactNode } from "react";

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** A refused call: the status and the raw body (a 409 carries the booking conflict the page draws). */
export class MeetingsApiError extends Error {
  readonly status: number;
  readonly rawBody: string;
  constructor(message: string, status: number, rawBody: string) {
    super(message);
    this.status = status;
    this.rawBody = rawBody;
  }
}

// The page is written against /api/meetings (the ERPs' relay); here the same routes sit at /api/v1/meetings.
const url = (path: string) => path.replace(/^\/api\/meetings/, "/api/v1/meetings");

function messageOf(status: number, raw: string): string {
  try {
    const j = JSON.parse(raw) as { error?: unknown };
    if (j.error === "conflict") return "That time is taken.";
    if (typeof j.error === "string" && j.error) return j.error;
  } catch {
    /* not JSON: the plain sentence for the status */
  }
  if (status === 401) return "You are signed out. Sign in again.";
  if (status === 403) return "You do not have permission for this.";
  return "Something went wrong. Please try again.";
}

async function call<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      credentials: "include",
      headers: form || body === undefined ? undefined : { "Content-Type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new MeetingsApiError(method === "GET" ? "Could not reach the server. Check your internet connection and try again." : "No answer came back from the server, so this may still have been saved. Refresh and check before trying again.", 0, "");
  }
  const raw = await res.text();
  if (!res.ok) throw new MeetingsApiError(messageOf(res.status, raw), res.status, raw);
  return (raw ? JSON.parse(raw) : {}) as T;
}

export const api = {
  get: <T,>(path: string, _opts?: { signal?: AbortSignal }) => call<T>("GET", path),
  post: <T = unknown,>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T = unknown,>(path: string, body?: unknown) => call<T>("PATCH", path, body ?? {}),
  postForm: <T = unknown,>(path: string, form: FormData) => call<T>("POST", path, undefined, form),
  async fetchBlobUrl(path: string, mime?: string): Promise<string> {
    const res = await fetch(url(path), { credentials: "include" });
    if (!res.ok) throw new MeetingsApiError("That file could not be opened.", res.status, "");
    const blob = await res.blob();
    return URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
  },
};

/** Opens a file fetched with the session in a new tab, and frees it after `keepMs`. */
export async function openLoadedTab(load: () => Promise<string>, keepMs: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const u = await load();
    if (tab) tab.location.href = u;
    else window.location.assign(u);
    setTimeout(() => URL.revokeObjectURL(u), keepMs);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export function TabStrip<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" aria-label="Meetings pages" className={cn("flex gap-1 overflow-x-auto border-b border-line", p.className)}>
      {p.options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === p.value} onClick={() => p.onChange(o.value)}
          className={cn("tap -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold", o.value === p.value ? "border-primary text-primary" : "border-transparent text-ink-subtle hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DateField(p: { value: string; onChange: (v: string) => void; fullWidth?: boolean; "aria-label"?: string }) {
  return (
    <input type="date" aria-label={p["aria-label"]} value={p.value} onChange={(e) => p.onChange(e.target.value)}
      className={cn("h-9 rounded-md border border-line bg-surface px-2 text-[13px] text-ink", p.fullWidth && "w-full")} />
  );
}

/* ---------- the unread count, shared by the page and the sidebar ---------- */

const REFRESH = "meetings:unread-refresh";

/** Re-read the count now: My meetings was just opened, which marks every update read. */
export function useRefreshMeetingsUnread(): () => void {
  return useCallback(() => window.dispatchEvent(new Event(REFRESH)), []);
}

/** Meeting invites, changes and cancellations not yet seen; 0 on any failure. Polled once a minute while visible. */
export function useMeetingsUnread(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/v1/meetings/unread", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { unread: 0 }))
        .then((j: { unread?: unknown }) => { if (live) setN(Math.max(0, Math.floor(Number(j.unread) || 0))); })
        .catch(() => { if (live) setN(0); });
    };
    load();
    const t = window.setInterval(load, 60_000);
    window.addEventListener(REFRESH, load);
    document.addEventListener("visibilitychange", load);
    return () => { live = false; window.clearInterval(t); window.removeEventListener(REFRESH, load); document.removeEventListener("visibilitychange", load); };
  }, []);
  return n;
}
