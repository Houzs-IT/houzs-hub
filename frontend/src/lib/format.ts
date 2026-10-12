import type { Priority, Status } from "../api/client";
import { SLA_HOURS, SLA_RUNNING } from "./labels";

const dt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const fmtDateTime = (iso: string | null) => (iso ? dt.format(new Date(iso)) : "-");

const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric" });
export const fmtDate = (iso: string) => d.format(new Date(iso));

export function fmtAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function span(ms: number) {
  const h = Math.abs(ms) / 3600_000;
  return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
}

export function sla(createdAt: string, priority: Priority, status: Status) {
  if (!SLA_RUNNING.includes(status)) return null;
  const left = new Date(createdAt).getTime() + SLA_HOURS[priority] * 3600_000 - Date.now();
  return left < 0
    ? { overdue: true, label: `Overdue ${span(left)}` }
    : { overdue: false, label: `Due in ${span(left)}` };
}

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
